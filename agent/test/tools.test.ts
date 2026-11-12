import { describe, expect, it } from "vitest";

import { DEFAULT_GAS, HEAVY_GAS } from "../src/game-client.js";
import { TOOLS, formatDecision, parseToolCall, toContractCall, type Decision } from "../src/tools.js";
import { ALLOWED_METHODS } from "../src/validator.js";

describe("TOOLS", () => {
  it("requires a reason on every tool", () => {
    for (const definition of TOOLS) {
      expect(definition.function.parameters.required).toContain("reason");
    }
  });
});

describe("parseToolCall", () => {
  it("parses every tool", () => {
    expect(parseToolCall("wait", "")).toEqual({ decision: { tool: "wait" }, reason: "" });
    expect(parseToolCall("register_player", '{"reason":"join"}')).toEqual({
      decision: { tool: "register_player" },
      reason: "join",
    });
    expect(parseToolCall("assign_stat_points", '{"strength":1,"dexterity":2,"vitality":0}').decision).toEqual({
      tool: "assign_stat_points",
      strength: 1,
      dexterity: 2,
      vitality: 0,
    });
    expect(parseToolCall("buy_item", '{"item_id":"basic_sword","quantity":1}').decision).toEqual({
      tool: "buy_item",
      item_id: "basic_sword",
      quantity: 1,
    });
    expect(parseToolCall("consume", '{"token_id":"t1"}').decision).toEqual({ tool: "consume", token_id: "t1" });
    expect(parseToolCall("start_expedition", '{"creature_id":"wolf"}').decision).toEqual({
      tool: "start_expedition",
      creature_id: "wolf",
    });
    expect(parseToolCall("challenge", '{"opponent_account_id":"r.testnet"}').decision).toEqual({
      tool: "challenge",
      opponent_account_id: "r.testnet",
    });
  });

  it("rejects unknown tools and malformed arguments", () => {
    expect(() => parseToolCall("dev_set_player_game_coin", "{}")).toThrow(/unknown tool/);
    expect(() => parseToolCall("equip", "[]")).toThrow(/JSON object/);
    expect(() => parseToolCall("equip", "not json")).toThrow();
    expect(() => parseToolCall("equip", '{"token_id":""}')).toThrow(/non-empty string/);
    expect(() => parseToolCall("assign_stat_points", '{"strength":1.5,"dexterity":0,"vitality":0}')).toThrow(/integer/);
  });
});

describe("toContractCall", () => {
  const cases: [Decision, string, Record<string, unknown>, bigint][] = [
    [{ tool: "register_player" }, "register_player", {}, DEFAULT_GAS],
    [
      { tool: "assign_stat_points", strength: 1, dexterity: 2, vitality: 3 },
      "assign_stat_points",
      { strength_points: 1, dexterity_points: 2, vitality_points: 3 },
      DEFAULT_GAS,
    ],
    [
      { tool: "buy_item", item_id: "basic_sword", quantity: 2 },
      "buy_items",
      { lines: [{ item_id: "basic_sword", quantity: 2, currency: "GameCoin" }] },
      HEAVY_GAS,
    ],
    [{ tool: "equip", token_id: "t1" }, "apply_inventory_actions", { actions: [{ type: "Equip", token_id: "t1" }] }, HEAVY_GAS],
    [{ tool: "consume", token_id: "t2" }, "apply_inventory_actions", { actions: [{ type: "Consume", token_id: "t2" }] }, HEAVY_GAS],
    [{ tool: "start_expedition", creature_id: "wolf" }, "start_expedition", { creature_id: "wolf" }, HEAVY_GAS],
    [{ tool: "challenge", opponent_account_id: "r.testnet" }, "challenge", { opponent_account_id: "r.testnet" }, HEAVY_GAS],
    [{ tool: "claim_leader_income" }, "claim_leader_income", {}, HEAVY_GAS],
  ];

  it.each(cases)("maps %o to %s", (decision, methodName, args, gas) => {
    const call = toContractCall(decision);
    expect(call).toEqual({ methodName, args, gas });
    expect(ALLOWED_METHODS.has(methodName)).toBe(true);
  });

  it("does not call the chain for wait", () => {
    expect(toContractCall({ tool: "wait" })).toBeNull();
  });
});

describe("formatDecision", () => {
  it("renders the tool with its args", () => {
    expect(formatDecision({ tool: "wait" })).toBe("wait");
    expect(formatDecision({ tool: "challenge", opponent_account_id: "r.testnet" })).toBe("challenge(opponent_account_id=r.testnet)");
  });
});
