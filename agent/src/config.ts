import { NEAR_AI_BASE_URL } from "./near-ai-llm.js";

export type CliFlags = { turns: number | null; dryRun: boolean; noLlm: boolean };

export type AgentConfig = {
  nearAi: { apiKey: string; model: string; baseUrl: string } | null;
  rpcUrl: string;
  networkId: string;
  contractId: string;
  accountId: string;
  privateKey: string | null;
  turns: number;
  turnDelayMs: number;
  dryRun: boolean;
};

export const DEFAULT_MODEL = "zai-org/GLM-5.1-FP8";

type Env = Readonly<Record<string, string | undefined>>;

function optional(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? null : value;
}

function required(env: Env, key: string): string {
  const value = optional(env, key);
  if (value === null) {
    throw new Error(`Missing required env var ${key} (see agent/.env.example)`);
  }
  return value;
}

function positiveInt(raw: string, label: string, allowZero = false): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} integer, got "${raw}"`);
  }
  return value;
}

export function parseFlags(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { turns: null, dryRun: false, noLlm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--no-llm") {
      flags.noLlm = true;
    } else if (arg === "--turns") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--turns needs a value");
      }
      flags.turns = positiveInt(value, "--turns");
      index += 1;
    } else {
      throw new Error(`Unknown flag "${arg}". Usage: [--turns N] [--dry-run] [--no-llm]`);
    }
  }
  return flags;
}

/** Fail-fast config: every missing or malformed value aborts before touching the network. */
export function loadConfig(env: Env, flags: CliFlags): AgentConfig {
  const nearAi = flags.noLlm
    ? null
    : {
        apiKey: required(env, "NEAR_AI_API_KEY"),
        model: optional(env, "NEAR_AI_MODEL") ?? DEFAULT_MODEL,
        baseUrl: optional(env, "NEAR_AI_BASE_URL") ?? NEAR_AI_BASE_URL,
      };

  return {
    nearAi,
    rpcUrl: optional(env, "NEAR_RPC_URL") ?? "https://rpc.testnet.near.org",
    networkId: optional(env, "NEAR_NETWORK_ID") ?? "testnet",
    contractId: required(env, "GAME_CONTRACT_ID"),
    accountId: required(env, "BOT_ACCOUNT_ID"),
    privateKey: flags.dryRun ? optional(env, "BOT_PRIVATE_KEY") : required(env, "BOT_PRIVATE_KEY"),
    turns: flags.turns ?? positiveInt(optional(env, "MAX_TURNS") ?? "10", "MAX_TURNS"),
    turnDelayMs: positiveInt(optional(env, "TURN_DELAY_MS") ?? "3000", "TURN_DELAY_MS", true),
    dryRun: flags.dryRun,
  };
}
