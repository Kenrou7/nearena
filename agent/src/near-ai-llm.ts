import OpenAI from "openai";

import type { ChatMessage, LlmClient, ToolCallReply } from "./brain.js";
import type { ToolDefinition } from "./tools.js";

export const NEAR_AI_BASE_URL = "https://cloud-api.near.ai/v1";

/**
 * NEAR AI Cloud is OpenAI-compatible: the official `openai` SDK works by pointing `baseURL`
 * at NEAR AI. Inference runs inside TEEs (private, verifiable).
 */
export class NearAiLlm implements LlmClient {
  private readonly client: OpenAI;

  public constructor(input: { apiKey: string; model: string; baseUrl: string }) {
    this.client = new OpenAI({ apiKey: input.apiKey, baseURL: input.baseUrl });
    this.model = input.model;
  }

  public readonly model: string;

  public async chooseTool(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolCallReply | null> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      tool_choice: "required",
      temperature: 0.2,
    });
    const call = completion.choices[0]?.message.tool_calls?.find((candidate) => candidate.type === "function");
    if (call === undefined || call.type !== "function") {
      return null;
    }
    return { id: call.id, name: call.function.name, arguments: call.function.arguments };
  }
}
