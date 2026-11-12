import type { ChatMessage, LlmClient, ToolCallReply } from "../src/brain.js";
import type { CallOutcome, ContractCall, GameClient } from "../src/game-client.js";
import type { ToolDefinition } from "../src/tools.js";
import type { NftToken, PlayerView } from "../src/types.js";
import { POTION, SWORD, WOLF, arena, player } from "./fixtures.js";

type Reply = ToolCallReply | null | Error;

/** Scripted LLM: returns the queued replies in order and records every conversation. */
export class ScriptedLlm implements LlmClient {
  public readonly model = "test-model";
  public readonly conversations: ChatMessage[][] = [];

  public constructor(private readonly replies: Reply[]) {}

  public async chooseTool(messages: ChatMessage[], _tools: ToolDefinition[]): Promise<ToolCallReply | null> {
    this.conversations.push([...messages]);
    const next = this.replies.shift();
    if (next === undefined) {
      throw new Error("ScriptedLlm ran out of replies");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

export const reply = (name: string, args: Record<string, unknown> = {}, id = "call-1"): ToolCallReply => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

/** In-memory `game` contract good enough to drive the loop: registration, points and fights. */
export class FakeGame implements GameClient {
  public readonly calls: ContractCall[] = [];
  public me: PlayerView | null = null;
  public failNextCalls = 0;
  public readonly tokens = new Map<string, NftToken>();

  public constructor(public readonly accountId = "bot.testnet") {}

  public async view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
    const value = ((): unknown => {
      switch (methodName) {
        case "get_player_view":
          return args.account_id === this.accountId ? this.me : player({ account_id: String(args.account_id), level: 1 });
        case "get_creatures":
          return [WOLF];
        case "get_item_definition":
          return [SWORD, POTION].find((item) => item.item_id === args.item_id) ?? null;
        case "get_arena_view":
          return arena();
        case "get_challenge_candidates":
          return ["rival.testnet"];
        case "get_token":
          return this.tokens.get(String(args.token_id)) ?? null;
        default:
          throw new Error(`FakeGame: unexpected view ${methodName}`);
      }
    })();
    return value as T;
  }

  public async call(call: ContractCall): Promise<CallOutcome> {
    this.calls.push(call);
    if (this.failNextCalls > 0) {
      this.failNextCalls -= 1;
      throw new Error("Smart contract panicked: boom");
    }
    const txHash = `tx-${this.calls.length}`;
    switch (call.methodName) {
      case "register_player":
        this.me = player({ account_id: this.accountId, unassigned_points: 3, game_coins: "0" });
        return { txHash, result: null };
      case "assign_stat_points":
        if (this.me !== null) {
          this.me = { ...this.me, unassigned_points: 0 };
        }
        return { txHash, result: null };
      case "challenge":
        return { txHash, result: { combat_id: 7, attacker_won: true, draw: false, rounds: 4 } };
      case "start_expedition":
        return {
          txHash,
          result: { expedition_id: 1, outcome: "DefenderWins", game_coins_gained: "0", xp_gained: "1", drop: null },
        };
      default:
        return { txHash, result: null };
    }
  }
}
