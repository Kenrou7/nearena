"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  queueConsume,
  queueEquip,
  queueUnequip,
  removeOneConsume,
  removeSlotChange,
  toContractActions,
  type EquipSlot,
  type QueuedAction,
} from "@/lib/action-queue";
import { inventoryActionsAction } from "@/lib/game-actions";
import { invalidateNearQueries } from "@/lib/near-query";
import { sendGameTransaction } from "@/lib/wallet-signer";
import { getPlayerAccountId, getWalletSession, subscribeWalletSession } from "@/lib/wallet-session";

type ActionQueueContextValue = {
  actions: QueuedAction[];
  equip: (tokenId: string, itemId: string, slot: EquipSlot) => void;
  unequip: (slot: EquipSlot) => void;
  consume: (tokenId: string, itemId: string) => void;
  cancelSlotChange: (slot: EquipSlot) => void;
  cancelOneConsume: (itemId: string) => void;
  clear: () => void;
  applying: boolean;
  apply: () => Promise<void>;
  /** Increments after every successful apply so pages can refresh their own data. */
  appliedVersion: number;
};

const ActionQueueContext = createContext<ActionQueueContextValue | null>(null);

/**
 * Pending equip/unequip/consume actions, applied together with one signature.
 * Kept in memory only: token ids go stale quickly, so nothing is persisted.
 */
export function ActionQueueProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [actions, setActions] = useState<QueuedAction[]>([]);
  const [applying, setApplying] = useState(false);
  const [appliedVersion, setAppliedVersion] = useState(0);

  // Queued token ids belong to one account; drop them when the session changes.
  useEffect(() => subscribeWalletSession(() => setActions([])), []);

  const equip = useCallback((tokenId: string, itemId: string, slot: EquipSlot) => {
    setActions((current) => queueEquip(current, { tokenId, itemId, slot }));
  }, []);
  const unequip = useCallback((slot: EquipSlot) => {
    setActions((current) => queueUnequip(current, slot));
  }, []);
  const consume = useCallback((tokenId: string, itemId: string) => {
    setActions((current) => queueConsume(current, { tokenId, itemId }));
  }, []);
  const cancelSlotChange = useCallback((slot: EquipSlot) => {
    setActions((current) => removeSlotChange(current, slot));
  }, []);
  const cancelOneConsume = useCallback((itemId: string) => {
    setActions((current) => removeOneConsume(current, itemId));
  }, []);
  const clear = useCallback(() => setActions([]), []);

  const apply = useCallback(async () => {
    if (actions.length === 0) {
      throw new Error("There are no pending actions.");
    }
    if (!getPlayerAccountId(getWalletSession())) {
      throw new Error("Connect a wallet with a registered player first.");
    }

    setApplying(true);
    try {
      await sendGameTransaction([inventoryActionsAction(toContractActions(actions))]);
      setActions([]);
      await invalidateNearQueries(queryClient);
      setAppliedVersion((version) => version + 1);
    } finally {
      setApplying(false);
    }
  }, [actions, queryClient]);

  const value = useMemo<ActionQueueContextValue>(
    () => ({
      actions,
      equip,
      unequip,
      consume,
      cancelSlotChange,
      cancelOneConsume,
      clear,
      applying,
      apply,
      appliedVersion,
    }),
    [actions, apply, applying, appliedVersion, cancelOneConsume, cancelSlotChange, clear, consume, equip, unequip],
  );

  return <ActionQueueContext.Provider value={value}>{children}</ActionQueueContext.Provider>;
}

export function useActionQueue(): ActionQueueContextValue {
  const context = useContext(ActionQueueContext);
  if (!context) {
    throw new Error("useActionQueue must be used inside <ActionQueueProvider>.");
  }
  return context;
}
