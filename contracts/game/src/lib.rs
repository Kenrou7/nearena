use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

mod creatures;
use creatures::{drop_for_roll, find_creature, CreatureDefinition, CreatureReward, CREATURES};

const SCALE: u128 = 1_000_000;
const BPS_DENOMINATOR: u128 = 10_000;

const TIER_ONE: u8 = 1;
const TIER_TWO: u8 = 2;
const TIER_THREE: u8 = 3;

const LEADER_COINS_PER_HOUR: u128 = 10 * SCALE;
const LEADER_XP_PER_HOUR: u128 = 20 * SCALE;
const LEADER_POINTS_PER_HOUR: u128 = 1 * SCALE;
const CHAMPION_POT_PER_HOUR: u128 = 5 * SCALE;

const CHALLENGE_MIN_HP_BPS: u128 = 2_000;
const STEAL_BPS: u128 = 1_000;
const STEAL_CAP: u128 = 100 * SCALE;
/// Game coins each ghost starts with, so beating one can actually steal coins.
const GHOST_STARTING_GAME_COINS: u128 = 500 * SCALE;

const M_MIN_BPS: u128 = 2_500;
const M_MAX_BPS: u128 = 20_000;

const DRAW_POINTS: u128 = 1 * SCALE;
const DRAW_XP: u128 = 30 * SCALE;
const WIN_POINTS: u128 = 3 * SCALE;
const WIN_XP: u128 = 40 * SCALE;
const LOSE_XP: u128 = 20 * SCALE;

const XP_PER_LEVEL_MULTIPLIER: u128 = 100 * SCALE;
const STAT_POINTS_PER_LEVEL: u32 = 3;
const MAX_LEVEL: u32 = 100;
const HP_REGEN_BPS: u128 = 500;
const HP_REGEN_INTERVAL_SECONDS: u64 = 600;
const PURCHASE_TO_GRAND_POT_BPS: u128 = 9_000;
const PURCHASE_TO_COLLECTION_BPS: u128 = 1_000;
const DEFAULT_COLLECTION_ACCOUNT_ID: &str = "nearena.testnet";
/// Upper bound of units minted by a single `buy_items` call, to stay well within the gas limit.
const MAX_ITEMS_PER_PURCHASE: u32 = 20;
/// Upper bound of actions applied by a single `apply_inventory_actions` call.
const MAX_INVENTORY_ACTIONS: usize = 20;

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum ItemSlot {
    Weapon,
    Shield,
    Helmet,
    Armor,
    Consumable,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum PurchaseCurrency {
    Stablecoin,
    GameCoin,
}

/// One cart line for `buy_items`: `quantity` units of `item_id` paid with `currency`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PurchaseLine {
    pub item_id: String,
    pub quantity: u32,
    pub currency: PurchaseCurrency,
}

