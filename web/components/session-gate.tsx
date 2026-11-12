"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

type SessionGateProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

export function SessionGate({ title, description, children }: SessionGateProps) {
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  if (session) {
    return <>{children}</>;
  }

  return (
    <main>
      <section className="panel app-shell">
        <header>
          <p className="eyebrow">Restricted access</p>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </header>

        <article className="module">
          <div className="status">
            Connect a wallet using the Connect wallet button in the top bar.
          </div>
          <div className="row">
            <Link className="button-link" href="/ranking">
              View public ranking
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
