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
        title: "Gladiador",
        description: "Stats, equipo y progreso del luchador principal.",
        href: "/gladiator",
        cta: "Ver perfil",
      },
      {
        title: "Tienda",
        description: "Compra y administracion de items para combate.",
        href: "/shop",
        cta: "Ir a tienda",
      },
      {
        title: "Arena",
        description: "Flujo de pelea y resultado de rondas.",
        href: "/arena",
        cta: "Abrir arena",
      },
      {
        title: "Ranking",
        description: "Tabla competitiva y progreso global de jugadores.",
        href: "/ranking",
        cta: "Ver ranking",
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
                ? "Sesion activa: acceso completo al circuito de juego."
                : "Conecta una wallet para desbloquear gladiador, tienda y arena."}
            </p>
          </div>
          <div className="row">
            {session ? (
              <Link className="button-link primary" href="/arena">
                Entrar a Arena
              </Link>
            ) : null}
            <Link className="button-link" href="/ranking">
              Ranking publico
            </Link>
          </div>
        </section>

        {session ? (
          <section className="game-grid">
            {unlockedModules.map((module) => (
              <article key={module.href} className="module">
                <h2>{module.title}</h2>
                <p className="muted">{module.description}</p>
                <div className="status">Modulo habilitado para sesion conectada.</div>
                <Link className="button-link" href={module.href}>
                  {module.cta}
                </Link>
              </article>
            ))}
          </section>
        ) : (
          <section className="game-grid">
            <article className="module">
              <h2>Antes de empezar</h2>
              <div className="status">
                1. Toca Connect wallet en la barra superior.
                {"\n"}2. Conecta una sola wallet (NEAR o Solana).
                {"\n"}3. Volve a Inicio para desbloquear Arena, Gladiador y Tienda.
              </div>
            </article>
            <article className="module">
              <h2>Acceso publico</h2>
              <p className="muted">Mientras no hay sesion, solo mostramos lo esencial.</p>
              <Link className="button-link" href="/ranking">
                Ir a ranking
              </Link>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
