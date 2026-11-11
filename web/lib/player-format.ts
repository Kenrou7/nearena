import { formatScaledInt, type PlayerView } from "./near-rpc";

/**
 * The contract subtracts each level's cost on level-up, so `xp` is the progress
 * inside the current level and `xp_to_next_level` is that level's full cost.
 */
export function formatXpProgress(player: Pick<PlayerView, "xp" | "xp_to_next_level">): string {
  return `${formatScaledInt(player.xp)} / ${formatScaledInt(player.xp_to_next_level)}`;
}

export function formatHpProgress(player: Pick<PlayerView, "current_hp" | "max_hp">): string {
  return `${formatScaledInt(player.current_hp)} / ${formatScaledInt(player.max_hp)}`;
}
