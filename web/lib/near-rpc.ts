export type NearViewError = {
  error: string;
  details?: unknown;
};

type NearRpcErrorPayload = {
  error?: NearViewError | string | { message?: string; error?: string };
  message?: string;
  details?: unknown;
};

function extractErrorMessage(error: NearRpcErrorPayload["error"]): string | null {
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    if (typeof error.error === "string" && error.error.length > 0) {
      return error.error;
    }

    if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
      return error.message;
    }
  }

  return null;
}

export type PlayerView = {
  account_id: string;
  level: number;
  xp: string;
  xp_to_next_level: string;
  unassigned_points: number;
  base_strength: string;
  base_dexterity: string;
  base_vitality: string;
  bonus_strength: string;
  bonus_dexterity: string;
  bonus_vitality: string;
  effective_strength: string;
  effective_dexterity: string;
  effective_vitality: string;
  max_hp: string;
  current_hp: string;
  game_coins: string;
  stablecoin_balance: string;
  owned_item_ids: string[];
  owned_token_ids: string[];
  equipped_weapon_token_id: string | null;
  equipped_shield_token_id: string | null;
  equipped_helmet_token_id: string | null;
  equipped_armor_token_id: string | null;
};

export type ArenaView = {
  tier: number;
  rank: number;
  is_leader: boolean;
  pending_leader_income: {
    coins: string;
    xp: string;
    points: string;
  };
  champion_pot: string;
};

export type CombatantSnapshot = {
  account_id: string;
  level: number;
  strength: string;
  dexterity: string;
  vitality: string;
  max_hp: string;
  hp_at_start: string;
  hp_at_end: string;
};

export type ChallengeRoundLog = {
  round: number;
  skipped: boolean;
  attacker_hit: boolean;
  attacker_damage: string;
  defender_hit: boolean;
  defender_damage: string;
  attacker_hp_after: string;
  defender_hp_after: string;
  attacker_defeated: boolean;
  defender_defeated: boolean;
};

export type ChallengeResultView = {
  attacker_won: boolean;
  draw: boolean;
  rounds: number;
  attacker_total_damage: string;
  defender_total_damage: string;
  attacker: CombatantSnapshot;
  defender: CombatantSnapshot;
  round_logs: ChallengeRoundLog[];
};

export type ItemDefinitionView = {
  item_id: string;
  slot: "Weapon" | "Shield" | "Helmet" | "Armor" | "Consumable";
  strength_bonus: string;
  dexterity_bonus: string;
  vitality_bonus: string;
  strength_percent_bps: number;
  dexterity_percent_bps: number;
  vitality_percent_bps: number;
  price_game_coin: string;
  price_stablecoin: string;
  active: boolean;
};

export type NftTokenView = {
  token_id: string;
  item_id: string;
  owner_id: string;
};

const DEFAULT_NEAR_RPC_PROXY_PATH = "/api/near-rpc";
const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NEAR_RPC_TIMEOUT_MS = 10_000;
const NEAR_RPC_MAX_RETRIES = 2;
const SCALE = 1_000_000n;

function resolveNearRpcProxyPath(): string {
  const override = process.env.NEXT_PUBLIC_NEAR_RPC_PROXY_PATH?.trim();

  // Only allow same-origin paths so reads always flow through our backend proxy.
  if (override && override.startsWith("/")) {
    return override;
  }

  return DEFAULT_NEAR_RPC_PROXY_PATH;
}

const NEAR_RPC_PROXY_PATH = resolveNearRpcProxyPath();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  throw new Error("Base64 encoding is not available in this runtime");
}

