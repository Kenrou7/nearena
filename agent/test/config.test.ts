import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL, loadConfig, parseFlags } from "../src/config.js";
import { NEAR_AI_BASE_URL } from "../src/near-ai-llm.js";

const BASE_ENV = {
  NEAR_AI_API_KEY: "key",
  GAME_CONTRACT_ID: "nearena-v1.testnet",
  BOT_ACCOUNT_ID: "bot.testnet",
  BOT_PRIVATE_KEY: "ed25519:abc",
};

describe("parseFlags", () => {
  it("parses all flags", () => {
    expect(parseFlags(["--turns", "4", "--dry-run", "--no-llm"])).toEqual({ turns: 4, dryRun: true, noLlm: true });
    expect(parseFlags([])).toEqual({ turns: null, dryRun: false, noLlm: false });
  });

  it("fails fast on bad input", () => {
    expect(() => parseFlags(["--turns"])).toThrow(/needs a value/);
    expect(() => parseFlags(["--turns", "0"])).toThrow(/positive integer/);
    expect(() => parseFlags(["--fast"])).toThrow(/Unknown flag/);
  });
});

describe("loadConfig", () => {
  const flags = { turns: null, dryRun: false, noLlm: false };

  it("applies defaults", () => {
    expect(loadConfig(BASE_ENV, flags)).toEqual({
      nearAi: { apiKey: "key", model: DEFAULT_MODEL, baseUrl: NEAR_AI_BASE_URL },
      rpcUrl: "https://rpc.testnet.near.org",
      networkId: "testnet",
      contractId: "nearena-v1.testnet",
      accountId: "bot.testnet",
      privateKey: "ed25519:abc",
      turns: 10,
      turnDelayMs: 3000,
      dryRun: false,
    });
  });

  it("requires the API key unless --no-llm, and the private key unless --dry-run", () => {
    const { NEAR_AI_API_KEY: _key, BOT_PRIVATE_KEY: _pk, ...rest } = BASE_ENV;
    expect(() => loadConfig({ ...rest, BOT_PRIVATE_KEY: "ed25519:abc" }, flags)).toThrow(/NEAR_AI_API_KEY/);
    expect(() => loadConfig({ ...rest, NEAR_AI_API_KEY: "key" }, flags)).toThrow(/BOT_PRIVATE_KEY/);
    const dry = loadConfig(rest, { turns: 2, dryRun: true, noLlm: true });
    expect(dry).toMatchObject({ nearAi: null, privateKey: null, turns: 2, dryRun: true });
  });

  it("validates numeric env vars", () => {
    expect(() => loadConfig({ ...BASE_ENV, MAX_TURNS: "abc" }, flags)).toThrow(/MAX_TURNS/);
    expect(loadConfig({ ...BASE_ENV, TURN_DELAY_MS: "0", NEAR_AI_MODEL: "m" }, flags)).toMatchObject({
      turnDelayMs: 0,
      nearAi: { model: "m" },
    });
  });
});
