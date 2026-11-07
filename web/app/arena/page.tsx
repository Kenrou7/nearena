"use client";

import type { BrowserWallet, WalletSelector } from "@near-wallet-selector/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionGate } from "@/components/session-gate";
import {
  type ChallengeResultView,
  formatScaledInt,
  type ArenaView,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const CALL_GAS = "100000000000000";
const NEAR_RPC_PROXY_PATH = process.env.NEXT_PUBLIC_NEAR_RPC_PROXY_PATH?.trim() || "/api/near-rpc";
const COMBAT_HISTORY_LIMIT = 20;

type LegacyChallengeResult = {
  attacker_won: boolean;
  draw: boolean;
  rounds: number;
};

type ParsedChallengePayload = {
  result: ChallengeResultView;
  legacy: boolean;
};

type CombatHistoryEntry = {
  id: string;
  createdAtIso: string;
  txHash: string | null;
  legacy: boolean;
  result: ChallengeResultView;
};

type OutcomeLike = {
  status?: {
    SuccessValue?: string;
  };
};

function makeCombatHistoryKey(accountId: string): string {
  return `gladiator-combat-history:${accountId}`;
}

function createLegacyChallengeResult(
  legacy: LegacyChallengeResult,
  attackerAccountId: string,
  defenderAccountId: string,
): ChallengeResultView {
  return {
    attacker_won: legacy.attacker_won,
    draw: legacy.draw,
    rounds: legacy.rounds,
    attacker_total_damage: "0",
    defender_total_damage: "0",
    attacker: {
      account_id: attackerAccountId,
      level: 0,
      strength: "0",
      dexterity: "0",
      vitality: "0",
      max_hp: "0",
      hp_at_start: "0",
      hp_at_end: "0",
    },
    defender: {
      account_id: defenderAccountId,
      level: 0,
      strength: "0",
      dexterity: "0",
      vitality: "0",
      max_hp: "0",
      hp_at_start: "0",
      hp_at_end: "0",
    },
    round_logs: [],
  };
}

function normalizeChallengePayload(
  parsed: unknown,
  attackerAccountId: string,
  defenderAccountId: string,
): ParsedChallengePayload | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.attacker_won === "boolean" &&
    typeof record.draw === "boolean" &&
    typeof record.rounds === "number"
  ) {
    if (Array.isArray(record.round_logs)) {
      return {
        result: parsed as ChallengeResultView,
        legacy: false,
      };
    }

    return {
      result: createLegacyChallengeResult(
        {
          attacker_won: record.attacker_won,
          draw: record.draw,
          rounds: record.rounds,
        },
        attackerAccountId,
        defenderAccountId,
      ),
      legacy: true,
    };
  }

  return null;
}

function decodeBase64ToUtf8(value: string): string {
  if (!value) {
    return "";
  }

  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return "";
}

