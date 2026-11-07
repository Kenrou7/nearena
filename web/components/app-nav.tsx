"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatScaledInt } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";
import { ConnectWalletMenu } from "@/components/connect-wallet-menu";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/gladiator", label: "Gladiator" },
  { href: "/inventory", label: "Inventory" },
  { href: "/shop", label: "Shop" },
  { href: "/arena", label: "Arena" },
  { href: "/ranking", label: "Ranking" },
];

export function AppNav() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [gameCoinBalance, setGameCoinBalance] = useState<string>("-");
  const [stablecoinBalance, setStablecoinBalance] = useState<string>("-");
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [isRegisteredNearPlayer, setIsRegisteredNearPlayer] = useState<boolean | null>(null);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => {
      setSession(getWalletSession());
    });
  }, []);

  const refreshBalances = useCallback(async (accountId: string) => {
    setBalancesLoading(true);

    try {
      const player = await queryClient.fetchQuery(nearQueryOptions.player(accountId));

      if (!player) {
        setIsRegisteredNearPlayer(false);
        setGameCoinBalance("-");
        setStablecoinBalance("-");
        return;
      }

      setIsRegisteredNearPlayer(true);
      setGameCoinBalance(formatScaledInt(player.game_coins));
      setStablecoinBalance(formatScaledInt(player.stablecoin_balance));
    } catch {
      setIsRegisteredNearPlayer(null);
      setGameCoinBalance("-");
      setStablecoinBalance("-");
    } finally {
      setBalancesLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!session || session.chain !== "near") {
      setGameCoinBalance("-");
      setStablecoinBalance("-");
      setIsRegisteredNearPlayer(null);
      setBalancesLoading(false);
      return;
    }

    void refreshBalances(session.accountId);
  }, [refreshBalances, session]);

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
