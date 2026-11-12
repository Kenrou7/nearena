"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { nearQueryOptions } from "@/lib/near-query";
import { resolveSolanaPlayerAccount } from "@/lib/solana-player";
import {
  getPlayerAccountId,
  getWalletSession,
  setWalletSession,
  subscribeWalletSession,
  type WalletSession,
} from "@/lib/wallet-session";
import { ConnectWalletMenu } from "@/components/connect-wallet-menu";
import { CurrencyIcon, formatCurrency } from "@/components/currency-amount";
import { TEXTS } from "@/lib/texts";

const BALANCE_REFRESH_INTERVAL_MS = 30_000;

const NAV_ITEMS = [
  { href: "/gladiator", label: "Gladiator" },
  { href: "/inventory", label: "Inventory" },
  { href: "/shop", label: "Shop" },
  { href: "/arena", label: "Arena" },
  { href: "/expeditions", label: TEXTS.nav.expeditions },
  { href: "/ranking", label: "Ranking" },
];

export function AppNav() {
  const pathname = usePathname();
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => {
      setSession(getWalletSession());
    });
  }, []);

  const nearAccountId = getPlayerAccountId(session);
  const [solanaSetup, setSolanaSetup] = useState<"idle" | "resolving" | "failed">("idle");

  // Solana sessions play through a NEAR account derived via chain signatures. Resolve it (and
  // register it on first use) as soon as Phantom connects, so every page can read the player.
  useEffect(() => {
    if (session?.chain !== "solana" || session.playerAccountId) {
      setSolanaSetup("idle");
      return;
    }

    let cancelled = false;
    const solanaAddress = session.accountId;
    setSolanaSetup("resolving");
    resolveSolanaPlayerAccount(solanaAddress)
      .then((playerAccountId) => {
        const current = getWalletSession();
        if (!cancelled && current?.chain === "solana" && current.accountId === solanaAddress) {
          setWalletSession({ ...current, playerAccountId });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSolanaSetup("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  // Subscribes to the shared player query: any page that fetches or invalidates
  // player data (purchases, faucet, combat, consume, register...) updates the navbar too.
  // The interval covers changes made outside this tab (e.g. being robbed in the arena, deposits).
  const playerQuery = useQuery({
    ...nearQueryOptions.player(nearAccountId ?? ""),
    enabled: nearAccountId !== null,
    refetchInterval: BALANCE_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const player = nearAccountId ? playerQuery.data : undefined;
  const balancesLoading = nearAccountId !== null && playerQuery.isPending;
  const isRegisteredNearPlayer: boolean | null =
    player === undefined ? null : player !== null;
  const gameCoinBalance = player ? formatCurrency(player.game_coins, "GC") : "-";
  const stablecoinBalance = player ? formatCurrency(player.stablecoin_balance, "SC") : "-";

  const visibleItems = useMemo(() => {
    if (!session) {
      return NAV_ITEMS.filter((item) => item.href === "/ranking");
    }

    if (session.chain === "near" && isRegisteredNearPlayer === false) {
      return NAV_ITEMS.filter((item) => ["/gladiator", "/ranking"].includes(item.href));
    }

    if (session) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter((item) => item.href === "/ranking");
  }, [isRegisteredNearPlayer, session]);

  return (
    <>
      <nav className="app-nav" aria-label="Main navigation">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${isActive ? "nav-link-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="nav-cluster">
        {session?.chain === "near" && isRegisteredNearPlayer === false ? (
          <Link href="/wallet" className="nav-link nav-link-active">
            Register Player
          </Link>
        ) : null}
        {session?.chain === "solana" && solanaSetup !== "idle" ? (
          <span className="nav-setup-status" role="status">
            {solanaSetup === "resolving" ? "Setting up your Solana player…" : "Could not set up your Solana player"}
          </span>
        ) : null}
        {nearAccountId && isRegisteredNearPlayer !== false ? (
          <div className="nav-balance-strip" aria-live="polite">
            <span className="nav-balance-item">
              <CurrencyIcon currency="GC" size={18} />
              <strong>{balancesLoading ? "..." : gameCoinBalance}</strong>
            </span>
            <span className="nav-balance-divider" aria-hidden="true">|</span>
            <span className="nav-balance-item">
              <CurrencyIcon currency="SC" size={18} />
              <strong>{balancesLoading ? "..." : stablecoinBalance}</strong>
            </span>
          </div>
        ) : null}
        <ConnectWalletMenu />
      </div>
    </>
  );
}
