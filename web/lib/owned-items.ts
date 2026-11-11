/**
 * The contract pushes one `owned_item_ids` entry per owned unit, so the same
 * item id can appear several times. Returns counts in first-seen order.
 */
export function countOwnedItems(ownedItemIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const itemId of ownedItemIds) {
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}
