import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, decideTurn } from "../src/brain.js";
import { snapshot } from "./fixtures.js";
import { ScriptedLlm, reply } from "./fakes.js";

const rivalSnapshot = snapshot({ opponents: [{ accountId: "rival.testnet", level: 1, power: 10 }] });

describe("decideTurn", () => {
  it("uses a valid LLM tool call", async () => {
    const llm = new ScriptedLlm([reply("challenge", { opponent_account_id: "rival.testnet", reason: "easy win" })]);
    const result = await decideTurn({ snapshot: rivalSnapshot, llm, recentEvents: ["turn 1: wait → waited"] });

    expect(result).toEqual({
      decision: { tool: "challenge", opponent_account_id: "rival.testnet" },
      reason: "easy win",
      source: "llm",
      llmIssues: [],
    });
    const [system, user] = llm.conversations[0] ?? [];
    expect(system).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(user?.role).toBe("user");
    expect(JSON.parse(user?.role === "user" ? user.content : "{}")).toMatchObject({
      state: { registered: true, can_fight: true },
      recent_turns: ["turn 1: wait → waited"],
    });
  });

  it("feeds the validation error back and accepts the corrected call", async () => {
    const llm = new ScriptedLlm([
      reply("challenge", { opponent_account_id: "champion.testnet" }, "c1"),
      reply("start_expedition", { creature_id: "wolf", reason: "farm" }, "c2"),
    ]);
    const result = await decideTurn({ snapshot: rivalSnapshot, llm, recentEvents: [] });

    expect(result.source).toBe("llm");
    expect(result.decision).toEqual({ tool: "start_expedition", creature_id: "wolf" });
    expect(result.llmIssues).toEqual(['invalid action challenge: "champion.testnet" is not in challengeable_opponents']);
    const retry = llm.conversations[1] ?? [];
    expect(retry.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("falls back after repeated invalid calls", async () => {
    const llm = new ScriptedLlm([reply("dev_set_player_game_coin"), reply("equip", { token_id: "ghost" })]);
    const result = await decideTurn({ snapshot: rivalSnapshot, llm, recentEvents: [] });

    expect(result.source).toBe("fallback");
    expect(result.decision.tool).toBe("buy_item");
    expect(result.llmIssues).toHaveLength(2);
    expect(result.llmIssues[0]).toMatch(/unknown tool/);
  });

  it("falls back on network errors and on missing tool calls", async () => {
    const failing = await decideTurn({ snapshot: snapshot({ player: null }), llm: new ScriptedLlm([new Error("503")]), recentEvents: [] });
    expect(failing).toMatchObject({ source: "fallback", decision: { tool: "register_player" }, llmIssues: ["llm error: 503"] });

    const silent = await decideTurn({ snapshot: snapshot({ player: null }), llm: new ScriptedLlm([null]), recentEvents: [] });
    expect(silent.llmIssues).toEqual(["llm returned no tool call"]);
  });

  it("uses rules only when no LLM is configured", async () => {
    const result = await decideTurn({ snapshot: snapshot({ player: null }), llm: null, recentEvents: [] });
    expect(result).toMatchObject({ source: "fallback", llmIssues: [] });
  });
});
