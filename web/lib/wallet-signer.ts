import type { Action, WalletSelector } from "@near-wallet-selector/core";
import { initNearWallet, type NearNetworkId } from "./near-wallet";
import { getPhantomProvider } from "./phantom";
import { getPlayerAccountId, getWalletSession, type WalletSession } from "./wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:8787";

/** Must match `SOLANA_ACTION_MESSAGE_HEADER` in backend/src/solana-action-relay.ts. */
const SOLANA_ACTION_MESSAGE_HEADER = "NEARena action";

export type GameTransactionResult = {
  /** NEAR account that signed (the wallet, or the Solana player's derived account). */
  signerId: string;
  txHash: string | null;
  /** Raw wallet response for NEAR sessions (null for Solana relays). */
  outcome: unknown;
};

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

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    encoded = `1${encoded}`;
  }
  return encoded;
}

async function sendViaNearWallet(session: WalletSession, actions: Action[]): Promise<GameTransactionResult> {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    signerId: session.accountId,
    receiverId: CONTRACT_ID,
    actions,
  });

  return { signerId: session.accountId, txHash: null, outcome };
}

/**
 * Solana players can't sign NEAR transactions: Phantom signs an action message proving
 * ownership of the address, and the backend signs the NEAR call via chain signatures.
 */
async function sendViaSolanaRelay(session: WalletSession, actions: Action[]): Promise<GameTransactionResult> {
  const signerId = getPlayerAccountId(session);
  if (!signerId) {
    throw new Error("Your Solana player is still being set up. Try again in a few seconds.");
  }

  const provider = getPhantomProvider();
  if (!provider) {
    throw new Error("Phantom wallet not found.");
  }
  const connected = provider.publicKey ?? (await provider.connect({ onlyIfTrusted: true })).publicKey;
  if (connected.toString() !== session.accountId) {
    throw new Error("Phantom is connected to a different address than this session. Reconnect your wallet.");
  }

  let txHash: string | null = null;
  for (const action of actions) {
    if (action.type !== "FunctionCall") {
      throw new Error(`Unsupported action type for Solana players: ${action.type}`);
    }

    const payload = {
      v: 1,
      contract: CONTRACT_ID,
      method: action.params.methodName,
      args: action.params.args,
      nonce: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
    };
    const message = `${SOLANA_ACTION_MESSAGE_HEADER}\n${JSON.stringify(payload)}`;
    const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");

    const response = await fetch(`${BACKEND_BASE_URL}/v1/solana/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ solanaAddress: session.accountId, message, signature: encodeBase58(signature) }),
    });
    const data = (await response.json()) as { txHash?: string; message?: string };
    if (!response.ok || typeof data.txHash !== "string") {
      throw new Error(data.message ?? `Relayed ${payload.method} failed (${response.status})`);
    }
    txHash = data.txHash;
  }

  return { signerId, txHash, outcome: null };
}

/** Signs and sends one game transaction with whatever wallet the session uses. */
export async function sendGameTransaction(actions: Action[]): Promise<GameTransactionResult> {
  const session = getWalletSession();
  if (!session) {
    throw new Error("Connect a wallet first.");
  }

  return session.chain === "near" ? sendViaNearWallet(session, actions) : sendViaSolanaRelay(session, actions);
}