/// One step of `apply_inventory_actions`. JSON: `{"type":"Equip","token_id":"token-1"}`,
/// `{"type":"Unequip","slot":"Weapon"}` or `{"type":"Consume","token_id":"token-2"}`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde", tag = "type")]
pub enum InventoryAction {
    Equip { token_id: String },
    Unequip { slot: ItemSlot },
    Consume { token_id: String },
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ItemDefinition {
    pub item_id: String,
    pub slot: ItemSlot,
    pub strength_bonus: U128,
    pub dexterity_bonus: U128,
    pub vitality_bonus: U128,
    pub strength_percent_bps: u16,
    pub dexterity_percent_bps: u16,
    pub vitality_percent_bps: u16,
    pub price_game_coin: U128,
    pub price_stablecoin: U128,
    pub active: bool,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct NftToken {
    pub token_id: String,
    pub item_id: String,
    pub owner_id: AccountId,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CombatConfig {
    pub hit_base_bps: u16,
    pub hit_coefficient_bps: u16,
    pub hit_min_bps: u16,
    pub hit_max_bps: u16,
    pub damage_random_min_bps: u16,
    pub damage_random_max_bps: u16,
    pub damage_reduction_k: U128,
}

impl Default for CombatConfig {
    fn default() -> Self {
        Self {
            hit_base_bps: 7_000,
            hit_coefficient_bps: 7_000,
            hit_min_bps: 3_000,
            hit_max_bps: 9_500,
            damage_random_min_bps: 8_000,
            damage_random_max_bps: 12_000,
            damage_reduction_k: U128(20 * SCALE),
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Player {
    pub account_id: AccountId,
    pub level: u32,
    pub xp: u128,
    pub unassigned_points: u32,
    pub base_strength: u128,
    pub base_dexterity: u128,
    pub base_vitality: u128,
    pub current_hp: u128,
    pub game_coins: u128,
    pub stablecoin_balance: u128,
    pub tournament_points: u128,
    pub owned_item_ids: Vec<String>,
    pub owned_token_ids: Vec<String>,
    pub equipped_weapon_token_id: Option<String>,
    pub equipped_shield_token_id: Option<String>,
    pub equipped_helmet_token_id: Option<String>,
    pub equipped_armor_token_id: Option<String>,
    pub is_ghost: bool,
    pub last_hp_regen_ts_sec: u64,
}

impl Player {
    fn new(account_id: AccountId, level: u32, is_ghost: bool, now_sec: u64) -> Self {
        let base_stat = (u128::from(level) + 4) * SCALE;
        let max_hp = max_hp_from_vitality(base_stat);

        Self {
            account_id,
            level,
            xp: 0,
            unassigned_points: 0,
            base_strength: base_stat,
            base_dexterity: base_stat,
            base_vitality: base_stat,
            current_hp: max_hp,
            game_coins: 0,
            stablecoin_balance: 0,
            tournament_points: 0,
            owned_item_ids: vec![],
            owned_token_ids: vec![],
            equipped_weapon_token_id: None,
            equipped_shield_token_id: None,
            equipped_helmet_token_id: None,
            equipped_armor_token_id: None,
            is_ghost,
            last_hp_regen_ts_sec: now_sec,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct ArenaTierState {
    pub ladder: Vec<AccountId>,
    pub leader_last_income_ts_sec: u64,
    pub champion_pot_last_accrual_ts_sec: u64,
    pub champion_pot: u128,
}

impl ArenaTierState {
    fn new(now_sec: u64) -> Self {
        Self {
            ladder: vec![],
            leader_last_income_ts_sec: now_sec,
            champion_pot_last_accrual_ts_sec: now_sec,
            champion_pot: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PlayerView {
    pub account_id: AccountId,
    pub level: u32,
    pub xp: U128,
    pub xp_to_next_level: U128,
    pub unassigned_points: u32,
    pub base_strength: U128,
    pub base_dexterity: U128,
    pub base_vitality: U128,
    pub bonus_strength: U128,
    pub bonus_dexterity: U128,
    pub bonus_vitality: U128,
    pub effective_strength: U128,
    pub effective_dexterity: U128,
    pub effective_vitality: U128,
    pub max_hp: U128,
    pub current_hp: U128,
    pub game_coins: U128,
    pub stablecoin_balance: U128,
    pub owned_item_ids: Vec<String>,
    pub owned_token_ids: Vec<String>,
    pub equipped_weapon_token_id: Option<String>,
    pub equipped_shield_token_id: Option<String>,
    pub equipped_helmet_token_id: Option<String>,
    pub equipped_armor_token_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PendingLeaderIncomeView {
    pub coins: U128,
    pub xp: U128,
    pub points: U128,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ArenaView {
    pub tier: u8,
    pub rank: u32,
    pub is_leader: bool,
    pub pending_leader_income: PendingLeaderIncomeView,
    pub champion_pot: U128,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CombatantSnapshot {
    pub account_id: AccountId,
    pub level: u32,
    pub strength: U128,
    pub dexterity: U128,
    pub vitality: U128,
    pub max_hp: U128,
    pub hp_at_start: U128,
    pub hp_at_end: U128,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CombatRoundLog {
    pub round: u8,
    pub skipped: bool,
    pub attacker_hit: bool,
    pub attacker_damage: U128,
    pub defender_hit: bool,
    pub defender_damage: U128,
    pub attacker_hp_after: U128,
    pub defender_hp_after: U128,
    pub attacker_defeated: bool,
    pub defender_defeated: bool,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ChallengeResult {
    pub combat_id: u64,
    /// Whether the attacker struck first in every round (more DEX since rules v2).
    pub attacker_first: bool,
    pub attacker_won: bool,
    pub draw: bool,
    pub rounds: u8,
    pub attacker_total_damage: U128,
    pub defender_total_damage: U128,
    pub attacker: CombatantSnapshot,
    pub defender: CombatantSnapshot,
    pub round_logs: Vec<CombatRoundLog>,
}

/// Bump whenever combat rules change, so stored combats are never replayed with other rules.
/// v1: attacker always strikes first. v2: the side with more DEX strikes first.
const COMBAT_RULES_VERSION: u8 = 2;
/// Combats kept per player and role (attacks / defenses); older ones are evicted.
const COMBAT_HISTORY_CAP: usize = 50;
const COMBAT_HISTORY_PAGE_MAX: u32 = 50;
const COMBAT_ROUNDS: u8 = 10;

// Combat history lives under its own storage prefixes, outside `GameContract`'s fields,
// so adding it does not change the contract state layout (code-only deploy, no migration).
const COMBAT_RECORDS_PREFIX: &[u8] = b"c";
const COMBAT_INDEX_PREFIX: &[u8] = b"h";
const COMBAT_NEXT_ID_KEY: &[u8] = b"q";

/// Everything needed to replay a combat: the stats each fighter brought into it.
#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct CombatantStart {
    pub account_id: AccountId,
    pub level: u32,
    pub strength: u128,
    pub dexterity: u128,
    pub vitality: u128,
    pub max_hp: u128,
    pub hp_at_start: u128,
}

impl CombatantStart {
    fn snapshot(&self, hp_at_end: u128) -> CombatantSnapshot {
        CombatantSnapshot {
            account_id: self.account_id.clone(),
            level: self.level,
            strength: U128(self.strength),
            dexterity: U128(self.dexterity),
            vitality: U128(self.vitality),
            max_hp: U128(self.max_hp),
            hp_at_start: U128(self.hp_at_start),
            hp_at_end: U128(hp_at_end),
        }
    }
}

/// Stored combat: a compact summary plus the inputs (seed, nonce, stats, config) that let
/// `replay_combat` rebuild every round deterministically without storing them.
#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct CombatRecord {
    pub id: u64,
    pub rules_version: u8,
    pub timestamp_sec: u64,
    pub tier: u8,
    pub random_seed: Vec<u8>,
    pub start_nonce: u64,
    pub config: CombatConfig,
    pub attacker: CombatantStart,
    pub defender: CombatantStart,
    pub outcome: CombatOutcome,
    pub attacker_hp_end: u128,
    pub defender_hp_end: u128,
    pub coins_stolen: u128,
    pub champion_pot_claimed: u128,
    pub attacker_rank_before: u32,
    pub defender_rank_before: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct PlayerCombatIndex {
    /// Oldest first.
    pub attacks: Vec<u64>,
    /// Oldest first.
    pub defenses: Vec<u64>,
}

impl PlayerCombatIndex {
    fn contains(&self, combat_id: u64) -> bool {
        self.attacks.contains(&combat_id) || self.defenses.contains(&combat_id)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum CombatRole {
    Attacks,
    Defenses,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CombatSummaryView {
    pub id: u64,
    pub timestamp_sec: u64,
    pub tier: u8,
    pub attacker_id: AccountId,
    pub defender_id: AccountId,
    pub attacker_level: u32,
    pub defender_level: u32,
    /// "AttackerWins" | "DefenderWins" | "Draw"
    pub outcome: CombatOutcome,
    pub attacker_hp_start: U128,
    pub attacker_hp_end: U128,
    pub defender_hp_start: U128,
    pub defender_hp_end: U128,
    pub coins_stolen: U128,
    pub champion_pot_claimed: U128,
    /// 0-based ranks inside the tier when the combat started.
    pub attacker_rank_before: u32,
    pub defender_rank_before: u32,
    pub replayable: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CombatHistoryPage {
    /// Combats stored for this player and role (at most `COMBAT_HISTORY_CAP`).
    pub total: u32,
    /// Newest first.
    pub items: Vec<CombatSummaryView>,
}

struct CombatSimulation {
    outcome: CombatOutcome,
    attacker_first: bool,
    rounds_executed: u8,
    attacker_hp: u128,
    defender_hp: u128,
    attacker_total_damage: u128,
    defender_total_damage: u128,
    round_logs: Vec<CombatRoundLog>,
    end_nonce: u64,
}

// Expeditions (PvE) keep their own records and index, also outside `GameContract`'s fields.
const EXPEDITION_RECORDS_PREFIX: &[u8] = b"x";
const EXPEDITION_INDEX_PREFIX: &[u8] = b"e";
const EXPEDITION_NEXT_ID_KEY: &[u8] = b"y";
const EXPEDITION_HISTORY_CAP: usize = 50;
/// Same floor as the arena: at least 20% of max effective HP to head out.
const EXPEDITION_MIN_HP_BPS: u128 = CHALLENGE_MIN_HP_BPS;

/// The stats a creature rolled for one fight (it is generated per fight, never an account).
#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct CreatureStats {
    pub level: u32,
    pub strength: u128,
    pub dexterity: u128,
    pub vitality: u128,
    pub max_hp: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExpeditionDrop {
    pub item_id: String,
    pub token_id: String,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct ExpeditionRecord {
    pub id: u64,
    pub rules_version: u8,
    pub timestamp_sec: u64,
    pub creature_id: String,
    pub creature: CreatureStats,
    pub player: CombatantStart,
    pub random_seed: Vec<u8>,
    /// Nonce right after the creature's stats were rolled: the fight starts here.
    pub fight_start_nonce: u64,
    pub config: CombatConfig,
    pub outcome: CombatOutcome,
    pub player_hp_end: u128,
    pub creature_hp_end: u128,
    pub game_coins_gained: u128,
    pub xp_gained: u128,
    pub drop: Option<ExpeditionDrop>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CreatureRewardView {
    pub game_coins: U128,
    pub xp: U128,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CreatureDropView {
    pub item_id: String,
    pub chance_bps: u16,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CreatureView {
    pub id: String,
    pub name: String,
    pub base_strength: U128,
    pub base_dexterity: U128,
    pub base_vitality: U128,
    pub points_per_level: u32,
    pub win: CreatureRewardView,
    pub loss: CreatureRewardView,
    pub draw: CreatureRewardView,
    pub drops: Vec<CreatureDropView>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CreatureSnapshot {
    pub id: String,
    pub name: String,
    pub level: u32,
    pub strength: U128,
    pub dexterity: U128,
    pub vitality: U128,
    pub max_hp: U128,
    pub hp_at_start: U128,
    pub hp_at_end: U128,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExpeditionResult {
    pub expedition_id: u64,
    pub timestamp_sec: u64,
    pub outcome: CombatOutcome,
    /// Whether the player struck first in every round (more DEX; ties go to the player).
    pub player_first: bool,
    pub rounds: u8,
    pub player_total_damage: U128,
    pub creature_total_damage: U128,
    pub player: CombatantSnapshot,
    pub creature: CreatureSnapshot,
    /// `attacker_*` is the player, `defender_*` the creature.
    pub round_logs: Vec<CombatRoundLog>,
    pub game_coins_gained: U128,
    pub xp_gained: U128,
    pub drop: Option<ExpeditionDrop>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExpeditionSummaryView {
    pub id: u64,
    pub timestamp_sec: u64,
    pub creature_id: String,
    pub creature_level: u32,
    pub outcome: CombatOutcome,
    pub player_hp_start: U128,
    pub player_hp_end: U128,
    pub game_coins_gained: U128,
    pub xp_gained: U128,
    pub drop: Option<ExpeditionDrop>,
    pub replayable: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExpeditionHistoryPage {
    pub total: u32,
    /// Newest first.
    pub items: Vec<ExpeditionSummaryView>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GameContract {
    pub owner_id: AccountId,
    pub relayer_account_id: AccountId,
    pub players: LookupMap<AccountId, Player>,
    pub item_catalog: LookupMap<String, ItemDefinition>,
    pub nft_tokens: LookupMap<String, NftToken>,
    pub processed_deposits: UnorderedSet<String>,
    pub stable_token_whitelist: UnorderedSet<AccountId>,
    pub arena_tiers: LookupMap<u8, ArenaTierState>,
    pub grand_pot_usd: u128,
    pub collection_account_id: AccountId,
    pub collection_usd_balance: u128,
    pub next_token_nonce: u64,
    pub combat_nonce: u64,
    pub combat_config: CombatConfig,
    pub ghosts_seeded_v1: bool,
}

#[near]
impl GameContract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        relayer_account_id: AccountId,
        stable_token_contract_id: AccountId,
        combat_config: Option<CombatConfig>,
    ) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");
        let now_sec = now_sec();
        let collection_account_id = DEFAULT_COLLECTION_ACCOUNT_ID
            .parse::<AccountId>()
            .unwrap_or_else(|_| env::panic_str("invalid default collection account"));

        let mut contract = Self {
            owner_id,
            relayer_account_id,
            players: LookupMap::new(b"p"),
            item_catalog: LookupMap::new(b"i"),
            nft_tokens: LookupMap::new(b"n"),
            processed_deposits: UnorderedSet::new(b"d"),
            stable_token_whitelist: UnorderedSet::new(b"s"),
            arena_tiers: LookupMap::new(b"a"),
            grand_pot_usd: 0,
            collection_account_id,
            collection_usd_balance: 0,
            next_token_nonce: 1,
            combat_nonce: 0,
            combat_config: combat_config.unwrap_or_default(),
            ghosts_seeded_v1: false,
        };

        contract
            .stable_token_whitelist
            .insert(&stable_token_contract_id);

        contract.arena_tiers.insert(&TIER_ONE, &ArenaTierState::new(now_sec));
        contract.arena_tiers.insert(&TIER_TWO, &ArenaTierState::new(now_sec));
        contract.arena_tiers.insert(&TIER_THREE, &ArenaTierState::new(now_sec));
        contract
    }

    pub fn register_player(&mut self) {
        let account_id = env::predecessor_account_id();
        require!(self.players.get(&account_id).is_none(), "Player already registered");

        let player = Player::new(account_id.clone(), 1, false, now_sec());
        self.players.insert(&account_id, &player);
        self.insert_into_tier_ladder(account_id, tier_for_level(1));
    }

    pub fn init_ghosts_v1(&mut self) {
        self.assert_owner();
        require!(!self.ghosts_seeded_v1, "Ghosts already seeded");

        for (ghost_id, level) in ghost_ids_v1() {
            if self.players.get(&ghost_id).is_some() {
                continue;
            }

            let mut ghost = Player::new(ghost_id.clone(), level, true, now_sec());
            ghost.game_coins = GHOST_STARTING_GAME_COINS;
            self.players.insert(&ghost_id, &ghost);
            self.insert_into_tier_ladder(ghost_id, TIER_ONE);
        }

        self.ghosts_seeded_v1 = true;
    }

    pub fn assign_stat_points(&mut self, strength_points: u32, dexterity_points: u32, vitality_points: u32) {
        let now = now_sec();
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
        self.apply_hp_regen(&mut player, now);
        let total = strength_points
            .checked_add(dexterity_points)
            .and_then(|value| value.checked_add(vitality_points))
            .unwrap_or_else(|| env::panic_str("point overflow"));

        require!(total > 0, "at least one point must be assigned");
        require!(player.unassigned_points >= total, "insufficient unassigned points");

        player.unassigned_points -= total;
        player.base_strength = player
            .base_strength
            .checked_add(u128::from(strength_points) * SCALE)
            .unwrap_or_else(|| env::panic_str("strength overflow"));
        player.base_dexterity = player
            .base_dexterity
            .checked_add(u128::from(dexterity_points) * SCALE)
            .unwrap_or_else(|| env::panic_str("dexterity overflow"));
        player.base_vitality = player
            .base_vitality
            .checked_add(u128::from(vitality_points) * SCALE)
            .unwrap_or_else(|| env::panic_str("vitality overflow"));

        let (_, _, effective_vitality) = self.effective_stats(&player);
        let max_hp = max_hp_from_vitality(effective_vitality);
        if player.current_hp > max_hp {
            player.current_hp = max_hp;
        }

        self.players.insert(&account_id, &player);
    }

    pub fn upsert_item_definition(&mut self, item: ItemDefinition) {
        self.assert_owner();
        require!(!item.item_id.trim().is_empty(), "item_id must not be empty");
        require!(
            item.price_game_coin.0 > 0 || item.price_stablecoin.0 > 0,
            "at least one price must be > 0"
        );

        self.item_catalog.insert(&item.item_id, &item);
    }

    pub fn buy_item_with_game_coin(&mut self, item_id: String) {
        self.purchase_lines(vec![PurchaseLine {
            item_id,
            quantity: 1,
            currency: PurchaseCurrency::GameCoin,
        }]);
    }

    pub fn buy_item(&mut self, item_id: String) {
        self.purchase_lines(vec![PurchaseLine {
            item_id,
            quantity: 1,
            currency: PurchaseCurrency::Stablecoin,
        }]);
    }

    /// Buys every cart line in one transaction, possibly mixing currencies.
    /// All lines are validated and both balances checked before any state changes,
    /// so the purchase is all-or-nothing. Returns the minted token ids.
    pub fn buy_items(&mut self, lines: Vec<PurchaseLine>) -> Vec<String> {
        self.purchase_lines(lines)
    }

    pub fn add_stable_token_to_whitelist(&mut self, token_contract_id: AccountId) {
        self.assert_owner();
        self.stable_token_whitelist.insert(&token_contract_id);
    }

    pub fn remove_stable_token_from_whitelist(&mut self, token_contract_id: AccountId) {
        self.assert_owner();
        require!(self.stable_token_whitelist.contains(&token_contract_id), "token is not whitelisted");

        let remaining = self
            .stable_token_whitelist
            .iter()
            .filter(|value| value != &token_contract_id)
            .count();
        require!(remaining > 0, "cannot remove last whitelisted stable token");

        self.stable_token_whitelist.remove(&token_contract_id);
    }

    pub fn get_stable_token_whitelist(&self) -> Vec<AccountId> {
        self.stable_token_whitelist.iter().collect()
    }

    pub fn equip(&mut self, token_id: String) {
        self.apply_inventory_actions(vec![InventoryAction::Equip { token_id }]);
    }

    pub fn unequip(&mut self, slot: ItemSlot) {
        self.apply_inventory_actions(vec![InventoryAction::Unequip { slot }]);
    }

    pub fn consume(&mut self, token_id: String) {
        self.apply_inventory_actions(vec![InventoryAction::Consume { token_id }]);
    }

    /// Applies equip/unequip/consume actions in order within one transaction.
    /// Works on a local copy of the player and burns consumed tokens only after every
    /// action succeeded, so the batch is all-or-nothing. Order matters: e.g. equipping
    /// vitality gear before drinking a potion raises the HP cap the potion heals up to.
    pub fn apply_inventory_actions(&mut self, actions: Vec<InventoryAction>) {
        require!(!actions.is_empty(), "Actions must not be empty");
        require!(
            actions.len() <= MAX_INVENTORY_ACTIONS,
            "Too many inventory actions in one call"
        );

        let now = now_sec();
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
        self.apply_hp_regen(&mut player, now);

        let mut burned_token_ids: Vec<String> = Vec::new();
        for action in actions {
            match action {
                InventoryAction::Equip { token_id } => {
                    self.equip_on(&account_id, &mut player, token_id);
                }
                InventoryAction::Unequip { slot } => Self::unequip_on(&mut player, slot),
                InventoryAction::Consume { token_id } => {
                    self.consume_on(&account_id, &mut player, &token_id);
                    burned_token_ids.push(token_id);
                }
            }
        }

        let (_, _, effective_vitality) = self.effective_stats(&player);
        let max_hp = max_hp_from_vitality(effective_vitality);
        if player.current_hp > max_hp {
            player.current_hp = max_hp;
        }

        for token_id in &burned_token_ids {
            self.nft_tokens.remove(token_id);
        }
        self.players.insert(&account_id, &player);
    }

    pub fn claim_leader_income(&mut self) {
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
        let now = now_sec();
        self.apply_hp_regen(&mut player, now);
        let tier = tier_for_level(player.level);
        self.players.insert(&account_id, &player);

        self.accrue_champion_pot_for_tier(tier, now);
        self.settle_current_leader_income(tier, now);

        let mut updated = self.must_player(&account_id);
        self.apply_level_ups(&mut updated);
        self.handle_tier_change_if_needed(&account_id, &mut updated, now);
        self.players.insert(&account_id, &updated);
    }

    pub fn challenge(&mut self, opponent_account_id: AccountId) -> ChallengeResult {
        let attacker_id = env::predecessor_account_id();
        require!(attacker_id != opponent_account_id, "cannot challenge self");

        let now = now_sec();
        let mut attacker = self.must_player(&attacker_id);
        let mut defender = self.must_player(&opponent_account_id);
        self.apply_hp_regen(&mut attacker, now);
        self.apply_hp_regen(&mut defender, now);

        require!(!attacker.is_ghost, "ghosts cannot initiate challenge");

        let attacker_tier = tier_for_level(attacker.level);
        let defender_tier = tier_for_level(defender.level);
        require!(attacker_tier == defender_tier, "challenge must stay inside same tier");

        self.accrue_champion_pot_for_tier(attacker_tier, now);
        self.settle_current_leader_income(attacker_tier, now);

        let mut tier_state = self.must_tier_state(attacker_tier);
        let attacker_rank = find_rank(&tier_state.ladder, &attacker_id)
            .unwrap_or_else(|| env::panic_str("attacker not found in ladder"));
        let defender_rank = find_rank(&tier_state.ladder, &opponent_account_id)
            .unwrap_or_else(|| env::panic_str("defender not found in ladder"));

        require!(defender_rank < attacker_rank, "target must be above attacker");
        require!(attacker_rank - defender_rank <= 5, "target must be one of top 5 above");

        let (attacker_str, attacker_dex, attacker_vit) = self.effective_stats(&attacker);
        let (defender_str, defender_dex, defender_vit) = self.effective_stats(&defender);

        let attacker_max_hp = max_hp_from_vitality(attacker_vit);
        let defender_max_hp = max_hp_from_vitality(defender_vit);
        let min_required_hp = apply_bps(attacker_max_hp, CHALLENGE_MIN_HP_BPS);
        require!(attacker.current_hp >= min_required_hp, "attacker hp below challenge threshold");

        let attacker_start = CombatantStart {
            account_id: attacker_id.clone(),
            level: attacker.level,
            strength: attacker_str,
            dexterity: attacker_dex,
            vitality: attacker_vit,
            max_hp: attacker_max_hp,
            hp_at_start: attacker.current_hp,
        };
        let defender_start = CombatantStart {
            account_id: opponent_account_id.clone(),
            level: defender.level,
            strength: defender_str,
            dexterity: defender_dex,
            vitality: defender_vit,
            max_hp: defender_max_hp,
            hp_at_start: defender.current_hp,
        };

        let random_seed = env::random_seed();
        let start_nonce = self.combat_nonce;
        let simulation = simulate_combat(
            &random_seed,
            start_nonce,
            &attacker_start,
            &defender_start,
            &self.combat_config,
            COMBAT_RULES_VERSION,
        );
        self.combat_nonce = simulation.end_nonce;

        attacker.current_hp = simulation.attacker_hp;
        defender.current_hp = simulation.defender_hp;

        let attacker_coins_before = attacker.game_coins;
        let defender_coins_before = defender.game_coins;
        let mut champion_pot_claimed = 0u128;

        match simulation.outcome {
            CombatOutcome::AttackerWins => {
                self.apply_win_rewards(&mut attacker, &mut defender);

                // If defender was leader, attacker claims champion pot.
                if defender_rank == 0 {
                    champion_pot_claimed = tier_state.champion_pot;
                    attacker.game_coins = attacker
                        .game_coins
                        .checked_add(tier_state.champion_pot)
                        .unwrap_or_else(|| env::panic_str("champion pot overflow"));
                    tier_state.champion_pot = 0;
                }

                // Attacker takes the defender's rank; the defender and everyone in between
                // drop one place. Ranks outside [defender, attacker] are untouched.
                tier_state.ladder[defender_rank..=attacker_rank].rotate_right(1);
                if defender_rank == 0 {
                    tier_state.leader_last_income_ts_sec = now;
                }
            }
            CombatOutcome::DefenderWins => {
                self.apply_win_rewards(&mut defender, &mut attacker);
            }
            CombatOutcome::Draw => {
                self.apply_draw_rewards(&mut attacker, &mut defender);
            }
        }

        // Coins the loser handed to the winner (champion pot excluded).
        let coins_stolen = match simulation.outcome {
            CombatOutcome::AttackerWins => defender_coins_before - defender.game_coins,
            CombatOutcome::DefenderWins => attacker_coins_before - attacker.game_coins,
            CombatOutcome::Draw => 0,
        };

        self.apply_level_ups(&mut attacker);
        self.apply_level_ups(&mut defender);

        self.arena_tiers.insert(&attacker_tier, &tier_state);

        self.handle_tier_change_if_needed(&attacker_id, &mut attacker, now);
        self.handle_tier_change_if_needed(&opponent_account_id, &mut defender, now);

        self.players.insert(&attacker_id, &attacker);
        self.players.insert(&opponent_account_id, &defender);

        let combat_id = self.store_combat_record(CombatRecord {
            id: 0,
            rules_version: COMBAT_RULES_VERSION,
            timestamp_sec: now,
            tier: attacker_tier,
            random_seed,
            start_nonce,
            config: self.combat_config.clone(),
            attacker: attacker_start.clone(),
            defender: defender_start.clone(),
            outcome: simulation.outcome,
            attacker_hp_end: simulation.attacker_hp,
            defender_hp_end: simulation.defender_hp,
            coins_stolen,
            champion_pot_claimed,
            attacker_rank_before: attacker_rank as u32,
            defender_rank_before: defender_rank as u32,
        });

        build_challenge_result(combat_id, &attacker_start, &defender_start, simulation)
    }

    pub fn credit_deposit(
        &mut self,
        account_id: AccountId,
        token_contract_id: AccountId,
        amount: U128,
        chain: String,
        tx_ref: String,
    ) {
        self.assert_relayer();
        require!(!tx_ref.trim().is_empty(), "tx_ref must not be empty");
        require!(!chain.trim().is_empty(), "chain must not be empty");
        require!(
            self.stable_token_whitelist.contains(&token_contract_id),
            "stable token is not whitelisted"
        );

        if self.processed_deposits.contains(&tx_ref) {
            return;
        }

        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| Player::new(account_id.clone(), 1, false, now_sec()));

        player.stablecoin_balance = player
            .stablecoin_balance
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("stablecoin overflow"));

        self.players.insert(&account_id, &player);
        self.processed_deposits.insert(&tx_ref);
    }

    pub fn donate_to_grand_pot(
        &mut self,
        token_contract_id: AccountId,
        amount: U128,
        chain: String,
        tx_ref: String,
    ) {
        self.assert_relayer();
        require!(!tx_ref.trim().is_empty(), "tx_ref must not be empty");
        require!(!chain.trim().is_empty(), "chain must not be empty");
        require!(
            self.stable_token_whitelist.contains(&token_contract_id),
            "stable token is not whitelisted"
        );

        if self.processed_deposits.contains(&tx_ref) {
            return;
        }

        self.grand_pot_usd = self
            .grand_pot_usd
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("grand pot overflow"));
        self.processed_deposits.insert(&tx_ref);
    }

    /// Sets the game coin balance of every seeded v1 ghost. Returns how many ghosts were updated.
    pub fn dev_set_ghosts_game_coin(&mut self, amount: U128) -> u32 {
        self.assert_owner();
        let mut updated = 0;
        for (ghost_id, _) in ghost_ids_v1() {
            if let Some(mut ghost) = self.players.get(&ghost_id) {
                ghost.game_coins = amount.0;
                self.players.insert(&ghost_id, &ghost);
                updated += 1;
            }
        }
        updated
    }

    pub fn dev_set_player_game_coin(&mut self, account_id: AccountId, amount: U128) {
        self.assert_owner();
        let mut player = self.must_player(&account_id);
        player.game_coins = amount.0;
        self.players.insert(&account_id, &player);
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<Player> {
        self.players.get(&account_id)
    }

    pub fn get_player_view(&self, account_id: AccountId) -> Option<PlayerView> {
        let player = self.players.get(&account_id)?;
        let (bonus_str, bonus_dex, bonus_vit) = self.bonus_stats(&player);

        let effective_str = player.base_strength.checked_add(bonus_str)?;
        let effective_dex = player.base_dexterity.checked_add(bonus_dex)?;
        let effective_vit = player.base_vitality.checked_add(bonus_vit)?;
        let max_hp = max_hp_from_vitality(effective_vit);
        let current_hp = self.regenerated_hp_at(&player, now_sec());

        Some(PlayerView {
            account_id: player.account_id.clone(),
            level: player.level,
            xp: U128(player.xp),
            xp_to_next_level: U128(xp_to_next_level(player.level)),
            unassigned_points: player.unassigned_points,
            base_strength: U128(player.base_strength),
            base_dexterity: U128(player.base_dexterity),
            base_vitality: U128(player.base_vitality),
            bonus_strength: U128(bonus_str),
            bonus_dexterity: U128(bonus_dex),
            bonus_vitality: U128(bonus_vit),
            effective_strength: U128(effective_str),
            effective_dexterity: U128(effective_dex),
            effective_vitality: U128(effective_vit),
            max_hp: U128(max_hp),
            current_hp: U128(current_hp),
            game_coins: U128(player.game_coins),
            stablecoin_balance: U128(player.stablecoin_balance),
            owned_item_ids: player.owned_item_ids.clone(),
            owned_token_ids: player.owned_token_ids.clone(),
            equipped_weapon_token_id: player.equipped_weapon_token_id.clone(),
            equipped_shield_token_id: player.equipped_shield_token_id.clone(),
            equipped_helmet_token_id: player.equipped_helmet_token_id.clone(),
            equipped_armor_token_id: player.equipped_armor_token_id.clone(),
        })
    }

    pub fn get_challenge_candidates(&self, account_id: AccountId) -> Vec<AccountId> {
        let player = match self.players.get(&account_id) {
            Some(value) => value,
            None => return vec![],
        };

        let tier = tier_for_level(player.level);
        let tier_state = match self.arena_tiers.get(&tier) {
            Some(value) => value,
            None => return vec![],
        };

        let rank = match find_rank(&tier_state.ladder, &account_id) {
            Some(value) => value,
            None => return vec![],
        };

        if rank == 0 {
            return vec![];
        }

        let start = rank.saturating_sub(5);
        tier_state.ladder[start..rank].to_vec()
    }

    pub fn get_tier_top(&self, tier: u8, limit: u32) -> Vec<AccountId> {
        let tier_state = match self.arena_tiers.get(&tier) {
            Some(value) => value,
            None => return vec![],
        };

        let capped_limit = limit.clamp(1, 50) as usize;
        tier_state.ladder.iter().take(capped_limit).cloned().collect()
    }

    /// Fights a creature (by id) generated at the player's level for this fight only.
    pub fn start_expedition(&mut self, creature_id: String) -> ExpeditionResult {
        let player_id = env::predecessor_account_id();
        let creature =
            find_creature(&creature_id).unwrap_or_else(|| env::panic_str("unknown creature"));
        let now = now_sec();
        let mut player = self.must_player(&player_id);
        require!(!player.is_ghost, "ghosts cannot go on expeditions");
        self.apply_hp_regen(&mut player, now);

        let (strength, dexterity, vitality) = self.effective_stats(&player);
        let max_hp = max_hp_from_vitality(vitality);
        require!(
            player.current_hp >= apply_bps(max_hp, EXPEDITION_MIN_HP_BPS),
            "player hp below expedition threshold"
        );

        let player_start = CombatantStart {
            account_id: player_id.clone(),
            level: player.level,
            strength,
            dexterity,
            vitality,
            max_hp,
            hp_at_start: player.current_hp,
        };

        let random_seed = env::random_seed();
        let mut rng = CombatRng {
            seed: &random_seed,
            nonce: self.combat_nonce,
        };
        let creature_stats =
            roll_creature_stats(&mut rng, creature, player.level, player_id.as_bytes());
        let fight_start_nonce = rng.nonce;
        let simulation = simulate_expedition_fight(
            &mut rng,
            &player_start,
            creature,
            &creature_stats,
            &self.combat_config,
            COMBAT_RULES_VERSION,
        );

        let reward = creature_reward(creature, simulation.outcome);
        let dropped =
            if simulation.outcome == CombatOutcome::AttackerWins && !creature.drops.is_empty() {
                let roll = rng.roll(
                    1,
                    BPS_DENOMINATOR as u16,
                    player_id.as_bytes(),
                    creature.id.as_bytes(),
                );
                drop_for_roll(creature.drops, roll)
            } else {
                None
            };
        self.combat_nonce = rng.nonce;

        player.current_hp = simulation.attacker_hp;
        player.game_coins = player
            .game_coins
            .checked_add(reward.game_coins)
            .unwrap_or_else(|| env::panic_str("coin overflow"));
        player.xp = player
            .xp
            .checked_add(reward.xp)
            .unwrap_or_else(|| env::panic_str("xp overflow"));

        let drop = dropped.map(|creature_drop| {
            require!(
                self.item_catalog
                    .get(&creature_drop.item_id.to_string())
                    .is_some(),
                "creature drop item is not in the catalog"
            );
            let token_id = self.mint_item_to_player(&player_id, creature_drop.item_id, &mut player);
            ExpeditionDrop {
                item_id: creature_drop.item_id.to_string(),
                token_id,
            }
        });

        self.apply_level_ups(&mut player);
        self.handle_tier_change_if_needed(&player_id, &mut player, now);
        self.players.insert(&player_id, &player);

        let mut record = ExpeditionRecord {
            id: 0,
            rules_version: COMBAT_RULES_VERSION,
            timestamp_sec: now,
            creature_id: creature.id.to_string(),
            creature: creature_stats,
            player: player_start,
            random_seed: random_seed.clone(),
            fight_start_nonce,
            config: self.combat_config.clone(),
            outcome: simulation.outcome,
            player_hp_end: simulation.attacker_hp,
            creature_hp_end: simulation.defender_hp,
            game_coins_gained: reward.game_coins,
            xp_gained: reward.xp,
            drop,
        };
        record.id = store_expedition_record(&record);

        build_expedition_result(&record, creature, simulation)
    }

    /// Creatures available for expeditions (data from `creatures.rs`).
    pub fn get_creatures(&self) -> Vec<CreatureView> {
        CREATURES.iter().map(creature_view).collect()
    }

    pub fn get_expedition_history(
        &self,
        account_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> ExpeditionHistoryPage {
        let ids = expedition_index().get(&account_id).unwrap_or_default();
        let records = expedition_records();
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(10).clamp(1, COMBAT_HISTORY_PAGE_MAX) as usize;

        ExpeditionHistoryPage {
            total: ids.len() as u32,
            items: ids
                .iter()
                .rev()
                .skip(from)
                .take(limit)
                .filter_map(|id| records.get(id))
                .map(|record| summarize_expedition(&record))
                .collect(),
        }
    }

    /// Rebuilds every round of a stored expedition from its seed, nonce and stats.
    pub fn replay_expedition(&self, expedition_id: u64) -> Option<ExpeditionResult> {
        let record = expedition_records().get(&expedition_id)?;
        require!(
            is_replayable_rules_version(record.rules_version),
            "expedition was played with other rules and cannot be replayed"
        );
        let creature = find_creature(&record.creature_id)
            .unwrap_or_else(|| env::panic_str("creature no longer exists"));
        let mut rng = CombatRng {
            seed: &record.random_seed,
            nonce: record.fight_start_nonce,
        };
        let simulation = simulate_expedition_fight(
            &mut rng,
            &record.player,
            creature,
            &record.creature,
            &record.config,
            record.rules_version,
        );
        require!(
            simulation.outcome == record.outcome
                && simulation.attacker_hp == record.player_hp_end
                && simulation.defender_hp == record.creature_hp_end,
            "expedition replay diverged from the stored result"
        );
        Some(build_expedition_result(&record, creature, simulation))
    }

    pub fn get_combat(&self, combat_id: u64) -> Option<CombatSummaryView> {
        combat_records()
            .get(&combat_id)
            .map(|record| summarize_combat(&record))
    }

    /// Paginated combat history for one player and role, newest first.
    pub fn get_combat_history(
        &self,
        account_id: AccountId,
        role: CombatRole,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> CombatHistoryPage {
        let player_index = combat_index().get(&account_id).unwrap_or_default();
        let ids = match role {
            CombatRole::Attacks => player_index.attacks,
            CombatRole::Defenses => player_index.defenses,
        };
        let records = combat_records();
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(10).clamp(1, COMBAT_HISTORY_PAGE_MAX) as usize;

        CombatHistoryPage {
            total: ids.len() as u32,
            items: ids
                .iter()
                .rev()
                .skip(from)
                .take(limit)
                .filter_map(|id| records.get(id))
                .map(|record| summarize_combat(&record))
                .collect(),
        }
    }

    /// Rebuilds every round of a stored combat from its seed, nonce and starting stats.
    pub fn replay_combat(&self, combat_id: u64) -> Option<ChallengeResult> {
        let record = combat_records().get(&combat_id)?;
        require!(
            is_replayable_rules_version(record.rules_version),
            "combat was played with other rules and cannot be replayed"
        );
        let simulation = simulate_combat(
            &record.random_seed,
            record.start_nonce,
            &record.attacker,
            &record.defender,
            &record.config,
            record.rules_version,
        );
        require!(
            simulation.outcome == record.outcome
                && simulation.attacker_hp == record.attacker_hp_end
                && simulation.defender_hp == record.defender_hp_end,
            "combat replay diverged from the stored result"
        );
        Some(build_challenge_result(
            record.id,
            &record.attacker,
            &record.defender,
            simulation,
        ))
    }

    pub fn get_arena_view(&self, account_id: AccountId) -> Option<ArenaView> {
        let player = self.players.get(&account_id)?;
        let tier = tier_for_level(player.level);
        let tier_state = self.arena_tiers.get(&tier)?;
        let rank = find_rank(&tier_state.ladder, &account_id)? as u32;
        let is_leader = rank == 0;

        let champion_pot = self.peek_champion_pot(tier, now_sec());
        let pending = if is_leader && !player.is_ghost {
            self.peek_leader_income(tier, now_sec())
        } else {
            (0, 0, 0)
        };

        Some(ArenaView {
            tier,
            rank,
            is_leader,
            pending_leader_income: PendingLeaderIncomeView {
                coins: U128(pending.0),
                xp: U128(pending.1),
                points: U128(pending.2),
            },
            champion_pot: U128(champion_pot),
        })
    }

    pub fn get_pot(&self) -> U128 {
        let now = now_sec();
        U128(
            self.peek_champion_pot(TIER_ONE, now)
                .checked_add(self.peek_champion_pot(TIER_TWO, now))
                .and_then(|value| value.checked_add(self.peek_champion_pot(TIER_THREE, now)))
                .unwrap_or_else(|| env::panic_str("champion pot overflow")),
        )
    }

    pub fn get_grand_pot(&self) -> U128 {
        U128(self.grand_pot_usd)
    }

    pub fn get_collection_account(&self) -> AccountId {
        self.collection_account_id.clone()
    }

    pub fn get_collection_balance(&self) -> U128 {
        U128(self.collection_usd_balance)
    }

    pub fn get_item_definition(&self, item_id: String) -> Option<ItemDefinition> {
        self.item_catalog.get(&item_id)
    }

    pub fn get_token(&self, token_id: String) -> Option<NftToken> {
        self.nft_tokens.get(&token_id)
    }

    pub fn get_player_item_ids(&self, account_id: AccountId) -> Vec<String> {
        self.players
            .get(&account_id)
            .map(|p| p.owned_item_ids)
            .unwrap_or_default()
    }

    pub fn get_player_token_ids(&self, account_id: AccountId) -> Vec<String> {
        self.players
            .get(&account_id)
            .map(|p| p.owned_token_ids)
            .unwrap_or_default()
    }

    pub fn empty_state_delete_keys(&mut self, keys: Vec<Base64VecU8>) -> u32 {
        self.assert_owner();
        self.assert_testnet_only();
        require!(!keys.is_empty(), "keys must not be empty");
        require!(keys.len() <= 500, "too many keys in one call");

        let mut deleted = 0u32;

        for key in keys {
            let raw = key.0;

            require!(raw != b"STATE", "deleting STATE key is not allowed");
            require!(
                Self::is_managed_storage_key(&raw),
                "key prefix is not allowed for empty_state_delete_keys"
            );

            if env::storage_remove(&raw) {
                deleted = deleted
                    .checked_add(1)
                    .unwrap_or_else(|| env::panic_str("deleted counter overflow"));
            }
        }

        deleted
    }

    pub fn empty_state_finalize(&mut self) {
        self.assert_owner();
        self.assert_testnet_only();

        self.next_token_nonce = 1;
        self.combat_nonce = 0;
        self.ghosts_seeded_v1 = false;
        env::storage_remove(COMBAT_NEXT_ID_KEY);
        env::storage_remove(EXPEDITION_NEXT_ID_KEY);

        let now = now_sec();
        self.arena_tiers.insert(&TIER_ONE, &ArenaTierState::new(now));
        self.arena_tiers.insert(&TIER_TWO, &ArenaTierState::new(now));
        self.arena_tiers.insert(&TIER_THREE, &ArenaTierState::new(now));
    }

    fn apply_win_rewards(&self, winner: &mut Player, loser: &mut Player) {
        let m_bps = level_multiplier_bps(loser.level, winner.level);

        let points_gain = apply_bps(WIN_POINTS, m_bps);
        if !winner.is_ghost {
            winner.tournament_points = winner
                .tournament_points
                .checked_add(points_gain)
                .unwrap_or_else(|| env::panic_str("points overflow"));
        }

        winner.xp = winner
            .xp
            .checked_add(apply_bps(WIN_XP, m_bps))
            .unwrap_or_else(|| env::panic_str("xp overflow"));

        loser.xp = loser
            .xp
            .checked_add(apply_bps(LOSE_XP, m_bps))
            .unwrap_or_else(|| env::panic_str("xp overflow"));

        let steal_amount = apply_bps(loser.game_coins, STEAL_BPS).min(STEAL_CAP);
        if steal_amount > 0 {
            loser.game_coins -= steal_amount;
            winner.game_coins = winner
                .game_coins
                .checked_add(steal_amount)
                .unwrap_or_else(|| env::panic_str("coin overflow"));
        }
    }

    fn apply_draw_rewards(&self, a: &mut Player, b: &mut Player) {
        if !a.is_ghost {
            a.tournament_points = a
                .tournament_points
                .checked_add(DRAW_POINTS)
                .unwrap_or_else(|| env::panic_str("points overflow"));
        }

        if !b.is_ghost {
            b.tournament_points = b
                .tournament_points
                .checked_add(DRAW_POINTS)
                .unwrap_or_else(|| env::panic_str("points overflow"));
        }

        a.xp = a.xp.checked_add(DRAW_XP).unwrap_or_else(|| env::panic_str("xp overflow"));
        b.xp = b.xp.checked_add(DRAW_XP).unwrap_or_else(|| env::panic_str("xp overflow"));
    }

    fn apply_level_ups(&self, player: &mut Player) {
        while player.level < MAX_LEVEL {
            let needed = xp_to_next_level(player.level);
            if player.xp < needed {
                break;
            }

            player.xp -= needed;
            player.level += 1;
            player.unassigned_points = player
                .unassigned_points
                .checked_add(STAT_POINTS_PER_LEVEL)
                .unwrap_or_else(|| env::panic_str("unassigned points overflow"));
        }
    }

    fn handle_tier_change_if_needed(&mut self, account_id: &AccountId, player: &mut Player, now: u64) {
        let target_tier = tier_for_level(player.level);

        let source_tier = match self.find_player_tier(account_id) {
            Some(value) => value,
            None => return,
        };

        if source_tier == target_tier {
            return;
        }

        self.accrue_champion_pot_for_tier(source_tier, now);
        self.settle_current_leader_income(source_tier, now);

        let mut source_state = self.must_tier_state(source_tier);
        let rank = find_rank(&source_state.ladder, account_id)
            .unwrap_or_else(|| env::panic_str("player missing in source ladder"));

        let was_leader = rank == 0;
        source_state.ladder.remove(rank);

        if was_leader {
            player.game_coins = player
                .game_coins
                .checked_add(source_state.champion_pot)
                .unwrap_or_else(|| env::panic_str("champion pot overflow"));
            source_state.champion_pot = 0;
            source_state.leader_last_income_ts_sec = now;
            source_state.champion_pot_last_accrual_ts_sec = now;
        }

        if source_state.ladder.is_empty() {
            source_state.leader_last_income_ts_sec = now;
        }
        self.arena_tiers.insert(&source_tier, &source_state);

        self.insert_into_tier_ladder(account_id.clone(), target_tier);
    }

    fn settle_current_leader_income(&mut self, tier: u8, now: u64) {
        let mut tier_state = self.must_tier_state(tier);
        if tier_state.ladder.is_empty() {
            tier_state.leader_last_income_ts_sec = now;
            self.arena_tiers.insert(&tier, &tier_state);
            return;
        }

        let leader_id = tier_state.ladder[0].clone();
        let elapsed = now.saturating_sub(tier_state.leader_last_income_ts_sec);
        tier_state.leader_last_income_ts_sec = now;

        if elapsed == 0 {
            self.arena_tiers.insert(&tier, &tier_state);
            return;
        }

        let mut leader = self.must_player(&leader_id);
        if !leader.is_ghost {
            let (coins, xp, points) = per_hour_income(elapsed);

            leader.game_coins = leader
                .game_coins
                .checked_add(coins)
                .unwrap_or_else(|| env::panic_str("leader coins overflow"));
            leader.xp = leader
                .xp
                .checked_add(xp)
                .unwrap_or_else(|| env::panic_str("leader xp overflow"));
            leader.tournament_points = leader
                .tournament_points
                .checked_add(points)
                .unwrap_or_else(|| env::panic_str("leader points overflow"));

            self.apply_level_ups(&mut leader);
            self.players.insert(&leader_id, &leader);
        }

        self.arena_tiers.insert(&tier, &tier_state);
    }

    fn accrue_champion_pot_for_tier(&mut self, tier: u8, now: u64) {
        let mut tier_state = self.must_tier_state(tier);
        let elapsed = now.saturating_sub(tier_state.champion_pot_last_accrual_ts_sec);
        if elapsed == 0 {
            return;
        }

        tier_state.champion_pot_last_accrual_ts_sec = now;
        if !tier_state.ladder.is_empty() {
            let add = mul_div_floor(CHAMPION_POT_PER_HOUR, u128::from(elapsed), 3_600u128);
            tier_state.champion_pot = tier_state
                .champion_pot
                .checked_add(add)
                .unwrap_or_else(|| env::panic_str("champion pot overflow"));
        }

        self.arena_tiers.insert(&tier, &tier_state);
    }

    fn peek_leader_income(&self, tier: u8, now: u64) -> (u128, u128, u128) {
        let tier_state = match self.arena_tiers.get(&tier) {
            Some(value) => value,
            None => return (0, 0, 0),
        };

        let elapsed = now.saturating_sub(tier_state.leader_last_income_ts_sec);
        per_hour_income(elapsed)
    }

    fn peek_champion_pot(&self, tier: u8, now: u64) -> u128 {
        let tier_state = match self.arena_tiers.get(&tier) {
            Some(value) => value,
            None => return 0,
        };

        if tier_state.ladder.is_empty() {
            return tier_state.champion_pot;
        }

        let elapsed = now.saturating_sub(tier_state.champion_pot_last_accrual_ts_sec);
        let add = mul_div_floor(CHAMPION_POT_PER_HOUR, u128::from(elapsed), 3_600u128);
        tier_state
            .champion_pot
            .checked_add(add)
            .unwrap_or_else(|| env::panic_str("champion pot overflow"))
    }

    fn effective_stats(&self, player: &Player) -> (u128, u128, u128) {
        let (bonus_str, bonus_dex, bonus_vit) = self.bonus_stats(player);

        let effective_str = player
            .base_strength
            .checked_add(bonus_str)
            .unwrap_or_else(|| env::panic_str("effective strength overflow"));
        let effective_dex = player
            .base_dexterity
            .checked_add(bonus_dex)
            .unwrap_or_else(|| env::panic_str("effective dexterity overflow"));
        let effective_vit = player
            .base_vitality
            .checked_add(bonus_vit)
            .unwrap_or_else(|| env::panic_str("effective vitality overflow"));

        (effective_str, effective_dex, effective_vit)
    }

    fn regenerated_hp_at(&self, player: &Player, now: u64) -> u128 {
        let (_, _, effective_vitality) = self.effective_stats(player);
        let max_hp = max_hp_from_vitality(effective_vitality);
        if player.current_hp >= max_hp {
            return max_hp;
        }

        if player.last_hp_regen_ts_sec == 0 {
            return player.current_hp;
        }

        let elapsed = now.saturating_sub(player.last_hp_regen_ts_sec);
        let ticks = elapsed / HP_REGEN_INTERVAL_SECONDS;
        if ticks == 0 {
            return player.current_hp;
        }

        let regen_per_tick = apply_bps(max_hp, HP_REGEN_BPS);
        if regen_per_tick == 0 {
            return player.current_hp;
        }

        let recovered = regen_per_tick
            .checked_mul(u128::from(ticks))
            .unwrap_or_else(|| env::panic_str("hp regen overflow"));

        player
            .current_hp
            .saturating_add(recovered)
            .min(max_hp)
    }

    fn apply_hp_regen(&self, player: &mut Player, now: u64) {
        let (_, _, effective_vitality) = self.effective_stats(player);
        let max_hp = max_hp_from_vitality(effective_vitality);

        if player.current_hp >= max_hp {
            player.current_hp = max_hp;
            player.last_hp_regen_ts_sec = now;
            return;
        }

        if player.last_hp_regen_ts_sec == 0 {
            player.last_hp_regen_ts_sec = now;
            return;
        }

        let elapsed = now.saturating_sub(player.last_hp_regen_ts_sec);
        let ticks = elapsed / HP_REGEN_INTERVAL_SECONDS;
        if ticks == 0 {
            return;
        }

        let regen_per_tick = apply_bps(max_hp, HP_REGEN_BPS);
        if regen_per_tick == 0 {
            player.last_hp_regen_ts_sec = now;
            return;
        }

        let recovered = regen_per_tick
            .checked_mul(u128::from(ticks))
            .unwrap_or_else(|| env::panic_str("hp regen overflow"));

        player.current_hp = player.current_hp.saturating_add(recovered).min(max_hp);

        if player.current_hp >= max_hp {
            player.current_hp = max_hp;
            player.last_hp_regen_ts_sec = now;
            return;
        }

        let consumed = ticks.saturating_mul(HP_REGEN_INTERVAL_SECONDS);
        player.last_hp_regen_ts_sec = player.last_hp_regen_ts_sec.saturating_add(consumed);
    }

    fn bonus_stats(&self, player: &Player) -> (u128, u128, u128) {
        let mut bonus_str = 0u128;
        let mut bonus_dex = 0u128;
        let mut bonus_vit = 0u128;

        for token_id in [
            player.equipped_weapon_token_id.as_ref(),
            player.equipped_shield_token_id.as_ref(),
            player.equipped_helmet_token_id.as_ref(),
            player.equipped_armor_token_id.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            let token = match self.nft_tokens.get(token_id) {
                Some(value) => value,
                None => continue,
            };
            let item = match self.item_catalog.get(&token.item_id) {
                Some(value) => value,
                None => continue,
            };
            if !item.active {
                continue;
            }

            let str_flat = item.strength_bonus.0;
            let dex_flat = item.dexterity_bonus.0;
            let vit_flat = item.vitality_bonus.0;

            let str_pct = apply_bps(player.base_strength, u128::from(item.strength_percent_bps));
            let dex_pct = apply_bps(player.base_dexterity, u128::from(item.dexterity_percent_bps));
            let vit_pct = apply_bps(player.base_vitality, u128::from(item.vitality_percent_bps));

            bonus_str = bonus_str
                .checked_add(str_flat)
                .and_then(|value| value.checked_add(str_pct))
                .unwrap_or_else(|| env::panic_str("bonus strength overflow"));
            bonus_dex = bonus_dex
                .checked_add(dex_flat)
                .and_then(|value| value.checked_add(dex_pct))
                .unwrap_or_else(|| env::panic_str("bonus dexterity overflow"));
            bonus_vit = bonus_vit
                .checked_add(vit_flat)
                .and_then(|value| value.checked_add(vit_pct))
                .unwrap_or_else(|| env::panic_str("bonus vitality overflow"));
        }

        (bonus_str, bonus_dex, bonus_vit)
    }

    fn insert_into_tier_ladder(&mut self, account_id: AccountId, tier: u8) {
        let now = now_sec();
        let mut tier_state = self.must_tier_state(tier);
        let was_empty = tier_state.ladder.is_empty();

        tier_state.ladder.push(account_id);
        if was_empty {
            tier_state.leader_last_income_ts_sec = now;
            tier_state.champion_pot_last_accrual_ts_sec = now;
        }
        self.arena_tiers.insert(&tier, &tier_state);
    }

    fn find_player_tier(&self, account_id: &AccountId) -> Option<u8> {
        for tier in [TIER_ONE, TIER_TWO, TIER_THREE] {
            let tier_state = self.arena_tiers.get(&tier)?;
            if tier_state.ladder.contains(account_id) {
                return Some(tier);
            }
        }

        None
    }

    fn mint_item_to_player(&mut self, owner_id: &AccountId, item_id: &str, player: &mut Player) -> String {
        let token_id = format!("token-{}", self.next_token_nonce);
        self.next_token_nonce = self
            .next_token_nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("token nonce overflow"));

        let token = NftToken {
            token_id: token_id.clone(),
            item_id: item_id.to_string(),
            owner_id: owner_id.clone(),
        };

        self.nft_tokens.insert(&token_id, &token);
        player.owned_item_ids.push(item_id.to_string());
        player.owned_token_ids.push(token_id.clone());

        token_id
    }

    fn owned_token(&self, account_id: &AccountId, player: &Player, token_id: &str) -> NftToken {
        require!(!token_id.trim().is_empty(), "token_id must not be empty");
        require!(
            player.owned_token_ids.iter().any(|owned| owned == token_id),
            "Player does not own token"
        );
        let token = self.must_token(&token_id.to_string());
        require!(&token.owner_id == account_id, "Token owner mismatch");
        token
    }

    fn equip_on(&self, account_id: &AccountId, player: &mut Player, token_id: String) {
        let token = self.owned_token(account_id, player, &token_id);
        let item = self.must_item(&token.item_id);

        match item.slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = Some(token_id),
            ItemSlot::Shield => player.equipped_shield_token_id = Some(token_id),
            ItemSlot::Helmet => player.equipped_helmet_token_id = Some(token_id),
            ItemSlot::Armor => player.equipped_armor_token_id = Some(token_id),
            ItemSlot::Consumable => env::panic_str("Consumables cannot be equipped"),
        }
    }

    fn unequip_on(player: &mut Player, slot: ItemSlot) {
        match slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = None,
            ItemSlot::Shield => player.equipped_shield_token_id = None,
            ItemSlot::Helmet => player.equipped_helmet_token_id = None,
            ItemSlot::Armor => player.equipped_armor_token_id = None,
            ItemSlot::Consumable => env::panic_str("Consumables cannot be unequipped"),
        }
    }

    /// Heals and removes the token from the player's lists; the caller removes it from
    /// `nft_tokens` once the whole batch succeeded.
    fn consume_on(&self, account_id: &AccountId, player: &mut Player, token_id: &str) {
        let token = self.owned_token(account_id, player, token_id);
        let item = self.must_item(&token.item_id);
        require!(item.active, "Item is not active");
        require!(item.slot == ItemSlot::Consumable, "Item is not consumable");

        let heal_amount = item.vitality_bonus.0;
        require!(heal_amount > 0, "Consumable has no healing effect");

        let (_, _, effective_vitality) = self.effective_stats(player);
        let max_hp = max_hp_from_vitality(effective_vitality);
        player.current_hp = player.current_hp.saturating_add(heal_amount).min(max_hp);

        if let Some(index) = player
            .owned_token_ids
            .iter()
            .position(|value| value == token_id)
        {
            player.owned_token_ids.remove(index);
        }
        if let Some(index) = player
            .owned_item_ids
            .iter()
            .position(|value| value == &token.item_id)
        {
            player.owned_item_ids.remove(index);
        }
    }

    fn must_player(&self, account_id: &AccountId) -> Player {
        self.players
            .get(account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"))
    }

    fn must_item(&self, item_id: &String) -> ItemDefinition {
        self.item_catalog
            .get(item_id)
            .unwrap_or_else(|| env::panic_str("Item does not exist"))
    }

    fn must_token(&self, token_id: &String) -> NftToken {
        self.nft_tokens
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Token does not exist"))
    }

    fn must_tier_state(&self, tier: u8) -> ArenaTierState {
        self.arena_tiers
            .get(&tier)
            .unwrap_or_else(|| env::panic_str("tier state missing"))
    }

    fn purchase_lines(&mut self, lines: Vec<PurchaseLine>) -> Vec<String> {
        require!(!lines.is_empty(), "Cart must not be empty");

        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);

        // Validation pass: no state is touched until every line and both balances check out.
        let mut total_units: u32 = 0;
        let mut stable_total: u128 = 0;
        let mut game_total: u128 = 0;
        let mut resolved: Vec<(ItemDefinition, u32)> = Vec::with_capacity(lines.len());

        for line in &lines {
            require!(!line.item_id.trim().is_empty(), "item_id must not be empty");
            require!(line.quantity > 0, "quantity must be > 0");
            total_units = total_units
                .checked_add(line.quantity)
                .unwrap_or_else(|| env::panic_str("cart quantity overflow"));
            require!(
                total_units <= MAX_ITEMS_PER_PURCHASE,
                "Too many items in one purchase"
            );

            let item = self.must_item(&line.item_id);
            require!(item.active, "Item is not active");
            let quantity = u128::from(line.quantity);

            match line.currency {
                PurchaseCurrency::Stablecoin => {
                    require!(item.price_stablecoin.0 > 0, "Item has no stablecoin price");
                    stable_total = item
                        .price_stablecoin
                        .0
                        .checked_mul(quantity)
                        .and_then(|cost| stable_total.checked_add(cost))
                        .unwrap_or_else(|| env::panic_str("stablecoin total overflow"));
                }
                PurchaseCurrency::GameCoin => {
                    require!(item.price_game_coin.0 > 0, "Item has no game coin price");
                    require!(item.price_stablecoin.0 > 0, "Item has no stablecoin price");
                    game_total = item
                        .price_game_coin
                        .0
                        .checked_mul(quantity)
                        .and_then(|cost| game_total.checked_add(cost))
                        .unwrap_or_else(|| env::panic_str("game coin total overflow"));
                }
            }

            resolved.push((item, line.quantity));
        }

        require!(
            player.stablecoin_balance >= stable_total,
            "Insufficient stablecoin balance"
        );
        require!(
            player.game_coins >= game_total,
            "Insufficient game coin balance"
        );

        // Apply pass.
        player.stablecoin_balance -= stable_total;
        player.game_coins -= game_total;

        let mut minted = Vec::with_capacity(total_units as usize);
        for (item, quantity) in &resolved {
            for _ in 0..*quantity {
                self.allocate_purchase_split(item.price_stablecoin.0);
                minted.push(self.mint_item_to_player(&account_id, &item.item_id, &mut player));
            }
        }

        self.players.insert(&account_id, &player);
        minted
    }

    fn allocate_purchase_split(&mut self, price_stablecoin: u128) {
        let grand_pot_share = apply_bps(price_stablecoin, PURCHASE_TO_GRAND_POT_BPS);
        let collection_share = apply_bps(price_stablecoin, PURCHASE_TO_COLLECTION_BPS);

        self.grand_pot_usd = self
            .grand_pot_usd
            .checked_add(grand_pot_share)
            .unwrap_or_else(|| env::panic_str("grand pot overflow"));
        self.collection_usd_balance = self
            .collection_usd_balance
            .checked_add(collection_share)
            .unwrap_or_else(|| env::panic_str("collection balance overflow"));
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only owner can call this method"
        );
    }

    fn assert_relayer(&self) {
        require!(
            env::predecessor_account_id() == self.relayer_account_id,
            "Only relayer can call this method"
        );
    }

    fn assert_testnet_only(&self) {
        let current = env::current_account_id().to_string();
        require!(
            current.ends_with(".testnet"),
            "Only allowed on testnet contract accounts"
        );
    }

    fn is_managed_storage_key(key: &[u8]) -> bool {
        key.starts_with(b"p")
            || key.starts_with(b"i")
            || key.starts_with(b"n")
            || key.starts_with(b"d")
            || key.starts_with(b"s")
            || key.starts_with(b"a")
            || key.starts_with(COMBAT_RECORDS_PREFIX)
            || key.starts_with(COMBAT_INDEX_PREFIX)
            || key == COMBAT_NEXT_ID_KEY
            || key.starts_with(EXPEDITION_RECORDS_PREFIX)
            || key.starts_with(EXPEDITION_INDEX_PREFIX)
            || key == EXPEDITION_NEXT_ID_KEY
    }

    /// Persists a combat and indexes it for both fighters; returns its id. Records evicted from
    /// every index that referenced them are deleted, so storage stays bounded per player.
    fn store_combat_record(&mut self, mut record: CombatRecord) -> u64 {
        let combat_id = next_id(COMBAT_NEXT_ID_KEY);
        record.id = combat_id;

        let mut records = combat_records();
        let mut index = combat_index();
        let attacker_id = record.attacker.account_id.clone();
        let defender_id = record.defender.account_id.clone();
        records.insert(&combat_id, &record);

        let mut attacker_index = index.get(&attacker_id).unwrap_or_default();
        let mut defender_index = index.get(&defender_id).unwrap_or_default();
        let evicted: Vec<u64> = [
            push_capped(&mut attacker_index.attacks, combat_id, COMBAT_HISTORY_CAP),
            push_capped(&mut defender_index.defenses, combat_id, COMBAT_HISTORY_CAP),
        ]
        .into_iter()
        .flatten()
        .collect();
        index.insert(&attacker_id, &attacker_index);
        index.insert(&defender_id, &defender_index);

        for old_id in evicted {
            let Some(old) = records.get(&old_id) else {
                continue;
            };
            let still_referenced = [&old.attacker.account_id, &old.defender.account_id]
                .into_iter()
                .any(|participant| {
                    index
                        .get(participant)
                        .is_some_and(|participant_index| participant_index.contains(old_id))
                });
            if !still_referenced {
                records.remove(&old_id);
            }
        }

        combat_id
    }

}

/// v1 ghosts: levels 10..1, 10 ghosts per level, all in tier 1 (`gLL-NN.testnet`).
fn ghost_ids_v1() -> Vec<(AccountId, u32)> {
    let mut ids = Vec::with_capacity(100);
    for level in (1..=10).rev() {
        for ordinal in 1..=10 {
            let ghost_id = format!("g{:02}-{:02}.testnet", level, ordinal)
                .parse::<AccountId>()
                .unwrap_or_else(|_| env::panic_str("invalid ghost id"));
            ids.push((ghost_id, level));
        }
    }
    ids
}

fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn mul_div_floor(a: u128, b: u128, denominator: u128) -> u128 {
    require!(denominator > 0, "denominator must be > 0");
    a.checked_mul(b)
        .unwrap_or_else(|| env::panic_str("mul overflow"))
        / denominator
}

fn apply_bps(value: u128, bps: u128) -> u128 {
    mul_div_floor(value, bps, BPS_DENOMINATOR)
}

fn max_hp_from_vitality(vitality: u128) -> u128 {
    100 * SCALE + vitality.checked_mul(10).unwrap_or_else(|| env::panic_str("hp overflow"))
}

fn tier_for_level(level: u32) -> u8 {
    if level <= 10 {
        TIER_ONE
    } else if level <= 25 {
        TIER_TWO
    } else {
        TIER_THREE
    }
}

fn xp_to_next_level(level: u32) -> u128 {
    u128::from(level) * XP_PER_LEVEL_MULTIPLIER
}

fn level_multiplier_bps(level_rival: u32, level_player: u32) -> u128 {
    require!(level_player > 0, "level must be > 0");
    let raw = mul_div_floor(
        u128::from(level_rival),
        BPS_DENOMINATOR,
        u128::from(level_player),
    );
    raw.clamp(M_MIN_BPS, M_MAX_BPS)
}

fn per_hour_income(elapsed_seconds: u64) -> (u128, u128, u128) {
    let elapsed = u128::from(elapsed_seconds);
    (
        mul_div_floor(LEADER_COINS_PER_HOUR, elapsed, 3_600u128),
        mul_div_floor(LEADER_XP_PER_HOUR, elapsed, 3_600u128),
        mul_div_floor(LEADER_POINTS_PER_HOUR, elapsed, 3_600u128),
    )
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[serde(crate = "near_sdk::serde")]
pub enum CombatOutcome {
    AttackerWins,
    DefenderWins,
    Draw,
}

fn resolve_combat_outcome(
    attacker_hp: u128,
    defender_hp: u128,
    damage_by_attacker: u128,
    damage_by_defender: u128,
) -> CombatOutcome {
    // A knockout always decides the fight; total damage only breaks ties when
    // both fighters survive all rounds. Combat stops at the first KO, so both
    // can never be at 0 HP.
    if defender_hp == 0 {
        CombatOutcome::AttackerWins
    } else if attacker_hp == 0 {
        CombatOutcome::DefenderWins
    } else if damage_by_attacker > damage_by_defender {
        CombatOutcome::AttackerWins
    } else if damage_by_defender > damage_by_attacker {
        CombatOutcome::DefenderWins
    } else {
        CombatOutcome::Draw
    }
}

/// Deterministic pseudo-random roll in `[min, max]` from the combat seed, the identities of
/// both sides (account ids, or a creature id) and a per-roll nonce.
fn combat_random_u16(seed: &[u8], nonce: u64, min: u16, max: u16, a: &[u8], b: &[u8]) -> u16 {
    require!(max >= min, "invalid random range");
    let span = u32::from(max - min + 1);

    let mut input = seed.to_vec();
    input.extend_from_slice(a);
    input.extend_from_slice(b);
    input.extend_from_slice(&nonce.to_le_bytes());

    let hash = env::sha256_array(&input);
    let value = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);

    min + (value % span) as u16
}

fn compute_hit_chance_bps(config: &CombatConfig, attacker_dex: u128, defender_dex: u128) -> u128 {
    let base = i128::from(config.hit_base_bps);
    let coeff = i128::from(config.hit_coefficient_bps);
    let min = i128::from(config.hit_min_bps);
    let max = i128::from(config.hit_max_bps);

    let sum = attacker_dex
        .checked_add(defender_dex)
        .unwrap_or_else(|| env::panic_str("dexterity overflow"));
    if sum == 0 {
        return u128::from(config.hit_min_bps);
    }

    let delta = attacker_dex as i128 - defender_dex as i128;
    let adj = coeff
        .checked_mul(delta)
        .unwrap_or_else(|| env::panic_str("chance overflow"))
        / sum as i128;

    (base + adj).clamp(min, max) as u128
}

/// One side of a fight as the simulation sees it. `rng_id` mixes into every roll: the
/// account id for players, the creature id for creatures.
struct Fighter<'a> {
    rng_id: &'a [u8],
    strength: u128,
    dexterity: u128,
    vitality: u128,
    hp_at_start: u128,
}

impl CombatantStart {
    fn fighter(&self) -> Fighter<'_> {
        Fighter {
            rng_id: self.account_id.as_bytes(),
            strength: self.strength,
            dexterity: self.dexterity,
            vitality: self.vitality,
            hp_at_start: self.hp_at_start,
        }
    }
}

/// Rolls generator for one combat: each roll consumes the next nonce.
struct CombatRng<'a> {
    seed: &'a [u8],
    nonce: u64,
}

impl CombatRng<'_> {
    fn roll(&mut self, min: u16, max: u16, a: &[u8], b: &[u8]) -> u16 {
        self.nonce = self
            .nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("combat nonce overflow"));
        combat_random_u16(self.seed, self.nonce, min, max, a, b)
    }

    fn roll_hit(&mut self, config: &CombatConfig, striker: &Fighter, target: &Fighter) -> bool {
        let chance_bps = compute_hit_chance_bps(config, striker.dexterity, target.dexterity);
        let roll = self.roll(1, BPS_DENOMINATOR as u16, striker.rng_id, target.rng_id);
        u128::from(roll) <= chance_bps
    }

    fn roll_damage(&mut self, config: &CombatConfig, striker: &Fighter, target: &Fighter) -> u128 {
        let random_bps = self.roll(
            config.damage_random_min_bps,
            config.damage_random_max_bps,
            striker.rng_id,
            target.rng_id,
        );

        let random_scaled = apply_bps(striker.strength, u128::from(random_bps));
        let k = config.damage_reduction_k.0;
        let denom = k
            .checked_add(target.vitality)
            .unwrap_or_else(|| env::panic_str("damage denominator overflow"));

        mul_div_floor(random_scaled, k, denom)
    }

    /// One strike: returns `(hit, damage dealt)` and lowers `target_hp`.
    fn strike(
        &mut self,
        config: &CombatConfig,
        striker: &Fighter,
        target: &Fighter,
        target_hp: &mut u128,
    ) -> (bool, u128) {
        if !self.roll_hit(config, striker, target) {
            return (false, 0);
        }
        let actual = self.roll_damage(config, striker, target).min(*target_hp);
        *target_hp -= actual;
        (true, actual)
    }
}

/// Who strikes first in every round under a given rules version.
/// v1: the attacker always. v2+: the side with more DEX; ties go to the attacker.
fn attacker_strikes_first(rules_version: u8, attacker_dex: u128, defender_dex: u128) -> bool {
    rules_version < 2 || attacker_dex >= defender_dex
}

/// Pure fight simulation shared by PvP and PvE, live and replayed: same inputs, same rounds.
/// `attacker` is the challenger (the player in expeditions); logs are always from its side.
fn simulate_fight(
    rng: &mut CombatRng,
    attacker: &Fighter,
    defender: &Fighter,
    config: &CombatConfig,
    attacker_first: bool,
) -> CombatSimulation {
    let mut attacker_hp = attacker.hp_at_start;
    let mut defender_hp = defender.hp_at_start;
    let mut total_damage_by_attacker = 0u128;
    let mut total_damage_by_defender = 0u128;
    let mut rounds_executed = 0u8;
    let mut round_logs: Vec<CombatRoundLog> = vec![];
    let mut battle_over = false;

    for round_number in 1..=COMBAT_ROUNDS {
        if battle_over {
            round_logs.push(CombatRoundLog {
                round: round_number,
                skipped: true,
                attacker_hit: false,
                attacker_damage: U128(0),
                defender_hit: false,
                defender_damage: U128(0),
                attacker_hp_after: U128(attacker_hp),
                defender_hp_after: U128(defender_hp),
                attacker_defeated: attacker_hp == 0,
                defender_defeated: defender_hp == 0,
            });
            continue;
        }

        rounds_executed += 1;
        let mut attacker_strike = (false, 0u128);
        let mut defender_strike = (false, 0u128);

        // Each side strikes once per round; the second striker only acts if still standing.
        for attacker_turn in [attacker_first, !attacker_first] {
            if attacker_turn {
                attacker_strike = rng.strike(config, attacker, defender, &mut defender_hp);
            } else {
                defender_strike = rng.strike(config, defender, attacker, &mut attacker_hp);
            }
            if attacker_hp == 0 || defender_hp == 0 {
                battle_over = true;
                break;
            }
        }

        total_damage_by_attacker = total_damage_by_attacker
            .checked_add(attacker_strike.1)
            .unwrap_or_else(|| env::panic_str("damage overflow"));
        total_damage_by_defender = total_damage_by_defender
            .checked_add(defender_strike.1)
            .unwrap_or_else(|| env::panic_str("damage overflow"));

        round_logs.push(CombatRoundLog {
            round: round_number,
            skipped: false,
            attacker_hit: attacker_strike.0,
            attacker_damage: U128(attacker_strike.1),
            defender_hit: defender_strike.0,
            defender_damage: U128(defender_strike.1),
            attacker_hp_after: U128(attacker_hp),
            defender_hp_after: U128(defender_hp),
            attacker_defeated: attacker_hp == 0,
            defender_defeated: defender_hp == 0,
        });
    }

    CombatSimulation {
        outcome: resolve_combat_outcome(
            attacker_hp,
            defender_hp,
            total_damage_by_attacker,
            total_damage_by_defender,
        ),
        attacker_first,
        rounds_executed,
        attacker_hp,
        defender_hp,
        attacker_total_damage: total_damage_by_attacker,
        defender_total_damage: total_damage_by_defender,
        round_logs,
        end_nonce: rng.nonce,
    }
}

/// Every rules version this code can still replay (older ones keep only their summary).
fn is_replayable_rules_version(rules_version: u8) -> bool {
    (1..=COMBAT_RULES_VERSION).contains(&rules_version)
}

/// PvP combat under the rules of `rules_version` (used by `challenge` and `replay_combat`).
fn simulate_combat(
    seed: &[u8],
    start_nonce: u64,
    attacker: &CombatantStart,
    defender: &CombatantStart,
    config: &CombatConfig,
    rules_version: u8,
) -> CombatSimulation {
    let mut rng = CombatRng {
        seed,
        nonce: start_nonce,
    };
    let attacker_first =
        attacker_strikes_first(rules_version, attacker.dexterity, defender.dexterity);
    simulate_fight(
        &mut rng,
        &attacker.fighter(),
        &defender.fighter(),
        config,
        attacker_first,
    )
}

fn build_challenge_result(
    combat_id: u64,
    attacker: &CombatantStart,
    defender: &CombatantStart,
    simulation: CombatSimulation,
) -> ChallengeResult {
    ChallengeResult {
        combat_id,
        attacker_first: simulation.attacker_first,
        attacker_won: simulation.outcome == CombatOutcome::AttackerWins,
        draw: simulation.outcome == CombatOutcome::Draw,
        rounds: simulation.rounds_executed,
        attacker_total_damage: U128(simulation.attacker_total_damage),
        defender_total_damage: U128(simulation.defender_total_damage),
        attacker: attacker.snapshot(simulation.attacker_hp),
        defender: defender.snapshot(simulation.defender_hp),
        round_logs: simulation.round_logs,
    }
}

/// Appends `combat_id`, keeping at most `cap` entries; returns the evicted (oldest) id.
fn push_capped(list: &mut Vec<u64>, combat_id: u64, cap: usize) -> Option<u64> {
    list.push(combat_id);
    if list.len() > cap {
        Some(list.remove(0))
    } else {
        None
    }
}

fn combat_records() -> LookupMap<u64, CombatRecord> {
    LookupMap::new(COMBAT_RECORDS_PREFIX)
}

fn combat_index() -> LookupMap<AccountId, PlayerCombatIndex> {
    LookupMap::new(COMBAT_INDEX_PREFIX)
}

fn summarize_combat(record: &CombatRecord) -> CombatSummaryView {
    CombatSummaryView {
        id: record.id,
        timestamp_sec: record.timestamp_sec,
        tier: record.tier,
        attacker_id: record.attacker.account_id.clone(),
        defender_id: record.defender.account_id.clone(),
        attacker_level: record.attacker.level,
        defender_level: record.defender.level,
        outcome: record.outcome,
        attacker_hp_start: U128(record.attacker.hp_at_start),
        attacker_hp_end: U128(record.attacker_hp_end),
        defender_hp_start: U128(record.defender.hp_at_start),
        defender_hp_end: U128(record.defender_hp_end),
        coins_stolen: U128(record.coins_stolen),
        champion_pot_claimed: U128(record.champion_pot_claimed),
        attacker_rank_before: record.attacker_rank_before,
        defender_rank_before: record.defender_rank_before,
        replayable: is_replayable_rules_version(record.rules_version),
    }
}

/// Reads and advances a `u64` id counter stored under `key` (first id is 1).
fn next_id(key: &[u8]) -> u64 {
    let id = env::storage_read(key)
        .map(|raw| {
            u64::from_le_bytes(
                raw.try_into()
                    .unwrap_or_else(|_| env::panic_str("corrupt id counter")),
            )
        })
        .unwrap_or(1);
    env::storage_write(
        key,
        &id.checked_add(1)
            .unwrap_or_else(|| env::panic_str("id counter overflow"))
            .to_le_bytes(),
    );
    id
}

/// Rolls a creature for one fight: base stats plus `points_per_level` points per level
/// (level 1 included), each point landing on STR, DEX or VIT at random. Full HP.
fn roll_creature_stats(
    rng: &mut CombatRng,
    creature: &CreatureDefinition,
    level: u32,
    player_rng_id: &[u8],
) -> CreatureStats {
    let mut strength = creature.base_strength;
    let mut dexterity = creature.base_dexterity;
    let mut vitality = creature.base_vitality;
    let points = creature
        .points_per_level
        .checked_mul(level)
        .unwrap_or_else(|| env::panic_str("creature points overflow"));

    for _ in 0..points {
        match rng.roll(0, 2, player_rng_id, creature.id.as_bytes()) {
            0 => strength += SCALE,
            1 => dexterity += SCALE,
            _ => vitality += SCALE,
        }
    }

    CreatureStats {
        level,
        strength,
        dexterity,
        vitality,
        max_hp: max_hp_from_vitality(vitality),
    }
}

/// Player (attacker side) against a rolled creature (defender side).
fn simulate_expedition_fight(
    rng: &mut CombatRng,
    player: &CombatantStart,
    creature: &CreatureDefinition,
    stats: &CreatureStats,
    config: &CombatConfig,
    rules_version: u8,
) -> CombatSimulation {
    let creature_fighter = Fighter {
        rng_id: creature.id.as_bytes(),
        strength: stats.strength,
        dexterity: stats.dexterity,
        vitality: stats.vitality,
        hp_at_start: stats.max_hp,
    };
    let player_first = attacker_strikes_first(rules_version, player.dexterity, stats.dexterity);
    simulate_fight(
        rng,
        &player.fighter(),
        &creature_fighter,
        config,
        player_first,
    )
}

fn creature_reward(creature: &CreatureDefinition, outcome: CombatOutcome) -> &CreatureReward {
    match outcome {
        CombatOutcome::AttackerWins => &creature.win,
        CombatOutcome::DefenderWins => &creature.loss,
        CombatOutcome::Draw => &creature.draw,
    }
}

fn reward_view(reward: &CreatureReward) -> CreatureRewardView {
    CreatureRewardView {
        game_coins: U128(reward.game_coins),
        xp: U128(reward.xp),
    }
}

fn creature_view(creature: &CreatureDefinition) -> CreatureView {
    CreatureView {
        id: creature.id.to_string(),
        name: creature.name.to_string(),
        base_strength: U128(creature.base_strength),
        base_dexterity: U128(creature.base_dexterity),
        base_vitality: U128(creature.base_vitality),
        points_per_level: creature.points_per_level,
        win: reward_view(&creature.win),
        loss: reward_view(&creature.loss),
        draw: reward_view(&creature.draw),
        drops: creature
            .drops
            .iter()
            .map(|drop| CreatureDropView {
                item_id: drop.item_id.to_string(),
                chance_bps: drop.chance_bps,
            })
            .collect(),
    }
}

fn build_expedition_result(
    record: &ExpeditionRecord,
    creature: &CreatureDefinition,
    simulation: CombatSimulation,
) -> ExpeditionResult {
    ExpeditionResult {
        expedition_id: record.id,
        timestamp_sec: record.timestamp_sec,
        outcome: simulation.outcome,
        player_first: simulation.attacker_first,
        rounds: simulation.rounds_executed,
        player_total_damage: U128(simulation.attacker_total_damage),
        creature_total_damage: U128(simulation.defender_total_damage),
        player: record.player.snapshot(simulation.attacker_hp),
        creature: CreatureSnapshot {
            id: creature.id.to_string(),
            name: creature.name.to_string(),
            level: record.creature.level,
            strength: U128(record.creature.strength),
            dexterity: U128(record.creature.dexterity),
            vitality: U128(record.creature.vitality),
            max_hp: U128(record.creature.max_hp),
            hp_at_start: U128(record.creature.max_hp),
            hp_at_end: U128(simulation.defender_hp),
        },
        round_logs: simulation.round_logs,
        game_coins_gained: U128(record.game_coins_gained),
        xp_gained: U128(record.xp_gained),
        drop: record.drop.clone(),
    }
}

fn expedition_records() -> LookupMap<u64, ExpeditionRecord> {
    LookupMap::new(EXPEDITION_RECORDS_PREFIX)
}

fn expedition_index() -> LookupMap<AccountId, Vec<u64>> {
    LookupMap::new(EXPEDITION_INDEX_PREFIX)
}

/// Persists an expedition and indexes it for its player (capped; evicted records are
/// deleted, since only that player references them). Returns the new id.
fn store_expedition_record(record: &ExpeditionRecord) -> u64 {
    let id = next_id(EXPEDITION_NEXT_ID_KEY);
    let mut stored = record.clone();
    stored.id = id;

    let mut records = expedition_records();
    let mut index = expedition_index();
    let player_id = &stored.player.account_id;
    records.insert(&id, &stored);

    let mut ids = index.get(player_id).unwrap_or_default();
    if let Some(evicted) = push_capped(&mut ids, id, EXPEDITION_HISTORY_CAP) {
        records.remove(&evicted);
    }
    index.insert(player_id, &ids);
    id
}

fn summarize_expedition(record: &ExpeditionRecord) -> ExpeditionSummaryView {
    ExpeditionSummaryView {
        id: record.id,
        timestamp_sec: record.timestamp_sec,
        creature_id: record.creature_id.clone(),
        creature_level: record.creature.level,
        outcome: record.outcome,
        player_hp_start: U128(record.player.hp_at_start),
        player_hp_end: U128(record.player_hp_end),
        game_coins_gained: U128(record.game_coins_gained),
        xp_gained: U128(record.xp_gained),
        drop: record.drop.clone(),
        replayable: is_replayable_rules_version(record.rules_version)
            && find_creature(&record.creature_id).is_some(),
    }
}

fn find_rank(ladder: &[AccountId], account_id: &AccountId) -> Option<usize> {
    ladder.iter().position(|entry| entry == account_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid account")
    }

    fn context(predecessor: &str, timestamp_ns: u64) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(account(predecessor));
        builder.block_timestamp(timestamp_ns);
        builder.random_seed([7; 32]);
        testing_env!(builder.build());
    }

    fn setup_contract() -> GameContract {
        context("owner.testnet", 1_700_000_000_000_000_000);
        GameContract::new(
            account("owner.testnet"),
            account("relayer.testnet"),
            account("stable.testnet"),
            None,
        )
    }

    #[test]
    fn register_player_initializes_scaled_defaults() {
        let mut contract = setup_contract();
        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player exists");
        assert_eq!(player.level, 1);
        assert_eq!(player.base_strength, 5 * SCALE);
        assert_eq!(player.base_dexterity, 5 * SCALE);
        assert_eq!(player.base_vitality, 5 * SCALE);
        assert_eq!(player.current_hp, 150 * SCALE);
    }

    #[test]
    fn level_multiplier_clamps_and_floors() {
        assert_eq!(level_multiplier_bps(1, 100), 2_500);
        assert_eq!(level_multiplier_bps(100, 1), 20_000);
        assert_eq!(level_multiplier_bps(15, 10), 15_000);
    }

    #[test]
    fn challenge_requires_target_within_top_five() {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        let tier_state = contract.must_tier_state(TIER_ONE);
        let attacker_rank = find_rank(&tier_state.ladder, &account("alice.testnet")).unwrap();
        assert!(attacker_rank > 5);

        // Rank 0 is farther than 5 positions above a brand-new entrant.
        let leader = tier_state.ladder[0].clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            context("alice.testnet", 1_700_000_000_000_000_000);
            contract.challenge(leader);
        }));

        assert!(result.is_err());
    }

    #[test]
    fn winning_challenger_takes_defender_rank_and_pushes_others_down() {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        // Make alice strong enough to win deterministically.
        let alice_id = account("alice.testnet");
        let mut alice = contract.must_player(&alice_id);
        alice.base_strength = 10_000 * SCALE;
        alice.base_dexterity = 10_000 * SCALE;
        alice.base_vitality = 10_000 * SCALE;
        alice.current_hp = max_hp_from_vitality(alice.base_vitality);
        contract.players.insert(&alice_id, &alice);

        let before = contract.must_tier_state(TIER_ONE).ladder;
        let attacker_rank = find_rank(&before, &alice_id).unwrap();
        let defender_rank = attacker_rank - 3;
        let defender_id = before[defender_rank].clone();

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.challenge(defender_id.clone());
        assert!(result.attacker_won);

        let after = contract.must_tier_state(TIER_ONE).ladder;
        assert_eq!(after.len(), before.len());
        assert_eq!(after[defender_rank], alice_id);
        // Defender and everyone between drop exactly one place.
        for rank in defender_rank..attacker_rank {
            assert_eq!(after[rank + 1], before[rank]);
        }
        assert_eq!(after[defender_rank + 1], defender_id);
        // Ranks outside the [defender, attacker] window are untouched.
        assert_eq!(after[..defender_rank], before[..defender_rank]);
        assert_eq!(after[attacker_rank + 1..], before[attacker_rank + 1..]);
    }

    #[test]
    fn knocked_out_attacker_loses_even_if_it_dealt_more_damage() {
        // Attacker dealt 80 but was KO'd; defender still standing.
        assert_eq!(
            resolve_combat_outcome(0, 120 * SCALE, 80 * SCALE, 30 * SCALE),
            CombatOutcome::DefenderWins
        );
    }

    #[test]
    fn knocked_out_defender_loses_even_if_it_dealt_more_damage() {
        assert_eq!(
            resolve_combat_outcome(10 * SCALE, 0, 30 * SCALE, 80 * SCALE),
            CombatOutcome::AttackerWins
        );
    }

    #[test]
    fn combat_without_knockout_is_decided_by_damage() {
        assert_eq!(
            resolve_combat_outcome(50 * SCALE, 50 * SCALE, 40 * SCALE, 20 * SCALE),
            CombatOutcome::AttackerWins
        );
        assert_eq!(
            resolve_combat_outcome(50 * SCALE, 50 * SCALE, 20 * SCALE, 40 * SCALE),
            CombatOutcome::DefenderWins
        );
        assert_eq!(
            resolve_combat_outcome(50 * SCALE, 50 * SCALE, 20 * SCALE, 20 * SCALE),
            CombatOutcome::Draw
        );
    }

    fn json<T: Serialize>(value: &T) -> String {
        near_sdk::serde_json::to_string(value).expect("serializable")
    }

    /// Ghosts + alice registered; returns alice's rank and the id of the player `gap` ranks above.
    fn setup_arena_with_alice(gap: usize) -> (GameContract, AccountId, AccountId) {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();
        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();
        let alice_id = account("alice.testnet");
        let ladder = contract.must_tier_state(TIER_ONE).ladder;
        let rank = find_rank(&ladder, &alice_id).unwrap();
        let target = ladder[rank - gap].clone();
        (contract, alice_id, target)
    }

    #[test]
    fn challenge_stores_combat_for_both_fighters_and_replay_matches() {
        let (mut contract, alice_id, target) = setup_arena_with_alice(1);

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.challenge(target.clone());
        assert_eq!(result.combat_id, 1);

        let attacks =
            contract.get_combat_history(alice_id.clone(), CombatRole::Attacks, None, None);
        assert_eq!(attacks.total, 1);
        assert_eq!(attacks.items[0].id, 1);
        assert_eq!(attacks.items[0].defender_id, target);
        assert!(attacks.items[0].replayable);

        let defenses =
            contract.get_combat_history(target.clone(), CombatRole::Defenses, None, None);
        assert_eq!(defenses.total, 1);
        assert_eq!(defenses.items[0].attacker_id, alice_id);
        assert_eq!(
            contract
                .get_combat_history(alice_id, CombatRole::Defenses, None, None)
                .total,
            0
        );

        let replay = contract.replay_combat(1).expect("stored combat");
        assert_eq!(json(&replay), json(&result));
        assert!(result.round_logs.iter().any(|round| !round.skipped));
    }

    #[test]
    fn combat_summary_records_outcome_coins_and_ranks() {
        let (mut contract, alice_id, target) = setup_arena_with_alice(2);
        let mut alice = contract.must_player(&alice_id);
        alice.base_strength = 10_000 * SCALE;
        alice.base_dexterity = 10_000 * SCALE;
        alice.base_vitality = 10_000 * SCALE;
        alice.current_hp = max_hp_from_vitality(alice.base_vitality);
        contract.players.insert(&alice_id, &alice);
        let ladder = contract.must_tier_state(TIER_ONE).ladder;
        let alice_rank = find_rank(&ladder, &alice_id).unwrap() as u32;
        let target_coins = contract.must_player(&target).game_coins;

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.challenge(target.clone());
        assert!(result.attacker_won);

        let summary = contract.get_combat(result.combat_id).expect("stored");
        assert_eq!(summary.outcome, CombatOutcome::AttackerWins);
        assert_eq!(summary.attacker_rank_before, alice_rank);
        assert_eq!(summary.defender_rank_before, alice_rank - 2);
        assert_eq!(
            summary.coins_stolen.0,
            apply_bps(target_coins, STEAL_BPS).min(STEAL_CAP)
        );
        assert_eq!(summary.defender_hp_end.0, 0);
    }

    #[test]
    fn combat_history_pages_newest_first() {
        let (mut contract, alice_id, target) = setup_arena_with_alice(1);
        for id in 1..=3u64 {
            let mut record = sample_record(&alice_id, &target);
            record.timestamp_sec = id;
            assert_eq!(contract.store_combat_record(record), id);
        }

        let page =
            contract.get_combat_history(alice_id.clone(), CombatRole::Attacks, Some(0), Some(2));
        assert_eq!(page.total, 3);
        assert_eq!(
            page.items.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![3, 2]
        );
        let next = contract.get_combat_history(alice_id, CombatRole::Attacks, Some(2), Some(2));
        assert_eq!(
            next.items.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn combat_history_is_capped_and_unreferenced_records_are_deleted() {
        let (mut contract, alice_id, bob) = setup_arena_with_alice(1);
        let carol = account("carol.testnet");

        for _ in 0..COMBAT_HISTORY_CAP {
            contract.store_combat_record(sample_record(&alice_id, &bob));
        }
        // Alice's attack list overflows; combat 1 is still in bob's defenses, so it survives.
        let id = contract.store_combat_record(sample_record(&alice_id, &carol));
        assert_eq!(id, COMBAT_HISTORY_CAP as u64 + 1);
        let alice_attacks =
            contract.get_combat_history(alice_id.clone(), CombatRole::Attacks, None, Some(50));
        assert_eq!(alice_attacks.total, COMBAT_HISTORY_CAP as u32);
        assert!(contract.get_combat(1).is_some());

        // Next alice-vs-bob: alice drops combat 2 (bob still has it, kept) and bob drops
        // combat 1 (alice already dropped it, so nobody references it and it is deleted).
        contract.store_combat_record(sample_record(&alice_id, &bob));
        assert!(contract.get_combat(1).is_none());
        assert!(contract.get_combat(2).is_some());
        let bob_defenses = contract.get_combat_history(bob, CombatRole::Defenses, None, Some(50));
        assert_eq!(bob_defenses.total, COMBAT_HISTORY_CAP as u32);
    }

    #[test]
    fn replay_refuses_combats_from_other_rules_versions() {
        let (mut contract, alice_id, target) = setup_arena_with_alice(1);
        let mut record = sample_record(&alice_id, &target);
        record.rules_version = COMBAT_RULES_VERSION + 1;
        let id = contract.store_combat_record(record);

        assert!(!contract.get_combat(id).unwrap().replayable);
        let replay =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| contract.replay_combat(id)));
        assert!(replay.is_err());
    }

    fn sample_record(attacker: &AccountId, defender: &AccountId) -> CombatRecord {
        let fighter = |id: &AccountId| CombatantStart {
            account_id: id.clone(),
            level: 1,
            strength: 5 * SCALE,
            dexterity: 5 * SCALE,
            vitality: 5 * SCALE,
            max_hp: 150 * SCALE,
            hp_at_start: 150 * SCALE,
        };
        CombatRecord {
            id: 0,
            rules_version: COMBAT_RULES_VERSION,
            timestamp_sec: 0,
            tier: TIER_ONE,
            random_seed: vec![1; 32],
            start_nonce: 0,
            config: CombatConfig::default(),
            attacker: fighter(attacker),
            defender: fighter(defender),
            outcome: CombatOutcome::Draw,
            attacker_hp_end: 150 * SCALE,
            defender_hp_end: 150 * SCALE,
            coins_stolen: 0,
            champion_pot_claimed: 0,
            attacker_rank_before: 1,
            defender_rank_before: 0,
        }
    }

    fn wolf() -> &'static CreatureDefinition {
        find_creature("wolf").expect("wolf is configured")
    }

    fn roll_wolf(seed: &[u8], level: u32) -> CreatureStats {
        let mut rng = CombatRng { seed, nonce: 0 };
        roll_creature_stats(&mut rng, wolf(), level, b"alice.testnet")
    }

    /// Ghosts, potions in the catalog and alice registered with full HP.
    fn setup_expedition() -> (GameContract, AccountId) {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();
        for item_id in ["potion_small", "potion_medium", "potion_large"] {
            contract.upsert_item_definition(potion_definition(item_id, 5 * SCALE, 10 * SCALE));
        }
        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();
        (contract, account("alice.testnet"))
    }

    fn set_alice_stats(contract: &mut GameContract, alice_id: &AccountId, stat: u128) {
        let mut alice = contract.must_player(alice_id);
        alice.base_strength = stat;
        alice.base_dexterity = stat;
        alice.base_vitality = stat;
        alice.current_hp = max_hp_from_vitality(stat);
        contract.players.insert(alice_id, &alice);
    }

    #[test]
    fn wolf_gets_base_stats_plus_three_random_points_per_level() {
        for level in [1u32, 2, 7, 25] {
            let stats = roll_wolf(&[3; 32], level);
            assert_eq!(stats.level, level);
            assert_eq!(
                stats.strength + stats.dexterity + stats.vitality,
                12 * SCALE + 3 * u128::from(level) * SCALE
            );
            assert!(
                stats.strength >= 4 * SCALE
                    && stats.dexterity >= 4 * SCALE
                    && stats.vitality >= 4 * SCALE
            );
            assert_eq!(stats.max_hp, max_hp_from_vitality(stats.vitality));
        }
        // Level 1: 15 points in total, like a brand-new player.
        let level_one = roll_wolf(&[3; 32], 1);
        assert_eq!(
            level_one.strength + level_one.dexterity + level_one.vitality,
            15 * SCALE
        );
    }

    #[test]
    fn wolf_generation_is_deterministic_per_seed_and_varies_across_seeds() {
        let a = roll_wolf(&[9; 32], 10);
        let b = roll_wolf(&[9; 32], 10);
        assert_eq!(
            (a.strength, a.dexterity, a.vitality),
            (b.strength, b.dexterity, b.vitality)
        );

        let distributions: std::collections::HashSet<(u128, u128, u128)> = (0u8..20)
            .map(|seed| {
                let stats = roll_wolf(&[seed; 32], 10);
                (stats.strength, stats.dexterity, stats.vitality)
            })
            .collect();
        assert!(distributions.len() > 1, "point spread must be random");
    }

    #[test]
    fn expedition_consumes_player_hp_and_is_stored_for_replay() {
        let (mut contract, alice_id) = setup_expedition();
        let hp_before = contract.must_player(&alice_id).current_hp;

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.start_expedition("wolf".to_string());

        let alice = contract.must_player(&alice_id);
        assert_eq!(alice.current_hp, result.player.hp_at_end.0);
        assert_eq!(hp_before - alice.current_hp, result.creature_total_damage.0);
        assert_eq!(result.creature.level, 1);

        let history = contract.get_expedition_history(alice_id, None, None);
        assert_eq!(history.total, 1);
        assert_eq!(history.items[0].id, result.expedition_id);
        let replay = contract
            .replay_expedition(result.expedition_id)
            .expect("stored");
        assert_eq!(json(&replay), json(&result));
    }

    #[test]
    fn expedition_requires_twenty_percent_hp() {
        let (mut contract, alice_id) = setup_expedition();
        let mut alice = contract.must_player(&alice_id);
        let max_hp = max_hp_from_vitality(contract.effective_stats(&alice).2);
        alice.current_hp = apply_bps(max_hp, EXPEDITION_MIN_HP_BPS) - 1;
        contract.players.insert(&alice_id, &alice);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            context("alice.testnet", 1_700_000_000_000_000_000);
            contract.start_expedition("wolf".to_string())
        }));
        assert!(result.is_err());
    }

    #[test]
    fn expedition_rejects_unknown_creatures() {
        let (mut contract, _) = setup_expedition();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            context("alice.testnet", 1_700_000_000_000_000_000);
            contract.start_expedition("jellyfish".to_string())
        }));
        assert!(result.is_err());
    }

    #[test]
    fn expedition_victory_pays_coins_and_xp_without_tournament_points() {
        let (mut contract, alice_id) = setup_expedition();
        set_alice_stats(&mut contract, &alice_id, 10_000 * SCALE);
        let before = contract.must_player(&alice_id);

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.start_expedition("wolf".to_string());
        assert_eq!(result.outcome, CombatOutcome::AttackerWins);
        assert!(result.player_first);

        let after = contract.must_player(&alice_id);
        assert_eq!(result.game_coins_gained.0, 10 * SCALE);
        assert_eq!(result.xp_gained.0, 20 * SCALE);
        assert_eq!(after.game_coins, before.game_coins + 10 * SCALE);
        assert_eq!(after.xp, before.xp + 20 * SCALE);
        assert_eq!(after.tournament_points, before.tournament_points);
    }

    #[test]
    fn expedition_defeat_pays_only_xp_and_never_drops() {
        let (mut contract, alice_id) = setup_expedition();
        set_alice_stats(&mut contract, &alice_id, 0);
        let before = contract.must_player(&alice_id);

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = contract.start_expedition("wolf".to_string());
        assert_eq!(result.outcome, CombatOutcome::DefenderWins);

        let after = contract.must_player(&alice_id);
        assert_eq!(after.game_coins, before.game_coins);
        assert_eq!(after.xp, before.xp + 10 * SCALE);
        assert_eq!(after.tournament_points, before.tournament_points);
        assert!(result.drop.is_none());
        assert_eq!(after.owned_token_ids.len(), before.owned_token_ids.len());
    }

    #[test]
    fn draw_pays_like_a_defeat() {
        let draw = creature_reward(wolf(), CombatOutcome::Draw);
        let loss = creature_reward(wolf(), CombatOutcome::DefenderWins);
        assert_eq!((draw.game_coins, draw.xp), (loss.game_coins, loss.xp));
        assert_eq!((draw.game_coins, draw.xp), (0, 10 * SCALE));
    }

    #[test]
    fn wolf_drop_table_maps_rolls_to_at_most_one_item() {
        let drops = wolf().drops;
        let item = |roll| drop_for_roll(drops, roll).map(|drop| drop.item_id);
        assert_eq!(item(1), Some("potion_small"));
        assert_eq!(item(1_500), Some("potion_small"));
        assert_eq!(item(1_501), Some("potion_medium"));
        assert_eq!(item(1_900), Some("potion_medium"));
        assert_eq!(item(1_901), Some("potion_large"));
        assert_eq!(item(2_000), Some("potion_large"));
        assert_eq!(item(2_001), None);
        assert_eq!(item(10_000), None);
    }

    #[test]
    fn wolf_drop_rates_match_configured_basis_points() {
        let drops = wolf().drops;
        let mut counts = std::collections::HashMap::new();
        let samples = 20_000u64;
        for nonce in 0..samples {
            let roll = combat_random_u16(&[5; 32], nonce, 1, 10_000, b"alice.testnet", b"wolf");
            if let Some(drop) = drop_for_roll(drops, roll) {
                *counts.entry(drop.item_id).or_insert(0u64) += 1;
            }
        }
        // Expected 15% / 4% / 1%, with a tolerance of about +-0.6 points.
        let rate = |item: &str| counts.get(item).copied().unwrap_or(0) * 10_000 / samples;
        assert!(
            (1_440..=1_560).contains(&rate("potion_small")),
            "small {}",
            rate("potion_small")
        );
        assert!(
            (340..=460).contains(&rate("potion_medium")),
            "medium {}",
            rate("potion_medium")
        );
        assert!(
            (70..=130).contains(&rate("potion_large")),
            "large {}",
            rate("potion_large")
        );
    }

    #[test]
    fn creature_drop_tables_never_exceed_one_hundred_percent() {
        for creature in CREATURES {
            let total: u32 = creature
                .drops
                .iter()
                .map(|drop| u32::from(drop.chance_bps))
                .sum();
            assert!(
                total <= 10_000,
                "{} drops add up to {} bps",
                creature.id,
                total
            );
        }
    }

    #[test]
    fn expedition_victories_eventually_drop_exactly_one_potion() {
        let (mut contract, alice_id) = setup_expedition();
        set_alice_stats(&mut contract, &alice_id, 10_000 * SCALE);

        let mut drops = 0;
        for i in 0..60u64 {
            let mut builder = VMContextBuilder::new();
            builder.predecessor_account_id(alice_id.clone());
            builder.block_timestamp(1_700_000_000_000_000_000 + i * 1_000_000_000);
            builder.random_seed([i as u8; 32]);
            testing_env!(builder.build());

            let tokens_before = contract.must_player(&alice_id).owned_token_ids.len();
            let result = contract.start_expedition("wolf".to_string());
            let tokens_after = contract.must_player(&alice_id).owned_token_ids.len();
            assert_eq!(
                tokens_after - tokens_before,
                usize::from(result.drop.is_some())
            );
            if let Some(drop) = result.drop {
                assert!(drop.item_id.starts_with("potion_"));
                drops += 1;
            }
        }
        assert!(
            drops > 0,
            "60 victories at 20% drop chance should drop something"
        );
    }

    #[test]
    fn higher_dexterity_strikes_first_since_rules_v2() {
        let fighter = |id: &str, dex: u128, hp: u128| CombatantStart {
            account_id: account(id),
            level: 1,
            strength: 50 * SCALE,
            dexterity: dex,
            vitality: 5 * SCALE,
            max_hp: hp,
            hp_at_start: hp,
        };
        // Attacker has 1 micro-HP: whoever strikes first and hits ends the fight.
        let attacker = fighter("alice.testnet", SCALE, 1);
        let defender = fighter("bob.testnet", 50 * SCALE, 150 * SCALE);
        let config = CombatConfig::default();

        let mut checked = 0;
        for seed in 0u8..40 {
            let v2 = simulate_combat(&[seed; 32], 0, &attacker, &defender, &config, 2);
            assert!(!v2.attacker_first);
            let first = &v2.round_logs[0];
            if first.defender_hit {
                // Defender struck first and knocked the attacker out before it could swing.
                assert!(!first.attacker_hit);
                assert_eq!(first.attacker_hp_after.0, 0);
                checked += 1;
            }

            let v1 = simulate_combat(&[seed; 32], 0, &attacker, &defender, &config, 1);
            assert!(v1.attacker_first);
        }
        assert!(checked > 0);

        // Equal DEX: the attacker keeps the first strike.
        let even = fighter("bob.testnet", SCALE, 150 * SCALE);
        assert!(simulate_combat(&[1; 32], 0, &attacker, &even, &config, 2).attacker_first);
    }

    #[test]
    fn combats_stored_under_rules_v1_stay_replayable() {
        let (mut contract, alice_id, target) = setup_arena_with_alice(1);
        let mut record = sample_record(&alice_id, &target);
        record.rules_version = 1;
        let simulation = simulate_combat(
            &record.random_seed,
            record.start_nonce,
            &record.attacker,
            &record.defender,
            &record.config,
            1,
        );
        record.outcome = simulation.outcome;
        record.attacker_hp_end = simulation.attacker_hp;
        record.defender_hp_end = simulation.defender_hp;
        let id = contract.store_combat_record(record);

        let replay = contract.replay_combat(id).expect("stored");
        assert!(replay.attacker_first);
        assert!(contract.get_combat(id).unwrap().replayable);
    }

    #[test]
    fn leader_income_is_lazy_and_claimable() {
        let mut contract = setup_contract();
        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        // Single human leader in tier 1.
        context("alice.testnet", 1_700_000_000_000_000_000 + 3_600_000_000_000);
        contract.claim_leader_income();

        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player exists");
        assert_eq!(player.game_coins, LEADER_COINS_PER_HOUR);
        assert_eq!(player.tournament_points, LEADER_POINTS_PER_HOUR);
    }

    #[test]
    fn ghost_leader_does_not_gain_tournament_points() {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();

        let tier_state = contract.must_tier_state(TIER_ONE);
        let ghost_id = tier_state.ladder[0].clone();

        context("owner.testnet", 1_700_000_000_000_000_000 + 3_600_000_000_000);
        contract.settle_current_leader_income(TIER_ONE, now_sec());

        let ghost = contract.get_player(ghost_id).expect("ghost exists");
        assert_eq!(ghost.tournament_points, 0);
    }

    #[test]
    fn unequip_clamps_hp_when_max_hp_drops() {
        let mut contract = setup_contract();

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.upsert_item_definition(ItemDefinition {
            item_id: "helmet_vit".to_string(),
            slot: ItemSlot::Helmet,
            strength_bonus: U128(0),
            dexterity_bonus: U128(0),
            vitality_bonus: U128(10 * SCALE),
            strength_percent_bps: 0,
            dexterity_percent_bps: 0,
            vitality_percent_bps: 0,
            price_game_coin: U128(1 * SCALE),
            price_stablecoin: U128(1 * SCALE),
            active: true,
        });
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(100 * SCALE));

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.buy_item_with_game_coin("helmet_vit".to_string());
        let token_id = contract.get_player_token_ids(account("alice.testnet"))[0].clone();
        contract.equip(token_id);

        let mut player = contract.get_player(account("alice.testnet")).unwrap();
        player.current_hp = 250 * SCALE;
        contract.players.insert(&account("alice.testnet"), &player);

        contract.unequip(ItemSlot::Helmet);
        let after = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(after.current_hp, 150 * SCALE);
    }

    #[test]
    fn consume_potion_restores_hp_and_burns_token() {
        let mut contract = setup_contract();

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.upsert_item_definition(ItemDefinition {
            item_id: "small_potion".to_string(),
            slot: ItemSlot::Consumable,
            strength_bonus: U128(0),
            dexterity_bonus: U128(0),
            vitality_bonus: U128(30 * SCALE),
            strength_percent_bps: 0,
            dexterity_percent_bps: 0,
            vitality_percent_bps: 0,
            price_game_coin: U128(1 * SCALE),
            price_stablecoin: U128(1 * SCALE),
            active: true,
        });

        contract.dev_set_player_game_coin(account("alice.testnet"), U128(100 * SCALE));

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.buy_item_with_game_coin("small_potion".to_string());

        let token_id = contract.get_player_token_ids(account("alice.testnet"))[0].clone();

        let mut player = contract.get_player(account("alice.testnet")).unwrap();
        player.current_hp = 80 * SCALE;
        contract.players.insert(&account("alice.testnet"), &player);

        contract.consume(token_id.clone());

        let after = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(after.current_hp, 110 * SCALE);
        assert!(!after.owned_token_ids.contains(&token_id));
        assert!(contract.get_token(token_id).is_none());
    }

    #[test]
    fn hp_regen_restores_five_percent_every_ten_minutes() {
        let mut contract = setup_contract();

        let start_ns = 1_700_000_000_000_000_000;
        context("alice.testnet", start_ns);
        contract.register_player();

        let mut player = contract.get_player(account("alice.testnet")).unwrap();
        player.current_hp = 100 * SCALE;
        player.last_hp_regen_ts_sec = start_ns / 1_000_000_000;
        contract.players.insert(&account("alice.testnet"), &player);

        context("alice.testnet", start_ns + 600_000_000_000);
        let view_after_10m = contract
            .get_player_view(account("alice.testnet"))
            .expect("player view");

        // max_hp at level 1 base vit is 150 * SCALE, 5% tick = 7.5 * SCALE.
        assert_eq!(view_after_10m.current_hp.0, 107_500_000);

        context("alice.testnet", start_ns + 1_200_000_000_000);
        let view_after_20m = contract
            .get_player_view(account("alice.testnet"))
            .expect("player view");
        assert_eq!(view_after_20m.current_hp.0, 115_000_000);
    }

    #[test]
    fn assign_stat_points_allows_partial_spend() {
        let mut contract = setup_contract();
        let now_ns = 1_700_000_000_000_000_000;

        context("alice.testnet", now_ns);
        contract.register_player();

        let mut player = contract.get_player(account("alice.testnet")).unwrap();
        player.unassigned_points = 3;
        contract.players.insert(&account("alice.testnet"), &player);

        context("alice.testnet", now_ns + 1_000_000_000);
        contract.assign_stat_points(2, 0, 0);

        let after = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(after.unassigned_points, 1);
        assert_eq!(after.base_strength, 7 * SCALE);
    }

    #[test]
    fn get_pot_aggregates_live_champion_pot() {
        let mut contract = setup_contract();
        let now_ns = 1_700_000_000_000_000_000;

        context("alice.testnet", now_ns);
        contract.register_player();

        context("owner.testnet", now_ns + 3_600_000_000_000);
        let pot = contract.get_pot();
        assert_eq!(pot.0, CHAMPION_POT_PER_HOUR);
    }

    #[test]
    fn stable_purchase_splits_into_grand_pot_and_collection() {
        let mut contract = setup_contract();
        let now_ns = 1_700_000_000_000_000_000;

        context("alice.testnet", now_ns);
        contract.register_player();

        context("owner.testnet", now_ns);
        contract.upsert_item_definition(ItemDefinition {
            item_id: "stable_item".to_string(),
            slot: ItemSlot::Consumable,
            strength_bonus: U128(0),
            dexterity_bonus: U128(0),
            vitality_bonus: U128(10 * SCALE),
            strength_percent_bps: 0,
            dexterity_percent_bps: 0,
            vitality_percent_bps: 0,
            price_game_coin: U128(1 * SCALE),
            price_stablecoin: U128(100 * SCALE),
            active: true,
        });

        context("relayer.testnet", now_ns + 1_000_000_000);
        contract.credit_deposit(
            account("alice.testnet"),
            account("stable.testnet"),
            U128(100 * SCALE),
            "test".to_string(),
            "tx-1".to_string(),
        );

        context("alice.testnet", now_ns + 2_000_000_000);
        contract.buy_item("stable_item".to_string());

        assert_eq!(contract.get_grand_pot().0, 90 * SCALE);
        assert_eq!(contract.get_collection_balance().0, 10 * SCALE);
    }

    #[test]
    fn credit_deposit_rejects_non_whitelisted_stable_token() {
        let mut contract = setup_contract();

        context("alice.testnet", 1_700_000_000_000_000_000);
        contract.register_player();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            context("relayer.testnet", 1_700_000_001_000_000_000);
            contract.credit_deposit(
                account("alice.testnet"),
                account("other-stable.testnet"),
                U128(10 * SCALE),
                "test".to_string(),
                "tx-reject".to_string(),
            );
        }));

        assert!(result.is_err());
    }

    #[test]
    #[ignore]
    fn long_statistical_combat_sanity() {
        let contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);

        let base = 10 * SCALE;
        let mut wins_strength = 0u32;
        let mut wins_balanced = 0u32;

        for i in 0..10_000u32 {
            let attacker_id = account("attacker.testnet");
            let defender_id = account("defender.testnet");

            let mut a = Player::new(attacker_id.clone(), 1, false, now_sec());
            let mut d = Player::new(defender_id.clone(), 1, false, now_sec());

            // Strength-biased vs balanced.
            a.base_strength = 20 * SCALE;
            a.base_dexterity = 5 * SCALE;
            a.base_vitality = 5 * SCALE;
            a.current_hp = max_hp_from_vitality(a.base_vitality);

            d.base_strength = base;
            d.base_dexterity = base;
            d.base_vitality = base;
            d.current_hp = max_hp_from_vitality(d.base_vitality);

            let (a_str, a_dex, a_vit) = contract.effective_stats(&a);
            let (d_str, d_dex, d_vit) = contract.effective_stats(&d);
            let start = |id: &AccountId, level, str_, dex, vit, hp| CombatantStart {
                account_id: id.clone(),
                level,
                strength: str_,
                dexterity: dex,
                vitality: vit,
                max_hp: hp,
                hp_at_start: hp,
            };
            let a_start = start(&attacker_id, a.level, a_str, a_dex, a_vit, a.current_hp);
            let d_start = start(&defender_id, d.level, d_str, d_dex, d_vit, d.current_hp);

            // Fresh mocked context per combat: resets the gas budget of the test VM.
            context(
                "owner.testnet",
                1_700_000_000_000_000_000 + u64::from(i) * 1_000_000_000,
            );
            let seed = env::sha256(i.to_le_bytes());
            let simulation = simulate_combat(
                &seed,
                0,
                &a_start,
                &d_start,
                &contract.combat_config,
                COMBAT_RULES_VERSION,
            );
            match simulation.outcome {
                CombatOutcome::AttackerWins => wins_strength += 1,
                CombatOutcome::DefenderWins => wins_balanced += 1,
                CombatOutcome::Draw => {}
            }
        }

        let balanced_rate = (wins_balanced as f64) / ((wins_strength + wins_balanced) as f64);
        assert!(balanced_rate >= 0.68 && balanced_rate <= 0.74);
    }

    fn potion_definition(item_id: &str, price_game: u128, price_stable: u128) -> ItemDefinition {
        ItemDefinition {
            item_id: item_id.to_string(),
            slot: ItemSlot::Consumable,
            strength_bonus: U128(0),
            dexterity_bonus: U128(0),
            vitality_bonus: U128(10 * SCALE),
            strength_percent_bps: 0,
            dexterity_percent_bps: 0,
            vitality_percent_bps: 0,
            price_game_coin: U128(price_game),
            price_stablecoin: U128(price_stable),
            active: true,
        }
    }

    fn setup_shop_with_funded_alice(stable: u128, game: u128) -> GameContract {
        let mut contract = setup_contract();
        let now_ns = 1_700_000_000_000_000_000;
        context("alice.testnet", now_ns);
        contract.register_player();

        context("owner.testnet", now_ns);
        contract.upsert_item_definition(potion_definition("potion_a", 5 * SCALE, 10 * SCALE));
        contract.upsert_item_definition(potion_definition("potion_b", 7 * SCALE, 20 * SCALE));
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(game));

        context("relayer.testnet", now_ns + 1_000_000_000);
        contract.credit_deposit(
            account("alice.testnet"),
            account("stable.testnet"),
            U128(stable),
            "test".to_string(),
            "tx-batch".to_string(),
        );

        context("alice.testnet", now_ns + 2_000_000_000);
        contract
    }

