/** Mirrors `MAX_INVENTORY_ACTIONS` in the game contract. */
export const MAX_QUEUED_ACTIONS = 20;

export type EquipSlot = "Weapon" | "Shield" | "Helmet" | "Armor";

export type QueuedAction =
  | { kind: "equip"; tokenId: string; itemId: string; slot: EquipSlot }
  | { kind: "unequip"; slot: EquipSlot }
  | { kind: "consume"; tokenId: string; itemId: string };

export type ContractInventoryAction =
  | { type: "Equip"; token_id: string }
  | { type: "Unequip"; slot: EquipSlot }
  | { type: "Consume"; token_id: string };

function touchesSlot(action: QueuedAction, slot: EquipSlot): boolean {
  return action.kind !== "consume" && action.slot === slot;
}

/** Queues an equip; any pending equip/unequip for the same slot is replaced. */
export function queueEquip(
  actions: readonly QueuedAction[],
  next: { tokenId: string; itemId: string; slot: EquipSlot },
): QueuedAction[] {
  const others = actions.filter((action) => !touchesSlot(action, next.slot));
  if (others.length >= MAX_QUEUED_ACTIONS) {
    return [...actions];
  }
  return [...others, { kind: "equip", ...next }];
}

/** Queues an unequip; any pending equip/unequip for the same slot is replaced. */
export function queueUnequip(actions: readonly QueuedAction[], slot: EquipSlot): QueuedAction[] {
  const others = actions.filter((action) => !touchesSlot(action, slot));
  if (others.length >= MAX_QUEUED_ACTIONS) {
    return [...actions];
  }
  return [...others, { kind: "unequip", slot }];
}

/** Queues consuming one token; a token can only be queued once. */
export function queueConsume(
  actions: readonly QueuedAction[],
  next: { tokenId: string; itemId: string },
): QueuedAction[] {
  const alreadyQueued = actions.some((action) => action.kind === "consume" && action.tokenId === next.tokenId);
  if (alreadyQueued || actions.length >= MAX_QUEUED_ACTIONS) {
    return [...actions];
  }
  return [...actions, { kind: "consume", ...next }];
}

export function removeSlotChange(actions: readonly QueuedAction[], slot: EquipSlot): QueuedAction[] {
  return actions.filter((action) => !touchesSlot(action, slot));
}

/** Removes the most recently queued consume of `itemId`. */
export function removeOneConsume(actions: readonly QueuedAction[], itemId: string): QueuedAction[] {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action.kind === "consume" && action.itemId === itemId) {
      return [...actions.slice(0, index), ...actions.slice(index + 1)];
    }
  }
  return [...actions];
}

export function queuedConsumeTokenIds(actions: readonly QueuedAction[]): Set<string> {
  return new Set(actions.flatMap((action) => (action.kind === "consume" ? [action.tokenId] : [])));
}

export function pendingSlotChange(actions: readonly QueuedAction[], slot: EquipSlot): QueuedAction | undefined {
  return actions.find((action) => touchesSlot(action, slot));
}

/**
 * Gear changes go first so potions heal up to the post-equip HP cap,
 * then consumes in the order they were queued.
 */
export function toContractActions(actions: readonly QueuedAction[]): ContractInventoryAction[] {
  const slotChanges = actions.filter((action) => action.kind !== "consume");
  const consumes = actions.filter((action) => action.kind === "consume");

  return [...slotChanges, ...consumes].map((action): ContractInventoryAction => {
    if (action.kind === "equip") {
      return { type: "Equip", token_id: action.tokenId };
    }
    if (action.kind === "unequip") {
      return { type: "Unequip", slot: action.slot };
    }
    return { type: "Consume", token_id: action.tokenId };
  });
}
