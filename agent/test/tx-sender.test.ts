import { describe, expect, it } from "vitest";

import { RpcError, createJsonRpc, sendAndConfirm, type JsonRpc } from "../src/tx-sender.js";

const SUCCESS_OUTCOME = {
  status: { SuccessValue: Buffer.from(JSON.stringify({ combat_id: 3, attacker_won: true })).toString("base64") },
  transaction_outcome: { id: "HASH" },
};

type Step = { method: string; reply: unknown } | { method: string; error: RpcError };

/** Scripted JSON-RPC: each call must match the next expected method. */
function scriptedRpc(steps: Step[]): JsonRpc & { methods: string[] } {
  const methods: string[] = [];
  const rpc = async (method: string, _params: Record<string, unknown>): Promise<unknown> => {
    methods.push(method);
    const step = steps.shift();
    if (step === undefined) {
      throw new Error(`unexpected rpc call ${method}`);
    }
    expect(method).toBe(step.method);
    if ("error" in step) {
      throw step.error;
    }
    return step.reply;
  };
  return Object.assign(rpc, { methods });
}

function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
}

const base = { signedTxBase64: "AAA=", txHash: "HASH", signerId: "bot.testnet", ...clock() };
const http500 = new RpcError("HTTP 500: Internal server error", { transient: true });
const unknownTx = new RpcError("Transaction HASH doesn't exist", { transient: true, causeName: "UNKNOWN_TRANSACTION" });

describe("sendAndConfirm", () => {
  it("recovers when send_tx fails with HTTP 500 but the tx executed (regression)", async () => {
    const rpc = scriptedRpc([
      { method: "send_tx", error: http500 },
      { method: "tx", reply: SUCCESS_OUTCOME },
    ]);
    const outcome = await sendAndConfirm({ ...base, rpc });
    expect(outcome).toEqual({ txHash: "HASH", result: { combat_id: 3, attacker_won: true } });
  });

  it("only waits for inclusion on send and confirms execution with tx", async () => {
    const params: Record<string, unknown>[] = [];
    const rpc: JsonRpc = async (method, p) => {
      params.push({ method, ...p });
      return method === "send_tx" ? { final_execution_status: "INCLUDED" } : SUCCESS_OUTCOME;
    };
    await sendAndConfirm({ ...base, rpc });
    expect(params).toEqual([
      { method: "send_tx", signed_tx_base64: "AAA=", wait_until: "INCLUDED" },
      { method: "tx", tx_hash: "HASH", sender_account_id: "bot.testnet", wait_until: "EXECUTED_OPTIMISTIC" },
    ]);
  });

  it("keeps polling through transient errors and rebroadcasts unknown txs", async () => {
    const rpc = scriptedRpc([
      { method: "send_tx", error: http500 },
      { method: "tx", error: unknownTx },
      { method: "send_tx", reply: {} },
      { method: "tx", error: new RpcError("timeout", { transient: true, causeName: "TIMEOUT_ERROR" }) },
      { method: "tx", reply: { final_execution_status: "INCLUDED" } },
      { method: "tx", reply: SUCCESS_OUTCOME },
    ]);
    await expect(sendAndConfirm({ ...base, rpc })).resolves.toMatchObject({ txHash: "HASH" });
  });

  it("fails fast when the node rejects the transaction itself", async () => {
    const rpc = scriptedRpc([
      { method: "send_tx", error: new RpcError("InvalidNonce", { transient: false, causeName: "INVALID_TRANSACTION" }) },
    ]);
    await expect(sendAndConfirm({ ...base, rpc })).rejects.toThrow(/InvalidNonce/);
  });

  it("surfaces contract panics from the final outcome", async () => {
    const failure = {
      status: {
        Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: cannot challenge self" } } } },
      },
      transaction_outcome: { id: "HASH" },
    };
    const rpc = scriptedRpc([
      { method: "send_tx", reply: {} },
      { method: "tx", reply: failure },
    ]);
    await expect(sendAndConfirm({ ...base, rpc })).rejects.toThrow("Smart contract panicked: cannot challenge self");
  });

  it("gives up after the deadline with the hash so it can be checked", async () => {
    const steps: Step[] = [{ method: "send_tx", reply: {} }];
    for (let index = 0; index < 100; index += 1) {
      steps.push({ method: "tx", error: http500 });
    }
    const rpc = scriptedRpc(steps);
    await expect(sendAndConfirm({ ...base, rpc, timeoutMs: 10_000, pollMs: 2_000 })).rejects.toThrow(
      /not confirmed after 10s \(tx HASH\)/,
    );
  });

  it("returns null when the method returns nothing", async () => {
    const rpc = scriptedRpc([
      { method: "send_tx", reply: {} },
      { method: "tx", reply: { status: { SuccessValue: "" }, transaction_outcome: { id: "HASH" } } },
    ]);
    await expect(sendAndConfirm({ ...base, rpc })).resolves.toEqual({ txHash: "HASH", result: null });
  });
});

describe("createJsonRpc", () => {
  const respond = (status: number, body: string): typeof fetch =>
    (async () => new Response(body, { status })) as typeof fetch;

  it("returns the JSON-RPC result", async () => {
    const rpc = createJsonRpc("https://rpc", 1_000, respond(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: 1 } })));
    await expect(rpc("tx", {})).resolves.toEqual({ ok: 1 });
  });

  it("classifies HTTP 5xx, network errors and odd bodies as transient", async () => {
    await expect(createJsonRpc("https://rpc", 1_000, respond(500, "Internal server error"))("send_tx", {})).rejects.toMatchObject({
      transient: true,
      message: "send_tx: HTTP 500 Internal server error",
    });
    await expect(createJsonRpc("https://rpc", 1_000, respond(400, "bad"))("tx", {})).rejects.toMatchObject({ transient: false });
    await expect(createJsonRpc("https://rpc", 1_000, respond(200, "<html>"))("tx", {})).rejects.toMatchObject({ transient: true });
    const offline = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    await expect(createJsonRpc("https://rpc", 1_000, offline)("tx", {})).rejects.toMatchObject({ transient: true });
  });

  it("aborts requests that take longer than the timeout", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    await expect(createJsonRpc("https://rpc", 10, hanging)("send_tx", {})).rejects.toMatchObject({ transient: true });
  });

  it("uses the RPC error cause to tell definitive from transient errors", async () => {
    const error = (cause: string) =>
      respond(200, JSON.stringify({ jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: cause }, data: "details" } }));
    await expect(createJsonRpc("https://rpc", 1_000, error("INVALID_TRANSACTION"))("send_tx", {})).rejects.toMatchObject({
      transient: false,
      causeName: "INVALID_TRANSACTION",
    });
    await expect(createJsonRpc("https://rpc", 1_000, error("UNKNOWN_TRANSACTION"))("tx", {})).rejects.toMatchObject({
      transient: true,
      causeName: "UNKNOWN_TRANSACTION",
    });
  });
});
