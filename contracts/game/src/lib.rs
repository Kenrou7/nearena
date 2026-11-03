use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum ItemSlot {
    Weapon,
    Shield,
    Helmet,
    Armor,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ItemDefinition {
    pub item_id: String,
    pub slot: ItemSlot,
    pub strength_bonus: u16,
    pub dexterity_bonus: u16,
    pub vitality_bonus: u16,
    pub price_game_coin: u128,
    pub price_stablecoin: u128,
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
pub struct BalanceConfig {
    pub xp_per_pve_win: u32,
    pub xp_per_pvp_win_base: u32,
    pub game_coin_per_pve_win: u32,
    pub pvp_steal_percent: u8,
    pub pvp_steal_cap: u32,
    pub life_regen_percent_per_tick: u8,
    pub life_regen_tick_seconds: u32,
    pub min_life_percent_to_fight: u8,
}

impl Default for BalanceConfig {
    fn default() -> Self {
        Self {
            xp_per_pve_win: 20,
            xp_per_pvp_win_base: 40,
            game_coin_per_pve_win: 10,
            pvp_steal_percent: 10,
            pvp_steal_cap: 100,
            life_regen_percent_per_tick: 5,
            life_regen_tick_seconds: 600,
            min_life_percent_to_fight: 20,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Player {
    pub account_id: AccountId,
    pub level: u32,
    pub xp: u32,
    pub strength: u16,
    pub dexterity: u16,
    pub vitality: u16,
    pub current_life: u32,
    pub stablecoin_balance: u128,
    pub game_coin_balance: u128,
    pub last_regen_timestamp_sec: u64,
    pub owned_item_ids: Vec<String>,
    pub owned_token_ids: Vec<String>,
    pub equipped_weapon_token_id: Option<String>,
    pub equipped_shield_token_id: Option<String>,
    pub equipped_helmet_token_id: Option<String>,
    pub equipped_armor_token_id: Option<String>,
}

impl Player {
    fn new(account_id: AccountId, timestamp_sec: u64) -> Self {
        Self {
            account_id,
            level: 1,
            xp: 0,
            strength: 5,
            dexterity: 5,
            vitality: 5,
            current_life: 150,
            stablecoin_balance: 0,
            game_coin_balance: 0,
            last_regen_timestamp_sec: timestamp_sec,
            owned_item_ids: vec![],
            owned_token_ids: vec![],
            equipped_weapon_token_id: None,
            equipped_shield_token_id: None,
            equipped_helmet_token_id: None,
            equipped_armor_token_id: None,
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GameContract {
    pub owner_id: AccountId,
    pub relayer_account_id: AccountId,
    pub balance_config: BalanceConfig,
    pub players: LookupMap<AccountId, Player>,
    pub processed_deposits: UnorderedSet<String>,
    pub item_catalog: LookupMap<String, ItemDefinition>,
    pub nft_tokens: LookupMap<String, NftToken>,
    pub next_token_nonce: u64,
    pub tournament_pot_stablecoin_balance: u128,
    pub treasury_stablecoin_balance: u128,
}

#[near]
impl GameContract {
    #[init]
    pub fn new(owner_id: AccountId, relayer_account_id: AccountId, balance_config: Option<BalanceConfig>) -> Self {
        require!(!env::state_exists(), "Contract is already initialized");

        Self {
            owner_id,
            relayer_account_id,
            balance_config: balance_config.unwrap_or_default(),
            players: LookupMap::new(b"p"),
            processed_deposits: UnorderedSet::new(b"d"),
            item_catalog: LookupMap::new(b"i"),
            nft_tokens: LookupMap::new(b"n"),
            next_token_nonce: 1,
            tournament_pot_stablecoin_balance: 0,
            treasury_stablecoin_balance: 0,
        }
    }

    pub fn upsert_item_definition(&mut self, item: ItemDefinition) {
        self.assert_owner();
        require!(!item.item_id.trim().is_empty(), "item_id must not be empty");
        require!(
            item.price_game_coin > 0 || item.price_stablecoin > 0,
            "at least one price must be > 0"
        );

        self.item_catalog.insert(&item.item_id, &item);
    }

    pub fn buy_item(&mut self, item_id: String) {
        require!(!item_id.trim().is_empty(), "item_id must not be empty");

        let account_id = env::predecessor_account_id();
        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"));

        let item = self
            .item_catalog
            .get(&item_id)
            .unwrap_or_else(|| env::panic_str("Item does not exist"));

        require!(item.active, "Item is not active");
        require!(item.price_stablecoin > 0, "Item has no stablecoin price");
        require!(
            player.stablecoin_balance >= item.price_stablecoin,
            "Insufficient stablecoin balance"
        );

        player.stablecoin_balance -= item.price_stablecoin;
        let token_id = self.mint_item_to_player(&account_id, &item.item_id, &mut player);

        let pot_share = item
            .price_stablecoin
            .checked_mul(90)
            .unwrap_or_else(|| env::panic_str("pot overflow"))
            / 100;
        let treasury_share = item.price_stablecoin - pot_share;

        self.tournament_pot_stablecoin_balance = self
            .tournament_pot_stablecoin_balance
            .checked_add(pot_share)
            .unwrap_or_else(|| env::panic_str("pot overflow"));

        self.treasury_stablecoin_balance = self
            .treasury_stablecoin_balance
            .checked_add(treasury_share)
            .unwrap_or_else(|| env::panic_str("treasury overflow"));

        self.players.insert(&account_id, &player);

        env::log_str(&format!(
            "minted token {} for item {} to {}",
            token_id, item.item_id, account_id
        ));
    }

    pub fn buy_item_with_game_coin(&mut self, item_id: String) {
        require!(!item_id.trim().is_empty(), "item_id must not be empty");

        let account_id = env::predecessor_account_id();
        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"));

        let item = self
            .item_catalog
            .get(&item_id)
            .unwrap_or_else(|| env::panic_str("Item does not exist"));

        require!(item.active, "Item is not active");
        require!(item.price_game_coin > 0, "Item has no game coin price");
        require!(
            player.game_coin_balance >= item.price_game_coin,
            "Insufficient game coin balance"
        );

        player.game_coin_balance -= item.price_game_coin;
        let token_id = self.mint_item_to_player(&account_id, &item.item_id, &mut player);
        self.players.insert(&account_id, &player);

        env::log_str(&format!(
            "minted token {} for item {} to {}",
            token_id, item.item_id, account_id
        ));
    }

    pub fn equip(&mut self, token_id: String) {
        require!(!token_id.trim().is_empty(), "token_id must not be empty");

        let account_id = env::predecessor_account_id();
        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"));

        require!(
            player.owned_token_ids.contains(&token_id),
            "Player does not own token"
        );

        let token = self
            .nft_tokens
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token does not exist"));

        require!(token.owner_id == account_id, "Token owner mismatch");

        let item = self
            .item_catalog
            .get(&token.item_id)
            .unwrap_or_else(|| env::panic_str("Item does not exist"));

        match item.slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = Some(token_id),
            ItemSlot::Shield => player.equipped_shield_token_id = Some(token_id),
            ItemSlot::Helmet => player.equipped_helmet_token_id = Some(token_id),
            ItemSlot::Armor => player.equipped_armor_token_id = Some(token_id),
        }

        self.players.insert(&account_id, &player);
    }

    pub fn unequip(&mut self, slot: ItemSlot) {
        let account_id = env::predecessor_account_id();
        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"));

        match slot {
            ItemSlot::Weapon => player.equipped_weapon_token_id = None,
            ItemSlot::Shield => player.equipped_shield_token_id = None,
            ItemSlot::Helmet => player.equipped_helmet_token_id = None,
            ItemSlot::Armor => player.equipped_armor_token_id = None,
        }

        self.players.insert(&account_id, &player);
    }

    pub fn register_player(&mut self) {
        let account_id = env::predecessor_account_id();
        require!(self.players.get(&account_id).is_none(), "Player already registered");

        let now_sec = env::block_timestamp() / 1_000_000_000;
        self.players
            .insert(&account_id, &Player::new(account_id.clone(), now_sec));
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
            .unwrap_or_else(|| {
                Player::new(account_id.clone(), env::block_timestamp() / 1_000_000_000)
            });

        player.stablecoin_balance = player
            .stablecoin_balance
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("stablecoin balance overflow"));

        self.players.insert(&account_id, &player);
        self.processed_deposits.insert(&tx_ref);
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<Player> {
        self.players.get(&account_id)
    }

    pub fn get_balance_config(&self) -> BalanceConfig {
        BalanceConfig {
            xp_per_pve_win: self.balance_config.xp_per_pve_win,
            xp_per_pvp_win_base: self.balance_config.xp_per_pvp_win_base,
            game_coin_per_pve_win: self.balance_config.game_coin_per_pve_win,
            pvp_steal_percent: self.balance_config.pvp_steal_percent,
            pvp_steal_cap: self.balance_config.pvp_steal_cap,
            life_regen_percent_per_tick: self.balance_config.life_regen_percent_per_tick,
            life_regen_tick_seconds: self.balance_config.life_regen_tick_seconds,
            min_life_percent_to_fight: self.balance_config.min_life_percent_to_fight,
        }
    }

    pub fn get_item_definition(&self, item_id: String) -> Option<ItemDefinition> {
        self.item_catalog.get(&item_id)
    }

    pub fn get_token(&self, token_id: String) -> Option<NftToken> {
        self.nft_tokens.get(&token_id)
    }

    pub fn get_pot(&self) -> U128 {
        U128(self.tournament_pot_stablecoin_balance)
    }

    pub fn get_treasury_stablecoin_balance(&self) -> U128 {
        U128(self.treasury_stablecoin_balance)
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

    pub fn dev_set_player_game_coin(&mut self, account_id: AccountId, amount: U128) {
        self.assert_owner();
        let mut player = self
            .players
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Player must be registered"));

        player.game_coin_balance = amount.0;
        self.players.insert(&account_id, &player);
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

    fn mint_item_to_player(
        &mut self,
        owner_id: &AccountId,
        item_id: &str,
        player: &mut Player,
    ) -> String {
        let token_id = format!("token-{}", self.next_token_nonce);
        self.next_token_nonce += 1;

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid account")
    }

    fn set_predecessor(value: &str) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(account(value));
        builder.block_timestamp(1_700_000_000_000_000_000);
        testing_env!(builder.build());
    }

    fn setup_contract() -> GameContract {
        GameContract::new(account("owner.testnet"), account("relayer.testnet"), None)
    }

    #[test]
    fn register_player_initializes_expected_defaults() {
        set_predecessor("alice.testnet");
        let mut contract = setup_contract();

        contract.register_player();
        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist");

        assert_eq!(player.level, 1);
        assert_eq!(player.strength, 5);
        assert_eq!(player.dexterity, 5);
        assert_eq!(player.vitality, 5);
        assert_eq!(player.current_life, 150);
        assert_eq!(player.stablecoin_balance, 0);
    }

    #[test]
    #[should_panic(expected = "Player already registered")]
    fn register_player_fails_if_already_registered() {
        set_predecessor("alice.testnet");
        let mut contract = setup_contract();

        contract.register_player();
        contract.register_player();
    }

    #[test]
    fn credit_deposit_is_idempotent_by_tx_ref() {
        let mut contract = setup_contract();

        set_predecessor("relayer.testnet");
        contract.credit_deposit(
            account("alice.testnet"),
            U128(1_000),
            "solana".to_string(),
            "tx-1".to_string(),
        );

        contract.credit_deposit(
            account("alice.testnet"),
            U128(1_000),
            "solana".to_string(),
            "tx-1".to_string(),
        );

        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist");

        assert_eq!(player.stablecoin_balance, 1_000);
    }

    #[test]
    #[should_panic(expected = "Only relayer can call this method")]
    fn credit_deposit_fails_if_not_relayer() {
        set_predecessor("alice.testnet");
        let mut contract = setup_contract();

        contract.credit_deposit(
            account("alice.testnet"),
            U128(100),
            "solana".to_string(),
            "tx-2".to_string(),
        );
    }

    #[test]
    fn buy_item_with_game_coin_deducts_balance_and_adds_item() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.upsert_item_definition(ItemDefinition {
            item_id: "basic_sword".to_string(),
            slot: ItemSlot::Weapon,
            strength_bonus: 2,
            dexterity_bonus: 0,
            vitality_bonus: 0,
            price_game_coin: 200,
            price_stablecoin: 5,
            active: true,
        });
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(300));

        set_predecessor("alice.testnet");
        contract.buy_item_with_game_coin("basic_sword".to_string());

        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist");

        assert_eq!(player.game_coin_balance, 100);
        assert_eq!(player.owned_item_ids, vec!["basic_sword".to_string()]);
        assert_eq!(player.owned_token_ids.len(), 1);
    }

    #[test]
    #[should_panic(expected = "Insufficient game coin balance")]
    fn buy_item_with_game_coin_fails_if_balance_is_low() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.upsert_item_definition(ItemDefinition {
            item_id: "basic_shield".to_string(),
            slot: ItemSlot::Shield,
            strength_bonus: 0,
            dexterity_bonus: 1,
            vitality_bonus: 1,
            price_game_coin: 200,
            price_stablecoin: 5,
            active: true,
        });
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(100));

        set_predecessor("alice.testnet");
        contract.buy_item_with_game_coin("basic_shield".to_string());
    }

    #[test]
    #[should_panic(expected = "Item does not exist")]
    fn buy_item_with_game_coin_fails_if_item_missing() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(500));

        set_predecessor("alice.testnet");
        contract.buy_item_with_game_coin("unknown_item".to_string());
    }

    #[test]
    fn buy_item_splits_pot_and_treasury_and_mints_token() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.upsert_item_definition(ItemDefinition {
            item_id: "nft_axe".to_string(),
            slot: ItemSlot::Weapon,
            strength_bonus: 3,
            dexterity_bonus: 0,
            vitality_bonus: 0,
            price_game_coin: 300,
            price_stablecoin: 100,
            active: true,
        });

        set_predecessor("relayer.testnet");
        contract.credit_deposit(
            account("alice.testnet"),
            U128(200),
            "solana".to_string(),
            "tx-stable-1".to_string(),
        );

        set_predecessor("alice.testnet");
        contract.buy_item("nft_axe".to_string());

        let player = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist");
        assert_eq!(player.stablecoin_balance, 100);
        assert_eq!(player.owned_token_ids.len(), 1);

        assert_eq!(contract.get_pot(), U128(90));
        assert_eq!(contract.get_treasury_stablecoin_balance(), U128(10));
    }

    #[test]
    #[should_panic(expected = "Insufficient stablecoin balance")]
    fn buy_item_fails_if_stablecoin_balance_is_low() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.upsert_item_definition(ItemDefinition {
            item_id: "nft_helmet".to_string(),
            slot: ItemSlot::Helmet,
            strength_bonus: 0,
            dexterity_bonus: 0,
            vitality_bonus: 2,
            price_game_coin: 120,
            price_stablecoin: 80,
            active: true,
        });

        set_predecessor("relayer.testnet");
        contract.credit_deposit(
            account("alice.testnet"),
            U128(50),
            "solana".to_string(),
            "tx-stable-2".to_string(),
        );

        set_predecessor("alice.testnet");
        contract.buy_item("nft_helmet".to_string());
    }

    #[test]
    fn equip_and_unequip_updates_slot() {
        let mut contract = setup_contract();

        set_predecessor("alice.testnet");
        contract.register_player();

        set_predecessor("owner.testnet");
        contract.upsert_item_definition(ItemDefinition {
            item_id: "basic_spear".to_string(),
            slot: ItemSlot::Weapon,
            strength_bonus: 2,
            dexterity_bonus: 1,
            vitality_bonus: 0,
            price_game_coin: 100,
            price_stablecoin: 3,
            active: true,
        });
        contract.dev_set_player_game_coin(account("alice.testnet"), U128(200));

        set_predecessor("alice.testnet");
        contract.buy_item_with_game_coin("basic_spear".to_string());
        let token_id = contract.get_player_token_ids(account("alice.testnet"))[0].clone();

        contract.equip(token_id.clone());
        let equipped = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist")
            .equipped_weapon_token_id;
        assert_eq!(equipped, Some(token_id));

        contract.unequip(ItemSlot::Weapon);
        let equipped_after = contract
            .get_player(account("alice.testnet"))
            .expect("player should exist")
            .equipped_weapon_token_id;
        assert_eq!(equipped_after, None);
    }
}
