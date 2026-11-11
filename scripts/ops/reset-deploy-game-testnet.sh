#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

NETWORK_NAME="${NETWORK_NAME:-testnet}"
SIGNER_ACCOUNT_ID="${SIGNER_ACCOUNT_ID:-nearena.testnet}"
BENEFICIARY_ACCOUNT_ID="${BENEFICIARY_ACCOUNT_ID:-nearena.testnet}"
CONTRACT_ACCOUNT_ID="${CONTRACT_ACCOUNT_ID:-nearena-v1.testnet}"
OWNER_ID="${OWNER_ID:-$SIGNER_ACCOUNT_ID}"
RELAYER_ACCOUNT_ID="${RELAYER_ACCOUNT_ID:-$SIGNER_ACCOUNT_ID}"
PLAYER_ACCOUNT_ID="${PLAYER_ACCOUNT_ID:-$SIGNER_ACCOUNT_ID}"
INITIAL_BALANCE_NEAR="${INITIAL_BALANCE_NEAR:-8 NEAR}"
ACCOUNT_CREATE_MODE="${ACCOUNT_CREATE_MODE:-auto}"
ON_DELETE_BAN="${ON_DELETE_BAN:-abort}"
REQUIRE_CLEAN_STATE="${REQUIRE_CLEAN_STATE:-true}"
CLEANUP_BATCH_SIZE="${CLEANUP_BATCH_SIZE:-200}"

ITEM_ID="${ITEM_ID:-basic_sword}"
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-120000000}"
# Pricing rule: 1 SC per 40 GC (price_stablecoin = price_game_coin / 40).
ITEM_PRICE_STABLECOIN="${ITEM_PRICE_STABLECOIN:-1250000}"
ITEM_PRICE_GAME_COIN="${ITEM_PRICE_GAME_COIN:-50000000}"
CHAIN_NAME="${CHAIN_NAME:-solana}"
TX_REF="${TX_REF:-smoke-tx-1}"
STABLE_TOKEN_CONTRACT_ID="${STABLE_TOKEN_CONTRACT_ID:-stable.testnet}"

EXPECTED_POT="${EXPECTED_POT:-90}"
EXPECTED_TREASURY="${EXPECTED_TREASURY:-10}"
ATTACHED_DEPOSIT="${ATTACHED_DEPOSIT:-0 NEAR}"
PREPAID_GAS="${PREPAID_GAS:-100 Tgas}"

ENABLE_SOLANA_MPC_PLAYER="${ENABLE_SOLANA_MPC_PLAYER:-true}"
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
SOLANA_KEYPAIR_PATH="${SOLANA_KEYPAIR_PATH:-$ROOT_DIR/scripts/.tmp/solana-devnet-player.json}"
SOLANA_AIRDROP_AMOUNT="${SOLANA_AIRDROP_AMOUNT:-1}"
SOLANA_AIRDROP_REQUIRED="${SOLANA_AIRDROP_REQUIRED:-false}"
SOLANA_MAX_RETRIES="${SOLANA_MAX_RETRIES:-6}"
SOLANA_RETRY_DELAY_SECONDS="${SOLANA_RETRY_DELAY_SECONDS:-5}"
IMPLICIT_ACCOUNT_FUNDING_NEAR="${IMPLICIT_ACCOUNT_FUNDING_NEAR:-0.2 NEAR}"
MPC_ADMIN_ACCOUNT_ID="${MPC_ADMIN_ACCOUNT_ID:-$SIGNER_ACCOUNT_ID}"
MPC_DERIVATION_PREFIX="${MPC_DERIVATION_PREFIX:-solana}"
MPC_PUBLIC_KEY_METHOD="${MPC_PUBLIC_KEY_METHOD:-derived_public_key}"
MPC_SIGN_GAS="${MPC_SIGN_GAS:-120 Tgas}"
MPC_SIGN_DEPOSIT="${MPC_SIGN_DEPOSIT:-1 yoctonear}"
NEAR_MAX_RETRIES="${NEAR_MAX_RETRIES:-8}"
NEAR_RETRY_DELAY_SECONDS="${NEAR_RETRY_DELAY_SECONDS:-4}"
NEAR_BACKOFF_MULTIPLIER="${NEAR_BACKOFF_MULTIPLIER:-2}"
NEAR_MAX_RETRY_DELAY_SECONDS="${NEAR_MAX_RETRY_DELAY_SECONDS:-30}"
NEAR_SUCCESS_DELAY_SECONDS="${NEAR_SUCCESS_DELAY_SECONDS:-1}"

