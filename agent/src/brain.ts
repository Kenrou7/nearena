import { fallbackDecision } from "./fallback.js";
import { describeSnapshot, type GameSnapshot } from "./game-state.js";
import { TOOLS, parseToolCall, type Decision, type ToolDefinition } from "./tools.js";
import { validateDecision } from "./validator.js";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCallReply = { id: string; name: string; arguments: string };

/** Minimal LLM contract: given a conversation and tools, return the first tool call (or null). */
export interface LlmClient {
  readonly model: string;
  chooseTool(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolCallReply | null>;
}

export type BrainDecision = {
  decision: Decision;
  reason: string;
  source: "llm" | "fallback";
  /** Why the LLM output was not used, when the fallback kicked in. */
  llmIssues: string[];
};

export const SYSTEM_PROMPT = `You are an autonomous player of "Gladiator", an on-chain arena game on NEAR.
Goal: climb the arena ladder of your tier, level up and become tier leader.
Rules:
- Each turn you receive your current state as JSON and must call exactly ONE tool.
- Stats: strength = damage, dexterity = strikes first, vitality = max HP. Leveling gives unassigned points; spend them.
- You can only challenge accounts listed in challengeable_opponents (rivals ranked above you). Winning moves you up.
- Expeditions fight PvE creatures for coins, XP and item drops.
- Fighting (challenge or expedition) requires can_fight = true (HP >= 20% of max). HP regenerates over time; potions heal instantly.
- Equip gear for empty slots; buy gear with game coins when affordable.
- If you are tier leader (arena.is_leader), claim_leader_income.
Prefer actions that make progress. Use wait only when nothing else is valid.`;

const MAX_LLM_ATTEMPTS = 2;

function buildUserMessage(snapshot: GameSnapshot, recentEvents: readonly string[]): string {
  return JSON.stringify({ state: describeSnapshot(snapshot), recent_turns: recentEvents });
}

/**
 * Asks the LLM for the next action, validates it, and gives the model one chance to correct
 * itself with the validation error. Falls back to the deterministic strategy otherwise.
 */
export async function decideTurn(input: {
  snapshot: GameSnapshot;
  llm: LlmClient | null;
  recentEvents: readonly string[];
}): Promise<BrainDecision> {
  const { snapshot, llm } = input;
  const issues: string[] = [];

  if (llm !== null) {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(snapshot, input.recentEvents) },
    ];

    for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt += 1) {
      let reply: ToolCallReply | null;
      try {
        reply = await llm.chooseTool(messages, TOOLS);
      } catch (error) {
        issues.push(`llm error: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (reply === null) {
        issues.push("llm returned no tool call");
        break;
      }

      let problem: string;
      try {
        const parsed = parseToolCall(reply.name, reply.arguments);
        const validation = validateDecision(parsed.decision, snapshot);
        if (validation.ok) {
          return { ...parsed, source: "llm", llmIssues: issues };
        }
        problem = `invalid action ${reply.name}: ${validation.reason}`;
      } catch (error) {
        problem = `bad tool call ${reply.name}: ${error instanceof Error ? error.message : String(error)}`;
      }
      issues.push(problem);
      messages.push(
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: reply.id, type: "function", function: { name: reply.name, arguments: reply.arguments } }],
        },
        { role: "tool", tool_call_id: reply.id, content: `REJECTED: ${problem}. Choose another tool.` },
      );
    }
  }

  return { ...fallbackDecision(snapshot), source: "fallback", llmIssues: issues };
}
