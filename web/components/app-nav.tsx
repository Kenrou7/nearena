"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";
import { ConnectWalletMenu } from "@/components/connect-wallet-menu";

const NAV_ITEMS = [
  { href: "/", label: "Inicio" },
  { href: "/gladiator", label: "Gladiador" },
  { href: "/shop", label: "Tienda" },
  { href: "/arena", label: "Arena" },
  { href: "/ranking", label: "Ranking" },
];

export function AppNav() {
  const pathname = usePathname();
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  const visibleItems = useMemo(() => {
    if (session) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter((item) => ["/", "/ranking"].includes(item.href));
  }, [session]);

  return (
    <nav className="app-nav" aria-label="Main navigation">
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
