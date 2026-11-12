import { describe, expect, it } from "vitest";

import { describeResult, runLoop, type LoopOptions } from "../src/loop.js";
import { FakeGame, ScriptedLlm, reply } from "./fakes.js";

function options(overrides: Partial<LoopOptions> & Pick<LoopOptions, "game">): LoopOptions & { lines: string[] } {
  const lines: string[] = [];
  return {
    llm: null,
    accountId: "bot.testnet",
    turns: 3,
    turnDelayMs: 0,
    dryRun: false,
    log: (line) => lines.push(line),
    sleep: async () => undefined,
    lines,
    ...overrides,
  };
}

describe("runLoop (smoke)", () => {
  it("plays a short full cycle: register → assign points → challenge", async () => {
    const game = new FakeGame();
    const llm = new ScriptedLlm([
      reply("register_player", { reason: "join" }),
      reply("assign_stat_points", { strength: 2, dexterity: 1, vitality: 0, reason: "dps" }),
      reply("challenge", { opponent_account_id: "rival.testnet", reason: "climb" }),
    ]);
    const opts = options({ game, llm });
    const records = await runLoop(opts);

    expect(game.calls.map((call) => call.methodName)).toEqual(["register_player", "assign_stat_points", "challenge"]);
    expect(records.every((record) => record.source === "llm")).toBe(true);
    expect(records[2]?.outcome).toBe("WON vs rival.testnet in 4 rounds (combat #7) | tx tx-3");
    expect(opts.lines[0]).toContain("NEAR AI (test-model)");
    // The model sees what happened in previous turns.
    const lastPrompt = llm.conversations[2]?.[1];
    expect(lastPrompt?.role === "user" ? lastPrompt.content : "").toContain("assign_stat_points");
  });

  it("never signs in dry-run mode", async () => {
    const game = new FakeGame();
    const opts = options({ game, dryRun: true, turns: 2 });
    const records = await runLoop(opts);

    expect(game.calls).toEqual([]);
    expect(records[0]?.outcome).toBe("dry-run: would call register_player({})");
    expect(opts.lines.some((line) => line.includes("fallback → register_player"))).toBe(true);
  });

  it("stops after consecutive failed transactions", async () => {
    const game = new FakeGame();
    game.failNextCalls = 10;
    const opts = options({ game, turns: 10 });
    const records = await runLoop(opts);

    expect(records).toHaveLength(3);
    expect(records[0]?.outcome).toMatch(/^FAILED: Smart contract panicked/);
    expect(opts.lines.at(-1)).toBe("stopping: 3 consecutive failed transactions");
  });

  it("waits between turns and logs wait turns", async () => {
    const game = new FakeGame();
    game.me = (await game.view("get_player_view", { account_id: "x" })) as NonNullable<typeof game.me>;
    game.me = { ...game.me, account_id: "bot.testnet", current_hp: "1" };
    const pauses: number[] = [];
    const opts = options({ game, turns: 2, turnDelayMs: 5, sleep: async (ms) => void pauses.push(ms) });
    const records = await runLoop(opts);

    expect(records.map((record) => record.outcome)).toEqual(["waited", "waited"]);
    expect(pauses).toEqual([5]);
  });
});

describe("describeResult", () => {
  it("summarises expeditions with drops and draws", () => {
    expect(
      describeResult(
        { tool: "start_expedition", creature_id: "wolf" },
        { expedition_id: 1, outcome: "AttackerWins", game_coins_gained: "2500000", xp_gained: "10", drop: { item_id: "potion_small", token_id: "t" } },
      ),
    ).toBe("WON vs wolf: +2.5 coins, +10 xp, dropped potion_small");
    expect(
      describeResult({ tool: "challenge", opponent_account_id: "r" }, { combat_id: 1, attacker_won: false, draw: true, rounds: 10 }),
    ).toBe("draw vs r in 10 rounds (combat #1)");
    expect(describeResult({ tool: "register_player" }, null)).toBe("ok");
  });
});