async function nearViewCall<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "gladiator-web",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "optimistic",
      account_id: CONTRACT_ID,
      method_name: methodName,
      args_base64: toBase64(JSON.stringify(args))
    }
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= NEAR_RPC_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, NEAR_RPC_TIMEOUT_MS);

    try {
      const response = await fetch(NEAR_RPC_PROXY_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: requestBody,
        signal: controller.signal
      });

      const upstream = response.headers.get("x-near-rpc-upstream");
      const raw = await response.text();
      let payload: {
        result?: { result: number[] };
        error?: NearViewError | string | { message?: string; error?: string };
        message?: string;
        details?: unknown;
      };

      try {
        payload = JSON.parse(raw) as {
          result?: { result: number[] };
          error?: NearViewError | string | { message?: string; error?: string };
          message?: string;
          details?: unknown;
        };
      } catch {
        const snippet = raw.slice(0, 180).replace(/\s+/g, " ").trim();
        const source = upstream ? ` via ${upstream}` : "";
        throw new Error(
          `NEAR RPC returned invalid JSON (status ${response.status})${source}${snippet ? `: ${snippet}` : ""}`,
        );
      }

      if (!response.ok || payload.error) {
        const errorPayload = payload as NearRpcErrorPayload;
        const message =
          extractErrorMessage(errorPayload.error) ??
          errorPayload.message ??
          `NEAR RPC failed with status ${response.status}`;

        const source = upstream ? ` (upstream: ${upstream})` : "";
        throw new Error(`${message}${source}`);
      }

      const bytes = payload.result?.result;
      if (!bytes) {
        throw new Error("NEAR RPC returned empty result");
      }

      const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as T;
      return parsed;
    } catch (error) {
      lastError = error;

      if (attempt < NEAR_RPC_MAX_RETRIES) {
        await delay(220 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`NEAR RPC request failed after retries: ${message}`);
}

export async function getPlayerView(accountId: string): Promise<PlayerView | null> {
  return nearViewCall<PlayerView | null>("get_player_view", { account_id: accountId });
}

export async function getPotView(): Promise<string> {
  const result = await nearViewCall<string>("get_grand_pot", {});
  return typeof result === "string" ? result : String(result);
}

export async function getItemDefinitionView(itemId: string): Promise<ItemDefinitionView | null> {
  return nearViewCall<ItemDefinitionView | null>("get_item_definition", { item_id: itemId });
}

export async function getTokenView(tokenId: string): Promise<NftTokenView | null> {
  return nearViewCall<NftTokenView | null>("get_token", { token_id: tokenId });
}

export async function getArenaView(accountId: string): Promise<ArenaView | null> {
  return nearViewCall<ArenaView | null>("get_arena_view", { account_id: accountId });
}

export async function getChallengeCandidates(accountId: string): Promise<string[]> {
  const result = await nearViewCall<string[] | null>("get_challenge_candidates", {
    account_id: accountId,
  });
  return Array.isArray(result) ? result : [];
}

export async function getTierTop(tier: number, limit = 5): Promise<string[]> {
  try {
    const result = await nearViewCall<string[] | null>("get_tier_top", {
      tier,
      limit,
    });
    return Array.isArray(result) ? result : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MethodNotFound") || message.includes("get_tier_top")) {
      return [];
    }

    throw error;
  }
}

export function parseU128(value: string | number | bigint | undefined): bigint {
  if (value === undefined) {
    return 0n;
  }

  if (typeof value === "number") {
    return BigInt(Math.max(0, Math.trunc(value)));
  }

  if (typeof value === "bigint") {
    return value < 0n ? 0n : value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 0n;
  }

  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

export function formatScaled(value: string | number | bigint | undefined, decimals = 2): string {
  const raw = parseU128(value);
  const whole = raw / SCALE;
  const fraction = raw % SCALE;

  if (decimals <= 0) {
    return whole.toString();
  }

  const factor = 10n ** BigInt(Math.min(decimals, 6));
  const scaledFraction = (fraction * factor) / SCALE;
  const fractionText = scaledFraction.toString().padStart(Math.min(decimals, 6), "0");
  return `${whole.toString()}.${fractionText}`;
}

export function formatScaledInt(value: string | number | bigint | undefined): string {
  return formatScaled(value, 0);
}
