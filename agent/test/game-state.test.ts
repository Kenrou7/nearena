import { describe, expect, it } from "vitest";

import { describeSnapshot, loadSnapshot, scaled } from "../src/game-state.js";
import { player, units } from "./fixtures.js";
import { FakeGame } from "./fakes.js";

describe("loadSnapshot", () => {
  it("returns an unregistered snapshot without arena reads", async () => {
    const snap = await loadSnapshot(new FakeGame(), "bot.testnet");
    expect(snap.player).toBeNull();
    expect(snap.items.map((item) => item.item_id)).toEqual(["basic_sword", "potion_small"]);
    expect(describeSnapshot(snap)).toEqual({ registered: false });
  });

  it("resolves opponents and owned tokens with their slots", async () => {
    const game = new FakeGame();
    game.me = player({ owned_token_ids: ["t1", "t2", "t-unknown"], equipped_weapon_token_id: "t1" });
    game.tokens.set("t1", { token_id: "t1", item_id: "basic_sword", owner_id: "bot.testnet" });
    game.tokens.set("t2", { token_id: "t2", item_id: "potion_small", owner_id: "bot.testnet" });

    const snap = await loadSnapshot(game, "bot.testnet");

    expect(snap.opponents).toEqual([{ accountId: "rival.testnet", level: 1, power: 15 }]);
    expect(snap.tokens).toEqual([
      { tokenId: "t1", itemId: "basic_sword", slot: "Weapon", equipped: true },
      { tokenId: "t2", itemId: "potion_small", slot: "Consumable", equipped: false },
    ]);
    expect(describeSnapshot(snap)).toMatchObject({
      registered: true,
      hp: "100/100",
      can_fight: true,
      game_coins: 100,
      shop: [{ item_id: "basic_sword", price_game_coin: 50, bonus: { strength: 1.2 } }, { item_id: "potion_small" }],
    });
  });
});

describe("scaled", () => {
  it("unscales fixed-point values keeping 2 decimals", () => {
    expect(scaled(units(1.234))).toBe(1.23);
    expect(scaled("300000")).toBe(0.3);
  });
});
