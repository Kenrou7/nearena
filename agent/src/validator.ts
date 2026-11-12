import { canFight, equippedTokenForSlot, type GameSnapshot } from "./game-state.js";
import type { Decision } from "./tools.js";

export type Validation = { ok: true } | { ok: false; reason: string };

const OK: Validation = { ok: true };
const reject = (reason: string): Validation => ({ ok: false, reason });

export const MAX_BUY_QUANTITY = 5;
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "register_player",
  "assign_stat_points",
  "buy_items",
  "apply_inventory_actions",
  "start_expedition",
  "challenge",
  "claim_leader_income",
]);

/**
 * Deterministic guard between the LLM and the chain: rejects anything the contract would
 * refuse (or that wastes a tx), so a confused model never burns gas or calls privileged code.
 */
export function validateDecision(decision: Decision, snapshot: GameSnapshot): Validation {
  const { player, arena } = snapshot;

  if (decision.tool === "wait") {
    return OK;
  }
  if (decision.tool === "register_player") {
    return player === null ? OK : reject("already registered");
  }
  if (player === null) {
    return reject("not registered yet: register_player first");
  }

  switch (decision.tool) {
    case "assign_stat_points": {
      const values = [decision.strength, decision.dexterity, decision.vitality];
      if (values.some((value) => value < 0)) {
        return reject("stat points cannot be negative");
      }
      const total = values.reduce((sum, value) => sum + value, 0);
      if (total === 0) {
        return reject("assign at least one point");
      }
      return total <= player.unassigned_points
        ? OK
        : reject(`only ${player.unassigned_points} unassigned points available`);
    }
    case "buy_item": {
      const item = snapshot.items.find((candidate) => candidate.item_id === decision.item_id);
      if (item === undefined) {
        return reject(`unknown item "${decision.item_id}"`);
      }
      if (decision.quantity < 1 || decision.quantity > MAX_BUY_QUANTITY) {
        return reject(`quantity must be between 1 and ${MAX_BUY_QUANTITY}`);
      }
      const price = BigInt(item.price_game_coin);
      if (price === 0n) {
        return reject(`"${item.item_id}" cannot be bought with game coins`);
      }
      return BigInt(player.game_coins) >= price * BigInt(decision.quantity) ? OK : reject("not enough game coins");
    }
    case "equip": {
      const token = snapshot.tokens.find((candidate) => candidate.tokenId === decision.token_id);
      if (token === undefined) {
        return reject(`token "${decision.token_id}" is not owned`);
      }
      if (token.slot === "Consumable") {
        return reject("consumables cannot be equipped; use consume");
      }
      return equippedTokenForSlot(player, token.slot) === token.tokenId ? reject("token already equipped") : OK;
    }
    case "consume": {
      const token = snapshot.tokens.find((candidate) => candidate.tokenId === decision.token_id);
      if (token === undefined) {
        return reject(`token "${decision.token_id}" is not owned`);
      }
      if (token.slot !== "Consumable") {
        return reject("only potions can be consumed");
      }
      return BigInt(player.current_hp) < BigInt(player.max_hp) ? OK : reject("HP is already full");
    }
    case "start_expedition": {
      if (!snapshot.creatures.some((creature) => creature.id === decision.creature_id)) {
        return reject(`unknown creature "${decision.creature_id}"`);
      }
      return canFight(player) ? OK : reject("HP below 20%: rest or drink a potion first");
    }
    case "challenge": {
      if (!snapshot.opponents.some((opponent) => opponent.accountId === decision.opponent_account_id)) {
        return reject(`"${decision.opponent_account_id}" is not in challengeable_opponents`);
      }
      return canFight(player) ? OK : reject("HP below 20%: rest or drink a potion first");
    }
    case "claim_leader_income":
      return arena?.is_leader === true ? OK : reject("only the tier leader can claim income");
  }
}
