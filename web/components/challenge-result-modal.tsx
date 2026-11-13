"use client";

import { useEffect } from "react";
import {
  CombatTitle,
  FightersHp,
  OutcomeFlash,
  activeRoundCount,
  useCombatReveal,
  useFollowLatest,
} from "@/components/combat-reveal";
import { resultFromViewer } from "@/lib/combat-history";
import { formatScaledInt, type ChallengeResultView } from "@/lib/near-rpc";

const OUTCOME_LABEL = { win: "VICTORY", loss: "DEFEAT", draw: "DRAW" } as const;

/**
 * Arena combat report. Fresh fights (`animate`) are replayed round by round and end with a
 * centred VICTORY/DEFEAT flash; history entries open fully revealed.
 */
export function ChallengeResultModal({
  result,
  viewerAccountId,
  animate,
  onClose,
}: {
  result: ChallengeResultView;
  viewerAccountId: string | null;
  animate: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const view = resultFromViewer(result, viewerAccountId);
  const logs = result.round_logs;
  const { shown, phase, skip, revealed } = useCombatReveal(activeRoundCount(logs), logs.length, animate);
  const logRef = useFollowLatest<HTMLDivElement>(shown);
  const selfSide: "attacker" | "defender" = view.viewerAttacked ? "attacker" : "defender";
  const rivalSide: "attacker" | "defender" = view.viewerAttacked ? "defender" : "attacker";
  const label = OUTCOME_LABEL[view.outcome];
  const fighters = [
    { title: "You", snapshot: view.self, side: selfSide },
    { title: "Rival", snapshot: view.rival, side: rivalSide },
  ];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Challenge result" onClick={onClose}>
      <div className="modal-card challenge-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="challenge-modal-header">
          <div className="challenge-modal-title-row">
            <CombatTitle outcome={view.outcome} label={label} phase={phase} onSkip={skip} />
            <button className="cart-line-remove" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="row">
            <span className="chip">{view.viewerAttacked ? "You attacked" : "You defended"}</span>
            {revealed ? (
              <>
                <span className="chip">Rounds: {result.rounds}</span>
                <span className="chip">You dealt: {formatScaledInt(view.damageDealt)}</span>
                <span className="chip">You took: {formatScaledInt(view.damageTaken)}</span>
              </>
            ) : null}
          </div>
          <FightersHp fighters={fighters} logs={logs} shown={shown} revealed={revealed} />
        </header>

        <div className="challenge-modal-body">
          <section className="combatants-grid">
            {fighters.map(({ title, snapshot }) => {
              return (
                <article className="combatant-card" key={title}>
                  <h3>{title}</h3>
                  <div className="list-block">
                    <div className="list-item"><span>Account</span><span className="chip">{snapshot.account_id}</span></div>
                    <div className="list-item"><span>Level</span><span className="chip">{snapshot.level}</span></div>
                    <div className="list-item"><span>STR</span><span className="chip">{formatScaledInt(snapshot.strength)}</span></div>
                    <div className="list-item"><span>DEX</span><span className="chip">{formatScaledInt(snapshot.dexterity)}</span></div>
                    <div className="list-item"><span>VIT</span><span className="chip">{formatScaledInt(snapshot.vitality)}</span></div>
                    <div className="list-item"><span>HP Start</span><span className="chip">{formatScaledInt(snapshot.hp_at_start)}</span></div>
                    {revealed ? (
                      <div className="list-item"><span>HP End</span><span className="chip">{formatScaledInt(snapshot.hp_at_end)}</span></div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>

          <section>
            <h3>Combat log</h3>
            {view.rounds.length > 0 ? (
              <div className="combat-log-list" ref={logRef}>
                {view.rounds.slice(0, shown).map((round) => (
                  <article className={`combat-log-item${animate ? " combat-log-item-enter" : ""}`} key={`round-${round.round}`}>
                    <strong>Round {round.round}</strong>
                    {round.skipped ? (
                      <p>Skipped (combat already resolved)</p>
                    ) : (
                      <>
                        <p>You: {round.selfHit ? `hit for ${formatScaledInt(round.selfDamage)}` : "missed"}</p>
                        <p>Rival: {round.rivalHit ? `hit for ${formatScaledInt(round.rivalDamage)}` : "missed"}</p>
                        <p>
                          HP after round: You {formatScaledInt(round.selfHpAfter)} / Rival {formatScaledInt(round.rivalHpAfter)}
                        </p>
                      </>
                    )}
                  </article>
                ))}
                {phase === "rounds" ? (
                  <div className="combat-log-typing" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="status">Detailed round logs are not available for this battle result.</div>
            )}
          </section>
        </div>

        <footer className="challenge-modal-footer">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
      {phase === "flash" ? <OutcomeFlash outcome={view.outcome} label={label} onDismiss={skip} /> : null}
    </div>
  );
}
