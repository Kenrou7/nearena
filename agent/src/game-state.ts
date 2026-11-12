import type { GameClient } from "./game-client.js";
import type { ArenaView, CreatureView, ItemDefinition, ItemSlot, NftToken, PlayerView } from "./types.js";

/** Mirrors `SCALE` in the contract: stats and HP are fixed-point with 6 decimals. */
export const SCALE = 1_000_000n;
/** Mirrors `CHALLENGE_MIN_HP_BPS` / `EXPEDITION_MIN_HP_BPS`: 20% of max HP to fight. */
export const MIN_FIGHT_HP_BPS = 2_000n;

/** Item ids sold in the shop (same list as web/lib/item-catalog.ts). */
export const KNOWN_ITEM_IDS = [
  "nft_axe",
  "basic_sword",
  "basic_shield",
  "iron_armor",
  "potion_small",
  "potion_medium",
  "potion_large",
] as const;

/** Upper bound of tokens inspected per turn, to keep the view calls and the prompt small. */
const MAX_TOKENS_INSPECTED = 30;

export type OwnedToken = { tokenId: string; itemId: string; slot: ItemSlot; equipped: boolean };
export type Opponent = { accountId: string; level: number; power: number };

/** Everything the brain and the validator need to decide a turn. */
export type GameSnapshot = {
  accountId: string;
  player: PlayerView | null;
  arena: ArenaView | null;
  /** Rivals above the bot in its tier that it may challenge (up to 5). */
  opponents: Opponent[];
  creatures: CreatureView[];
  items: ItemDefinition[];
  tokens: OwnedToken[];
};

/** Fixed-point contract value → plain number, rounded to 2 decimals (display only). */
export function scaled(value: string): number {
  return Math.round(Number(BigInt(value)) / (Number(SCALE) / 100)) / 100;
}

export function canFight(player: PlayerView): boolean {
  return BigInt(player.current_hp) * 10_000n >= BigInt(player.max_hp) * MIN_FIGHT_HP_BPS;
}

export function equippedTokenIds(player: PlayerView): string[] {
  return [
    player.equipped_weapon_token_id,
    player.equipped_shield_token_id,
    player.equipped_helmet_token_id,
    player.equipped_armor_token_id,
  ].filter((id): id is string => id !== null);
}

export function equippedTokenForSlot(player: PlayerView, slot: ItemSlot): string | null {
  switch (slot) {
    case "Weapon":
      return player.equipped_weapon_token_id;
    case "Shield":
      return player.equipped_shield_token_id;
    case "Helmet":
      return player.equipped_helmet_token_id;
    case "Armor":
      return player.equipped_armor_token_id;
    case "Consumable":
      return null;
  }
}

function power(view: PlayerView): number {
  return scaled(view.effective_strength) + scaled(view.effective_dexterity) + scaled(view.effective_vitality);
}

export async function loadSnapshot(client: GameClient, accountId: string): Promise<GameSnapshot> {
  const [player, creatures, itemResults] = await Promise.all([
    client.view<PlayerView | null>("get_player_view", { account_id: accountId }),
    client.view<CreatureView[]>("get_creatures", {}),
    Promise.all(KNOWN_ITEM_IDS.map((itemId) => client.view<ItemDefinition | null>("get_item_definition", { item_id: itemId }))),
  ]);
  const items = itemResults.filter((item): item is ItemDefinition => item !== null && item.active);

  if (player === null) {
    return { accountId, player: null, arena: null, opponents: [], creatures, items, tokens: [] };
  }

  const [arena, candidateIds, tokenResults] = await Promise.all([
    client.view<ArenaView | null>("get_arena_view", { account_id: accountId }),
    client.view<string[]>("get_challenge_candidates", { account_id: accountId }),
    Promise.all(
      player.owned_token_ids
        .slice(0, MAX_TOKENS_INSPECTED)
        .map((tokenId) => client.view<NftToken | null>("get_token", { token_id: tokenId })),
    ),
  ]);

  const candidateViews = await Promise.all(
    candidateIds.map((id) => client.view<PlayerView | null>("get_player_view", { account_id: id })),
  );
  const opponents = candidateViews
    .filter((view): view is PlayerView => view !== null)
    .map((view) => ({ accountId: view.account_id, level: view.level, power: power(view) }));

  const equipped = new Set(equippedTokenIds(player));
  const slotByItem = new Map(items.map((item) => [item.item_id, item.slot]));
  const tokens = tokenResults
    .filter((token): token is NftToken => token !== null)
    .flatMap((token) => {
      const slot = slotByItem.get(token.item_id);
      return slot === undefined
        ? []
        : [{ tokenId: token.token_id, itemId: token.item_id, slot, equipped: equipped.has(token.token_id) }];
    });

  return { accountId, player, arena, opponents, creatures, items, tokens };
}

/** Compact, human-readable state for the LLM prompt (numbers already unscaled). */
export function describeSnapshot(snapshot: GameSnapshot): Record<string, unknown> {
  const { player, arena } = snapshot;
  if (player === null) {
    return { registered: false };
  }
  return {
    registered: true,
    level: player.level,
    xp: `${player.xp}/${player.xp_to_next_level}`,
    unassigned_points: player.unassigned_points,
    stats: {
      strength: scaled(player.effective_strength),
      dexterity: scaled(player.effective_dexterity),
      vitality: scaled(player.effective_vitality),
    },
    hp: `${scaled(player.current_hp)}/${scaled(player.max_hp)}`,
    can_fight: canFight(player),
    game_coins: scaled(player.game_coins),
    arena: arena === null ? null : { tier: arena.tier, rank: arena.rank, is_leader: arena.is_leader },
    challengeable_opponents: snapshot.opponents,
    creatures: snapshot.creatures.map((creature) => ({
      id: creature.id,
      name: creature.name,
      win_reward: { game_coins: scaled(creature.win.game_coins), xp: creature.win.xp },
    })),
    shop: snapshot.items.map((item) => ({
      item_id: item.item_id,
      slot: item.slot,
      price_game_coin: scaled(item.price_game_coin),
      bonus: {
        strength: scaled(item.strength_bonus),
        dexterity: scaled(item.dexterity_bonus),
        vitality: scaled(item.vitality_bonus),
      },
    })),
    inventory: snapshot.tokens,
  };
}
