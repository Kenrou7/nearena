import { describe, expect, it } from "vitest";

import { validateDecision } from "../src/validator.js";
import { arena, player, snapshot, units } from "./fixtures.js";

const lowHp = player({ current_hp: units(10) });
const rival = { accountId: "rival.testnet", level: 1, power: 10 };

describe("validateDecision", () => {
  it("always allows wait", () => {
    expect(validateDecision({ tool: "wait" }, snapshot({ player: null }))).toEqual({ ok: true });
  });

  it("only registers unregistered players", () => {
    expect(validateDecision({ tool: "register_player" }, snapshot({ player: null })).ok).toBe(true);
    expect(validateDecision({ tool: "register_player" }, snapshot())).toEqual({ ok: false, reason: "already registered" });
  });

  it("requires registration for game actions", () => {
    const result = validateDecision({ tool: "claim_leader_income" }, snapshot({ player: null }));
    expect(result.ok).toBe(false);
  });

  describe("assign_stat_points", () => {
    const s = snapshot({ player: player({ unassigned_points: 3 }) });
    it("accepts a valid split", () => {
      expect(validateDecision({ tool: "assign_stat_points", strength: 1, dexterity: 1, vitality: 1 }, s).ok).toBe(true);
    });
    it("rejects negatives, zero and overspending", () => {
      expect(validateDecision({ tool: "assign_stat_points", strength: -1, dexterity: 2, vitality: 0 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "assign_stat_points", strength: 0, dexterity: 0, vitality: 0 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "assign_stat_points", strength: 4, dexterity: 0, vitality: 0 }, s)).toEqual({
        ok: false,
        reason: "only 3 unassigned points available",
      });
    });
  });

  describe("buy_item", () => {
    it("accepts affordable items", () => {
      expect(validateDecision({ tool: "buy_item", item_id: "basic_sword", quantity: 2 }, snapshot()).ok).toBe(true);
    });
    it("rejects unknown items, bad quantities, stablecoin-only items and lack of coins", () => {
      const s = snapshot();
      expect(validateDecision({ tool: "buy_item", item_id: "nope", quantity: 1 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "buy_item", item_id: "basic_sword", quantity: 0 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "buy_item", item_id: "basic_sword", quantity: 6 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "buy_item", item_id: "stable_only", quantity: 1 }, s).ok).toBe(false);
      expect(validateDecision({ tool: "buy_item", item_id: "basic_sword", quantity: 3 }, s)).toEqual({
        ok: false,
        reason: "not enough game coins",
      });
    });
  });

  describe("equip and consume", () => {
    const s = snapshot({
      player: player({ equipped_weapon_token_id: "t-eq", current_hp: units(50) }),
      tokens: [
        { tokenId: "t-eq", itemId: "basic_sword", slot: "Weapon", equipped: true },
        { tokenId: "t-new", itemId: "basic_sword", slot: "Weapon", equipped: false },
        { tokenId: "t-pot", itemId: "potion_small", slot: "Consumable", equipped: false },
      ],
    });
    it("equips owned gear not yet equipped", () => {
      expect(validateDecision({ tool: "equip", token_id: "t-new" }, s).ok).toBe(true);
      expect(validateDecision({ tool: "equip", token_id: "t-eq" }, s).ok).toBe(false);
      expect(validateDecision({ tool: "equip", token_id: "t-pot" }, s).ok).toBe(false);
      expect(validateDecision({ tool: "equip", token_id: "missing" }, s).ok).toBe(false);
    });
    it("consumes owned potions only when hurt", () => {
      expect(validateDecision({ tool: "consume", token_id: "t-pot" }, s).ok).toBe(true);
      expect(validateDecision({ tool: "consume", token_id: "t-new" }, s).ok).toBe(false);
      expect(validateDecision({ tool: "consume", token_id: "missing" }, s).ok).toBe(false);
      const full = { ...s, player: player() };
      expect(validateDecision({ tool: "consume", token_id: "t-pot" }, full)).toEqual({ ok: false, reason: "HP is already full" });
    });
  });

  describe("fights", () => {
    it("allows known creatures and candidate rivals with enough HP", () => {
      const s = snapshot({ opponents: [rival] });
      expect(validateDecision({ tool: "start_expedition", creature_id: "wolf" }, s).ok).toBe(true);
      expect(validateDecision({ tool: "challenge", opponent_account_id: "rival.testnet" }, s).ok).toBe(true);
    });
    it("rejects unknown targets and low HP", () => {
      const s = snapshot({ opponents: [rival] });
      expect(validateDecision({ tool: "start_expedition", creature_id: "dragon" }, s).ok).toBe(false);
      expect(validateDecision({ tool: "challenge", opponent_account_id: "someone.testnet" }, s).ok).toBe(false);
      const hurt = { ...s, player: lowHp };
      expect(validateDecision({ tool: "start_expedition", creature_id: "wolf" }, hurt).ok).toBe(false);
      expect(validateDecision({ tool: "challenge", opponent_account_id: "rival.testnet" }, hurt).ok).toBe(false);
    });
    it("treats exactly 20% HP as enough", () => {
      const s = snapshot({ player: player({ current_hp: units(20) }) });
      expect(validateDecision({ tool: "start_expedition", creature_id: "wolf" }, s).ok).toBe(true);
    });
  });

  it("only lets the leader claim income", () => {
    expect(validateDecision({ tool: "claim_leader_income" }, snapshot()).ok).toBe(false);
    expect(validateDecision({ tool: "claim_leader_income" }, snapshot({ arena: arena({ is_leader: true }) })).ok).toBe(true);
  });
});
