"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import type { BrowserWallet, WalletSelector } from "@near-wallet-selector/core";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, setWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

type NetworkChoice = "near" | "solana" | null;

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

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const SELECTOR_INIT_TIMEOUT_MS = 12000;

function compactAddress(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 3) {
    return value;
  }

  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
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

export function ConnectWalletMenu() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [open, setOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [networkChoice, setNetworkChoice] = useState<NetworkChoice>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Pick a network to continue.");
  const [copyTooltip, setCopyTooltip] = useState("Copy");
  const [portalReady, setPortalReady] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current) {
        return;
      }

      if (!accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!selector) {
      return;
    }

    const subscription = selector.store.observable.subscribe(() => {
      const active = getActiveAccountId(selector);
      if (active) {
        const current = getWalletSession();
        if (!current || current.chain === "near") {
          setWalletSession({ chain: "near", accountId: active });
        }
      } else {
        const current = getWalletSession();
        if (current?.chain === "near") {
          setWalletSession(null);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [selector]);

  const isLockedByOtherChain = useMemo(
    () => ({
      near: Boolean(session && session.chain !== "near"),
      solana: Boolean(session && session.chain !== "solana"),
    }),
    [session],
  );

  async function ensureNearSelector(): Promise<WalletSelector> {
    if (selector) {
      return selector;
    }

    const nearWallet = await withTimeout(
      initNearWallet(NETWORK_ID, CONTRACT_ID),
      SELECTOR_INIT_TIMEOUT_MS,
    );
    setSelector(nearWallet.selector);
    return nearWallet.selector;
  }

  function openMenu() {
    setOpen(true);
    setNetworkChoice(null);
    setStatus("Pick a network to continue.");
  }

  function closeMenu() {
    setOpen(false);
    setBusy(false);
    setNetworkChoice(null);
    setStatus("Pick a network to continue.");
  }

  async function connectNear() {
    if (isLockedByOtherChain.near) {
      setStatus("Disconnect Solana first. Only one wallet session can be active.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Connecting to Meteor Wallet...");

      const currentSelector = await ensureNearSelector();
      const wallet = (await currentSelector.wallet("meteor-wallet")) as BrowserWallet;
      await wallet.signIn({
        contractId: CONTRACT_ID,
        methodNames: ["register_player"],
      });

      const activeNearAccount = getActiveAccountId(currentSelector);
      if (activeNearAccount) {
        setWalletSession({ chain: "near", accountId: activeNearAccount });
      }

      setStatus("Meteor sign-in requested.");
      closeMenu();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Near connect failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function connectSolana() {
    if (isLockedByOtherChain.solana) {
      setStatus("Disconnect NEAR first. Only one wallet session can be active.");
      return;
    }

    const provider = getPhantomProvider();
    if (!provider) {
      setStatus("Phantom wallet not found. Install Phantom extension first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Connecting to Phantom...");
      const connected = await provider.connect();
      const address = connected.publicKey.toString();
      setWalletSession({ chain: "solana", accountId: address });
      setStatus("Phantom connected.");
      closeMenu();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Solana connect failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnectActiveSession() {
    if (!session) {
      return;
    }

    try {
      setBusy(true);
      setStatus("Disconnecting active wallet...");

      if (session.chain === "near") {
        const currentSelector = await ensureNearSelector();
        const wallet = await currentSelector.wallet();
        await wallet.signOut();
      }

      if (session.chain === "solana") {
        const provider = getPhantomProvider();
        if (provider) {
          await provider.disconnect();
        }
      }

      setWalletSession(null);
      setAccountMenuOpen(false);
      setStatus("Wallet disconnected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Disconnect failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyAccountId() {
    if (!session) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyTooltip("Unavailable");
      window.setTimeout(() => {
        setCopyTooltip("Copy");
      }, 1500);
      return;
    }

    try {
      await navigator.clipboard.writeText(session.accountId);
      setCopyTooltip("Copied");
      window.setTimeout(() => {
        setCopyTooltip("Copy");
      }, 1800);
    } catch {
      setCopyTooltip("Failed");
      window.setTimeout(() => {
        setCopyTooltip("Copy");
      }, 1800);
    }
  }

  return (
    <>
      {session ? (
        <div className="nav-account" ref={accountMenuRef}>
          <button
            className="nav-account-btn"
            onClick={() => setAccountMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            {compactAddress(session.accountId, 6)}
          </button>

          {accountMenuOpen ? (
            <div className="nav-account-menu" role="menu">
              <div className="nav-account-header">
                <strong>{session.accountId}</strong>
                <div className="nav-account-actions">
                  <button
                    type="button"
                    className="copy-icon-btn"
                    onClick={copyAccountId}
                    aria-label="Copy account id"
                    title={copyTooltip}
                    data-tooltip={copyTooltip}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M8 8h10v12H8z" />
                      <path d="M6 4h10v2H8v10H6z" />
                    </svg>
                  </button>
                  <span className="chip">{session.chain.toUpperCase()}</span>
                </div>
              </div>
              <button role="menuitem" onClick={disconnectActiveSession} disabled={busy}>
                {busy ? "Disconnecting..." : "Disconnect wallet"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button className="nav-connect-btn" onClick={openMenu}>
          Connect wallet
        </button>
      )}

      {open && portalReady
        ? createPortal(
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Connect wallet"
              onClick={closeMenu}
            >
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <strong>Connect wallet</strong>
                <p className="muted">
                  {session
                    ? `Active session: ${session.chain}:${compactAddress(session.accountId, 10)}`
                    : "No active wallet session."}
                </p>

                {networkChoice === null ? (
                  <>
                    <p>Step 1: Choose network</p>
                    <div className="row">
                      <button
                        className="primary"
                        onClick={() => setNetworkChoice("near")}
                        disabled={busy || isLockedByOtherChain.near}
                      >
                        <Image
                          src="/assets/wallets/near.svg"
                          alt="NEAR"
                          className="wallet-logo"
                          width={16}
                          height={16}
                        />
                        NEAR
                      </button>
                      <button
                        className="primary"
                        onClick={() => setNetworkChoice("solana")}
                        disabled={busy || isLockedByOtherChain.solana}
                      >
                        <Image
                          src="/assets/wallets/solana.svg"
                          alt="Solana"
                          className="wallet-logo"
                          width={16}
                          height={16}
                        />
                        Solana
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>Step 2: Choose wallet</p>
                    {networkChoice === "near" ? (
                      <button className="primary" onClick={connectNear} disabled={busy}>
                        <Image
                          src="/assets/wallets/near.svg"
                          alt="NEAR"
                          className="wallet-logo"
                          width={16}
                          height={16}
                        />
                        Meteor Wallet
                      </button>
                    ) : (
                      <button className="primary" onClick={connectSolana} disabled={busy}>
                        <Image
                          src="/assets/wallets/solana.svg"
                          alt="Solana"
                          className="wallet-logo"
                          width={16}
                          height={16}
                        />
                        Phantom Wallet
                      </button>
                    )}
                    <button onClick={() => setNetworkChoice(null)} disabled={busy}>
                      Back
                    </button>
                  </>
                )}

                <div className="status">{status}</div>

                <div className="row">
                  <button onClick={closeMenu} disabled={busy}>
                    Close
                  </button>
                  <button onClick={disconnectActiveSession} disabled={busy || !session}>
                    Disconnect active wallet
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
