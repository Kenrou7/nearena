import { parseU128, type ChallengeResultView, type CombatSummaryView } from "@/lib/near-rpc";

export type ViewerOutcome = "win" | "loss" | "draw";

/** Combat outcome from the point of view of `viewerAccountId` (attacker or defender). */
export function viewerOutcome(summary: CombatSummaryView, viewerAccountId: string): ViewerOutcome {
  if (summary.outcome === "Draw") {
    return "draw";
  }
  const viewerAttacked = summary.attacker_id === viewerAccountId;
  const attackerWon = summary.outcome === "AttackerWins";
  return viewerAttacked === attackerWon ? "win" : "loss";
}

export function opponentOf(summary: CombatSummaryView, viewerAccountId: string): string {
  return summary.attacker_id === viewerAccountId ? summary.defender_id : summary.attacker_id;
}

/** Game coins the viewer gained (positive) or lost (negative) in this combat. */
export function viewerCoinDelta(summary: CombatSummaryView, viewerAccountId: string): bigint {
  const outcome = viewerOutcome(summary, viewerAccountId);
  const stolen = parseU128(summary.coins_stolen);
  if (outcome === "win") {
    const pot = summary.attacker_id === viewerAccountId ? parseU128(summary.champion_pot_claimed) : 0n;
    return stolen + pot;
  }
  return outcome === "loss" ? -stolen : 0n;
}

/** 1-based ranks before and after the combat for the viewer, or null when it did not move. */
export function viewerRankChange(
  summary: CombatSummaryView,
  viewerAccountId: string,
): { before: number; after: number } | null {
  if (summary.outcome !== "AttackerWins") {
    return null;
  }
  // The attacker takes the defender's rank; the defender drops exactly one place.
  if (summary.attacker_id === viewerAccountId) {
    return { before: summary.attacker_rank_before + 1, after: summary.defender_rank_before + 1 };
  }
  return { before: summary.defender_rank_before + 1, after: summary.defender_rank_before + 2 };
}

/** Swaps a combat result so "self" is the viewer, whether they attacked or defended. */
export function resultFromViewer(result: ChallengeResultView, viewerAccountId: string | null) {
  const viewerAttacked = viewerAccountId === null || result.attacker.account_id === viewerAccountId;
  const outcome: ViewerOutcome = result.draw ? "draw" : result.attacker_won === viewerAttacked ? "win" : "loss";

  return {
    viewerAttacked,
    outcome,
    self: viewerAttacked ? result.attacker : result.defender,
    rival: viewerAttacked ? result.defender : result.attacker,
    damageDealt: viewerAttacked ? result.attacker_total_damage : result.defender_total_damage,
    damageTaken: viewerAttacked ? result.defender_total_damage : result.attacker_total_damage,
    rounds: result.round_logs.map((round) => ({
      round: round.round,
      skipped: round.skipped,
      selfHit: viewerAttacked ? round.attacker_hit : round.defender_hit,
      selfDamage: viewerAttacked ? round.attacker_damage : round.defender_damage,
      rivalHit: viewerAttacked ? round.defender_hit : round.attacker_hit,
      rivalDamage: viewerAttacked ? round.defender_damage : round.attacker_damage,
      selfHpAfter: viewerAttacked ? round.attacker_hp_after : round.defender_hp_after,
      rivalHpAfter: viewerAttacked ? round.defender_hp_after : round.attacker_hp_after,
    })),
  };
}
