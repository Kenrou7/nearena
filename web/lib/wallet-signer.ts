import type { Action, WalletSelector } from "@near-wallet-selector/core";
import { initNearWallet, type NearNetworkId } from "./near-wallet";
import { getWalletSession } from "./wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";

let selectorPromise: Promise<WalletSelector> | null = null;

function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = initNearWallet(NETWORK_ID, CONTRACT_ID).then((context) => context.selector);
    selectorPromise.catch(() => {
      selectorPromise = null;
    });
  }
  return selectorPromise;
}

/** Signs and sends one transaction against the game contract with the active NEAR session. */
export async function sendGameTransaction(actions: Action[]): Promise<void> {
  const session = getWalletSession();
  if (!session || session.chain !== "near") {
    throw new Error("A NEAR wallet session is required.");
  }

  const selector = await getSelector();
  const wallet = await selector.wallet();
  await wallet.signAndSendTransaction({
    signerId: session.accountId,
    receiverId: CONTRACT_ID,
    actions,
  });
}
