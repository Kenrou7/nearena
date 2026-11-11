import type { Action } from "@near-wallet-selector/core";

export const GAME_CALL_GAS = "100000000000000";

export type BuyToken = "stable" | "game";

function functionCall(methodName: string, args: Record<string, string>): Action {
  return {
    type: "FunctionCall",
    params: {
      methodName,
      args,
      gas: GAME_CALL_GAS,
      deposit: "0",
    },
  };
}

export function consumeAction(tokenId: string): Action {
  return functionCall("consume", { token_id: tokenId });
}

/** Max gas per transaction; unused gas is refunded. A full cart mints up to 20 tokens. */
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