    #[test]
    fn buy_items_mints_all_lines_and_charges_each_currency() {
        let mut contract = setup_shop_with_funded_alice(100 * SCALE, 100 * SCALE);
        let game_before = contract
            .get_player(account("alice.testnet"))
            .unwrap()
            .game_coins;

        let minted = contract.buy_items(vec![
            PurchaseLine {
                item_id: "potion_a".to_string(),
                quantity: 3,
                currency: PurchaseCurrency::Stablecoin,
            },
            PurchaseLine {
                item_id: "potion_b".to_string(),
                quantity: 2,
                currency: PurchaseCurrency::GameCoin,
            },
        ]);

        assert_eq!(minted.len(), 5);
        let player = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(player.stablecoin_balance, 100 * SCALE - 3 * 10 * SCALE);
        assert_eq!(player.game_coins, game_before - 2 * 7 * SCALE);
        assert_eq!(player.owned_token_ids.len(), 5);
        assert_eq!(
            player
                .owned_item_ids
                .iter()
                .filter(|id| id.as_str() == "potion_a")
                .count(),
            3
        );
        assert_eq!(
            player
                .owned_item_ids
                .iter()
                .filter(|id| id.as_str() == "potion_b")
                .count(),
            2
        );
        // Same pot split as single purchases: 90% of each unit's stable price.
        assert_eq!(
            contract.get_grand_pot().0,
            90 * (3 * 10 * SCALE + 2 * 20 * SCALE) / 100
        );
    }

