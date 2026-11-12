/**
 * Subset of the `game` contract views the bot reads. Field names mirror the contract JSON
 * (see contracts/game/src/lib.rs); U128 values arrive as decimal strings.
 */

export type ItemSlot = "Weapon" | "Shield" | "Helmet" | "Armor" | "Consumable";
export type GearSlot = Exclude<ItemSlot, "Consumable">;

export type PlayerView = {
  account_id: string;
  level: number;
  xp: string;
  xp_to_next_level: string;
  unassigned_points: number;
  effective_strength: string;
  effective_dexterity: string;
  effective_vitality: string;
  max_hp: string;
  current_hp: string;
  game_coins: string;
  owned_token_ids: string[];
  equipped_weapon_token_id: string | null;
  equipped_shield_token_id: string | null;
  equipped_helmet_token_id: string | null;
  equipped_armor_token_id: string | null;
};

export type ArenaView = {
  tier: number;
  rank: number;
  is_leader: boolean;
  pending_leader_income: { coins: string; xp: string; points: string };
  champion_pot: string;
};

export type CreatureView = {
  id: string;
  name: string;
  base_strength: string;
  base_dexterity: string;
  base_vitality: string;
  points_per_level: number;
  win: { game_coins: string; xp: string };
};

export type ItemDefinition = {
  item_id: string;
  slot: ItemSlot;
  strength_bonus: string;
  dexterity_bonus: string;
  vitality_bonus: string;
  price_game_coin: string;
  price_stablecoin: string;
  active: boolean;
};

export type NftToken = {
  token_id: string;
  item_id: string;
  owner_id: string;
};

export type CombatOutcome = "AttackerWins" | "DefenderWins" | "Draw";

export type ChallengeResult = {
  combat_id: number;
  attacker_won: boolean;
  draw: boolean;
  rounds: number;
};

export type ExpeditionResult = {
  expedition_id: number;
  outcome: CombatOutcome;
  game_coins_gained: string;
  xp_gained: string;
  drop: { item_id: string; token_id: string } | null;
};
