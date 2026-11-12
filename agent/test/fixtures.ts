import type { GameSnapshot } from "../src/game-state.js";
import type { ArenaView, CreatureView, ItemDefinition, PlayerView } from "../src/types.js";

const M = 1_000_000;
export const units = (value: number): string => String(Math.round(value * M));

export function player(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    account_id: "bot.testnet",
    level: 1,
    xp: "0",
    xp_to_next_level: "100",
    unassigned_points: 0,
    effective_strength: units(5),
    effective_dexterity: units(5),
    effective_vitality: units(5),
    max_hp: units(100),
    current_hp: units(100),
    game_coins: units(100),
    owned_token_ids: [],
    equipped_weapon_token_id: null,
    equipped_shield_token_id: null,
    equipped_helmet_token_id: null,
    equipped_armor_token_id: null,
    ...overrides,
  };
}

export function arena(overrides: Partial<ArenaView> = {}): ArenaView {
  return {
    tier: 1,
    rank: 7,
    is_leader: false,
    pending_leader_income: { coins: "0", xp: "0", points: "0" },
    champion_pot: "0",
    ...overrides,
  };
}

export const WOLF: CreatureView = {
  id: "wolf",
  name: "Wolf",
  base_strength: units(3),
  base_dexterity: units(3),
  base_vitality: units(3),
  points_per_level: 3,
  win: { game_coins: units(10), xp: "20" },
};

export const SWORD: ItemDefinition = {
  item_id: "basic_sword",
  slot: "Weapon",
  strength_bonus: units(1.2),
  dexterity_bonus: "0",
  vitality_bonus: "0",
  price_game_coin: units(50),
  price_stablecoin: units(1),
  active: true,
};

export const POTION: ItemDefinition = {
  item_id: "potion_small",
  slot: "Consumable",
  strength_bonus: "0",
  dexterity_bonus: "0",
  vitality_bonus: "0",
  price_game_coin: units(10),
  price_stablecoin: "0",
  active: true,
};

export const STABLE_ONLY: ItemDefinition = { ...SWORD, item_id: "stable_only", price_game_coin: "0" };

export function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    accountId: "bot.testnet",
    player: player(),
    arena: arena(),
    opponents: [],
    creatures: [WOLF],
    items: [SWORD, POTION, STABLE_ONLY],
    tokens: [],
    ...overrides,
  };
}
