export type ItemPresentation = {
  itemId: string;
  title: string;
  description: string;
  imageSrc: string;
  role: "offense" | "defense" | "utility";
};

const ITEM_PRESENTATION_LIST: ItemPresentation[] = [
  {
    itemId: "nft_axe",
    title: "NFT Axe",
    description: "Heavy weapon for burst damage and strength scaling.",
    imageSrc: "/assets/items/nft_axe.svg",
    role: "offense",
  },
  {
    itemId: "basic_sword",
    title: "Basic Sword",
    description: "Starter weapon for stable progression.",
    imageSrc: "/assets/items/basic_sword.svg",
    role: "offense",
  },
  {
    itemId: "basic_shield",
    title: "Basic Shield",
    description: "Defensive shield with vitality and dexterity bonuses.",
    imageSrc: "/assets/items/basic_shield.svg",
    role: "defense",
  },
  {
    itemId: "iron_armor",
    title: "Iron Armor",
    description: "Body armor that boosts vitality and durability.",
    imageSrc: "/assets/items/iron_armor.svg",
    role: "defense",
  },
  {
    itemId: "potion_small",
    title: "Small Potion",
    description: "Consumable potion that restores a small amount of HP.",
    imageSrc: "/assets/items/potion_small.svg",
    role: "utility",
  },
  {
    itemId: "potion_medium",
    title: "Medium Potion",
    description: "Consumable potion with moderate HP restoration.",
    imageSrc: "/assets/items/potion_medium.svg",
    role: "utility",
  },
  {
    itemId: "potion_large",
    title: "Large Potion",
    description: "Consumable potion with high HP restoration.",
    imageSrc: "/assets/items/potion_large.svg",
    role: "utility",
  },
];

const ITEM_PRESENTATION_BY_ID = new Map<string, ItemPresentation>(
  ITEM_PRESENTATION_LIST.map((item) => [item.itemId, item]),
);

function humanizeItemId(itemId: string): string {
  return itemId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getItemPresentation(itemId: string): ItemPresentation {
  const known = ITEM_PRESENTATION_BY_ID.get(itemId);
  if (known) {
    return known;
  }

  return {
    itemId,
    title: humanizeItemId(itemId),
    description: "Uncatalogued item discovered in your inventory.",
    imageSrc: "/assets/items/basic_sword.svg",
    role: "utility",
  };
}

export function getItemDisplayName(itemId: string): string {
  return getItemPresentation(itemId).title;
}

export const SHOP_ITEM_IDS = ITEM_PRESENTATION_LIST.map((item) => item.itemId);
