import { DEFAULT_GAS, HEAVY_GAS, type ContractCall } from "./game-client.js";

/**
 * One bot action. Each maps to a public, non-privileged `game` method; `wait` skips the turn.
 * The bot only pays with GameCoin (it never holds stablecoins).
 */
export type Decision =
  | { tool: "register_player" }
  | { tool: "assign_stat_points"; strength: number; dexterity: number; vitality: number }
  | { tool: "buy_item"; item_id: string; quantity: number }
  | { tool: "equip"; token_id: string }
  | { tool: "consume"; token_id: string }
  | { tool: "start_expedition"; creature_id: string }
  | { tool: "challenge"; opponent_account_id: string }
  | { tool: "claim_leader_income" }
  | { tool: "wait" };

export type ToolName = Decision["tool"];

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };

export type ToolDefinition = {
  type: "function";
  function: { name: ToolName; description: string; parameters: JsonSchema };
};

const REASON = { type: "string", description: "One short sentence explaining why you chose this action." };

function tool(name: ToolName, description: string, properties: Record<string, unknown> = {}): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: { ...properties, reason: REASON },
        required: [...Object.keys(properties), "reason"],
        additionalProperties: false,
      },
    },
  };
}

const POINTS = { type: "integer", minimum: 0 };

/** OpenAI-style function-calling tools exposed to the NEAR AI model. */
export const TOOLS: ToolDefinition[] = [
  tool("register_player", "Join the tournament. Only valid when not registered yet."),
  tool("assign_stat_points", "Spend unassigned stat points. The total must be > 0 and <= unassigned_points.", {
    strength: POINTS,
    dexterity: POINTS,
    vitality: POINTS,
  }),
  tool("buy_item", "Buy items from the shop with game coins.", {
    item_id: { type: "string" },
    quantity: { type: "integer", minimum: 1, maximum: 5 },
  }),
  tool("equip", "Equip an owned, not yet equipped gear token (weapon, shield, helmet or armor).", {
    token_id: { type: "string" },
  }),
  tool("consume", "Drink an owned potion token to restore HP.", { token_id: { type: "string" } }),
  tool("start_expedition", "Fight a PvE creature for coins, XP and item drops. Needs can_fight.", {
    creature_id: { type: "string" },
  }),
  tool("challenge", "Challenge an opponent from challengeable_opponents to climb the arena ladder. Needs can_fight.", {
    opponent_account_id: { type: "string" },
  }),
  tool("claim_leader_income", "Collect the income of the arena tier leader. Only valid when is_leader."),
  tool("wait", "Do nothing this turn (for example to let HP regenerate)."),
];

export type ParsedToolCall = { decision: Decision; reason: string };

function readObject(raw: string): Record<string, unknown> {
  const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`argument "${key}" must be a non-empty string`);
  }
  return value;
}

function readInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`argument "${key}" must be an integer`);
  }
  return value;
}

/** Turns a raw model tool call into a typed decision; throws on unknown tools or bad args. */
export function parseToolCall(name: string, rawArguments: string): ParsedToolCall {
  const args = readObject(rawArguments);
  const reason = typeof args.reason === "string" ? args.reason : "";
  const decision = ((): Decision => {
    switch (name) {
      case "register_player":
      case "claim_leader_income":
      case "wait":
        return { tool: name };
      case "assign_stat_points":
        return {
          tool: name,
          strength: readInt(args, "strength"),
          dexterity: readInt(args, "dexterity"),
          vitality: readInt(args, "vitality"),
        };
      case "buy_item":
        return { tool: name, item_id: readString(args, "item_id"), quantity: readInt(args, "quantity") };
      case "equip":
      case "consume":
        return { tool: name, token_id: readString(args, "token_id") };
      case "start_expedition":
        return { tool: name, creature_id: readString(args, "creature_id") };
      case "challenge":
        return { tool: name, opponent_account_id: readString(args, "opponent_account_id") };
      default:
        throw new Error(`unknown tool "${name}"`);
    }
  })();
  return { decision, reason };
}

/** Contract call for a decision, or null for `wait`. */
export function toContractCall(decision: Decision): ContractCall | null {
  switch (decision.tool) {
    case "register_player":
      return { methodName: "register_player", args: {}, gas: DEFAULT_GAS };
    case "assign_stat_points":
      return {
        methodName: "assign_stat_points",
        args: {
          strength_points: decision.strength,
          dexterity_points: decision.dexterity,
          vitality_points: decision.vitality,
        },
        gas: DEFAULT_GAS,
      };
    case "buy_item":
      return {
        methodName: "buy_items",
        args: { lines: [{ item_id: decision.item_id, quantity: decision.quantity, currency: "GameCoin" }] },
        gas: HEAVY_GAS,
      };
    case "equip":
      return {
        methodName: "apply_inventory_actions",
        args: { actions: [{ type: "Equip", token_id: decision.token_id }] },
        gas: HEAVY_GAS,
      };
    case "consume":
      return {
        methodName: "apply_inventory_actions",
        args: { actions: [{ type: "Consume", token_id: decision.token_id }] },
        gas: HEAVY_GAS,
      };
    case "start_expedition":
      return { methodName: "start_expedition", args: { creature_id: decision.creature_id }, gas: HEAVY_GAS };
    case "challenge":
      return { methodName: "challenge", args: { opponent_account_id: decision.opponent_account_id }, gas: HEAVY_GAS };
    case "claim_leader_income":
      return { methodName: "claim_leader_income", args: {}, gas: HEAVY_GAS };
    case "wait":
      return null;
  }
}

export function formatDecision(decision: Decision): string {
  const { tool: name, ...args } = decision;
  const entries = Object.entries(args);
  return entries.length === 0 ? name : `${name}(${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")})`;
}
