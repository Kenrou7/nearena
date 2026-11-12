"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateNearQueries } from "@/lib/near-query";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { BrowserWallet } from "@near-wallet-selector/core";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import {
  getWalletSession,
  setWalletSession,
  subscribeWalletSession,
  type WalletSession,
} from "@/lib/wallet-session";

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) ||
  "testnet";
const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:8787";
const SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() || "devnet";
const REGISTER_PLAYER_GAS = "100000000000000";
const SELECTOR_INIT_TIMEOUT_MS = 12000;

type SolanaCreatePlayerResponse = {
  contractAccountId: string;
  playerAccountId: string;
  alreadyRegistered: boolean;
  fundingTxHash: string | null;
  registerPlayerTxHash: string | null;
  proof: {
    solanaAddress: string;
    derivationPath: string;
    mpcDerivedPublicKey: string;
    implicitNearAccountId: string;
    txSigner: string;
    match: boolean;
  };
};

type PhantomAccountResponse = {
  publicKey: {
    toString: () => string;
  };
};

type PhantomProvider = {
  isPhantom?: boolean;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<PhantomAccountResponse>;
  disconnect: () => Promise<void>;
};

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { phantom?: { solana?: PhantomProvider } }).phantom?.solana;
  if (!candidate || !candidate.isPhantom) {
    return null;
  }

  return candidate;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Wallet selector init timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function compactAddress(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 3) {
    return value;
  }

  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [nearAccountId, setNearAccountId] = useState<string | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearStatus, setNearStatus] = useState("Ready to connect with Meteor Wallet.");
  const [showNearModal, setShowNearModal] = useState(false);
  const [solanaBusy, setSolanaBusy] = useState(false);
  const [solanaStatus, setSolanaStatus] = useState("Ready to connect with Phantom Wallet.");
  const [solanaResult, setSolanaResult] = useState<SolanaCreatePlayerResponse | null>(null);
  const [showPhantomModal, setShowPhantomModal] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);

  const solanaConnected = Boolean(solanaAddress);

  const nearLockedByOtherChain = Boolean(session && session.chain !== "near");
  const solanaLockedByOtherChain = Boolean(session && session.chain !== "solana");

  const canRegister = useMemo(
    () => Boolean(selector && nearAccountId && !nearBusy && !nearLockedByOtherChain),
    [selector, nearAccountId, nearBusy, nearLockedByOtherChain],
  );
  const canRegisterSolana = Boolean(solanaAddress && !solanaBusy && !solanaLockedByOtherChain);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      try {
        const nearWallet = await withTimeout(
          initNearWallet(NETWORK_ID, CONTRACT_ID),
          SELECTOR_INIT_TIMEOUT_MS,
        );
        if (!mounted) {
          return;
        }

        setSelector(nearWallet.selector);
        const activeNearAccount = getActiveAccountId(nearWallet.selector);
        setNearAccountId(activeNearAccount);
        if (activeNearAccount) {
          const current = getWalletSession();
          if (!current || current.chain === "near") {
            setWalletSession({
              chain: "near",
              accountId: activeNearAccount,
            });
          }
        }
        setNearStatus("Wallet selector ready (Meteor Wallet only).");

        const subscription = nearWallet.selector.store.observable.subscribe(() => {
          if (!mounted) {
            return;
          }

          const activeNearAccount = getActiveAccountId(nearWallet.selector);
          setNearAccountId(activeNearAccount);

          if (activeNearAccount) {
            const current = getWalletSession();
            if (!current || current.chain === "near") {
              setWalletSession({
                chain: "near",
                accountId: activeNearAccount,
              });
            }
            return;
          }

          const current = getWalletSession();
          if (current?.chain === "near") {
            setWalletSession(null);
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } catch (error) {
        if (!mounted) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setNearStatus(
          `Wallet selector not ready yet: ${message}. You can retry with Connect NEAR wallet.`,
        );
      }
    }

    void setup();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  async function ensureSelector(): Promise<WalletSelector> {
    if (selector) {
      return selector;
    }

    setNearStatus("Initializing wallet selector...");
    const nearWallet = await withTimeout(
      initNearWallet(NETWORK_ID, CONTRACT_ID),
      SELECTOR_INIT_TIMEOUT_MS,
    );

    setSelector(nearWallet.selector);
    setNearAccountId(getActiveAccountId(nearWallet.selector));
    return nearWallet.selector;
  }

  function connectNearWallet() {
    if (nearLockedByOtherChain) {
      setNearStatus("Disconnect Solana first. Only one wallet session can be active.");
      return;
    }

    setNearStatus("Open the selector and choose Meteor Wallet.");
    setShowNearModal(true);
  }

  async function connectMeteorFromModal() {
    try {
      setNearBusy(true);
      setNearStatus("Connecting to Meteor Wallet...");

      const currentSelector = await ensureSelector();
      const wallet = (await currentSelector.wallet("meteor-wallet")) as BrowserWallet;
      await wallet.signIn({
        contractId: CONTRACT_ID,
        methodNames: ["register_player"],
      });

      const activeNearAccount = getActiveAccountId(currentSelector);
      if (activeNearAccount) {
        const current = getWalletSession();
        if (!current || current.chain === "near") {
          setWalletSession({
            chain: "near",
            accountId: activeNearAccount,
          });
        }
      }

      setNearStatus("Meteor Wallet sign-in requested.");
      setShowNearModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNearStatus(`Meteor Wallet connect failed: ${message}`);
    } finally {
      setNearBusy(false);
    }
  }

  async function disconnectNearWallet() {
    try {
      setNearBusy(true);
      const currentSelector = await ensureSelector();
      const wallet = await currentSelector.wallet();
      await wallet.signOut();
      setNearStatus("Wallet disconnected.");
      setNearAccountId(null);
      const current = getWalletSession();
      if (current?.chain === "near") {
        setWalletSession(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNearStatus(`Disconnect failed: ${message}`);
    } finally {
      setNearBusy(false);
    }
  }

  async function registerNearPlayer() {
    if (!nearAccountId) {
      return;
    }

    try {
      setNearBusy(true);
      setNearStatus("Sending register_player transaction...");

      const currentSelector = await ensureSelector();
      const wallet = await currentSelector.wallet();
      const result = await wallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "register_player",
              args: {},
              gas: REGISTER_PLAYER_GAS,
              deposit: "0",
            },
          },
        ],
      });

      const txHash =
        result && "transaction" in result ? result.transaction.hash : "returned via wallet callback";
      setNearStatus(`register_player success. Tx hash: ${txHash}`);
      await invalidateNearQueries(queryClient);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNearStatus(`register_player failed: ${message}`);
    } finally {
      setNearBusy(false);
    }
  }

  function connectSolanaWallet() {
    if (solanaLockedByOtherChain) {
      setSolanaStatus("Disconnect NEAR first. Only one wallet session can be active.");
      return;
    }

    setSolanaStatus("Open the selector and choose Phantom Wallet.");
    setShowPhantomModal(true);
  }

  async function connectPhantomFromModal() {
    const provider = getPhantomProvider();
    if (!provider) {
      setSolanaStatus("Phantom wallet not found. Install Phantom extension first.");
      setShowPhantomModal(false);
      return;
    }

    try {
      setSolanaBusy(true);
      setSolanaStatus("Connecting to Phantom...");

      const connectedAccount = await provider.connect();
      const connectedAddress = connectedAccount.publicKey.toString();
      setSolanaAddress(connectedAddress);
      setWalletSession({
        chain: "solana",
        accountId: connectedAddress,
      });
      setSolanaStatus("Phantom connected.");
      setShowPhantomModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSolanaStatus(`Phantom connect failed: ${message}`);
    } finally {
      setSolanaBusy(false);
    }
  }

  async function disconnectSolanaWallet() {
    const provider = getPhantomProvider();
    if (!provider) {
      setSolanaAddress(null);
      setSolanaStatus("Phantom disconnected.");
      setSolanaResult(null);
      const current = getWalletSession();
      if (current?.chain === "solana") {
        setWalletSession(null);
      }
      return;
    }

    try {
      setSolanaBusy(true);
      await provider.disconnect();
      setSolanaAddress(null);
      setSolanaStatus("Phantom disconnected.");
      setSolanaResult(null);
      const current = getWalletSession();
      if (current?.chain === "solana") {
        setWalletSession(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSolanaStatus(`Phantom disconnect failed: ${message}`);
    } finally {
      setSolanaBusy(false);
    }
  }

  async function registerSolanaPlayer() {
    if (!solanaAddress) {
      return;
    }

    try {
      setSolanaBusy(true);
      setSolanaStatus("Registering Solana-derived player via backend...");
      setSolanaResult(null);

      const response = await fetch(`${BACKEND_BASE_URL}/v1/players/solana-derived`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ solanaAddress }),
      });

      const data = (await response.json()) as SolanaCreatePlayerResponse | { message?: string };
      if (!response.ok) {
        const message = "message" in data && data.message ? data.message : "backend request failed";
        throw new Error(message);
      }

      const parsed = data as SolanaCreatePlayerResponse;
      setSolanaResult(parsed);
      setWalletSession({
        chain: "solana",
        accountId: solanaAddress,
        playerAccountId: parsed.playerAccountId,
      });
      setSolanaStatus(
        `Solana player ready. match=${parsed.proof.match} account=${parsed.playerAccountId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSolanaStatus(`Solana register failed: ${message}`);
    } finally {
      setSolanaBusy(false);
    }
  }

  return (
    <main>
      <section className="panel app-shell">
        <header>
          <p className="eyebrow">Wallet Command</p>
          <h2>Connect and Register</h2>
          <p className="muted">NEAR with Meteor and Solana with Phantom. Register your player to start fighting.</p>
          <p className="muted">
            Active session: {session ? `${session.chain}:${compactAddress(session.accountId, 10)}` : "none"}
          </p>
        </header>

        <section className="wallet-hub">
          <article className="module">
            <h2>NEAR Rail (Meteor)</h2>
            <div className="status">
              <div>
                <strong>Network:</strong> {NETWORK_ID}
              </div>
              <div>
                <strong>Contract:</strong> <code>{CONTRACT_ID}</code>
              </div>
              <div>
                <strong>Account:</strong>{" "}
                {nearAccountId ? <code>{compactAddress(nearAccountId, 10)}</code> : <span>Not connected</span>}
              </div>
            </div>
            <div className="row">
              <button onClick={connectNearWallet} disabled={nearBusy || nearLockedByOtherChain}>
                Connect Meteor
              </button>
              <button onClick={disconnectNearWallet} disabled={!selector || !nearAccountId || nearBusy}>
                Disconnect
              </button>
              <button className="primary" onClick={registerNearPlayer} disabled={!canRegister}>
                Register Player
              </button>
            </div>
            {nearLockedByOtherChain ? (
              <div className="status">NEAR is locked: a Solana session is active.</div>
            ) : null}
            <div className="status">{nearStatus}</div>
          </article>

          <article className="module">
            <h2>Solana Rail (Phantom)</h2>
            <div className="status">
              <div>
                <strong>Network:</strong> {SOLANA_NETWORK}
              </div>
              <div>
                <strong>Backend:</strong> <code>{BACKEND_BASE_URL}</code>
              </div>
              <div>
                <strong>Wallet:</strong>{" "}
                {solanaConnected && solanaAddress ? <code>{compactAddress(solanaAddress, 8)}</code> : <span>Not connected</span>}
              </div>
            </div>

            <div className="row">
              <button onClick={connectSolanaWallet} disabled={solanaBusy || solanaLockedByOtherChain}>
                Connect Phantom
              </button>
              <button onClick={disconnectSolanaWallet} disabled={!solanaConnected || solanaBusy}>
                Disconnect
              </button>
              <button className="primary" onClick={registerSolanaPlayer} disabled={!canRegisterSolana}>
                Register via Solana
              </button>
            </div>

            {solanaLockedByOtherChain ? (
              <div className="status">Solana is locked: a NEAR session is active.</div>
            ) : null}

            <div className="status">{solanaStatus}</div>

            {solanaResult ? (
              <div className="status">
                <strong>Derivation Proof</strong>
                <div className="proof-grid">
                  <span>Player Account</span>
                  <code>{compactAddress(solanaResult.playerAccountId, 12)}</code>
                  <span>Derivation Match</span>
                  <span className={solanaResult.proof.match ? "chip chip-good" : "chip chip-bad"}>
                    {solanaResult.proof.match ? "Verified" : "Mismatch"}
                  </span>
                  <span>Funding Tx</span>
                  <code>{solanaResult.fundingTxHash ? compactAddress(solanaResult.fundingTxHash) : "n/a"}</code>
                  <span>Register Tx</span>
                  <code>
                    {solanaResult.registerPlayerTxHash
                      ? compactAddress(solanaResult.registerPlayerTxHash)
                      : "already registered"}
                  </code>
                </div>
              </div>
            ) : null}
          </article>
        </section>

        {showPhantomModal ? (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Select Solana wallet">
            <div className="modal-card">
              <strong>Select Solana Wallet</strong>
              <p>This environment is configured to show Phantom only.</p>
              <button className="primary" onClick={connectPhantomFromModal} disabled={solanaBusy}>
                Phantom Wallet
              </button>
              <button onClick={() => setShowPhantomModal(false)} disabled={solanaBusy}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {showNearModal ? (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Select Near wallet">
            <div className="modal-card">
              <strong>Select NEAR Wallet</strong>
              <p>This environment is configured to show Meteor only.</p>
              <button className="primary" onClick={connectMeteorFromModal} disabled={nearBusy}>
                Meteor Wallet
              </button>
              <button onClick={() => setShowNearModal(false)} disabled={nearBusy}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