RUST_TARGET="wasm32-unknown-unknown"
WASM_PATH="$ROOT_DIR/contracts/target/wasm32-unknown-unknown/release/gladiator_game.wasm"

log() {
  printf '\n[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run() {
  log "$*"
  "$@"
}

try_run() {
  "$@"
}

is_retryable_near_error() {
  local output="$1"
  if [[ "$output" == *"remaining balance will not be enough to cover storage"* ]]; then
    return 1
  fi

  [[ "$output" == *"this client has exceeded the rate limit"* ]] ||
    [[ "$output" == *"Cannot sign a transaction due to an error while fetching the most recent nonce value"* ]] ||
    [[ "$output" == *"429"* ]] ||
    [[ "$output" == *"Too Many Requests"* ]]
}

near_with_retry() {
  local attempt=1
  local output=""
  local exit_code=0
  local delay_seconds=0

  while true; do
    set +e
    output="$({ near "$@"; } 2>&1)"
    exit_code=$?
    set -e

    printf '%s\n' "$output"

    if [[ $exit_code -eq 0 ]]; then
      if [[ "$NEAR_SUCCESS_DELAY_SECONDS" != "0" ]]; then
        sleep "$NEAR_SUCCESS_DELAY_SECONDS"
      fi
      return 0
    fi

    if ! is_retryable_near_error "$output" || [[ $attempt -ge $NEAR_MAX_RETRIES ]]; then
      return "$exit_code"
    fi

    delay_seconds=$((NEAR_RETRY_DELAY_SECONDS * (NEAR_BACKOFF_MULTIPLIER ** (attempt - 1))))
    if (( delay_seconds > NEAR_MAX_RETRY_DELAY_SECONDS )); then
      delay_seconds=$NEAR_MAX_RETRY_DELAY_SECONDS
    fi

    log "near command failed with transient RPC error (attempt $attempt/$NEAR_MAX_RETRIES). Retrying in ${delay_seconds}s"
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

solana_airdrop_with_retry() {
  local amount="$1"
  local address="$2"
  local attempt=1
  local output=""
  local exit_code=0

  while true; do
    set +e
    output="$({ solana airdrop "$amount" "$address" --url "$SOLANA_RPC_URL"; } 2>&1)"
    exit_code=$?
    set -e

    printf '%s\n' "$output"

    if [[ $exit_code -eq 0 ]]; then
      return 0
    fi

    if [[ $attempt -ge $SOLANA_MAX_RETRIES ]]; then
      return "$exit_code"
    fi

    log "solana airdrop failed (attempt $attempt/$SOLANA_MAX_RETRIES). Retrying in ${SOLANA_RETRY_DELAY_SECONDS}s"
    sleep "$SOLANA_RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
}

account_exists() {
  near_with_retry account view-account-summary "$1" \
    network-config "$NETWORK_NAME" now >/dev/null 2>&1
}

call_change() {
  local signer_account_id="$1"
  local function_name="$2"
  local args_json="$3"
  near_with_retry contract call-function as-transaction "$CONTRACT_ACCOUNT_ID" "$function_name" json-args "$args_json" \
    prepaid-gas "$PREPAID_GAS" \
    attached-deposit "$ATTACHED_DEPOSIT" \
    sign-as "$signer_account_id" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send
}

call_view() {
  local function_name="$1"
  local args_json="$2"
  near_with_retry contract call-function as-read-only "$CONTRACT_ACCOUNT_ID" "$function_name" json-args "$args_json" \
    network-config "$NETWORK_NAME" now
}

require_cmd near
require_cmd cargo
require_cmd rustup

if [[ "$ENABLE_SOLANA_MPC_PLAYER" == "true" ]]; then
  require_cmd solana
  require_cmd solana-keygen
  require_cmd node
fi

log "Bootstrapping testnet contract: $CONTRACT_ACCOUNT_ID"

delete_was_skipped="false"

delete_contract_account_if_exists() {
  if ! account_exists "$CONTRACT_ACCOUNT_ID"; then
    log "Account $CONTRACT_ACCOUNT_ID does not exist, skipping delete"
    return 0
  fi

  local output=""
  local exit_code=0

  set +e
  output="$({ near_with_retry account delete-account "$CONTRACT_ACCOUNT_ID" \
    beneficiary "$BENEFICIARY_ACCOUNT_ID" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send; } 2>&1)"
  exit_code=$?
  set -e

  printf '%s\n' "$output"

  if [[ $exit_code -eq 0 ]]; then
    return 0
  fi

  if [[ "$output" == *"whose state is large is temporarily banned"* ]]; then
    case "$ON_DELETE_BAN" in
      abort)
        echo "Delete blocked by NEAR temporary large-state ban for $CONTRACT_ACCOUNT_ID" >&2
        echo "Set ON_DELETE_BAN=skip to continue without delete (only safe for storage-compatible deploys)," >&2
        echo "or choose a fresh CONTRACT_ACCOUNT_ID." >&2
        return 1
        ;;
      skip)
        log "Delete blocked by large-state ban; continuing without delete because ON_DELETE_BAN=skip"
        delete_was_skipped="true"
        return 0
        ;;
      cleanup)
        log "Delete blocked by large-state ban; running testnet state cleanup and retrying delete"

        CONTRACT_ACCOUNT_ID="$CONTRACT_ACCOUNT_ID" \
          OWNER_ID="$OWNER_ID" \
          NETWORK_NAME="$NETWORK_NAME" \
          BATCH_SIZE="$CLEANUP_BATCH_SIZE" \
          PREPAID_GAS="$PREPAID_GAS" \
          ATTACHED_DEPOSIT="$ATTACHED_DEPOSIT" \
          DRY_RUN=false \
          bash "$ROOT_DIR/scripts/ops/empty-state-testnet.sh"

        near_with_retry account delete-account "$CONTRACT_ACCOUNT_ID" \
          beneficiary "$BENEFICIARY_ACCOUNT_ID" \
          network-config "$NETWORK_NAME" \
          sign-with-keychain \
          send

        return 0
        ;;
      *)
        echo "Invalid ON_DELETE_BAN: $ON_DELETE_BAN (expected abort|skip|cleanup)" >&2
        return 1
        ;;
    esac
  fi

  return "$exit_code"
}

