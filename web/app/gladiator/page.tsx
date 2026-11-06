"use client";

import { useCallback, useEffect, useState } from "react";
import { SessionGate } from "@/components/session-gate";
import { getPlayerView, getPotView, type PlayerView } from "@/lib/near-rpc";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";

function formatAmount(value: string | number): string {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US").format(normalized);
}

export default function GladiatorPage() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [pot, setPot] = useState<string>("0");
  const [status, setStatus] = useState("Waiting for wallet session.");
  const [loading, setLoading] = useState(false);

  const refreshProfile = useCallback(async (nearAccountId: string) => {
    setLoading(true);
    setStatus("Fetching on-chain profile...");

    try {
      const [playerData, potData] = await Promise.all([getPlayerView(nearAccountId), getPotView()]);
      setPlayer(playerData);
      setPot(potData);

      if (playerData) {
        setStatus(`Profile loaded for ${nearAccountId}.`);
      } else {
        setStatus(`No registered player found for ${nearAccountId}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to fetch profile: ${message}`);
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    if (!session) {
      setPlayer(null);
      setStatus("Waiting for wallet session.");
      return;
    }

    if (session.chain !== "near") {
      setPlayer(null);
      setStatus("Gladiator profile requires a NEAR session.");
      return;
    }

    void refreshProfile(session.accountId);
  }, [refreshProfile, session]);

  return (
    <SessionGate
      title="Perfil del Campeon"
      description="Conecta una wallet para ver stats reales del gladiador y datos del contrato."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Gladiador</p>
            <h2>Perfil on-chain</h2>
            <p className="muted">Consulta real al contrato para get_player y get_pot.</p>
          </header>

          <article className="module">
            <div className="status">{status}</div>
            {loading ? <div className="status">Loading profile...</div> : null}
          </article>

          <section className="game-grid">
            <article className="module">
              <h2>Contract snapshot</h2>
              <div className="list-block">
                <div className="list-item">
                  <span>Account</span>
                  <span className="chip">{session?.accountId ?? "none"}</span>
                </div>
                <div className="list-item">
                  <span>Pot</span>
                  <span className="chip">{formatAmount(pot)}</span>
                </div>
                <div className="list-item">
                  <span>Contract</span>
                  <span className="chip">{CONTRACT_ID}</span>
                </div>
              </div>
            </article>

            <article className="module">
              <h2>Stats</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item"><span>Level</span><span className="chip">{player.level}</span></div>
                  <div className="list-item"><span>XP</span><span className="chip">{player.xp}</span></div>
                  <div className="list-item"><span>STR</span><span className="chip">{player.strength}</span></div>
                  <div className="list-item"><span>DEX</span><span className="chip">{player.dexterity}</span></div>
                  <div className="list-item"><span>VIT</span><span className="chip">{player.vitality}</span></div>
                  <div className="list-item"><span>Life</span><span className="chip">{player.current_life}</span></div>
                </div>
              ) : (
                <div className="status">No player loaded for this session.</div>
              )}
            </article>

            <article className="module">
              <h2>Balances</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item">
                    <span>Stablecoin</span>
                    <span className="chip">{formatAmount(player.stablecoin_balance)}</span>
                  </div>
                  <div className="list-item">
                    <span>Game coin</span>
                    <span className="chip">{formatAmount(player.game_coin_balance)}</span>
                  </div>
                </div>
              ) : (
                <div className="status">No balances available.</div>
              )}
            </article>

            <article className="module">
              <h2>Inventory</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item">
                    <span>Items</span>
                    <span className="chip">{player.owned_item_ids.length}</span>
                  </div>
                  <div className="list-item">
                    <span>Tokens</span>
                    <span className="chip">{player.owned_token_ids.length}</span>
                  </div>
                </div>
              ) : (
                <div className="status">No inventory available.</div>
              )}
            </article>
          </section>
        </section>
      </main>
    </SessionGate>
  );
}
