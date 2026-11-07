use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::json_types::U128;
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
}

impl Player {
    fn new(account_id: AccountId, level: u32, is_ghost: bool) -> Self {
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
    pub arena_tiers: LookupMap<u8, ArenaTierState>,
    pub next_token_nonce: u64,
    pub combat_nonce: u64,
    pub combat_config: CombatConfig,
    pub ghosts_seeded_v1: bool,
}

#[near]
impl GameContract {
    #[init]
    pub fn new(owner_id: AccountId, relayer_account_id: AccountId, combat_config: Option<CombatConfig>) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");
        let now_sec = now_sec();

        let mut contract = Self {
            owner_id,
            relayer_account_id,
            players: LookupMap::new(b"p"),
            item_catalog: LookupMap::new(b"i"),
            nft_tokens: LookupMap::new(b"n"),
            processed_deposits: UnorderedSet::new(b"d"),
            arena_tiers: LookupMap::new(b"a"),
            next_token_nonce: 1,
            combat_nonce: 0,
            combat_config: combat_config.unwrap_or_default(),
            ghosts_seeded_v1: false,
        };

        contract.arena_tiers.insert(&TIER_ONE, &ArenaTierState::new(now_sec));
        contract.arena_tiers.insert(&TIER_TWO, &ArenaTierState::new(now_sec));
        contract.arena_tiers.insert(&TIER_THREE, &ArenaTierState::new(now_sec));
        contract
    }

    pub fn register_player(&mut self) {
        let account_id = env::predecessor_account_id();
        require!(self.players.get(&account_id).is_none(), "Player already registered");

        let player = Player::new(account_id.clone(), 1, false);
        self.players.insert(&account_id, &player);
        self.insert_into_tier_ladder(account_id, tier_for_level(1));
    }

    pub fn init_ghosts_v1(&mut self) {
        self.assert_owner();
        require!(!self.ghosts_seeded_v1, "Ghosts already seeded");

        // v1: level 10..1, 10 ghosts per level in tier 1.
        for level in (1..=10).rev() {
            for ordinal in 1..=10 {
                let ghost_id = format!("g{:02}-{:02}.testnet", level, ordinal)
                    .parse::<AccountId>()
                    .unwrap_or_else(|_| env::panic_str("invalid ghost id"));

                if self.players.get(&ghost_id).is_some() {
                    continue;
                }

                let ghost = Player::new(ghost_id.clone(), level, true);
                self.players.insert(&ghost_id, &ghost);
                self.insert_into_tier_ladder(ghost_id, TIER_ONE);
            }
        }

        self.ghosts_seeded_v1 = true;
    }

    pub fn assign_stat_points(&mut self, strength_points: u32, dexterity_points: u32, vitality_points: u32) {
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
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
        require!(!item_id.trim().is_empty(), "item_id must not be empty");
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
        let item = self.must_item(&item_id);

        require!(item.active, "Item is not active");
        require!(item.price_game_coin.0 > 0, "Item has no game coin price");
        require!(
            player.game_coins >= item.price_game_coin.0,
            "Insufficient game coin balance"
        );

        player.game_coins -= item.price_game_coin.0;
        let _token_id = self.mint_item_to_player(&account_id, &item.item_id, &mut player);
        self.players.insert(&account_id, &player);
    }

    pub fn buy_item(&mut self, item_id: String) {
        require!(!item_id.trim().is_empty(), "item_id must not be empty");
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);
        let item = self.must_item(&item_id);

        require!(item.active, "Item is not active");
        require!(item.price_stablecoin.0 > 0, "Item has no stablecoin price");
        require!(
            player.stablecoin_balance >= item.price_stablecoin.0,
            "Insufficient stablecoin balance"
        );