run delete_contract_account_if_exists

if [[ "$delete_was_skipped" == "true" && "$REQUIRE_CLEAN_STATE" == "true" ]]; then
  echo "Refusing to continue: delete was skipped but REQUIRE_CLEAN_STATE=true." >&2
  echo "Use a fresh CONTRACT_ACCOUNT_ID for reset deploys with storage changes." >&2
  echo "If and only if your storage layout is compatible, set REQUIRE_CLEAN_STATE=false." >&2
  exit 1
fi

create_with_fund_myself() {
  local output=""
  local exit_code=0

  set +e
  output="$({ near_with_retry account create-account fund-myself "$CONTRACT_ACCOUNT_ID" "$INITIAL_BALANCE_NEAR" \
    autogenerate-new-keypair \
    save-to-keychain \
    sign-as "$SIGNER_ACCOUNT_ID" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send; } 2>&1)"
  exit_code=$?
  set -e

  printf '%s\n' "$output"

  if [[ $exit_code -eq 0 ]]; then
    return 0
  fi

  if [[ "$output" == *"already exists"* ]]; then
    log "Account $CONTRACT_ACCOUNT_ID already exists, continuing"
    return 0
  fi

  return "$exit_code"
}

create_with_sponsor() {
  local output=""
  local exit_code=0

  set +e
  output="$({ near_with_retry account create-account sponsor-by-faucet-service "$CONTRACT_ACCOUNT_ID" \
    autogenerate-new-keypair \
    save-to-keychain \
    network-config "$NETWORK_NAME" \
    create; } 2>&1)"
  exit_code=$?
  set -e

  printf '%s\n' "$output"

  if [[ $exit_code -eq 0 ]]; then
    return 0
  fi

  if [[ "$output" == *"already exists"* ]]; then
    log "Account $CONTRACT_ACCOUNT_ID already exists, continuing"
    return 0
  fi

  return "$exit_code"
}

