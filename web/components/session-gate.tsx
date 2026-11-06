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
          <p className="eyebrow">Acceso restringido</p>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </header>

        <article className="module">
          <div className="status">
            Necesitas conectar una wallet desde el boton Connect wallet en la barra superior.
          </div>
          <div className="row">
            <Link className="button-link" href="/ranking">
              Ver ranking publico
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
