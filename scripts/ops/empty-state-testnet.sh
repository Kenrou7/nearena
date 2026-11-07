#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CONTRACT_ACCOUNT_ID="${CONTRACT_ACCOUNT_ID:-}"
OWNER_ID="${OWNER_ID:-nearena.testnet}"
NETWORK_NAME="${NETWORK_NAME:-testnet}"
BATCH_SIZE="${BATCH_SIZE:-200}"
PREPAID_GAS="${PREPAID_GAS:-100 Tgas}"
ATTACHED_DEPOSIT="${ATTACHED_DEPOSIT:-0 NEAR}"
PREFIX_BYTES="${PREFIX_BYTES:-p i n d a}"
RPC_URL="${RPC_URL:-}"
DRY_RUN="${DRY_RUN:-false}"

if [[ -z "$CONTRACT_ACCOUNT_ID" ]]; then
  echo "CONTRACT_ACCOUNT_ID is required" >&2
  exit 1
fi

if [[ "$NETWORK_NAME" != "testnet" ]]; then
  echo "This cleanup script is only intended for testnet (NETWORK_NAME=testnet)." >&2
  exit 1
fi

if [[ -z "$RPC_URL" ]]; then
  case "$NETWORK_NAME" in
    testnet)
      RPC_URL="https://rpc.testnet.near.org"
      ;;
    mainnet)
      RPC_URL="https://rpc.mainnet.near.org"
      ;;
    *)
      echo "Unsupported NETWORK_NAME: $NETWORK_NAME" >&2
      exit 1
      ;;
  esac
fi

log() {
  printf '\n[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

count_lines() {
  if [[ ! -f "$1" ]]; then
    echo "0"
    return
  fi

  wc -l < "$1" | tr -d ' '
}

require_cmd near
require_cmd curl
require_cmd jq
require_cmd base64
require_cmd split

if ! [[ "$BATCH_SIZE" =~ ^[0-9]+$ ]]; then
  echo "BATCH_SIZE must be a positive integer" >&2
  exit 1
fi

if (( BATCH_SIZE < 1 || BATCH_SIZE > 500 )); then
  echo "BATCH_SIZE must be between 1 and 500" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

raw_keys_file="$tmp_dir/raw_keys.txt"
all_keys_file="$tmp_dir/all_keys.txt"
: > "$raw_keys_file"

log "Collecting raw storage keys for $CONTRACT_ACCOUNT_ID from prefixes: $PREFIX_BYTES"

for prefix in $PREFIX_BYTES; do
  prefix_b64="$(printf '%s' "$prefix" | base64 | tr -d '\n')"
  payload="$(jq -nc --arg account "$CONTRACT_ACCOUNT_ID" --arg prefix "$prefix_b64" '{jsonrpc:"2.0",id:"dontcare",method:"query",params:{request_type:"view_state",finality:"final",account_id:$account,prefix_base64:$prefix,include_proof:false}}')"

  response_file="$tmp_dir/resp_${prefix}.json"
  curl -sS -X POST "$RPC_URL" \
    -H 'content-type: application/json' \
    -d "$payload" > "$response_file"

  if [[ "$(jq -r 'has("error")' "$response_file")" == "true" ]]; then
    echo "RPC error while listing prefix '$prefix':" >&2
    jq '.error' "$response_file" >&2
    exit 1
  fi

  jq -r '.result.values[]?.key' "$response_file" >> "$raw_keys_file"
  prefix_count="$(jq '.result.values | length' "$response_file")"
  log "Prefix '$prefix': $prefix_count key(s)"
done

sort -u "$raw_keys_file" > "$all_keys_file"
total_keys="$(count_lines "$all_keys_file")"
log "Total unique keys to delete: $total_keys"

if [[ "$total_keys" == "0" ]]; then
  log "No managed keys found. Running finalize reset only."
  if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY_RUN=true; skipping finalize transaction"
    exit 0
  fi

  near contract call-function as-transaction "$CONTRACT_ACCOUNT_ID" empty_state_finalize json-args '{}' \
    prepaid-gas "$PREPAID_GAS" \
    attached-deposit "$ATTACHED_DEPOSIT" \
    sign-as "$OWNER_ID" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send

  log "Finalize completed"
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  log "DRY_RUN=true; no transactions sent"
  exit 0
fi

split -l "$BATCH_SIZE" "$all_keys_file" "$tmp_dir/batch_"

batch_index=0
for batch_file in "$tmp_dir"/batch_*; do
  [[ -f "$batch_file" ]] || continue
  batch_index=$((batch_index + 1))
  batch_size="$(count_lines "$batch_file")"

  args_json="$(jq -Rsc 'split("\n") | map(select(length > 0)) | {keys: .}' < "$batch_file")"

  log "Deleting batch #$batch_index ($batch_size keys)"
  near contract call-function as-transaction "$CONTRACT_ACCOUNT_ID" empty_state_delete_keys json-args "$args_json" \
    prepaid-gas "$PREPAID_GAS" \
    attached-deposit "$ATTACHED_DEPOSIT" \
    sign-as "$OWNER_ID" \
    network-config "$NETWORK_NAME" \
    sign-with-keychain \
    send
done

log "Running empty_state_finalize"
near contract call-function as-transaction "$CONTRACT_ACCOUNT_ID" empty_state_finalize json-args '{}' \
  prepaid-gas "$PREPAID_GAS" \
  attached-deposit "$ATTACHED_DEPOSIT" \
  sign-as "$OWNER_ID" \
  network-config "$NETWORK_NAME" \
  sign-with-keychain \
  send

verify_file="$tmp_dir/verify_keys.txt"
: > "$verify_file"

prefix_failures=0

for prefix in $PREFIX_BYTES; do
  prefix_b64="$(printf '%s' "$prefix" | base64 | tr -d '\n')"
  payload="$(jq -nc --arg account "$CONTRACT_ACCOUNT_ID" --arg prefix "$prefix_b64" '{jsonrpc:"2.0",id:"dontcare",method:"query",params:{request_type:"view_state",finality:"final",account_id:$account,prefix_base64:$prefix,include_proof:false}}')"

  response_file="$tmp_dir/verify_${prefix}.json"
  curl -sS -X POST "$RPC_URL" \
    -H 'content-type: application/json' \
    -d "$payload" > "$response_file"

  if [[ "$(jq -r 'has("error")' "$response_file")" == "true" ]]; then
    echo "RPC error while verifying prefix '$prefix':" >&2
    jq '.error' "$response_file" >&2
    exit 1
  fi

  jq -r '.result.values[]?.key' "$response_file" >> "$verify_file"

  prefix_count="$(jq '.result.values | length' "$response_file")"
  if [[ "$prefix" == "a" ]]; then
    if [[ "$prefix_count" != "3" ]]; then
      echo "Verification failed: expected exactly 3 arena tier keys after finalize, got $prefix_count" >&2
      prefix_failures=$((prefix_failures + 1))
    fi
  else
    if [[ "$prefix_count" != "0" ]]; then
      echo "Verification failed: expected 0 keys for prefix '$prefix', got $prefix_count" >&2
      prefix_failures=$((prefix_failures + 1))
    fi
  fi
done

remaining_keys="$(count_lines "$verify_file")"
if (( prefix_failures > 0 )); then
  echo "Cleanup verification failed with $prefix_failures prefix mismatch(es)." >&2
  exit 1
fi

log "State cleanup completed for $CONTRACT_ACCOUNT_ID (remaining managed keys: $remaining_keys)"