create_account_with_fallback() {
  if account_exists "$CONTRACT_ACCOUNT_ID"; then
    log "Account $CONTRACT_ACCOUNT_ID already exists, skipping account creation"
    return 0
  fi

  case "$ACCOUNT_CREATE_MODE" in
    fund-myself)
      run create_with_fund_myself
      ;;
    sponsor)
      run create_with_sponsor
      ;;
    auto)
      log "Trying account creation with fund-myself"
      if try_run create_with_fund_myself; then
        return 0
      fi

      log "fund-myself failed; retrying with sponsor-by-faucet-service"
      run create_with_sponsor
      ;;
    *)
      echo "Invalid ACCOUNT_CREATE_MODE: $ACCOUNT_CREATE_MODE (expected auto|fund-myself|sponsor)" >&2
      exit 1
      ;;
  esac
}

create_account_with_fallback

run rustup target add "$RUST_TARGET"
run cargo build \
  --manifest-path "$ROOT_DIR/contracts/Cargo.toml" \
  -p gladiator-game \
  --target "$RUST_TARGET" \
  --release

if [[ ! -f "$WASM_PATH" ]]; then
  echo "WASM artifact not found at $WASM_PATH" >&2
  exit 1
fi

run near_with_retry contract deploy "$CONTRACT_ACCOUNT_ID" \
  use-file "$WASM_PATH" \
  without-init-call \
  network-config "$NETWORK_NAME" \
  sign-with-keychain \
  send

build_mpc_public_key_args() {
  local derivation_path="$1"

  if [[ "$MPC_PUBLIC_KEY_METHOD" == "derived_public_key" ]]; then
    printf '{"path":"%s","predecessor":"%s","domain_id":1,"chain":"solana"}' "$derivation_path" "$MPC_ADMIN_ACCOUNT_ID"
    return 0
  fi

  printf '{}'
}

extract_first_ed25519() {
  local value="$1"
  printf '%s\n' "$value" | grep -Eo 'ed25519:[1-9A-HJ-NP-Za-km-z]+' | head -n 1
}

derive_implicit_account_from_public_key() {
  local public_key="$1"

  (
    cd "$ROOT_DIR/scripts"
    node --input-type=module -e '
      import bs58 from "bs58";
      const input = process.argv[1] ?? "";
      if (!input.startsWith("ed25519:")) {
        throw new Error("expected ed25519 public key");
      }
      const decoded = bs58.decode(input.slice("ed25519:".length));
      if (decoded.length !== 32) {
        throw new Error(`invalid ed25519 key length ${decoded.length}`);
      }
      console.log(Buffer.from(decoded).toString("hex"));
    ' "$public_key"
  )
}