        player.stablecoin_balance -= item.price_stablecoin.0;
        let _token_id = self.mint_item_to_player(&account_id, &item.item_id, &mut player);
        self.players.insert(&account_id, &player);
    }

    pub fn equip(&mut self, token_id: String) {
        require!(!token_id.trim().is_empty(), "token_id must not be empty");
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);

        require!(
            player.owned_token_ids.contains(&token_id),
            "Player does not own token"
        );

        let token = self.must_token(&token_id);
        require!(token.owner_id == account_id, "Token owner mismatch");
        let item = self.must_item(&token.item_id);
        require!(item.slot != ItemSlot::Consumable, "Consumables cannot be equipped");

        match item.slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = Some(token_id),
            ItemSlot::Shield => player.equipped_shield_token_id = Some(token_id),
            ItemSlot::Helmet => player.equipped_helmet_token_id = Some(token_id),
            ItemSlot::Armor => player.equipped_armor_token_id = Some(token_id),
            ItemSlot::Consumable => env::panic_str("Consumables cannot be equipped"),
        }

        self.players.insert(&account_id, &player);
    }

    pub fn unequip(&mut self, slot: ItemSlot) {
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);

        match slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = None,
            ItemSlot::Shield => player.equipped_shield_token_id = None,
            ItemSlot::Helmet => player.equipped_helmet_token_id = None,
            ItemSlot::Armor => player.equipped_armor_token_id = None,
            ItemSlot::Consumable => env::panic_str("Consumables cannot be unequipped"),
        }

        let (_, _, effective_vitality) = self.effective_stats(&player);
        let max_hp = max_hp_from_vitality(effective_vitality);
        if player.current_hp > max_hp {
            player.current_hp = max_hp;
        }

        self.players.insert(&account_id, &player);
    }

    pub fn consume(&mut self, token_id: String) {
        require!(!token_id.trim().is_empty(), "token_id must not be empty");
        let account_id = env::predecessor_account_id();
        let mut player = self.must_player(&account_id);

        require!(
            player.owned_token_ids.contains(&token_id),
            "Player does not own token"
        );

        let token = self.must_token(&token_id);
        require!(token.owner_id == account_id, "Token owner mismatch");

        let item = self.must_item(&token.item_id);
        require!(item.active, "Item is not active");
        require!(item.slot == ItemSlot::Consumable, "Item is not consumable");

        let (_, _, effective_vitality) = self.effective_stats(&player);
        let max_hp = max_hp_from_vitality(effective_vitality);

        let heal_amount = item.vitality_bonus.0;
        require!(heal_amount > 0, "Consumable has no healing effect");

        let healed = player.current_hp.saturating_add(heal_amount).min(max_hp);
        player.current_hp = healed;

        self.burn_player_token(&mut player, &token_id, &token.item_id);
        self.players.insert(&account_id, &player);
    }

    pub fn claim_leader_income(&mut self) {
        let account_id = env::predecessor_account_id();
        let player = self.must_player(&account_id);
        let tier = tier_for_level(player.level);
        let now = now_sec();

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

            // If defender was leader, attacker claims champion pot and ladder swaps.
            if defender_rank == 0 {
                attacker.game_coins = attacker
                    .game_coins
                    .checked_add(tier_state.champion_pot)
                    .unwrap_or_else(|| env::panic_str("champion pot overflow"));
                tier_state.champion_pot = 0;
            }

            tier_state.ladder.swap(attacker_rank, defender_rank);
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

    pub fn credit_deposit(&mut self, account_id: AccountId, amount: U128, chain: String, tx_ref: String) {
        self.assert_relayer();
        require!(!tx_ref.trim().is_empty(), "tx_ref must not be empty");
        require!(!chain.trim().is_empty(), "chain must not be empty");

        if self.processed_deposits.contains(&tx_ref) {
            return;
        }

        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| Player::new(account_id.clone(), 1, false));

        player.stablecoin_balance = player
            .stablecoin_balance
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("stablecoin overflow"));

        self.players.insert(&account_id, &player);
        self.processed_deposits.insert(&tx_ref);
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
            current_hp: U128(player.current_hp),
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

    fn burn_player_token(&mut self, player: &mut Player, token_id: &str, item_id: &str) {
        if let Some(index) = player.owned_token_ids.iter().position(|value| value == token_id) {
            player.owned_token_ids.remove(index);
        }

        if let Some(index) = player.owned_item_ids.iter().position(|value| value == item_id) {
            player.owned_item_ids.remove(index);
        }

        self.nft_tokens.remove(&token_id.to_string());
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
        GameContract::new(account("owner.testnet"), account("relayer.testnet"), None)
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
            price_stablecoin: U128(0),
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
            price_stablecoin: U128(0),
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

            let mut a = Player::new(attacker_id.clone(), 1, false);
            let mut d = Player::new(defender_id.clone(), 1, false);

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
}
