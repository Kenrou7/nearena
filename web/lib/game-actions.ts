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

export function buyItemAction(itemId: string, token: BuyToken): Action {
  return functionCall(token === "stable" ? "buy_item" : "buy_item_with_game_coin", { item_id: itemId });
}

export function consumeAction(tokenId: string): Action {
  return functionCall("consume", { token_id: tokenId });
}