create_solana_mpc_player() {
  mkdir -p "$(dirname "$SOLANA_KEYPAIR_PATH")"

  run solana-keygen new \
    --no-bip39-passphrase \
    --force \
    --outfile "$SOLANA_KEYPAIR_PATH"

  local solana_player_address
  solana_player_address="$(solana address -k "$SOLANA_KEYPAIR_PATH")"
  log "Solana devnet player address: $solana_player_address"

  if ! run solana_airdrop_with_retry "$SOLANA_AIRDROP_AMOUNT" "$solana_player_address"; then
    if [[ "$SOLANA_AIRDROP_REQUIRED" == "true" ]]; then
      echo "Solana airdrop failed and SOLANA_AIRDROP_REQUIRED=true" >&2
      exit 1
    fi

    log "Solana airdrop failed after retries; continuing because SOLANA_AIRDROP_REQUIRED=false"
  fi

  local derivation_path
  derivation_path="$MPC_DERIVATION_PREFIX:$solana_player_address"

  local mpc_args
  mpc_args="$(build_mpc_public_key_args "$derivation_path")"

  local mpc_key_output
  mpc_key_output="$(near_with_retry contract call-function as-read-only "$NEAR_MPC_CONTRACT_ID" "$MPC_PUBLIC_KEY_METHOD" json-args "$mpc_args" network-config "$NETWORK_NAME" now)"

  local mpc_derived_public_key
  mpc_derived_public_key="$(extract_first_ed25519 "$mpc_key_output")"
  if [[ -z "$mpc_derived_public_key" ]]; then
    echo "Failed to parse MPC derived public key from output" >&2
    echo "$mpc_key_output" >&2
    exit 1
  fi

  local mpc_player_near_account_id
  mpc_player_near_account_id="$(derive_implicit_account_from_public_key "$mpc_derived_public_key")"

  log "MPC derived NEAR implicit account: $mpc_player_near_account_id"

  run near_with_retry tokens "$SIGNER_ACCOUNT_ID" send-near "$mpc_player_near_account_id" "$IMPLICIT_ACCOUNT_FUNDING_NEAR" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send

  near_with_retry contract call-function as-transaction "$CONTRACT_ACCOUNT_ID" register_player json-args '{}' \
    prepaid-gas "$PREPAID_GAS" \
    attached-deposit "$ATTACHED_DEPOSIT" \
    sign-as "$mpc_player_near_account_id" \
    network-config "$NETWORK_NAME" \
    sign-with-mpc "$MPC_ADMIN_ACCOUNT_ID" \
    ed25519 \
    derivation-path "$derivation_path" \
    prepaid-gas "$MPC_SIGN_GAS" \
    attached-deposit "$MPC_SIGN_DEPOSIT" \
    sign-mpc-with-keychain \
    send

  local mpc_player_output
  mpc_player_output="$(call_view "get_player" "{\"account_id\":\"$mpc_player_near_account_id\"}")"
  if [[ "$mpc_player_output" != *"$mpc_player_near_account_id"* ]]; then
    echo "MPC player registration check failed for $mpc_player_near_account_id" >&2
    echo "$mpc_player_output" >&2
    exit 1
  fi

  log "MPC player registered from Solana path"
  log "Solana: $solana_player_address"
  log "MPC path: $derivation_path"
  log "NEAR implicit player: $mpc_player_near_account_id"
}

