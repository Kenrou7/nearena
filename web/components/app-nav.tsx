"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getPlayerView } from "@/lib/near-rpc";
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
  const pathname = usePathname();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [gameCoinBalance, setGameCoinBalance] = useState<string>("-");
  const [stablecoinBalance, setStablecoinBalance] = useState<string>("-");
  const [balancesLoading, setBalancesLoading] = useState(false);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshBalances() {
      if (!session || session.chain !== "near") {
        setGameCoinBalance("-");
        setStablecoinBalance("-");
        setBalancesLoading(false);
        return;
      }

      setBalancesLoading(true);

      try {
        const player = await getPlayerView(session.accountId);
        if (cancelled) {
          return;
        }

        if (!player) {
          setGameCoinBalance("-");
          setStablecoinBalance("-");
          return;
        }

        setGameCoinBalance(String(player.game_coin_balance));
        setStablecoinBalance(String(player.stablecoin_balance));
      } catch {
        if (cancelled) {
          return;
        }

        setGameCoinBalance("-");
        setStablecoinBalance("-");
      } finally {
        if (!cancelled) {
          setBalancesLoading(false);
        }
      }
    }

    void refreshBalances();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const visibleItems = useMemo(() => {
    if (session) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter((item) => ["/", "/ranking"].includes(item.href));
  }, [session]);

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
