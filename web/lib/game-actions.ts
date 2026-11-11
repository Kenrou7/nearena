import type { Action } from "@near-wallet-selector/core";
import type { ContractInventoryAction } from "./action-queue";

export type BuyToken = "stable" | "game";

/** Max gas per transaction; unused gas is refunded. Batches hold up to 20 units/actions. */
export const CHECKOUT_GAS = "300000000000000";

export type PurchaseLineArgs = {
  item_id: string;
  quantity: number;
  currency: "Stablecoin" | "GameCoin";
};

export function buyItemsAction(lines: ReadonlyArray<{ itemId: string; currency: BuyToken; quantity: number }>): Action {
  const contractLines: PurchaseLineArgs[] = lines.map((line) => ({
    item_id: line.itemId,
    quantity: line.quantity,
    currency: line.currency === "stable" ? "Stablecoin" : "GameCoin",
  }));

  return {
    type: "FunctionCall",
    params: {
      methodName: "buy_items",
      args: { lines: contractLines },
      gas: CHECKOUT_GAS,
      deposit: "0",
    },
  };
}

export function inventoryActionsAction(actions: readonly ContractInventoryAction[]): Action {
  return {
    type: "FunctionCall",
    params: {
      methodName: "apply_inventory_actions",
      args: { actions },
      gas: CHECKOUT_GAS,
      deposit: "0",
    },
  };
}
