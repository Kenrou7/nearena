"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatScaledInt, getPotView } from "@/lib/near-rpc";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

export default function HomePage() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [potDisplay, setPotDisplay] = useState("Loading...");

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadPot() {
      try {
        const pot = await getPotView();
        if (!mounted) {
          return;
        }

        setPotDisplay(`${formatScaledInt(pot)} USD`);
      } catch {
        if (!mounted) {
          return;
        }

        setPotDisplay("Unavailable");
      }
    }

    void loadPot();
    return () => {
      mounted = false;
    };
  }, []);

  const unlockedModules = useMemo(
    () => [
      {
        title: "Gladiator",
        description: "Stats, gear and progress of your fighter.",
        href: "/gladiator",
        cta: "View profile",
      },
      {
        title: "Shop",
        description: "Buy and manage combat items.",
        href: "/shop",
        cta: "Go to shop",
      },
      {
        title: "Arena",
        description: "Challenge rivals and review your fights.",
        href: "/arena",
        cta: "Open arena",
      },
      {
        title: "Ranking",
        description: "Leaderboard and global player progress.",
        href: "/ranking",
        cta: "View ranking",
      },
    ],
    [],
  );

  return (
    <main>
      <section className="panel app-shell">
        <section className="hero-card">
          <div>
            <p className="eyebrow">NEARena: Blood and Glory</p>
            <h2>Grand Pot: {potDisplay}</h2>
            <p className="muted">
              {session
                ? "Session active: full access to the game."
                : "Connect a wallet to unlock your gladiator, the shop and the arena."}
            </p>
          </div>
          <div className="row">
            {session ? (
              <Link className="button-link primary" href="/arena">
                Enter the Arena
              </Link>
            ) : null}
            <Link className="button-link" href="/ranking">
              Public ranking
            </Link>
          </div>
        </section>

        {session ? (
          <section className="game-grid">
            {unlockedModules.map((module) => (
              <article key={module.href} className="module">
                <h2>{module.title}</h2>
                <p className="muted">{module.description}</p>
                                <Link className="button-link" href={module.href}>
                  {module.cta}
                </Link>
              </article>
            ))}
          </section>
        ) : (
          <section className="game-grid">
            <article className="module">
              <h2>Before you start</h2>
              <div className="status">
                1. Tap Connect wallet in the top bar.
                {"\n"}2. Connect a single wallet (NEAR or Solana).
                {"\n"}3. Come back Home to unlock the Arena, Gladiator and Shop.
              </div>
            </article>
            <article className="module">
              <h2>Public access</h2>
              <p className="muted">Without a session, only the essentials are shown.</p>
              <Link className="button-link" href="/ranking">
                Go to ranking
              </Link>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
