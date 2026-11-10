import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import type { WalletSelector } from "@near-wallet-selector/core";
import { resolveNearRpcProxyPath } from "./runtime-config";

export type NearNetworkId = "testnet" | "mainnet";

export type NearWalletContext = {
  selector: WalletSelector;
};

function resolveNearRpcProxyUrl(): string {
  const value = resolveNearRpcProxyPath();

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (typeof window !== "undefined") {
    return new URL(value, window.location.origin).toString();
  }

  return value;
}

function resolveNetworkConfig(networkId: NearNetworkId, nodeUrl: string) {
  if (networkId === "mainnet") {
    return {
      networkId,
      nodeUrl,
      helperUrl: "https://helper.mainnet.near.org",
      explorerUrl: "https://nearblocks.io",
      indexerUrl: "https://api.kitwallet.app",
    };
  }

  return {
    networkId,
    nodeUrl,
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: "https://testnet.nearblocks.io",
    indexerUrl: "https://testnet-api.kitwallet.app",
  };
}

export async function initNearWallet(
  networkId: NearNetworkId,
  _contractId: string,
): Promise<NearWalletContext> {
  const rpcProxyUrl = resolveNearRpcProxyUrl();
  const network = resolveNetworkConfig(networkId, rpcProxyUrl);
  const selector = await setupWalletSelector({
    network,
    fallbackRpcUrls: [rpcProxyUrl],
    modules: [setupMeteorWallet()],
  });

  return { selector };
}

export function getActiveAccountId(selector: WalletSelector): string | null {
  const state = selector.store.getState();
  const active = state.accounts.find((account) => account.active);
  return active?.accountId ?? null;
}