    #[test]
    fn buy_items_is_all_or_nothing_when_a_currency_is_short() {
        let mut contract = setup_shop_with_funded_alice(100 * SCALE, 10 * SCALE);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.buy_items(vec![
                PurchaseLine {
                    item_id: "potion_a".to_string(),
                    quantity: 2,
                    currency: PurchaseCurrency::Stablecoin,
                },
                PurchaseLine {
                    item_id: "potion_b".to_string(),
                    quantity: 2,
                    currency: PurchaseCurrency::GameCoin,
                },
            ]);
        }));

        assert!(result.is_err());
        let player = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(player.stablecoin_balance, 100 * SCALE);
        assert!(player.owned_token_ids.is_empty());
        assert_eq!(contract.get_grand_pot().0, 0);
    }

    #[test]
    fn buy_items_rejects_empty_zero_quantity_and_oversized_carts() {
        let mut contract = setup_shop_with_funded_alice(1_000 * SCALE, 1_000 * SCALE);

        let empty = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.buy_items(vec![]);
        }));
        assert!(empty.is_err());

        let zero = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.buy_items(vec![PurchaseLine {
                item_id: "potion_a".to_string(),
                quantity: 0,
                currency: PurchaseCurrency::Stablecoin,
            }]);
        }));
        assert!(zero.is_err());

        let oversized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.buy_items(vec![PurchaseLine {
                item_id: "potion_a".to_string(),
                quantity: MAX_ITEMS_PER_PURCHASE + 1,
                currency: PurchaseCurrency::GameCoin,
            }]);
        }));
        assert!(oversized.is_err());

        let player = contract.get_player(account("alice.testnet")).unwrap();
        assert!(player.owned_token_ids.is_empty());
    }

    fn gear_definition(item_id: &str, slot: ItemSlot, vitality: u128) -> ItemDefinition {
        ItemDefinition {
            item_id: item_id.to_string(),
            slot,
            strength_bonus: U128(0),
            dexterity_bonus: U128(0),
            vitality_bonus: U128(vitality),
            strength_percent_bps: 0,
            dexterity_percent_bps: 0,
            vitality_percent_bps: 0,
            price_game_coin: U128(SCALE),
            price_stablecoin: U128(SCALE),
            active: true,
        }
    }

    /// Alice owns a sword, an armor (+10 VIT) and two potions (+10 HP each), with HP lowered to 100.
    fn setup_alice_with_inventory() -> (GameContract, String, String, String, String) {
        let mut contract = setup_shop_with_funded_alice(0, 100 * SCALE);
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.upsert_item_definition(gear_definition("sword", ItemSlot::Weapon, 0));
        contract.upsert_item_definition(gear_definition("armor", ItemSlot::Armor, 10 * SCALE));

        context("alice.testnet", 1_700_000_002_000_000_000);
        let minted = contract.buy_items(vec![
            PurchaseLine {
                item_id: "sword".to_string(),
                quantity: 1,
                currency: PurchaseCurrency::GameCoin,
            },
            PurchaseLine {
                item_id: "armor".to_string(),
                quantity: 1,
                currency: PurchaseCurrency::GameCoin,
            },
            PurchaseLine {
                item_id: "potion_a".to_string(),
                quantity: 2,
                currency: PurchaseCurrency::GameCoin,
            },
        ]);

        let mut player = contract.get_player(account("alice.testnet")).unwrap();
        player.current_hp = 100 * SCALE;
        contract.players.insert(&account("alice.testnet"), &player);

        (
            contract,
            minted[0].clone(),
            minted[1].clone(),
            minted[2].clone(),
            minted[3].clone(),
        )
    }

    #[test]
    fn inventory_actions_equip_and_consume_in_one_call() {
        let (mut contract, sword, armor, potion_1, potion_2) = setup_alice_with_inventory();

        contract.apply_inventory_actions(vec![
            InventoryAction::Equip {
                token_id: sword.clone(),
            },
            InventoryAction::Equip {
                token_id: armor.clone(),
            },
            InventoryAction::Consume {
                token_id: potion_1.clone(),
            },
            InventoryAction::Consume {
                token_id: potion_2.clone(),
            },
        ]);

        let player = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(player.equipped_weapon_token_id, Some(sword));
        assert_eq!(player.equipped_armor_token_id, Some(armor));
        assert_eq!(player.current_hp, 120 * SCALE);
        assert_eq!(player.owned_token_ids.len(), 2);
        assert!(contract.nft_tokens.get(&potion_1).is_none());
        assert!(contract.nft_tokens.get(&potion_2).is_none());
    }

    #[test]
    fn inventory_actions_are_all_or_nothing() {
        let (mut contract, sword, _armor, potion_1, _potion_2) = setup_alice_with_inventory();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.apply_inventory_actions(vec![
                InventoryAction::Equip {
                    token_id: sword.clone(),
                },
                InventoryAction::Consume {
                    token_id: potion_1.clone(),
                },
                InventoryAction::Consume {
                    token_id: potion_1.clone(),
                },
            ]);
        }));

        assert!(result.is_err());
        let player = contract.get_player(account("alice.testnet")).unwrap();
        assert_eq!(player.equipped_weapon_token_id, None);
        assert_eq!(player.current_hp, 100 * SCALE);
        assert_eq!(player.owned_token_ids.len(), 4);
        assert!(contract.nft_tokens.get(&potion_1).is_some());
    }

    #[test]
    fn inventory_actions_reject_empty_and_oversized_batches() {
        let (mut contract, sword, _armor, _potion_1, _potion_2) = setup_alice_with_inventory();

        let empty = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.apply_inventory_actions(vec![]);
        }));
        assert!(empty.is_err());

        let oversized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.apply_inventory_actions(
                (0..=MAX_INVENTORY_ACTIONS)
                    .map(|_| InventoryAction::Equip {
                        token_id: sword.clone(),
                    })
                    .collect(),
            );
        }));
        assert!(oversized.is_err());
    }

    #[test]
    fn ghosts_are_seeded_with_starting_game_coins() {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();

        for ghost in ["g10-01.testnet", "g05-07.testnet", "g01-10.testnet"] {
            let player = contract.get_player(account(ghost)).expect("ghost exists");
            assert!(player.is_ghost);
            assert_eq!(player.game_coins, GHOST_STARTING_GAME_COINS);
        }
    }

    #[test]
    fn owner_can_reset_every_ghost_game_coin_balance() {
        let mut contract = setup_contract();
        context("owner.testnet", 1_700_000_000_000_000_000);
        contract.init_ghosts_v1();

        let mut robbed = contract.get_player(account("g03-02.testnet")).unwrap();
        robbed.game_coins = 0;
        contract.players.insert(&account("g03-02.testnet"), &robbed);

        assert_eq!(contract.dev_set_ghosts_game_coin(U128(500 * SCALE)), 100);
        assert_eq!(
            contract.get_player(account("g03-02.testnet")).unwrap().game_coins,
            500 * SCALE
        );

        context("alice.testnet", 1_700_000_000_000_000_000);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.dev_set_ghosts_game_coin(U128(1));
        }));
        assert!(result.is_err());
    }
}
