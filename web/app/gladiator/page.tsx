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
import { formatHpProgress, formatXpProgress } from "@/lib/player-format";
import { sendGameTransaction } from "@/lib/wallet-signer";
import { getPlayerAccountId, getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const ASSIGN_STAT_POINTS_GAS = "100000000000000";

export default function GladiatorPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState("Waiting for wallet session.");
  const [loading, setLoading] = useState(false);
  const [assigningStats, setAssigningStats] = useState(false);
  const [pendingStrength, setPendingStrength] = useState(0);
  const [pendingDexterity, setPendingDexterity] = useState(0);
  const [pendingVitality, setPendingVitality] = useState(0);

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

  const submitStatAllocation = useCallback(async () => {
    const playerAccountId = getPlayerAccountId(session);
    if (!playerAccountId) {
      setStatus("Connect a wallet to assign stat points.");
      return;
    }

    if (!player) {
      setStatus("Load player profile first.");
      return;
    }

    const total = pendingStrength + pendingDexterity + pendingVitality;
    if (total <= 0) {
      setStatus("Choose at least one point before confirming.");
      return;
    }

    if (total > player.unassigned_points) {
      setStatus("Selected points exceed available unassigned points.");
      return;
    }

    if (total < player.unassigned_points) {
      const remaining = player.unassigned_points - total;
      const confirmed = window.confirm(
        `You are assigning ${total} of ${player.unassigned_points} points. ${remaining} point(s) will remain unassigned. Continue?`,
      );

      if (!confirmed) {
        setStatus("Stat allocation canceled.");
        return;
      }
    }

    try {
      setAssigningStats(true);
      setStatus("Submitting assign_stat_points transaction...");

      await sendGameTransaction([
          {
            type: "FunctionCall",
            params: {
              methodName: "assign_stat_points",
              args: {
                strength_points: pendingStrength,
                dexterity_points: pendingDexterity,
                vitality_points: pendingVitality,
              },
              gas: ASSIGN_STAT_POINTS_GAS,
              deposit: "0",
            },
          },
      ]);

      await invalidateNearQueries(queryClient);
      await refreshProfile(playerAccountId);

      setPendingStrength(0);
      setPendingDexterity(0);
      setPendingVitality(0);
      setStatus("Stats updated successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Stat allocation failed: ${message}`);
      presentToast(message);
    } finally {
      setAssigningStats(false);
    }
  }, [
    pendingDexterity,
    pendingStrength,
    pendingVitality,
    player,
    presentToast,
    queryClient,
    refreshProfile,
    session,
  ]);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => {
      setSession(getWalletSession());
    });
  }, []);

  useEffect(() => {
    if (!session) {
      setPlayer(null);
      setStatus("Waiting for wallet session.");
      return;
    }

    const playerAccountId = getPlayerAccountId(session);
    if (!playerAccountId) {
      setPlayer(null);
      setStatus("Setting up your Solana player...");
      return;
    }

    void refreshProfile(playerAccountId);
  }, [refreshProfile, session]);

  useEffect(() => {
    if (!player || player.unassigned_points <= 0) {
      setPendingStrength(0);
      setPendingDexterity(0);
      setPendingVitality(0);
      return;
    }

    const selected = pendingStrength + pendingDexterity + pendingVitality;
    if (selected <= player.unassigned_points) {
      return;
    }

    // Clamp to available points if profile refresh reduced unassigned points.
    setPendingStrength(0);
    setPendingDexterity(0);
    setPendingVitality(0);
  }, [pendingDexterity, pendingStrength, pendingVitality, player]);

  const totalPendingPoints = pendingStrength + pendingDexterity + pendingVitality;
  const remainingPoints = player ? player.unassigned_points - totalPendingPoints : 0;
  const overAssigned = remainingPoints < 0;

  const adjustPendingStat = useCallback(
    (stat: "strength" | "dexterity" | "vitality", delta: number) => {
      if (!player || player.unassigned_points <= 0) {
        return;
      }

      const nextStrength =
        stat === "strength" ? Math.max(0, pendingStrength + delta) : pendingStrength;
      const nextDexterity =
        stat === "dexterity" ? Math.max(0, pendingDexterity + delta) : pendingDexterity;
      const nextVitality =
        stat === "vitality" ? Math.max(0, pendingVitality + delta) : pendingVitality;
      const nextTotal = nextStrength + nextDexterity + nextVitality;

      if (nextTotal > player.unassigned_points) {
        return;
      }

      setPendingStrength(nextStrength);
      setPendingDexterity(nextDexterity);
      setPendingVitality(nextVitality);
    },
    [pendingDexterity, pendingStrength, pendingVitality, player],
  );

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
            <p className="muted">Consulta real al contrato para get_player y get_grand_pot.</p>
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
                  <span className="chip">{player ? formatXpProgress(player) : "-"}</span>
                </div>
                <div className="list-item">
                  <span>HP</span>
                  <span className="chip">
                    {player ? formatHpProgress(player) : "-"}
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
                  <div className="list-item"><span>Unassigned</span><span className="chip">{player.unassigned_points}</span></div>
                  <div className="list-item"><span>Level</span><span className="chip">{player.level}</span></div>
                  <div className="list-item"><span>XP</span><span className="chip">{formatXpProgress(player)}</span></div>
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
                  <div className="list-item"><span>HP</span><span className="chip">{formatHpProgress(player)}</span></div>

                  {player.unassigned_points > 0 ? (
                    <>
                      <div className="status">Allocate points and confirm once to send one transaction.</div>
                      <div className="list-item">
                        <span>STR</span>
                        <div className="stat-stepper" role="group" aria-label="Allocate strength points">
                          <button
                            onClick={() => adjustPendingStat("strength", -1)}
                            disabled={pendingStrength <= 0 || assigningStats}
                            aria-label="Decrease strength allocation"
                          >
                            -
                          </button>
                          <span className="chip stat-stepper-value">{pendingStrength}</span>
                          <button
                            onClick={() => adjustPendingStat("strength", 1)}
                            disabled={remainingPoints <= 0 || assigningStats}
                            aria-label="Increase strength allocation"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="list-item">
                        <span>DEX</span>
                        <div className="stat-stepper" role="group" aria-label="Allocate dexterity points">
                          <button
                            onClick={() => adjustPendingStat("dexterity", -1)}
                            disabled={pendingDexterity <= 0 || assigningStats}
                            aria-label="Decrease dexterity allocation"
                          >
                            -
                          </button>
                          <span className="chip stat-stepper-value">{pendingDexterity}</span>
                          <button
                            onClick={() => adjustPendingStat("dexterity", 1)}
                            disabled={remainingPoints <= 0 || assigningStats}
                            aria-label="Increase dexterity allocation"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="list-item">
                        <span>VIT</span>
                        <div className="stat-stepper" role="group" aria-label="Allocate vitality points">
                          <button
                            onClick={() => adjustPendingStat("vitality", -1)}
                            disabled={pendingVitality <= 0 || assigningStats}
                            aria-label="Decrease vitality allocation"
                          >
                            -
                          </button>
                          <span className="chip stat-stepper-value">{pendingVitality}</span>
                          <button
                            onClick={() => adjustPendingStat("vitality", 1)}
                            disabled={remainingPoints <= 0 || assigningStats}
                            aria-label="Increase vitality allocation"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="list-item"><span>Selected</span><span className="chip">{totalPendingPoints}</span></div>
                      <div className="list-item">
                        <span>Remaining after submit</span>
                        <span className="chip">{overAssigned ? "Invalid" : remainingPoints}</span>
                      </div>
                      {totalPendingPoints > 0 && !overAssigned && remainingPoints > 0 ? (
                        <div className="status">Warning: you will keep {remainingPoints} unassigned point(s) if you confirm now.</div>
                      ) : null}
                      {overAssigned ? (
                        <div className="status">Selected points exceed available points. Reduce values to continue.</div>
                      ) : null}
                      <div className="row">
                        <button
                          className="primary"
                          disabled={assigningStats || totalPendingPoints <= 0 || overAssigned}
                          onClick={() => void submitStatAllocation()}
                        >
                          {assigningStats ? "Submitting stats..." : "Confirm stat allocation"}
                        </button>
                      </div>
                    </>
                  ) : null}
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
