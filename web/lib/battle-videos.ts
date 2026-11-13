export type BattleOutcome = "win" | "loss" | "draw";

/**
 * Battle cinematic for a PvE creature. `cueSec` is the moment the outcome flash appears; the
 * rounds of the log are spread evenly before it so the replay and the video stay in sync.
 * `pauseAtCue` freezes the video there (used while there is no dedicated clip for that outcome).
 */
export type BattleVideo = {
  src: string;
  cues: Record<BattleOutcome, { cueSec: number; pauseAtCue: boolean }>;
};

/**
 * Keyed by the contract's `creature_id`. The wolf clip only shows a victory: the wolf hits the
 * ground at ~4.75s. Until there are defeat/draw clips, those outcomes reuse the fight and freeze
 * it (bite on the shield at 3.0s for a defeat, both still standing at 4.3s for a draw).
 */
export const BATTLE_VIDEOS: Record<string, BattleVideo> = {
  wolf: {
    src: "/assets/battle/vs-wolf-victory.mp4",
    cues: {
      win: { cueSec: 4.75, pauseAtCue: false },
      loss: { cueSec: 3.0, pauseAtCue: true },
      draw: { cueSec: 4.3, pauseAtCue: true },
    },
  },
};

/** Round `k` (1-based) of `active` is revealed at k/(active+1) of the way to the cue. */
export function roundsRevealedAt(timeSec: number, cueSec: number, active: number): number {
  if (cueSec <= 0 || active <= 0) {
    return active;
  }
  return Math.min(active, Math.floor((timeSec / cueSec) * (active + 1)));
}
