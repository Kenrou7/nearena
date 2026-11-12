import { describe, expect, it } from "vitest";

import { fallbackDecision } from "../src/fallback.js";
import { validateDecision } from "../src/validator.js";
import { arena, player, snapshot, units } from "./fixtures.js";

describe("fallbackDecision", () => {
  it("registers first", () => {
    expect(fallbackDecision(snapshot({ player: null })).decision).toEqual({ tool: "register_player" });
  });

  it("spends all unassigned points", () => {
    const { decision } = fallbackDecision(snapshot({ player: player({ unassigned_points: 5 }) }));
    expect(decision).toEqual({ tool: "assign_stat_points", strength: 3, dexterity: 1, vitality: 1 });
  });

  it("equips gear for an empty slot", () => {
    const s = snapshot({ tokens: [{ tokenId: "t1", itemId: "basic_sword", slot: "Weapon", equipped: false }] });
    expect(fallbackDecision(s).decision).toEqual({ tool: "equip", token_id: "t1" });
  });

  it("claims leader income when pending", () => {
    const s = snapshot({ arena: arena({ is_leader: true, pending_leader_income: { coins: "5", xp: "0", points: "0" } }) });
    expect(fallbackDecision(s).decision).toEqual({ tool: "claim_leader_income" });
  });

  it("drinks a potion or waits when HP is too low", () => {
    const hurt = player({ current_hp: units(5) });
    const withPotion = snapshot({
      player: hurt,
      tokens: [{ tokenId: "p1", itemId: "potion_small", slot: "Consumable", equipped: false }],
    });
    expect(fallbackDecision(withPotion).decision).toEqual({ tool: "consume", token_id: "p1" });
    expect(fallbackDecision(snapshot({ player: hurt })).decision).toEqual({ tool: "wait" });
  });

  it("buys affordable gear for an empty slot", () => {
    expect(fallbackDecision(snapshot()).decision).toEqual({ tool: "buy_item", item_id: "basic_sword", quantity: 1 });
  });

  it("challenges the weakest rival, otherwise goes on an expedition", () => {
    const geared = player({ game_coins: "0" });
    const rivals = [
      { accountId: "strong.testnet", level: 3, power: 40 },
      { accountId: "weak.testnet", level: 1, power: 12 },
      { accountId: "weaker.testnet", level: 1, power: 9 },
    ];
    expect(fallbackDecision(snapshot({ player: geared, opponents: rivals })).decision).toEqual({
      tool: "challenge",
      opponent_account_id: "weaker.testnet",
    });
    expect(fallbackDecision(snapshot({ player: geared })).decision).toEqual({ tool: "start_expedition", creature_id: "wolf" });
    expect(fallbackDecision(snapshot({ player: geared, creatures: [] })).decision).toEqual({ tool: "wait" });
  });

  it("always proposes something the validator accepts", () => {
    const cases = [
      snapshot({ player: null }),
      snapshot({ player: player({ unassigned_points: 1 }) }),
      snapshot(),
      snapshot({ player: player({ current_hp: units(1) }) }),
      snapshot({ player: player({ game_coins: "0" }), opponents: [{ accountId: "r.testnet", level: 1, power: 1 }] }),
    ];
    for (const s of cases) {
      expect(validateDecision(fallbackDecision(s).decision, s)).toEqual({ ok: true });
    }
  });
});
