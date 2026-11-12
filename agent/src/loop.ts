import { decideTurn, type LlmClient } from "./brain.js";
import type { GameClient } from "./game-client.js";
import { loadSnapshot, scaled } from "./game-state.js";
import { formatDecision, toContractCall, type Decision } from "./tools.js";
import type { ChallengeResult, ExpeditionResult } from "./types.js";
import { ALLOWED_METHODS } from "./validator.js";

export type Logger = (line: string) => void;

export type LoopOptions = {
  game: GameClient;
  llm: LlmClient | null;
  accountId: string;
  turns: number;
  turnDelayMs: number;
  dryRun: boolean;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
};

export type TurnRecord = { turn: number; decision: Decision; source: "llm" | "fallback"; outcome: string };

const MAX_CONSECUTIVE_FAILURES = 3;
const RECENT_EVENTS_KEPT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function describeResult(decision: Decision, result: unknown): string {
  if (decision.tool === "challenge" && isRecord(result) && "attacker_won" in result) {
    const fight = result as ChallengeResult;
    const verdict = fight.draw ? "draw" : fight.attacker_won ? "WON" : "lost";
    return `${verdict} vs ${decision.opponent_account_id} in ${fight.rounds} rounds (combat #${fight.combat_id})`;
  }
  if (decision.tool === "start_expedition" && isRecord(result) && "outcome" in result) {
    const run = result as ExpeditionResult;
    const verdict = run.outcome === "AttackerWins" ? "WON" : run.outcome === "Draw" ? "draw" : "lost";
    const drop = run.drop === null ? "" : `, dropped ${run.drop.item_id}`;
    return `${verdict} vs ${decision.creature_id}: +${scaled(run.game_coins_gained)} coins, +${run.xp_gained} xp${drop}`;
  }
  return "ok";
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The agent loop: observe (views) → decide (NEAR AI + guard) → act (signed tx) → repeat. */
export async function runLoop(options: LoopOptions): Promise<TurnRecord[]> {
  const { game, llm, log } = options;
  const sleep = options.sleep ?? defaultSleep;
  const records: TurnRecord[] = [];
  const recentEvents: string[] = [];
  let consecutiveFailures = 0;

  log(`bot ${options.accountId} | brain: ${llm === null ? "rules only" : `NEAR AI (${llm.model})`} | dry-run: ${options.dryRun}`);

  for (let turn = 1; turn <= options.turns; turn += 1) {
    const snapshot = await loadSnapshot(game, options.accountId);
    const player = snapshot.player;
    log(
      player === null
        ? `[turn ${turn}] state: not registered`
        : `[turn ${turn}] state: lvl ${player.level} | hp ${scaled(player.current_hp)}/${scaled(player.max_hp)} | coins ${scaled(player.game_coins)} | points ${player.unassigned_points} | rank ${snapshot.arena?.rank ?? "-"} tier ${snapshot.arena?.tier ?? "-"}`,
    );

    const choice = await decideTurn({ snapshot, llm, recentEvents });
    for (const issue of choice.llmIssues) {
      log(`[turn ${turn}]   ! ${issue}`);
    }
    log(`[turn ${turn}] ${choice.source === "llm" ? "NEAR AI" : "fallback"} → ${formatDecision(choice.decision)} — ${choice.reason}`);

    const call = toContractCall(choice.decision);
    let outcome: string;
    if (call === null) {
      outcome = "waited";
    } else if (!ALLOWED_METHODS.has(call.methodName)) {
      throw new Error(`refusing to call non-whitelisted method ${call.methodName}`);
    } else if (options.dryRun) {
      outcome = `dry-run: would call ${call.methodName}(${JSON.stringify(call.args)})`;
    } else {
      try {
        const result = await game.call(call);
        outcome = `${describeResult(choice.decision, result.result)} | tx ${result.txHash}`;
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        outcome = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    log(`[turn ${turn}]   ${outcome}`);

    records.push({ turn, decision: choice.decision, source: choice.source, outcome });
    recentEvents.push(`turn ${turn}: ${formatDecision(choice.decision)} → ${outcome}`);
    if (recentEvents.length > RECENT_EVENTS_KEPT) {
      recentEvents.shift();
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log(`stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive failed transactions`);
      break;
    }
    if (turn < options.turns) {
      await sleep(options.turnDelayMs);
    }
  }
  return records;
}
