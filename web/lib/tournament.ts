import { parseU128, type TournamentView } from "@/lib/near-rpc";

const BPS_DENOMINATOR = 10_000n;

/** Prize for a 1-based place with the current pool, or null outside the paid places. */
export function prizeForRank(tournament: TournamentView, rank: number): bigint | null {
  const shareBps = tournament.prize_shares_bps[rank - 1];
  if (shareBps === undefined) {
    return null;
  }
  return (parseU128(tournament.prize_pool) * BigInt(shareBps)) / BPS_DENOMINATOR;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };

export function countdownParts(remainingSec: number): CountdownParts {
  const total = Math.max(0, Math.floor(remainingSec));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}