function extractChallengeResultFromWalletResponse(
  payload: unknown,
  attackerAccountId: string,
  defenderAccountId: string,
): ParsedChallengePayload | null {
  const responses = Array.isArray(payload) ? payload : [payload];

  for (const response of responses) {
    if (!response || typeof response !== "object") {
      continue;
    }

    const candidates: unknown[] = [];
    const maybe = response as {
      status?: { SuccessValue?: string };
      final_execution_status?: string;
      transaction_outcome?: unknown;
      receipts_outcome?: unknown[];
    };

    candidates.push(response);
    if (maybe.transaction_outcome) {
      candidates.push(maybe.transaction_outcome);
    }
    if (Array.isArray(maybe.receipts_outcome)) {
      candidates.push(...maybe.receipts_outcome);
    }

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const status = (candidate as OutcomeLike).status;
      if (!status || typeof status !== "object") {
        continue;
      }

      const successValue = status.SuccessValue;
      if (typeof successValue !== "string") {
        continue;
      }

      const decoded = decodeBase64ToUtf8(successValue);
      if (!decoded) {
        continue;
      }

      try {
        const parsed = JSON.parse(decoded) as unknown;
        const normalized = normalizeChallengePayload(parsed, attackerAccountId, defenderAccountId);
        if (normalized) {
          return normalized;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function extractTxHashFromWalletResponse(payload: unknown): string | null {
  const responses = Array.isArray(payload) ? payload : [payload];

  for (const response of responses) {
    if (!response || typeof response !== "object") {
      continue;
    }

    const asRecord = response as {
      transaction?: { hash?: unknown };
      transaction_outcome?: { id?: unknown };
    };

    if (asRecord.transaction && typeof asRecord.transaction.hash === "string") {
      return asRecord.transaction.hash;
    }

    if (asRecord.transaction_outcome && typeof asRecord.transaction_outcome.id === "string") {
      return asRecord.transaction_outcome.id;
    }
  }

  return null;
}

async function fetchChallengeResultFromTxHash(
  txHash: string,
  signerId: string,
  attackerAccountId: string,
  defenderAccountId: string,
): Promise<ParsedChallengePayload | null> {
  const response = await fetch(NEAR_RPC_PROXY_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "arena-combat-result",
      method: "tx",
      params: [txHash, signerId],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    result?: {
      receipts_outcome?: Array<{ outcome?: { status?: { SuccessValue?: string } } }>;
      transaction_outcome?: { outcome?: { status?: { SuccessValue?: string } } };
    };
  };

  const outcomes: Array<{ status?: { SuccessValue?: string } }> = [];
  if (payload.result?.transaction_outcome?.outcome) {
    outcomes.push(payload.result.transaction_outcome.outcome);
  }

  for (const receipt of payload.result?.receipts_outcome ?? []) {
    if (receipt.outcome) {
      outcomes.push(receipt.outcome);
    }
  }

  for (const outcome of outcomes) {
    const successValue = outcome.status?.SuccessValue;
    if (!successValue) {
      continue;
    }

    try {
      const decoded = decodeBase64ToUtf8(successValue);
      if (!decoded) {
        continue;
      }

      const parsed = JSON.parse(decoded) as unknown;
      const normalized = normalizeChallengePayload(parsed, attackerAccountId, defenderAccountId);
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Wallet selector init timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export default function ArenaPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [browserWallet, setBrowserWallet] = useState<BrowserWallet | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [arenaView, setArenaView] = useState<ArenaView | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tierTop, setTierTop] = useState<string[]>([]);
  const [challengingTarget, setChallengingTarget] = useState<string | null>(null);
  const [combatResult, setCombatResult] = useState<ChallengeResultView | null>(null);
  const [history, setHistory] = useState<CombatHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Connect a NEAR wallet session to load arena data.");

  const nearAccountId = useMemo(() => {
    if (!session || session.chain !== "near") {
      return null;
    }

    return session.accountId;
  }, [session]);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  const ensureNearSelector = useCallback(async (): Promise<WalletSelector> => {
    if (selector) {
      return selector;
    }

    const nearWallet = await withTimeout(initNearWallet(NETWORK_ID, CONTRACT_ID), 12_000);
    setSelector(nearWallet.selector);
    return nearWallet.selector;
  }, [selector]);

  const ensureNearBrowserWallet = useCallback(async (): Promise<BrowserWallet> => {
    if (browserWallet) {
      return browserWallet;
    }

    const nearSelector = await ensureNearSelector();
    const wallet = (await nearSelector.wallet()) as BrowserWallet;
    setBrowserWallet(wallet);
    return wallet;
  }, [browserWallet, ensureNearSelector]);

  const refreshArena = useCallback(async () => {
    if (!nearAccountId) {
      setPlayer(null);
      setArenaView(null);
      setCandidates([]);
      setStatus("Connect a NEAR wallet session to load arena data.");
      return;
    }

    const cachedPlayer = queryClient.getQueryData<PlayerView | null>(nearQueryKeys.player(nearAccountId));
    const cachedArena = queryClient.getQueryData<ArenaView | null>(nearQueryKeys.arena(nearAccountId));
    const cachedCandidates = queryClient.getQueryData<string[]>(nearQueryKeys.candidates(nearAccountId));

    if (cachedPlayer !== undefined && cachedPlayer) {
      setPlayer(cachedPlayer);
    }

    if (cachedArena !== undefined && cachedArena) {
      setArenaView(cachedArena);
      const cachedTop = queryClient.getQueryData<string[]>(nearQueryKeys.tierTop(cachedArena.tier, 5));
      if (cachedTop) {
        setTierTop(cachedTop);
      }
    }

    if (cachedCandidates) {
      setCandidates(cachedCandidates);
    }

    if ((cachedPlayer !== undefined && cachedPlayer) || (cachedArena !== undefined && cachedArena)) {
      setStatus("Arena loaded from cache. Syncing latest state...");
    }

    setLoading(true);
    setStatus((current) =>
      current.includes("cache") ? current : "Loading arena state...",
    );

    try {
      const [playerData, arenaData, candidateData] = await Promise.all([
        queryClient.fetchQuery(nearQueryOptions.player(nearAccountId)),
        queryClient.fetchQuery(nearQueryOptions.arena(nearAccountId)),
        queryClient.fetchQuery(nearQueryOptions.candidates(nearAccountId)),
      ]);

      let tierTopData: string[] = [];
      if (arenaData) {
        try {
          tierTopData = await queryClient.fetchQuery(nearQueryOptions.tierTop(arenaData.tier, 5));
        } catch {
          // Keep arena usable even if optional top-tier view is not available on-chain yet.
          tierTopData = [];
        }
      }

      setPlayer(playerData);
      setArenaView(arenaData);
      setCandidates(candidateData);
      setTierTop(tierTopData);

      if (!playerData) {
        setStatus("Player is not registered yet. Register player first.");
        return;
      }

      if (!arenaData) {
        setStatus("No arena state found for this account yet.");
        return;
      }

      if (candidateData.length === 0) {
        if (arenaData.rank === 0) {
          setStatus("You are current leader in your tier. No targets above your rank.");
        } else {
          setStatus("No challenge candidates found in range. Ensure ghosts were initialized.");
        }
        return;
      }

      setStatus("Arena data synced. Choose a target from available candidates.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Could not load arena state: ${message}`);
      setPlayer(null);
      setArenaView(null);
      setCandidates([]);
      setTierTop([]);
    } finally {
      setLoading(false);
    }
  }, [nearAccountId, queryClient]);

  useEffect(() => {
    void refreshArena();
  }, [refreshArena]);

  useEffect(() => {
    if (!nearAccountId) {
      setHistory([]);
      return;
    }

    try {
      const raw = window.localStorage.getItem(makeCombatHistoryKey(nearAccountId));
      if (!raw) {
        setHistory([]);
        return;
      }

      const parsed = JSON.parse(raw) as CombatHistoryEntry[];
      if (!Array.isArray(parsed)) {
        setHistory([]);
        return;
      }

      setHistory(parsed);
    } catch {
      setHistory([]);
    }
  }, [nearAccountId]);

  const pushHistory = useCallback((entry: CombatHistoryEntry) => {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, COMBAT_HISTORY_LIMIT);

      if (nearAccountId) {
        window.localStorage.setItem(makeCombatHistoryKey(nearAccountId), JSON.stringify(next));
      }

      return next;
    });
  }, [nearAccountId]);

  useEffect(() => {
    if (!nearAccountId) {
      setBrowserWallet(null);
      return;
    }

    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function setupSelector() {
      try {
        const nearWallet = await ensureNearSelector();
        if (!mounted) {
          return;
        }

        const subscription = nearWallet.store.observable.subscribe(() => {
          if (!mounted) {
            return;
          }

          const active = getActiveAccountId(nearWallet);
          if (active && active !== nearAccountId) {
            setStatus("Detected another NEAR account in wallet. Refreshing arena...");
            void refreshArena();
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } catch {
        // Wallet setup errors are surfaced when challenge is triggered.
      }
    }

    void setupSelector();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [ensureNearSelector, nearAccountId, refreshArena]);

  const challengeTarget = useCallback(async (targetAccountId: string) => {
    if (!nearAccountId) {
      setStatus("NEAR session is required to challenge.");
      return;
    }

    try {
      setChallengingTarget(targetAccountId);
      setStatus(`Sending challenge transaction to ${targetAccountId}...`);

      const wallet = await ensureNearBrowserWallet();
      const txResult = await wallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "challenge",
              args: {
                opponent_account_id: targetAccountId,
              },
              gas: CALL_GAS,
              deposit: "0",
            },
          },
        ],
      });

      let parsedResult = extractChallengeResultFromWalletResponse(txResult, nearAccountId, targetAccountId);

      if (!parsedResult) {
        const txHash = extractTxHashFromWalletResponse(txResult);
        if (txHash) {
          parsedResult = await fetchChallengeResultFromTxHash(
            txHash,
            nearAccountId,
            nearAccountId,
            targetAccountId,
          );
        }
      }

      if (parsedResult) {
        const txHash = extractTxHashFromWalletResponse(txResult);
        setCombatResult(parsedResult.result);
        pushHistory({
          id: `${Date.now()}-${targetAccountId}`,
          createdAtIso: new Date().toISOString(),
          txHash,
          legacy: parsedResult.legacy,
          result: parsedResult.result,
        });
      }

      setStatus("Challenge sent. Refreshing arena state...");
      await invalidateNearQueries(queryClient);
      await refreshArena();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Challenge failed: ${message}`);
    } finally {
      setChallengingTarget(null);
    }
  }, [ensureNearBrowserWallet, nearAccountId, pushHistory, queryClient, refreshArena]);

  return (
    <SessionGate
      title="Centro de Combate"
      description="Conecta una wallet para desbloquear peleas, rounds y recompensas."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Arena</p>
            <h2>Centro de Combate</h2>
            <p className="muted">Pantalla dedicada para preparar pelea, ejecutar ronda y revisar resultado.</p>
          </header>

          <article className="module">
            <h2>Arena State</h2>
            <div className="status">{status}</div>
            <div className="row">
              <button className="primary" onClick={() => void refreshArena()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh Arena"}
              </button>
            </div>

            {player && arenaView ? (
              <div className="list-block">
                <div className="list-item"><span>Tier</span><span className="chip">{arenaView.tier}</span></div>
                <div className="list-item"><span>Rank</span><span className="chip">{arenaView.rank + 1}</span></div>
                <div className="list-item"><span>Leader</span><span className="chip">{arenaView.is_leader ? "Yes" : "No"}</span></div>
                <div className="list-item"><span>Champion Pot</span><span className="chip">{formatScaledInt(arenaView.champion_pot)}</span></div>
                <div className="list-item"><span>Pending Coins</span><span className="chip">{formatScaledInt(arenaView.pending_leader_income.coins)}</span></div>
                <div className="list-item"><span>Pending XP</span><span className="chip">{formatScaledInt(arenaView.pending_leader_income.xp)}</span></div>
              </div>
            ) : null}
          </article>

          <article className="module">
            <h2>Challenge Candidates</h2>
            {candidates.length > 0 ? (
              <div className="list-block">
                {candidates.map((candidate) => (
                  <div className="list-item" key={candidate}>
                    <span>{candidate}</span>
                    <div className="row">
                      <span className="chip">Target</span>
                      <button
                        className="primary"
                        onClick={() => void challengeTarget(candidate)}
                        disabled={loading || challengingTarget !== null}
                      >
                        {challengingTarget === candidate ? "Challenging..." : "Challenge"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="status">No candidates available right now.</div>
            )}
            <div className="row">
              <button disabled>Battle log (next iteration)</button>
            </div>
          </article>

          <article className="module">
            <h2>Top 5 in Tier</h2>
            {tierTop.length > 0 ? (
              <div className="list-block">
                {tierTop.map((accountId, index) => (
                  <div className="list-item" key={accountId}>
                    <span>{index + 1}. {accountId}</span>
                    <span className="chip">Tier {arenaView?.tier ?? "-"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="status">No ladder entries available for this tier yet.</div>
            )}
          </article>

          <article className="module">
            <h2>Combat History</h2>
            {history.length > 0 ? (
              <div className="list-block">
                {history.map((entry) => (
                  <div className="list-item" key={entry.id}>
                    <span>
                      {entry.result.draw ? "DRAW" : entry.result.attacker_won ? "VICTORY" : "DEFEAT"} vs {entry.result.defender.account_id}
                    </span>
                    <div className="row">
                      <span className="chip">{new Date(entry.createdAtIso).toLocaleString()}</span>
                      {entry.legacy ? <span className="chip">Legacy</span> : null}
                      <button className="primary" onClick={() => setCombatResult(entry.result)}>
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="status">No combat history yet on this browser for this account.</div>
            )}
          </article>

          {combatResult ? (
            <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Challenge result">
              <div className="modal-card challenge-modal-card" onClick={(event) => event.stopPropagation()}>
                <header className="challenge-modal-header">
                  <h2 className={combatResult.attacker_won ? "combat-title-win" : combatResult.draw ? "combat-title-draw" : "combat-title-loss"}>
                    {combatResult.draw ? "DRAW" : combatResult.attacker_won ? "VICTORY" : "DEFEAT"}
                  </h2>
                  <div className="row">
                    <span className="chip">Rounds: {combatResult.rounds}</span>
                    <span className="chip">You dealt: {formatScaledInt(combatResult.attacker_total_damage)}</span>
                    <span className="chip">You took: {formatScaledInt(combatResult.defender_total_damage)}</span>
                  </div>
                </header>

                <section className="combatants-grid">
                  <article className="combatant-card">
                    <h3>You</h3>
                    <div className="list-block">
                      <div className="list-item"><span>Account</span><span className="chip">{combatResult.attacker.account_id}</span></div>
                      <div className="list-item"><span>Level</span><span className="chip">{combatResult.attacker.level}</span></div>
                      <div className="list-item"><span>STR</span><span className="chip">{formatScaledInt(combatResult.attacker.strength)}</span></div>
                      <div className="list-item"><span>DEX</span><span className="chip">{formatScaledInt(combatResult.attacker.dexterity)}</span></div>
                      <div className="list-item"><span>VIT</span><span className="chip">{formatScaledInt(combatResult.attacker.vitality)}</span></div>
                      <div className="list-item"><span>HP Start</span><span className="chip">{formatScaledInt(combatResult.attacker.hp_at_start)}</span></div>
                      <div className="list-item"><span>HP End</span><span className="chip">{formatScaledInt(combatResult.attacker.hp_at_end)}</span></div>
                    </div>
                  </article>

                  <article className="combatant-card">
                    <h3>Rival</h3>
                    <div className="list-block">
                      <div className="list-item"><span>Account</span><span className="chip">{combatResult.defender.account_id}</span></div>
                      <div className="list-item"><span>Level</span><span className="chip">{combatResult.defender.level}</span></div>
                      <div className="list-item"><span>STR</span><span className="chip">{formatScaledInt(combatResult.defender.strength)}</span></div>
                      <div className="list-item"><span>DEX</span><span className="chip">{formatScaledInt(combatResult.defender.dexterity)}</span></div>
                      <div className="list-item"><span>VIT</span><span className="chip">{formatScaledInt(combatResult.defender.vitality)}</span></div>
                      <div className="list-item"><span>HP Start</span><span className="chip">{formatScaledInt(combatResult.defender.hp_at_start)}</span></div>
                      <div className="list-item"><span>HP End</span><span className="chip">{formatScaledInt(combatResult.defender.hp_at_end)}</span></div>
                    </div>
                  </article>
                </section>

                <section>
                  <h3>Combat log</h3>
                  {combatResult.round_logs.length > 0 ? (
                    <div className="combat-log-list">
                      {combatResult.round_logs.map((round) => (
                        <article className="combat-log-item" key={`round-${round.round}`}>
                          <strong>Round {round.round}</strong>
                          {round.skipped ? (
                            <p>Skipped (combat already resolved)</p>
                          ) : (
                            <>
                              <p>
                                You: {round.attacker_hit ? `hit for ${formatScaledInt(round.attacker_damage)}` : "missed"}
                              </p>
                              <p>
                                Rival: {round.defender_hit ? `hit for ${formatScaledInt(round.defender_damage)}` : "missed"}
                              </p>
                              <p>
                                HP after round: You {formatScaledInt(round.attacker_hp_after)} / Rival {formatScaledInt(round.defender_hp_after)}
                              </p>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="status">
                      Detailed round logs are not available for this battle result. Redeploy the latest contract to get full logs.
                    </div>
                  )}
                </section>

                <div className="row">
                  <button className="primary" onClick={() => setCombatResult(null)}>Close</button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </SessionGate>
  );
}
