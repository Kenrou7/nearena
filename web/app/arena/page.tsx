"use client";

import type { WalletSelector } from "@near-wallet-selector/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { SessionGate } from "@/components/session-gate";
import { PlayerCompareModal } from "@/components/player-compare-modal";
import {
  PotionQuickPanel,
  type PotionRow,
} from "@/components/potion-quick-panel";
import { useCart } from "@/components/cart-provider";
import { MAX_CART_UNITS, quantityInCart } from "@/lib/cart";
import type { BuyToken } from "@/lib/game-actions";
import { useActionQueue } from "@/components/action-queue-provider";
import { MAX_QUEUED_ACTIONS, queuedConsumeTokenIds } from "@/lib/action-queue";
import { getItemPresentation, SHOP_ITEM_IDS } from "@/lib/item-catalog";
import {
  type ChallengeResultView,
  formatScaledInt,
  parseU128,
  type ArenaView,
  type PlayerView,
} from "@/lib/near-rpc";
import { formatHpProgress } from "@/lib/player-format";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { resolveNearRpcProxyPath } from "@/lib/runtime-config";
import { sendGameTransaction } from "@/lib/wallet-signer";
import { getPlayerAccountId, getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const CALL_GAS = "100000000000000";
const NEAR_RPC_PROXY_PATH = resolveNearRpcProxyPath();
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
  const cart = useCart();
  const queue = useActionQueue();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [arenaView, setArenaView] = useState<ArenaView | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tierTop, setTierTop] = useState<string[]>([]);
  const [challengingTarget, setChallengingTarget] = useState<string | null>(null);
  const [combatResult, setCombatResult] = useState<ChallengeResultView | null>(null);
  const [history, setHistory] = useState<CombatHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Connect a NEAR wallet session to load arena data.");
  const [potions, setPotions] = useState<PotionRow[] | null>(null);
  const [hasSynced, setHasSynced] = useState(false);
  const [inspectedAccount, setInspectedAccount] = useState<string | null>(null);

  // NEAR account holding the player's state (the wallet, or a Solana player's derived account).
  const nearAccountId = getPlayerAccountId(session);
  const isNearWalletSession = session?.chain === "near";

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => {
      setSession(getWalletSession());
    });
  }, []);

  const ensureNearSelector = useCallback(async (): Promise<WalletSelector> => {
    if (selector) {
      return selector;
    }

    const nearWallet = await withTimeout(initNearWallet(NETWORK_ID, CONTRACT_ID), 12_000);
    setSelector(nearWallet.selector);
    return nearWallet.selector;
  }, [selector]);

  const refreshPotions = useCallback(async (playerData: PlayerView) => {
    try {
      const [definitionResults, tokenResults] = await Promise.all([
        Promise.allSettled(
          SHOP_ITEM_IDS.map((itemId) => queryClient.fetchQuery(nearQueryOptions.itemDefinition(itemId))),
        ),
        Promise.allSettled(
          playerData.owned_token_ids.map((tokenId) => queryClient.fetchQuery(nearQueryOptions.token(tokenId))),
        ),
      ]);

      const tokenIdsByItem = new Map<string, string[]>();
      for (const result of tokenResults) {
        if (result.status !== "fulfilled" || !result.value) {
          continue;
        }
        const { item_id: itemId, token_id: tokenId } = result.value;
        tokenIdsByItem.set(itemId, [...(tokenIdsByItem.get(itemId) ?? []), tokenId]);
      }

      const rows: PotionRow[] = [];
      for (const result of definitionResults) {
        const definition = result.status === "fulfilled" ? result.value : null;
        if (!definition || !definition.active || definition.slot !== "Consumable") {
          continue;
        }

        const presentation = getItemPresentation(definition.item_id);
        rows.push({
          itemId: definition.item_id,
          title: presentation.title,
          imageSrc: presentation.imageSrc,
          healAmount: parseU128(definition.vitality_bonus),
          ownedTokenIds: tokenIdsByItem.get(definition.item_id) ?? [],
          prices: {
            stable: parseU128(definition.price_stablecoin),
            game: parseU128(definition.price_game_coin),
          },
        });
      }

      rows.sort((a, b) => (a.healAmount < b.healAmount ? -1 : a.healAmount > b.healAmount ? 1 : 0));
      setPotions(rows);
    } catch {
      setPotions([]);
    }
  }, [queryClient]);

  const refreshArena = useCallback(async () => {
    if (!nearAccountId) {
      setPotions(null);
      setPlayer(null);
      setArenaView(null);
      setCandidates([]);
      setStatus("Connect a NEAR wallet session to load arena data.");
      setHasSynced(true);
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

      if (playerData) {
        void refreshPotions(playerData);
      } else {
        setPotions([]);
      }

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
      setHasSynced(true);
    }
  }, [nearAccountId, queryClient, refreshPotions]);

  useEffect(() => {
    void refreshArena();
  }, [refreshArena, cart.checkoutVersion, queue.appliedVersion]);

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
    if (!nearAccountId || !isNearWalletSession) {
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
  }, [ensureNearSelector, isNearWalletSession, nearAccountId, refreshArena]);

  const challengeTarget = useCallback(async (targetAccountId: string) => {
    if (!nearAccountId) {
      setStatus("NEAR session is required to challenge.");
      return;
    }

    try {
      setChallengingTarget(targetAccountId);
      setStatus(`Sending challenge transaction to ${targetAccountId}...`);

      const tx = await sendGameTransaction([
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
      ]);

      // NEAR wallets return the outcome directly; Solana relays only return the tx hash.
      const txHash = tx.txHash ?? extractTxHashFromWalletResponse(tx.outcome);
      let parsedResult = tx.outcome
        ? extractChallengeResultFromWalletResponse(tx.outcome, nearAccountId, targetAccountId)
        : null;

      if (!parsedResult && txHash) {
        parsedResult = await fetchChallengeResultFromTxHash(txHash, tx.signerId, nearAccountId, targetAccountId);
      }

      if (parsedResult) {
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
  }, [nearAccountId, pushHistory, queryClient, refreshArena]);

  const consumePotion = useCallback(
    (tokenId: string, potion: PotionRow) => queue.consume(tokenId, potion.itemId),
    [queue],
  );

  const addPotionToCart = useCallback(
    (potion: PotionRow, token: BuyToken) => cart.add(potion.itemId, token),
    [cart],
  );

  useEffect(() => {
    if (!combatResult) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCombatResult(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combatResult]);

  const actionsLocked = loading || challengingTarget !== null || queue.applying || cart.checkingOut;
  const hpCurrent = player ? parseU128(player.current_hp) : 0n;
  const hpMax = player ? parseU128(player.max_hp) : 0n;
  const hpPercent = hpMax > 0n ? Number((hpCurrent * 100n) / hpMax) : 0;
  const hpFull = hpMax > 0n && hpCurrent >= hpMax;
  const syncing = loading || !hasSynced;
  const standingLoading = syncing && !arenaView;
  const listsLoading = syncing && candidates.length === 0 && tierTop.length === 0;

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

          <div className="arena-toolbar">
            <div className="status arena-status">{status}</div>
            <button onClick={() => void refreshArena()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="arena-layout">
            <div className="arena-column arena-column-main">
              <article className="module arena-standing">
                <h2>Your standing</h2>
                {standingLoading ? (
                  <div aria-busy="true">
                    <div className="skeleton arena-hp-skeleton" />
                    <div className="arena-stat-tiles">
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <div className="skeleton arena-stat-tile-skeleton" key={index} />
                      ))}
                    </div>
                  </div>
                ) : player && arenaView ? (
                  <>
                    <div className="arena-hp">
                      <div className="arena-hp-label">
                        <span>HP</span>
                        <strong>{formatHpProgress(player)}</strong>
                      </div>
                      <div className="item-stat-track arena-hp-track" role="presentation">
                        <div className="item-stat-fill item-stat-fill-vitality" style={{ width: `${hpPercent}%` }} />
                      </div>
                    </div>
                    <div className="arena-stat-tiles">
                      <div className="arena-stat-tile">
                        <span>Tier</span>
                        <strong>{arenaView.tier}</strong>
                      </div>
                      <div className="arena-stat-tile">
                        <span>Rank</span>
                        <strong>#{arenaView.rank + 1}</strong>
                      </div>
                      <div className={`arena-stat-tile${arenaView.is_leader ? " arena-stat-tile-highlight" : ""}`}>
                        <span>Leader</span>
                        <strong>{arenaView.is_leader ? "Yes" : "No"}</strong>
                      </div>
                      <div className="arena-stat-tile">
                        <span>Champion pot</span>
                        <strong>{formatScaledInt(arenaView.champion_pot)}</strong>
                      </div>
                      <div className="arena-stat-tile">
                        <span>Pending coins</span>
                        <strong>{formatScaledInt(arenaView.pending_leader_income.coins)}</strong>
                      </div>
                      <div className="arena-stat-tile">
                        <span>Pending XP</span>
                        <strong>{formatScaledInt(arenaView.pending_leader_income.xp)}</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="status">No arena state loaded.</div>
                )}
              </article>

              <article className="module arena-candidates">
                <h2>Challenge candidates</h2>
                {listsLoading ? (
                  <div className="list-block" aria-busy="true">
                    {[0, 1, 2].map((index) => (
                      <div className="skeleton arena-row-skeleton" key={index} />
                    ))}
                  </div>
                ) : candidates.length > 0 ? (
                  <div className="list-block">
                    {candidates.map((candidate) => (
                      <div className="list-item arena-compact-row" key={candidate}>
                        <button className="arena-account arena-account-link" onClick={() => setInspectedAccount(candidate)}>
                          {candidate}
                        </button>
                        <button
                          className="primary"
                          onClick={() => void challengeTarget(candidate)}
                          disabled={actionsLocked}
                        >
                          {challengingTarget === candidate ? "Challenging..." : "Challenge"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="status">No candidates available right now.</div>
                )}
              </article>

              <article className="module arena-history">
                <h2>Combat history</h2>
                {history.length > 0 ? (
                  <div className="list-block arena-scroll">
                    {history.map((entry) => {
                      const outcome = entry.result.draw ? "draw" : entry.result.attacker_won ? "win" : "loss";
                      return (
                        <div className="list-item arena-compact-row" key={entry.id}>
                          <span className={`arena-outcome arena-outcome-${outcome}`}>
                            {outcome === "draw" ? "D" : outcome === "win" ? "W" : "L"}
                          </span>
                          <button
                            className="arena-account arena-account-link"
                            onClick={() => setInspectedAccount(entry.result.defender.account_id)}
                          >
                            {entry.result.defender.account_id}
                          </button>
                          <span className="meta-row">
                            {new Date(entry.createdAtIso).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                          </span>
                          {entry.legacy ? <span className="chip">Legacy</span> : null}
                          <button onClick={() => setCombatResult(entry.result)}>Open</button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="status">No combat history yet on this browser for this account.</div>
                )}
              </article>
            </div>

            <aside className="arena-column arena-column-side">
              <PotionQuickPanel
                potions={nearAccountId ? potions : []}
                balances={
                  player
                    ? { stable: parseU128(player.stablecoin_balance), game: parseU128(player.game_coins) }
                    : null
                }
                hpFull={hpFull}
                disabled={actionsLocked || !player || queue.actions.length >= MAX_QUEUED_ACTIONS}
                queuedTokenIds={queuedConsumeTokenIds(queue.actions)}
                onConsume={consumePotion}
                onAddToCart={addPotionToCart}
                inCart={(itemId, token) => quantityInCart(cart.lines, itemId, token)}
                cartFull={cart.units >= MAX_CART_UNITS}
              />

              <article className="module arena-top">
                <h2>Top 5 in tier {arenaView?.tier ?? ""}</h2>
                {listsLoading ? (
                  <div className="list-block" aria-busy="true">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <div className="skeleton arena-row-skeleton arena-row-skeleton-small" key={index} />
                    ))}
                  </div>
                ) : tierTop.length > 0 ? (
                  <ol className="arena-top-list">
                    {tierTop.map((accountId) => (
                      <li
                        key={accountId}
                        className={accountId === nearAccountId ? "arena-top-self" : undefined}
                      >
                        <button className="arena-account arena-account-link" onClick={() => setInspectedAccount(accountId)}>
                          {accountId}
                        </button>
                        {accountId === nearAccountId ? <span className="chip">You</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="status">No ladder entries available for this tier yet.</div>
                )}
              </article>
            </aside>
          </div>

          {inspectedAccount ? (
            <PlayerCompareModal
              rivalAccountId={inspectedAccount}
              self={player}
              isCandidate={candidates.includes(inspectedAccount)}
              challenging={challengingTarget === inspectedAccount}
              challengeLocked={actionsLocked}
              onChallenge={() => {
                const target = inspectedAccount;
                setInspectedAccount(null);
                void challengeTarget(target);
              }}
              onClose={() => setInspectedAccount(null)}
            />
          ) : null}

          {combatResult ? (
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Challenge result"
              onClick={() => setCombatResult(null)}
            >
              <div className="modal-card challenge-modal-card" onClick={(event) => event.stopPropagation()}>
                <header className="challenge-modal-header">
                  <div className="challenge-modal-title-row">
                    <h2 className={combatResult.attacker_won ? "combat-title-win" : combatResult.draw ? "combat-title-draw" : "combat-title-loss"}>
                      {combatResult.draw ? "DRAW" : combatResult.attacker_won ? "VICTORY" : "DEFEAT"}
                    </h2>
                    <button className="cart-line-remove" aria-label="Close" onClick={() => setCombatResult(null)}>
                      ×
                    </button>
                  </div>
                  <div className="row">
                    <span className="chip">Rounds: {combatResult.rounds}</span>
                    <span className="chip">You dealt: {formatScaledInt(combatResult.attacker_total_damage)}</span>
                    <span className="chip">You took: {formatScaledInt(combatResult.defender_total_damage)}</span>
                  </div>
                </header>

                <div className="challenge-modal-body">
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

                </div>

                <footer className="challenge-modal-footer">
                  <button className="primary" onClick={() => setCombatResult(null)}>Close</button>
                </footer>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </SessionGate>
  );
}
