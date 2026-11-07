"use client";

import Image from "next/image";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { SessionGate } from "@/components/session-gate";
import {
  formatScaledInt,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:8787";
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() || "testnet";

export default function GladiatorPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState("Waiting for wallet session.");
  const [loading, setLoading] = useState(false);
  const [requestingTokens, setRequestingTokens] = useState(false);

  const presentToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });

    window.setTimeout(() => {
      setToast((current) => {
        if (!current || current.id !== id) {
          return current;
        }

        return null;
      });
    }, 4200);
  }, []);

  const refreshProfile = useCallback(async (nearAccountId: string) => {
    const cachedPlayer = queryClient.getQueryData<PlayerView | null>(nearQueryKeys.player(nearAccountId));
    if (cachedPlayer !== undefined) {
      setPlayer(cachedPlayer);
      setStatus(`Profile loaded for ${nearAccountId} (cached).`);
    }

    setLoading(true);
    setStatus("Fetching on-chain profile...");

    try {
      const playerData = await queryClient.fetchQuery(nearQueryOptions.player(nearAccountId));
      setPlayer(playerData);

      if (playerData) {
        setStatus(`Profile loaded for ${nearAccountId}.`);
      } else {
        setStatus(`No registered player found for ${nearAccountId}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("Could not refresh profile. Please retry in a few seconds.");
      presentToast(message);
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }, [presentToast, queryClient]);

  const requestTokens = useCallback(async () => {
    if (!session || session.chain !== "near") {
      setStatus("NEAR session is required to request tokens.");
      return;
    }

    if (NETWORK_ID !== "testnet") {
      setStatus("Token request is only available on testnet.");
      return;
    }

    if (!player) {
      setStatus("Register player first before requesting tokens.");
      return;
    }

    try {
      setRequestingTokens(true);
      setStatus("Requesting testnet tokens from backend...");

      const response = await fetch(`${BACKEND_BASE_URL}/v1/faucet/request-tokens`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ accountId: session.accountId }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        const message = payload.message ?? payload.error ?? `Faucet request failed (${response.status})`;
        throw new Error(message);
      }

      setStatus("Tokens minted successfully. Refreshing profile...");
  await invalidateNearQueries(queryClient);
      await refreshProfile(session.accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Token request failed: ${message}`);
      presentToast(message);
    } finally {
      setRequestingTokens(false);
    }
  }, [player, presentToast, refreshProfile, session]);

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
            {session?.chain === "near" && !loading && !player ? (
              <div className="row">
                <Link className="button-link primary" href="/wallet">
                  Register player
                </Link>
              </div>
            ) : null}
            {session?.chain === "near" && player && NETWORK_ID === "testnet" ? (
              <div className="row">
                <button className="primary" onClick={() => void requestTokens()} disabled={requestingTokens}>
                  {requestingTokens ? "Requesting tokens..." : "Request testnet tokens"}
                </button>
              </div>
            ) : null}
            {loading ? <div className="status">Loading profile...</div> : null}
          </article>

          <article className="module gladiator-hero">
            <Image
              src="/assets/gladiators/default-gladiator.svg"
              alt="Gladiator avatar"
              className="gladiator-hero-image"
              width={220}
              height={220}
              priority
            />
            <div className="gladiator-hero-copy">
              <h2>Champion Card</h2>
              <p className="muted">
                Default avatar for v1. Later we can bind this to class/skin per player.
              </p>
              <div className="list-block">
                <div className="list-item">
                  <span>Account</span>
                  <span className="chip">{session?.accountId ?? "none"}</span>
                </div>
                <div className="list-item">
                  <span>Level</span>
                  <span className="chip">{player?.level ?? "-"}</span>
                </div>
                <div className="list-item">
                  <span>XP</span>
                  <span className="chip">{player ? formatScaledInt(player.xp) : "-"}</span>
                </div>
                <div className="list-item">
                  <span>HP</span>
                  <span className="chip">
                    {player ? `${formatScaledInt(player.current_hp)} / ${formatScaledInt(player.max_hp)}` : "-"}
                  </span>
                </div>
              </div>
            </div>
          </article>

          <section className="game-grid">
            <article className="module">
              <h2>Stats</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item"><span>Level</span><span className="chip">{player.level}</span></div>
                  <div className="list-item"><span>XP</span><span className="chip">{formatScaledInt(player.xp)}</span></div>
                  <div className="list-item">
                    <span>STR</span>
                    <span className="chip">
                      {formatScaledInt(player.effective_strength)}
                      {Number(player.bonus_strength) > 0 ? ` (+${formatScaledInt(player.bonus_strength)})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>DEX</span>
                    <span className="chip">
                      {formatScaledInt(player.effective_dexterity)}
                      {Number(player.bonus_dexterity) > 0 ? ` (+${formatScaledInt(player.bonus_dexterity)})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>VIT</span>
                    <span className="chip">
                      {formatScaledInt(player.effective_vitality)}
                      {Number(player.bonus_vitality) > 0 ? ` (+${formatScaledInt(player.bonus_vitality)})` : ""}
                    </span>
                  </div>
                  <div className="list-item"><span>HP</span><span className="chip">{formatScaledInt(player.current_hp)} / {formatScaledInt(player.max_hp)}</span></div>
                </div>
              ) : (
                <div className="status">No player loaded for this session.</div>
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
                  <div className="row">
                    <Link className="button-link" href="/inventory">
                      Open inventory manager
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="status">No inventory available.</div>
              )}
            </article>
          </section>
        </section>

        {toast ? (
          <div className="shop-toast" role="status" aria-live="polite">
            <strong>Error</strong>
            <p>{toast.message}</p>
          </div>
        ) : null}
      </main>
    </SessionGate>
  );
}