call_change "$OWNER_ID" "new" "{\"owner_id\":\"$OWNER_ID\",\"relayer_account_id\":\"$RELAYER_ACCOUNT_ID\",\"stable_token_contract_id\":\"$STABLE_TOKEN_CONTRACT_ID\",\"combat_config\":null}"
call_change "$OWNER_ID" "init_ghosts_v1" "{}"
call_change "$PLAYER_ACCOUNT_ID" "register_player" "{}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"nft_axe\",\"slot\":\"Weapon\",\"strength_bonus\":\"3000000\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"0\",\"strength_percent_bps\":200,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"150000000\",\"price_stablecoin\":\"3750000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"basic_sword\",\"slot\":\"Weapon\",\"strength_bonus\":\"1200000\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"0\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"$ITEM_PRICE_GAME_COIN\",\"price_stablecoin\":\"$ITEM_PRICE_STABLECOIN\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"basic_shield\",\"slot\":\"Shield\",\"strength_bonus\":\"0\",\"dexterity_bonus\":\"300000\",\"vitality_bonus\":\"1500000\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":100,\"price_game_coin\":\"70000000\",\"price_stablecoin\":\"1750000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"iron_armor\",\"slot\":\"Armor\",\"strength_bonus\":\"0\",\"dexterity_bonus\":\"150000\",\"vitality_bonus\":\"2600000\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":150,\"price_game_coin\":\"95000000\",\"price_stablecoin\":\"2375000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"potion_small\",\"slot\":\"Consumable\",\"strength_bonus\":\"0\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"25000000\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"15000000\",\"price_stablecoin\":\"375000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"potion_medium\",\"slot\":\"Consumable\",\"strength_bonus\":\"0\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"50000000\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"28000000\",\"price_stablecoin\":\"700000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"potion_large\",\"slot\":\"Consumable\",\"strength_bonus\":\"0\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"90000000\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"45000000\",\"price_stablecoin\":\"1125000\",\"active\":true}}"
call_change "$OWNER_ID" "upsert_item_definition" "{\"item\":{\"item_id\":\"$ITEM_ID\",\"slot\":\"Weapon\",\"strength_bonus\":\"2000000\",\"dexterity_bonus\":\"0\",\"vitality_bonus\":\"0\",\"strength_percent_bps\":0,\"dexterity_percent_bps\":0,\"vitality_percent_bps\":0,\"price_game_coin\":\"$ITEM_PRICE_GAME_COIN\",\"price_stablecoin\":\"$ITEM_PRICE_STABLECOIN\",\"active\":true}}"
call_change "$RELAYER_ACCOUNT_ID" "credit_deposit" "{\"account_id\":\"$PLAYER_ACCOUNT_ID\",\"token_contract_id\":\"$STABLE_TOKEN_CONTRACT_ID\",\"amount\":\"$DEPOSIT_AMOUNT\",\"chain\":\"$CHAIN_NAME\",\"tx_ref\":\"$TX_REF\"}"
call_change "$PLAYER_ACCOUNT_ID" "buy_item" "{\"item_id\":\"$ITEM_ID\"}"

if [[ "$ENABLE_SOLANA_MPC_PLAYER" == "true" ]]; then
  create_solana_mpc_player
fi

player_output="$(call_view "get_player" "{\"account_id\":\"$PLAYER_ACCOUNT_ID\"}")"
player_view_output="$(call_view "get_player_view" "{\"account_id\":\"$PLAYER_ACCOUNT_ID\"}")"
arena_view_output="$(call_view "get_arena_view" "{\"account_id\":\"$PLAYER_ACCOUNT_ID\"}")"
ghost_output="$(call_view "get_player" "{\"account_id\":\"g10-01.testnet\"}")"

if ! printf '%s\n' "$ghost_output" | grep -Eq '"is_ghost"[[:space:]]*:[[:space:]]*true'; then
  echo "Smoke check failed: expected seeded ghost g10-01.testnet" >&2
  echo "$ghost_output" >&2
  exit 1
fi

if [[ "$player_view_output" == "null" ]]; then
  echo "Smoke check failed: expected non-null get_player_view for $PLAYER_ACCOUNT_ID" >&2
  echo "$player_view_output" >&2
  exit 1
fi

if [[ "$player_output" != *"$ITEM_ID"* ]]; then
  echo "Smoke check failed: expected player to own $ITEM_ID" >&2
  echo "$player_output" >&2
  exit 1
fi

if ! printf '%s\n' "$arena_view_output" | grep -Eq '"tier"[[:space:]]*:[[:space:]]*1'; then
  echo "Smoke check failed: expected arena tier 1 for $PLAYER_ACCOUNT_ID" >&2
  echo "$arena_view_output" >&2
  exit 1
fi

log "Smoke checks passed"
log "Contract account: $CONTRACT_ACCOUNT_ID"
log "Owner: $OWNER_ID | Relayer: $RELAYER_ACCOUNT_ID | Player: $PLAYER_ACCOUNT_ID"
