"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatScaledInt, parseU128, type ChallengeRoundLog } from "@/lib/near-rpc";
import { TEXTS } from "@/lib/texts";

const T = TEXTS.combat;

/** Time between two revealed rounds of a fresh fight. */
export const ROUND_REVEAL_MS = 850;
/** Pause after the last round before the outcome flash. */
const OUTCOME_PAUSE_MS = 500;
/** How long the centred VICTORY/DEFEAT message stays on screen (matches the CSS animation). */
export const OUTCOME_FLASH_MS = 2_200;

export type CombatOutcomeKey = "win" | "loss" | "draw";

/** `rounds`: the log is still being written; `flash`: the outcome message is on screen. */
export type RevealPhase = "rounds" | "flash" | "done";

/**
 * Drives the dramatic replay of a fresh fight: rounds appear one at a time, then the outcome
 * flashes, then everything is revealed. Without `animate` (history replays) it starts at `done`.
 * Rounds after `activeRounds` (skipped, combat already resolved) are revealed with the outcome.
 */
export function useCombatReveal(
  activeRounds: number,
  totalRounds: number,
  animate: boolean,
  /** With an external clock (a battle video) rounds advance via `advanceTo` and the flash via `cue`. */
  externalClock = false,
) {
  const [shown, setShown] = useState(animate ? 0 : totalRounds);
  const [phase, setPhase] = useState<RevealPhase>(animate ? "rounds" : "done");

  useEffect(() => {
    if (phase === "rounds" && !externalClock) {
      if (shown < activeRounds) {
        const timer = setTimeout(() => setShown((value) => value + 1), shown === 0 ? 300 : ROUND_REVEAL_MS);
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => {
        setShown(totalRounds);
        setPhase("flash");
      }, OUTCOME_PAUSE_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "flash") {
      const timer = setTimeout(() => setPhase("done"), OUTCOME_FLASH_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, shown, activeRounds, totalRounds, externalClock]);

  /** First click jumps to the outcome flash; a click during the flash dismisses it. */
  const skip = useCallback(() => {
    setShown(totalRounds);
    setPhase((current) => (current === "rounds" ? "flash" : "done"));
  }, [totalRounds]);

  const advanceTo = useCallback(
    (count: number) => setShown((value) => Math.max(value, Math.min(count, activeRounds))),
    [activeRounds],
  );

  /** The external clock reached the decisive moment: show the outcome now. */
  const cue = useCallback(() => {
    setShown(totalRounds);
    setPhase((current) => (current === "rounds" ? "flash" : current));
  }, [totalRounds]);

  return { shown, phase, skip, advanceTo, cue, revealed: phase === "done" };
}

/** Rounds that matter for the replay: everything up to the last round that was not skipped. */
export function activeRoundCount(rounds: ChallengeRoundLog[]): number {
  let count = 0;
  rounds.forEach((round, index) => {
    if (!round.skipped) {
      count = index + 1;
    }
  });
  return count;
}

/** HP of one side after the `shown` revealed rounds, and whether the latest round hit it. */
export function liveFighterState(
  rounds: ChallengeRoundLog[],
  shown: number,
  side: "attacker" | "defender",
  snapshot: { hp_at_start: string; hp_at_end: string },
  revealed: boolean,
): { hp: string; hit: boolean } {
  const last = shown > 0 ? rounds[shown - 1] : undefined;
  if (revealed || !last) {
    return { hp: revealed ? snapshot.hp_at_end : snapshot.hp_at_start, hit: false };
  }
  return side === "attacker"
    ? { hp: last.attacker_hp_after, hit: !last.skipped && last.defender_hit }
    : { hp: last.defender_hp_after, hit: !last.skipped && last.attacker_hit };
}

/** Keeps the newest revealed round in view while the log is being written. */
export function useFollowLatest<T extends HTMLElement>(shown: number) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const last = ref.current?.lastElementChild;
    if (last instanceof HTMLElement) {
      last.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [shown]);
  return ref;
}

function CrossedSwords() {
  // Hand-drawn for NEARena: two blades swinging into each other.
  const blade = (
    <>
      <path d="M50 6 L55 14 L55 66 L45 66 L45 14 Z" className="fight-blade" />
      <rect x="34" y="66" width="32" height="6" rx="2" className="fight-guard" />
      <rect x="46" y="72" width="8" height="16" rx="2" className="fight-grip" />
      <circle cx="50" cy="92" r="5" className="fight-guard" />
    </>
  );
  return (
    <svg className="fight-swords" viewBox="0 0 160 110" aria-hidden="true">
      <g className="fight-sword fight-sword-left">
        <g transform="translate(30 5)">{blade}</g>
      </g>
      <g className="fight-sword fight-sword-right">
        <g transform="translate(30 5)">{blade}</g>
      </g>
      <g className="fight-sparks">
        <circle cx="80" cy="30" r="3" />
        <circle cx="70" cy="22" r="2" />
        <circle cx="91" cy="21" r="2" />
        <circle cx="66" cy="36" r="1.6" />
        <circle cx="95" cy="37" r="1.6" />
      </g>
    </svg>
  );
}

/** Full-screen loader while the fight transaction is being signed and executed. */
export function FightLoader({ opponent, preloadVideo }: { opponent: string; preloadVideo?: string }) {
  return (
    <div className="fight-loader" role="status" aria-live="polite">
      {/* Warms the browser cache so the battle video starts right away when the result arrives. */}
      {preloadVideo ? <video className="fight-loader-preload" src={preloadVideo} preload="auto" muted aria-hidden="true" /> : null}
      <div className="fight-loader-card">
        <CrossedSwords />
        <p className="fight-loader-title">{T.loaderTitle}</p>
        <p className="fight-loader-versus">{T.loaderVersus(opponent)}</p>
        <p className="muted fight-loader-hint">{T.loaderHint}</p>
      </div>
    </div>
  );
}

/** Big centred outcome message shown briefly at the end of a fresh fight. Click to dismiss. */
export function OutcomeFlash({
  outcome,
  label,
  onDismiss,
  overVideo = false,
}: {
  outcome: CombatOutcomeKey;
  label: string;
  onDismiss: () => void;
  /** Over a battle video the backdrop stays light so the decisive moment remains visible. */
  overVideo?: boolean;
}) {
  return (
    <div
      className={`outcome-flash outcome-flash-${outcome}${overVideo ? " outcome-flash-over-video" : ""}`}
      role="alert"
      onClick={(event) => {
        // Rendered inside the modal overlay, whose click closes the report.
        event.stopPropagation();
        onDismiss();
      }}
    >
      <span className="outcome-flash-text">{label}</span>
    </div>
  );
}

/**
 * Title of the result modal: "the fight is on" while rounds are revealed, the outcome after.
 * The skip button sits next to it during the replay.
 */
export function CombatTitle({
  outcome,
  label,
  phase,
  onSkip,
}: {
  outcome: CombatOutcomeKey;
  label: string;
  phase: RevealPhase;
  onSkip: () => void;
}) {
  if (phase === "done") {
    return <h2 className={`combat-title-${outcome} combat-title-reveal`}>{label}</h2>;
  }
  return (
    <div className="combat-title-live">
      <h2 className="combat-title-fighting">{T.inProgress}</h2>
      {phase === "rounds" ? (
        <button className="combat-skip" onClick={onSkip}>
          {T.skip}
        </button>
      ) : null}
    </div>
  );
}

/**
 * HP bar of one fighter. `hit` re-triggers the shake each time the fighter takes damage
 * (the parent changes `hitKey` per revealed round).
 */
export function FighterHpBar({
  name,
  current,
  max,
  hit,
  hitKey,
}: {
  name: string;
  current: string;
  max: string;
  hit: boolean;
  hitKey: string;
}) {
  const maxValue = parseU128(max);
  const currentValue = parseU128(current);
  const percent = maxValue > 0n ? Number((currentValue * 100n) / maxValue) : 0;
  const tone = percent > 50 ? "high" : percent > 20 ? "mid" : "low";
  return (
    <div key={hitKey} className={`fighter-hp${hit ? " fighter-hp-hit" : ""}`}>
      <div className="fighter-hp-track">
        <div className={`fighter-hp-fill fighter-hp-${tone}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <span className="fighter-hp-label">
        <strong>{name}</strong>
        <span>
          {formatScaledInt(current)} / {formatScaledInt(max)}
        </span>
      </span>
    </div>
  );
}

/**
 * Both fighters' live HP side by side. It lives in the modal header, which does not scroll,
 * so the bars stay visible while the log is written below.
 */
export function FightersHp({
  fighters,
  logs,
  shown,
  revealed,
}: {
  fighters: { title: string; snapshot: { max_hp: string; hp_at_start: string; hp_at_end: string }; side: "attacker" | "defender" }[];
  logs: ChallengeRoundLog[];
  shown: number;
  revealed: boolean;
}) {
  return (
    <div className="fighters-hp">
      {fighters.map(({ title, snapshot, side }) => {
        const live = liveFighterState(logs, shown, side, snapshot, revealed);
        return (
          <FighterHpBar
            key={title}
            name={title}
            current={live.hp}
            max={snapshot.max_hp}
            hit={live.hit}
            hitKey={`${side}-${shown}`}
          />
        );
      })}
    </div>
  );
}
