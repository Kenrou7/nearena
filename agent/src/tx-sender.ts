import type { CallOutcome } from "./game-client.js";

/** One JSON-RPC request; resolves with `result` or throws `RpcError`. */
export type JsonRpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * RPC failure. `transient` errors (HTTP 5xx/429, network, timeouts, unknown tx) say nothing
 * about the transaction itself: it may well have executed, so callers keep checking by hash.
 */
export class RpcError extends Error {
  public readonly transient: boolean;
  /** `error.cause.name` of a JSON-RPC error, e.g. `UNKNOWN_TRANSACTION`. */
  public readonly causeName: string | undefined;

  public constructor(message: string, options: { transient: boolean; causeName?: string }) {
    super(message);
    this.name = "RpcError";
    this.transient = options.transient;
    this.causeName = options.causeName;
  }
}

/** RPC causes that are a definitive answer about the request, not a hiccup of the node. */
const DEFINITIVE_CAUSES = new Set(["INVALID_TRANSACTION", "REQUEST_VALIDATION_ERROR", "PARSE_ERROR"]);

export function isTransientCause(cause: string | undefined): boolean {
  return cause === undefined || !DEFINITIVE_CAUSES.has(cause);
}

type FinalOutcome = {
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction_outcome: { id: string };
};

function isFinalOutcome(value: unknown): value is FinalOutcome {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return typeof status === "object" && status !== null && ("SuccessValue" in status || "Failure" in status);
}

function failureMessage(failure: unknown): string {
  const kind = (failure as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: unknown } } } })
    .ActionError?.kind?.FunctionCallError?.ExecutionError;
  return typeof kind === "string" ? kind : JSON.stringify(failure);
}

function toCallOutcome(outcome: FinalOutcome, txHash: string): CallOutcome {
  if (typeof outcome.status === "object" && outcome.status.Failure !== undefined) {
    throw new Error(`${failureMessage(outcome.status.Failure)} (tx ${txHash})`);
  }
  const successValue = typeof outcome.status === "object" ? outcome.status.SuccessValue : undefined;
  if (successValue === undefined || successValue === "") {
    return { txHash, result: null };
  }
  const decoded = Buffer.from(successValue, "base64").toString("utf8");
  try {
    return { txHash, result: JSON.parse(decoded) as unknown };
  } catch {
    return { txHash, result: decoded };
  }
}

export const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;
export const DEFAULT_POLL_MS = 1_500;

/**
 * Broadcasts a signed tx and confirms it by hash. `send_tx` only waits for inclusion (short),
 * and execution is confirmed with short `tx` polls: long blocking requests are what proxies
 * (e.g. dRPC) cut with "Internal server error" even though the tx executes fine.
 */
export async function sendAndConfirm(input: {
  rpc: JsonRpc;
  signedTxBase64: string;
  txHash: string;
  signerId: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CallOutcome> {
  const { rpc, txHash } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS;
  const deadline = now() + timeoutMs;

  const broadcast = async (): Promise<void> => {
    try {
      await rpc("send_tx", { signed_tx_base64: input.signedTxBase64, wait_until: "INCLUDED" });
    } catch (error) {
      if (!(error instanceof RpcError) || !error.transient) {
        throw error;
      }
      // The node may have accepted it anyway; the status polls below find out.
    }
  };

  await broadcast();
  while (now() < deadline) {
    try {
      const status = await rpc("tx", {
        tx_hash: txHash,
        sender_account_id: input.signerId,
        wait_until: "EXECUTED_OPTIMISTIC",
      });
      if (isFinalOutcome(status)) {
        return toCallOutcome(status, txHash);
      }
    } catch (error) {
      if (!(error instanceof RpcError) || !error.transient) {
        throw error;
      }
      if (error.causeName === "UNKNOWN_TRANSACTION") {
        // Same signed bytes → same hash: rebroadcasting is safe if the first send was lost.
        await broadcast();
      }
    }
    await sleep(pollMs);
  }
  throw new Error(`transaction not confirmed after ${Math.round(timeoutMs / 1000)}s (tx ${txHash}); check it in the explorer`);
}

/** `JsonRpc` over fetch with a per-request timeout, classifying failures as transient or not. */
export function createJsonRpc(url: string, requestTimeoutMs = 20_000, fetchImpl: typeof fetch = fetch): JsonRpc {
  let nextId = 1;
  return async (method, params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RpcError(`${method}: ${error instanceof Error ? error.message : String(error)}`, { transient: true });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      const transient = response.status >= 500 || response.status === 408 || response.status === 429;
      throw new RpcError(`${method}: HTTP ${response.status} ${text.slice(0, 200)}`, { transient });
    }
    let body: { result?: unknown; error?: { message?: string; cause?: { name?: string }; data?: unknown } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new RpcError(`${method}: non-JSON response ${text.slice(0, 200)}`, { transient: true });
    }
    if (body.error !== undefined) {
      const cause = body.error.cause?.name;
      const detail = typeof body.error.data === "string" ? body.error.data : JSON.stringify(body.error.data ?? body.error);
      throw new RpcError(`${method}: ${cause ?? body.error.message ?? "RPC error"}: ${detail}`, {
        transient: isTransientCause(cause),
        causeName: cause,
      });
    }
    return body.result;
  };
}
