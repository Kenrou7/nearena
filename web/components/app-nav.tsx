"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatScaledInt } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";
import { ConnectWalletMenu } from "@/components/connect-wallet-menu";

const BALANCE_REFRESH_INTERVAL_MS = 30_000;

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/gladiator", label: "Gladiator" },
  { href: "/inventory", label: "Inventory" },
  { href: "/shop", label: "Shop" },
  { href: "/arena", label: "Arena" },
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

  const nearAccountId = session?.chain === "near" ? session.accountId : null;

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
  const gameCoinBalance = player ? formatScaledInt(player.game_coins) : "-";
  const stablecoinBalance = player ? formatScaledInt(player.stablecoin_balance) : "-";

  const visibleItems = useMemo(() => {
    if (!session) {
      return NAV_ITEMS.filter((item) => ["/", "/ranking"].includes(item.href));
    }

    if (session.chain === "near" && isRegisteredNearPlayer === false) {
      return NAV_ITEMS.filter((item) => ["/", "/gladiator", "/ranking"].includes(item.href));
    }

    if (session) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter((item) => ["/", "/ranking"].includes(item.href));
  }, [isRegisteredNearPlayer, session]);

  return (
    <nav className="app-nav" aria-label="Main navigation">
      {session?.chain === "near" ? (
        <div className="nav-balance-strip" aria-live="polite">
          <span className="nav-balance-item">
            <span className="token-mark token-mark-game" aria-hidden="true">
              GC
            </span>
            <strong>{balancesLoading ? "..." : gameCoinBalance}</strong>
          </span>
          <span className="nav-balance-divider">|</span>
          <span className="nav-balance-item">
            <span className="token-mark token-mark-stable" aria-hidden="true">
              SC
            </span>
            <strong>{balancesLoading ? "..." : stablecoinBalance}</strong>
          </span>
          {isRegisteredNearPlayer === false ? (
            <Link href="/wallet" className="nav-link nav-link-active">
              Register Player
            </Link>
          ) : null}
        </div>
      ) : null}

      {visibleItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${isActive ? "nav-link-active" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
      <ConnectWalletMenu />
    </nav>
  );
}
