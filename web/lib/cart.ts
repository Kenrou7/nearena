import type { BuyToken } from "./game-actions";

/** Mirrors `MAX_ITEMS_PER_PURCHASE` in the game contract. */
export const MAX_CART_UNITS = 20;

export type CartLine = {
  itemId: string;
  currency: BuyToken;
  quantity: number;
};

function sameLine(a: Pick<CartLine, "itemId" | "currency">, b: Pick<CartLine, "itemId" | "currency">): boolean {
  return a.itemId === b.itemId && a.currency === b.currency;
}

export function cartUnits(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

/** Sets a line's quantity (removing it at 0), clamped so the cart never exceeds MAX_CART_UNITS. */
export function setLineQuantity(
  lines: readonly CartLine[],
  target: Pick<CartLine, "itemId" | "currency">,
  quantity: number,
): CartLine[] {
  const others = lines.filter((line) => !sameLine(line, target));
  const room = MAX_CART_UNITS - cartUnits(others);
  const clamped = Math.max(0, Math.min(Math.trunc(quantity), room));

  if (clamped === 0) {
    return others;
  }

  const index = lines.findIndex((line) => sameLine(line, target));
  const next: CartLine = { itemId: target.itemId, currency: target.currency, quantity: clamped };
  if (index === -1) {
    return [...lines, next];
  }

  return lines.map((line, lineIndex) => (lineIndex === index ? next : line));
}

export function addToCart(lines: readonly CartLine[], itemId: string, currency: BuyToken, quantity = 1): CartLine[] {
  const existing = lines.find((line) => sameLine(line, { itemId, currency }));
  return setLineQuantity(lines, { itemId, currency }, (existing?.quantity ?? 0) + quantity);
}

/** Moves a line to the other currency, merging with an existing line for that currency. */
export function switchLineCurrency(lines: readonly CartLine[], target: Pick<CartLine, "itemId" | "currency">): CartLine[] {
  const line = lines.find((entry) => sameLine(entry, target));
  if (!line) {
    return [...lines];
  }

  const otherCurrency: BuyToken = line.currency === "stable" ? "game" : "stable";
  const without = lines.filter((entry) => !sameLine(entry, target));
  return addToCart(without, line.itemId, otherCurrency, line.quantity);
}

export function quantityInCart(lines: readonly CartLine[], itemId: string, currency: BuyToken): number {
  return lines.find((line) => sameLine(line, { itemId, currency }))?.quantity ?? 0;
}

export function cartTotals(
  lines: readonly CartLine[],
  priceOf: (itemId: string, currency: BuyToken) => bigint | null,
): Record<BuyToken, bigint> | null {
  const totals: Record<BuyToken, bigint> = { stable: 0n, game: 0n };
  for (const line of lines) {
    const price = priceOf(line.itemId, line.currency);
    if (price === null) {
      return null;
    }
    totals[line.currency] += price * BigInt(line.quantity);
  }
  return totals;
}

export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    let lines: CartLine[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const { itemId, currency, quantity } = entry as Record<string, unknown>;
      if (
        typeof itemId === "string" &&
        (currency === "stable" || currency === "game") &&
        typeof quantity === "number" &&
        quantity > 0
      ) {
        lines = addToCart(lines, itemId, currency, quantity);
      }
    }
    return lines;
  } catch {
    return [];
  }
}
