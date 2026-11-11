use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

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
    pub attacker_won: bool,
    pub draw: bool,
    pub rounds: u8,
    pub attacker_total_damage: U128,
    pub defender_total_damage: U128,
    pub attacker: CombatantSnapshot,
    pub defender: CombatantSnapshot,
    pub round_logs: Vec<CombatRoundLog>,
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

        let attacker_snapshot_start = CombatantSnapshot {
            account_id: attacker_id.clone(),
            level: attacker.level,
            strength: U128(attacker_str),
            dexterity: U128(attacker_dex),
            vitality: U128(attacker_vit),
            max_hp: U128(attacker_max_hp),
            hp_at_start: U128(attacker.current_hp),
            hp_at_end: U128(attacker.current_hp),
        };

        let defender_snapshot_start = CombatantSnapshot {
            account_id: opponent_account_id.clone(),
            level: defender.level,
            strength: U128(defender_str),
            dexterity: U128(defender_dex),
            vitality: U128(defender_vit),
            max_hp: U128(defender_max_hp),
            hp_at_start: U128(defender.current_hp),
            hp_at_end: U128(defender.current_hp),
        };

        let mut attacker_hp = attacker.current_hp;
        let mut defender_hp = defender.current_hp;
        let mut total_damage_by_attacker = 0u128;
        let mut total_damage_by_defender = 0u128;
        let mut rounds_executed = 0u8;
        let mut round_logs: Vec<CombatRoundLog> = vec![];
        let mut battle_over = false;

        for round_number in 1..=10 {
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
            let mut attacker_hit = false;
            let mut defender_hit = false;
            let mut attacker_damage = 0u128;
            let mut defender_damage = 0u128;

            if self.roll_hit(attacker_dex, defender_dex, &attacker_id, &opponent_account_id) {
                attacker_hit = true;
                let dmg = self.roll_damage(attacker_str, defender_vit, &attacker_id, &opponent_account_id);
                let actual = dmg.min(defender_hp);
                defender_hp -= actual;
                attacker_damage = actual;
                total_damage_by_attacker = total_damage_by_attacker
                    .checked_add(actual)
                    .unwrap_or_else(|| env::panic_str("damage overflow"));
            }

            if defender_hp == 0 {
                battle_over = true;
            } else {
                if self.roll_hit(defender_dex, attacker_dex, &opponent_account_id, &attacker_id) {
                    defender_hit = true;
                    let dmg = self.roll_damage(defender_str, attacker_vit, &opponent_account_id, &attacker_id);
                    let actual = dmg.min(attacker_hp);
                    attacker_hp -= actual;
                    defender_damage = actual;
                    total_damage_by_defender = total_damage_by_defender
                        .checked_add(actual)
                        .unwrap_or_else(|| env::panic_str("damage overflow"));
                }

                if attacker_hp == 0 {
                    battle_over = true;
                }
            }

            round_logs.push(CombatRoundLog {
                round: round_number,
                skipped: false,
                attacker_hit,
                attacker_damage: U128(attacker_damage),
                defender_hit,
                defender_damage: U128(defender_damage),
                attacker_hp_after: U128(attacker_hp),
                defender_hp_after: U128(defender_hp),
                attacker_defeated: attacker_hp == 0,
                defender_defeated: defender_hp == 0,
            });
        }

        attacker.current_hp = attacker_hp;
        defender.current_hp = defender_hp;

        let mut result = ChallengeResult {
            attacker_won: false,
            draw: false,
            rounds: rounds_executed,
            attacker_total_damage: U128(total_damage_by_attacker),
            defender_total_damage: U128(total_damage_by_defender),
            attacker: attacker_snapshot_start,
            defender: defender_snapshot_start,
            round_logs,
        };

        if defender_hp == 0 || total_damage_by_attacker > total_damage_by_defender {
            result.attacker_won = true;
            self.apply_win_rewards(&mut attacker, &mut defender);

            // If defender was leader, attacker claims champion pot.
            if defender_rank == 0 {
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
        } else if attacker_hp == 0 || total_damage_by_defender > total_damage_by_attacker {
            self.apply_win_rewards(&mut defender, &mut attacker);
        } else {
            result.draw = true;
            self.apply_draw_rewards(&mut attacker, &mut defender);
        }

        self.apply_level_ups(&mut attacker);
        self.apply_level_ups(&mut defender);

        self.arena_tiers.insert(&attacker_tier, &tier_state);

        self.handle_tier_change_if_needed(&attacker_id, &mut attacker, now);
        self.handle_tier_change_if_needed(&opponent_account_id, &mut defender, now);

        self.players.insert(&attacker_id, &attacker);
        self.players.insert(&opponent_account_id, &defender);

        result.attacker.hp_at_end = U128(attacker.current_hp);
        result.defender.hp_at_end = U128(defender.current_hp);

        result
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

    fn roll_hit(
        &mut self,
        attacker_dex: u128,
        defender_dex: u128,
        attacker_id: &AccountId,
        defender_id: &AccountId,
    ) -> bool {
        let chance_bps = self.compute_hit_chance_bps(attacker_dex, defender_dex);
        let roll = self.random_u16(1, BPS_DENOMINATOR as u16, attacker_id, defender_id);
        u128::from(roll) <= chance_bps
    }

    fn compute_hit_chance_bps(&self, attacker_dex: u128, defender_dex: u128) -> u128 {
        let base = i128::from(self.combat_config.hit_base_bps);
        let coeff = i128::from(self.combat_config.hit_coefficient_bps);
        let min = i128::from(self.combat_config.hit_min_bps);
        let max = i128::from(self.combat_config.hit_max_bps);

        let sum = attacker_dex
            .checked_add(defender_dex)
            .unwrap_or_else(|| env::panic_str("dexterity overflow"));
        if sum == 0 {
            return u128::from(self.combat_config.hit_min_bps);
        }

        let delta = attacker_dex as i128 - defender_dex as i128;
        let adj = coeff
            .checked_mul(delta)
            .unwrap_or_else(|| env::panic_str("chance overflow"))
            / sum as i128;

        let raw = base + adj;
        raw.clamp(min, max) as u128
    }

    fn roll_damage(
        &mut self,
        attacker_strength: u128,
        defender_vitality: u128,
        attacker_id: &AccountId,
        defender_id: &AccountId,
    ) -> u128 {
        let random_bps = self.random_u16(
            self.combat_config.damage_random_min_bps,
            self.combat_config.damage_random_max_bps,
            attacker_id,
            defender_id,
        );

        let random_scaled = apply_bps(attacker_strength, u128::from(random_bps));
        let k = self.combat_config.damage_reduction_k.0;
        let denom = k
            .checked_add(defender_vitality)
            .unwrap_or_else(|| env::panic_str("damage denominator overflow"));

        mul_div_floor(random_scaled, k, denom)
    }

    fn random_u16(&mut self, min: u16, max: u16, a: &AccountId, b: &AccountId) -> u16 {
        require!(max >= min, "invalid random range");
        let span = u32::from(max - min + 1);

        self.combat_nonce = self
            .combat_nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("combat nonce overflow"));

        let mut seed = env::random_seed();
        seed.extend_from_slice(a.as_bytes());
        seed.extend_from_slice(b.as_bytes());
        seed.extend_from_slice(&self.combat_nonce.to_le_bytes());

        let hash = env::sha256_array(&seed);
        let value = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);

        min + (value % span) as u16
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
        let mut contract = setup_contract();
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

            let mut a_hp = a.current_hp;
            let mut d_hp = d.current_hp;
            let mut dmg_a = 0u128;
            let mut dmg_d = 0u128;

            context(
                "owner.testnet",
                1_700_000_000_000_000_000 + u64::from(i) * 1_000_000_000,
            );

            for _ in 0..10 {
                if contract.roll_hit(a_dex, d_dex, &attacker_id, &defender_id) {
                    let dmg = contract.roll_damage(a_str, d_vit, &attacker_id, &defender_id);
                    let actual = dmg.min(d_hp);
                    d_hp -= actual;
                    dmg_a += actual;
                }
                if d_hp == 0 {
                    break;
                }

                if contract.roll_hit(d_dex, a_dex, &defender_id, &attacker_id) {
                    let dmg = contract.roll_damage(d_str, a_vit, &defender_id, &attacker_id);
                    let actual = dmg.min(a_hp);
                    a_hp -= actual;
                    dmg_d += actual;
                }
                if a_hp == 0 {
                    break;
                }
            }

            if d_hp == 0 || dmg_a > dmg_d {
                wins_strength += 1;
            } else if a_hp == 0 || dmg_d > dmg_a {
                wins_balanced += 1;
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
