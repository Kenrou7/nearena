"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { CreatureArt } from "@/components/creature-art";
import { CurrencyAmount } from "@/components/currency-amount";
import { SessionGate } from "@/components/session-gate";
import { startExpeditionAction } from "@/lib/game-actions";
import { getItemDisplayName } from "@/lib/item-catalog";
import {
  formatScaledInt,
  getExpeditionHistory,
  parseU128,
  type CombatOutcome,
  type CreatureView,
  type ExpeditionResultView,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryOptions } from "@/lib/near-query";
import { formatHpProgress } from "@/lib/player-format";
import { TEXTS } from "@/lib/texts";
import { sendGameTransaction } from "@/lib/wallet-signer";
import { getPlayerAccountId, getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const T = TEXTS.expeditions;
/** Mirrors `EXPEDITION_MIN_HP_BPS` in the game contract (20% of max effective HP). */
const EXPEDITION_MIN_HP_BPS = 2_000n;
const RECENT_LIMIT = 10;
/** The new expedition can take a moment to show up on the RPC node that serves the read. */
const RESULT_LOOKUP_ATTEMPTS = 5;
const RESULT_LOOKUP_DELAY_MS = 1_200;

type OutcomeKey = "win" | "loss" | "draw";

function outcomeKey(outcome: CombatOutcome): OutcomeKey {
  return outcome === "AttackerWins" ? "win" : outcome === "DefenderWins" ? "loss" : "draw";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blockedReason(player: PlayerView | null | undefined): string | null {
  if (!player) {
    return T.blockedNoPlayer;
  }
  const hp = parseU128(player.current_hp);
  const maxHp = parseU128(player.max_hp);
  return hp < (maxHp * EXPEDITION_MIN_HP_BPS) / 10_000n ? T.blockedLowHp : null;
}

async function latestExpeditionId(accountId: string): Promise<number> {
  const page = await getExpeditionHistory(accountId, 0, 1);
  return page.items[0]?.id ?? 0;
}

export default function ExpeditionsPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [fightingCreature, setFightingCreature] = useState<string | null>(null);
  const [fightError, setFightError] = useState<string | null>(null);
  const [result, setResult] = useState<ExpeditionResultView | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => setSession(getWalletSession()));
  }, []);

  const accountId = getPlayerAccountId(session);
  const playerQuery = useQuery({ ...nearQueryOptions.player(accountId ?? ""), enabled: accountId !== null });
  const creaturesQuery = useQuery(nearQueryOptions.creatures());
  const recentQuery = useQuery({
    ...nearQueryOptions.expeditionHistory(accountId ?? "", RECENT_LIMIT),
    enabled: accountId !== null,
  });

  const player = accountId ? playerQuery.data : undefined;
  const blocked = playerQuery.isPending ? null : blockedReason(player);

  const fight = useCallback(
    async (creature: CreatureView) => {
      if (!accountId) {
        return;
      }
      setFightError(null);
      setFightingCreature(creature.id);
      try {
        const previousId = await latestExpeditionId(accountId);
        await sendGameTransaction([startExpeditionAction(creature.id)]);

        // Read the stored expedition back (works the same for NEAR wallets and Solana relays).
        let expeditionId = 0;
        for (let attempt = 0; attempt < RESULT_LOOKUP_ATTEMPTS && expeditionId <= previousId; attempt += 1) {
          if (attempt > 0) {
            await delay(RESULT_LOOKUP_DELAY_MS);
          }
          expeditionId = await latestExpeditionId(accountId);
        }
        if (expeditionId <= previousId) {
          throw new Error(T.resultNotVisible);
        }

        const replay = await queryClient.fetchQuery(nearQueryOptions.expeditionReplay(expeditionId));
        if (!replay) {
          throw new Error(T.resultUnreadable);
        }
        setResult(replay);
      } catch (error) {
        setFightError(error instanceof Error ? error.message : String(error));
      } finally {
        setFightingCreature(null);
        await invalidateNearQueries(queryClient);
      }
    },
    [accountId, queryClient],
  );

  async function openExpedition(expeditionId: number) {
    setOpenError(null);
    setOpeningId(expeditionId);
    try {
      const replay = await queryClient.fetchQuery(nearQueryOptions.expeditionReplay(expeditionId));
      if (!replay) {
        throw new Error(T.noLongerStored);
      }
      setResult(replay);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningId(null);
    }
  }

  const creatureName = (creatureId: string) =>
    creaturesQuery.data?.find((creature) => creature.id === creatureId)?.name ?? creatureId;

  return (
    <SessionGate title={T.gateTitle} description={T.gateDescription}>
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">{T.eyebrow}</p>
            <h2>{T.title}</h2>
            <p className="muted">{T.subtitle}</p>
          </header>

          <article className="module expedition-hp">
            <span>{T.yourHp}</span>
            {player ? (
              <strong className={blocked === T.blockedLowHp ? "compare-worse" : undefined}>{formatHpProgress(player)}</strong>
            ) : (
              <span className="skeleton arena-row-skeleton-small expedition-hp-skeleton" aria-busy="true" />
            )}
          </article>

          <h3>{T.creaturesHeading}</h3>
          {creaturesQuery.isPending ? (
            <div className="expedition-grid" aria-busy="true">
              <div className="skeleton expedition-card-skeleton" />
            </div>
          ) : creaturesQuery.isError ? (
            <div className="status">
              {T.couldNotLoadCreatures} {creaturesQuery.error.message}
            </div>
          ) : creaturesQuery.data.length === 0 ? (
            <div className="status">{T.noCreatures}</div>
          ) : (
            <div className="expedition-grid">
              {creaturesQuery.data.map((creature) => (
                <article className="module expedition-card" key={creature.id}>
                  <CreatureArt creatureId={creature.id} />
                  <h3>{creature.name}</h3>

                  <div className="expedition-actions">
                    {blocked ? <span className="meta-row">{blocked}</span> : null}
                    <button
                      className="primary"
                      disabled={Boolean(blocked) || playerQuery.isPending || fightingCreature !== null}
                      onClick={() => void fight(creature)}
                    >
                      {fightingCreature === creature.id ? T.fighting : T.fight}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {fightError ? (
            <div className="status" role="alert">
              {T.fightFailed} {fightError}
            </div>
          ) : null}

          <article className="module arena-history">
            <h2>{T.recentHeading}</h2>
            {recentQuery.isPending ? (
              <div className="list-block" aria-busy="true">
                {[0, 1, 2].map((index) => (
                  <div className="skeleton arena-row-skeleton-small" key={index} />
                ))}
              </div>
            ) : !recentQuery.data || recentQuery.data.items.length === 0 ? (
              <div className="status">{T.noRecent}</div>
            ) : (
              <div className="list-block arena-scroll">
                {recentQuery.data.items.map((summary) => {
                  const outcome = outcomeKey(summary.outcome);
                  const coins = parseU128(summary.game_coins_gained);
                  return (
                    <div className="list-item arena-compact-row arena-history-row" key={summary.id}>
                      <span className={`arena-outcome arena-outcome-${outcome}`}>
                        {outcome === "win" ? "W" : outcome === "loss" ? "L" : "D"}
                      </span>
                      <span className="arena-account">
                        {creatureName(summary.creature_id)} · {T.statLevel} {summary.creature_level}
                      </span>
                      <span className="arena-history-meta">
                        {coins > 0n ? (
                          <span className="arena-delta-up">
                            +<CurrencyAmount value={coins} currency="GC" />
                          </span>
                        ) : null}
                        <span>{T.xp(`+${formatScaledInt(summary.xp_gained)}`)}</span>
                        {summary.drop ? <span className="chip">{getItemDisplayName(summary.drop.item_id)}</span> : null}
                        <span className="meta-row">
                          {new Date(summary.timestamp_sec * 1000).toLocaleString([], {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      </span>
                      {summary.replayable ? (
                        <button disabled={openingId !== null} onClick={() => void openExpedition(summary.id)}>
                          {openingId === summary.id ? T.loading : T.open}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {openError ? (
              <div className="status" role="alert">
                {T.couldNotOpen} {openError}
              </div>
            ) : null}
          </article>

          {result ? <ExpeditionResultModal result={result} onClose={() => setResult(null)} /> : null}
        </section>
      </main>
    </SessionGate>
  );
}

/** Strikes in the order they happened; a side knocked out by the first strike never swings. */
function roundLines(result: ExpeditionResultView, round: ExpeditionResultView["round_logs"][number]): string[] {
  const you = T.roundYou(round.attacker_hit, formatScaledInt(round.attacker_damage));
  const creature = T.roundCreature(result.creature.name, round.defender_hit, formatScaledInt(round.defender_damage));
  if (result.player_first) {
    return round.defender_defeated ? [you] : [you, creature];
  }
  return round.attacker_defeated ? [creature] : [creature, you];
}

function ExpeditionResultModal({ result, onClose }: { result: ExpeditionResultView; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const outcome = outcomeKey(result.outcome);
  const name = result.creature.name;
  const fighters = [
    { title: T.you, snapshot: result.player },
    { title: name, snapshot: result.creature },
  ];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={T.resultLabel} onClick={onClose}>
      <div className="modal-card challenge-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="challenge-modal-header">
          <div className="challenge-modal-title-row">
            <h2 className={`combat-title-${outcome}`}>{T.outcome[outcome]}</h2>
            <button className="cart-line-remove" aria-label={T.close} onClick={onClose}>
              ×
            </button>
          </div>
          <div className="row">
            <span className="chip">{result.player_first ? T.youStruckFirst : T.creatureStruckFirst(name)}</span>
            <span className="chip">{T.rounds(result.rounds)}</span>
            <span className="chip">{T.youDealt(formatScaledInt(result.player_total_damage))}</span>
            <span className="chip">{T.youTook(formatScaledInt(result.creature_total_damage))}</span>
          </div>
        </header>

        <div className="challenge-modal-body">
          <section className="expedition-rewards-earned">
            <h3>{T.rewardsEarned}</h3>
            <div className="row">
              <span className="chip">
                +<CurrencyAmount value={parseU128(result.game_coins_gained)} currency="GC" />
              </span>
              <span className="chip">{T.xp(`+${formatScaledInt(result.xp_gained)}`)}</span>
              <span className={result.drop ? "chip expedition-drop" : "meta-row"}>
                {result.drop ? T.dropped(getItemDisplayName(result.drop.item_id)) : T.noDrop}
              </span>
            </div>
          </section>

          <section className="combatants-grid">
            {fighters.map(({ title, snapshot }) => (
              <article className="combatant-card" key={title}>
                <h3>{title}</h3>
                <div className="list-block">
                  <div className="list-item"><span>{T.statLevel}</span><span className="chip">{snapshot.level}</span></div>
                  <div className="list-item"><span>{T.statStr}</span><span className="chip">{formatScaledInt(snapshot.strength)}</span></div>
                  <div className="list-item"><span>{T.statDex}</span><span className="chip">{formatScaledInt(snapshot.dexterity)}</span></div>
                  <div className="list-item"><span>{T.statVit}</span><span className="chip">{formatScaledInt(snapshot.vitality)}</span></div>
                  <div className="list-item"><span>{T.statHpStart}</span><span className="chip">{formatScaledInt(snapshot.hp_at_start)}</span></div>
                  <div className="list-item"><span>{T.statHpEnd}</span><span className="chip">{formatScaledInt(snapshot.hp_at_end)}</span></div>
                </div>
              </article>
            ))}
          </section>

          <section>
            <h3>{T.combatLog}</h3>
            <div className="combat-log-list">
              {result.round_logs.map((round) => (
                <article className="combat-log-item" key={`round-${round.round}`}>
                  <strong>{T.round(round.round)}</strong>
                  {round.skipped ? (
                    <p>{T.roundSkipped}</p>
                  ) : (
                    <>
                      {roundLines(result, round).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      <p>
                        {T.roundHp(
                          formatScaledInt(round.attacker_hp_after),
                          name,
                          formatScaledInt(round.defender_hp_after),
                        )}
                      </p>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>

        <footer className="challenge-modal-footer">
          <button className="primary" onClick={onClose}>
            {T.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
