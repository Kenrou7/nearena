"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RevealPhase } from "@/components/combat-reveal";
import { roundsRevealedAt, type BattleOutcome, type BattleVideo } from "@/lib/battle-videos";
import { TEXTS } from "@/lib/texts";

const T = TEXTS.combat;
/** If the video stalls or never plays, the outcome is shown anyway after this extra time. */
const STALL_GRACE_MS = 4_000;

/**
 * Full-screen battle video for a fresh fight. The video time drives the replay: rounds are
 * revealed as it plays (`onProgress`) and `onCue` fires at the decisive moment, so the outcome
 * flash lands exactly when the creature goes down. `hud` (HP bars, latest round) sits below.
 */
export function FightCinematic({
  video,
  outcome,
  phase,
  activeRounds,
  onProgress,
  onCue,
  onSkip,
  hud,
}: {
  video: BattleVideo;
  outcome: BattleOutcome;
  phase: RevealPhase;
  activeRounds: number;
  onProgress: (rounds: number) => void;
  onCue: () => void;
  onSkip: () => void;
  hud: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const { cueSec, pauseAtCue } = video.cues[outcome];

  // Autoplay with sound when allowed; browsers that block it get a muted start and a sound button.
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.muted = false;
    element.play().catch(() => {
      element.muted = true;
      setMuted(true);
      element.play().catch(() => onCue());
    });
  }, [onCue]);

  // Follow the video clock frame by frame while the rounds are being revealed.
  useEffect(() => {
    if (phase !== "rounds") {
      return;
    }
    const element = ref.current;
    let frame = 0;
    const tick = () => {
      if (!element) {
        return;
      }
      const time = element.currentTime;
      onProgress(roundsRevealedAt(time, cueSec, activeRounds));
      if (time >= cueSec) {
        if (pauseAtCue) {
          element.pause();
        }
        onCue();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const stall = setTimeout(onCue, cueSec * 1000 + STALL_GRACE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(stall);
    };
  }, [phase, cueSec, pauseAtCue, activeRounds, onProgress, onCue]);

  const skip = () => {
    const element = ref.current;
    if (element && phase === "rounds") {
      element.currentTime = cueSec;
      if (pauseAtCue) {
        element.pause();
      }
    }
    onSkip();
  };

  const frozen = pauseAtCue && phase !== "rounds";

  return (
    <div className="fight-cinematic" onClick={(event) => event.stopPropagation()}>
      <div className="fight-cinematic-stage">
        <div className={`fight-cinematic-frame${frozen ? ` fight-cinematic-frozen-${outcome}` : ""}`}>
          <video ref={ref} src={video.src} playsInline preload="auto" onError={onCue} />
        </div>
        <div className="fight-cinematic-controls">
          {muted ? (
            <button
              onClick={() => {
                if (ref.current) {
                  ref.current.muted = false;
                  setMuted(false);
                }
              }}
            >
              {T.unmute}
            </button>
          ) : null}
          {phase === "rounds" ? <button onClick={skip}>{T.skip}</button> : null}
        </div>
        <div className="fight-cinematic-hud">{hud}</div>
      </div>
    </div>
  );
}
