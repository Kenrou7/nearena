import { canFight, equippedTokenForSlot, type GameSnapshot } from "./game-state.js";
import type { GearSlot } from "./types.js";
import type { Decision } from "./tools.js";

const GEAR_SLOTS: readonly GearSlot[] = ["Weapon", "Shield", "Helmet", "Armor"];

/**
 * Simple deterministic strategy, used when the LLM is disabled, fails, or keeps proposing
 * invalid actions. Priority: register → spend points → equip → claim → heal/rest →
 * buy missing gear → fight (arena first, expeditions otherwise).
 */
export function fallbackDecision(snapshot: GameSnapshot): { decision: Decision; reason: string } {
  const { player, arena } = snapshot;
  if (player === null) {
    return { decision: { tool: "register_player" }, reason: "not registered yet" };
  }

  if (player.unassigned_points > 0) {
    const points = player.unassigned_points;
    const third = Math.floor(points / 3);
    return {
      decision: { tool: "assign_stat_points", strength: points - 2 * third, dexterity: third, vitality: third },
      reason: "spread unassigned points, favouring strength",
    };
  }

  const emptySlots = GEAR_SLOTS.filter((slot) => equippedTokenForSlot(player, slot) === null);
  const gearToEquip = snapshot.tokens.find((token) => !token.equipped && emptySlots.some((slot) => slot === token.slot));
  if (gearToEquip !== undefined) {
    return { decision: { tool: "equip", token_id: gearToEquip.tokenId }, reason: `fill empty ${gearToEquip.slot} slot` };
  }

  if (arena?.is_leader === true && BigInt(arena.pending_leader_income.coins) > 0n) {
    return { decision: { tool: "claim_leader_income" }, reason: "collect leader income" };
  }

  if (!canFight(player)) {
    const potion = snapshot.tokens.find((token) => token.slot === "Consumable");
    return potion === undefined
      ? { decision: { tool: "wait" }, reason: "HP too low and no potions: regenerate" }
      : { decision: { tool: "consume", token_id: potion.tokenId }, reason: "HP too low to fight" };
  }

  const coins = BigInt(player.game_coins);
  const affordableGear = snapshot.items
    .filter((item) => item.slot !== "Consumable" && emptySlots.some((slot) => slot === item.slot))
    .filter((item) => {
      const price = BigInt(item.price_game_coin);
      return price > 0n && price <= coins;
    })
    .filter((item) => !snapshot.tokens.some((token) => token.itemId === item.item_id));
  const gearToBuy = affordableGear[0];
  if (gearToBuy !== undefined) {
    return {
      decision: { tool: "buy_item", item_id: gearToBuy.item_id, quantity: 1 },
      reason: `buy gear for empty ${gearToBuy.slot} slot`,
    };
  }

  const weakest = [...snapshot.opponents].sort((a, b) => a.level - b.level || a.power - b.power)[0];
  if (weakest !== undefined) {
    return {
      decision: { tool: "challenge", opponent_account_id: weakest.accountId },
      reason: "challenge the weakest rival above in the ladder",
    };
  }

  const creature = snapshot.creatures[0];
  if (creature !== undefined) {
    return { decision: { tool: "start_expedition", creature_id: creature.id }, reason: "no rivals to challenge: farm XP" };
  }

  return { decision: { tool: "wait" }, reason: "nothing useful to do" };
}
