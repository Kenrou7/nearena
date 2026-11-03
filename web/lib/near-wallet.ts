import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import type { WalletSelector } from "@near-wallet-selector/core";

export type NearNetworkId = "testnet" | "mainnet";

export type NearWalletContext = {
  selector: WalletSelector;
};

export async function initNearWallet(
  networkId: NearNetworkId,
  _contractId: string,
): Promise<NearWalletContext> {
  const selector = await setupWalletSelector({
    network: networkId,
    modules: [setupMeteorWallet()],
  });

  return { selector };
}

export function getActiveAccountId(selector: WalletSelector): string | null {
  const state = selector.store.getState();
  const active = state.accounts.find((account) => account.active);
  return active?.accountId ?? null;
}
