import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import type { CreateSolanaDerivedPlayerRequest } from "@gladiator/shared-types";

import { defaultCommandRunner } from "./command-runner.js";
import { loadConfig } from "./config.js";
import { runNearReadOnlyWithRetry, runNearWithRetry } from "./near-cli.js";
import { viewFunctionWithRpcFallback } from "./near-rpc.js";
import { SolanaDerivedPlayerService } from "./solana-derived-player-service.js";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveAllowedOrigin(requestOrigin: string | undefined, corsAllowedOrigins: string[]): string {
  if (corsAllowedOrigins.includes("*")) {
    return "*";
  }

  if (!requestOrigin) {
    return "";
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  return corsAllowedOrigins.some((origin) => normalizeOrigin(origin) === normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : "";
}

function buildCorsHeaders(requestOrigin: string | undefined, corsAllowedOrigins: string[]): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(requestOrigin, corsAllowedOrigins);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  };

  if (allowedOrigin.length > 0) {
    headers["access-control-allow-origin"] = allowedOrigin;
    headers.vary = "Origin";
  }

  return headers;
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  payload: unknown,
  corsHeaders: Record<string, string>
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...corsHeaders,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as unknown;
}

function validateRequest(body: unknown): CreateSolanaDerivedPlayerRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object");
  }

  if (!("solanaAddress" in body)) {
    return {};
  }

  const value = (body as { solanaAddress?: unknown }).solanaAddress;
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== "string") {
    throw new Error("solanaAddress must be a string when provided");
  }

  return {
    solanaAddress: value
  };
}

type FaucetRequest = {
  accountId: string;
};

function validateFaucetRequest(body: unknown): FaucetRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object");
  }

  const accountId = (body as { accountId?: unknown }).accountId;
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    throw new Error("accountId is required");
  }

  return { accountId: accountId.trim() };
}

function extractTxHash(output: string): string {
  const match = output.match(/Transaction ID:\s*([A-Za-z0-9]+)/);
  if (!match || !match[1]) {
    throw new Error(`Could not find transaction hash in output:\n${output}`);
  }

  return match[1];
}

function parseNearCliReturnValue(output: string): unknown {
  const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

  const tryParseJsonFromText = (text: string): unknown | null => {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (let i = 0; i < lines.length; i += 1) {
      const start = lines[i] ?? "";
      if (start === "null") {
        return null;
      }

      const first = start[0] ?? "";
      if (first !== "{" && first !== "[") {
        continue;
      }

      let depth = 0;
      let inString = false;
      let isEscaped = false;
      let candidate = "";

      for (let j = i; j < lines.length; j += 1) {
        const line = lines[j] ?? "";
        candidate += (candidate.length > 0 ? "\n" : "") + line;

        for (const char of line) {
          if (isEscaped) {
            isEscaped = false;
            continue;
          }

          if (char === "\\") {
            isEscaped = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (inString) {
            continue;
          }

          if (char === "{" || char === "[") {
            depth += 1;
          } else if (char === "}" || char === "]") {
            depth -= 1;
          }
        }

        if (depth === 0) {
          try {
            return JSON.parse(candidate) as unknown;
          } catch {
            break;
          }
        }
      }
    }

    return null;
  };

  const marker = "Function execution return value (printed to stdout):";
  const cleanedOutput = stripAnsi(output);
  const payloadSection = cleanedOutput.includes(marker)
    ? cleanedOutput.split(marker).slice(-1)[0]?.trim() ?? ""
    : cleanedOutput.trim();

  const parsedPayload = tryParseJsonFromText(payloadSection);
  if (parsedPayload !== null || payloadSection.trim() === "null") {
    return parsedPayload;
  }

  const parsedWholeOutput = tryParseJsonFromText(cleanedOutput);
  if (parsedWholeOutput !== null || cleanedOutput.trim() === "null") {
    return parsedWholeOutput;
  }

  try {
    return JSON.parse(payloadSection) as unknown;
  } catch {
    throw new Error(`Could not parse view return payload from output:\n${output}`);
  }
}

function summarizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

function inferRpcMethod(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "unknown";
  }

  const method = (payload as { method?: unknown }).method;
  return typeof method === "string" && method.length > 0 ? method : "unknown";
}

type RpcProxyResult = {
  status: number;
  payload: unknown;
  upstream: string;
};

function isRateLimited(status: number, payload: unknown): boolean {
  if (status === 429) {
    return true;
  }

  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return false;
  }

  const errorValue = (payload as { error?: unknown }).error;
  if (!errorValue) {
    return false;
  }

  const raw = typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue);
  return /rate limit|too many requests|429/i.test(raw);
}

async function proxyNearRpcRequest(
  config: ReturnType<typeof loadConfig>,
  payload: unknown,
  requestId: string
): Promise<RpcProxyResult> {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("RPC proxy expects a JSON object body");
  }

  const rpcMethod = inferRpcMethod(payload);
  let lastError: unknown = new Error("No RPC upstreams configured");

  for (let index = 0; index < config.nearRpcUrls.length; index += 1) {
    const upstream = config.nearRpcUrls[index] ?? "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.nearRpcProxyTimeoutMs);
    const startedAt = Date.now();

    console.info(
      `[backend.rpc] requestId=${requestId} stage=attempt_start method=${rpcMethod} upstream=${upstream} attempt=${index + 1}/${config.nearRpcUrls.length}`
    );

    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      let parsedPayload: unknown;

      try {
        parsedPayload = JSON.parse(text) as unknown;
      } catch {
        parsedPayload = {
          error: "invalid_upstream_json",
          message: `Upstream ${upstream} returned non-JSON payload`,
          status: response.status
        };
      }

      if (!response.ok && isRateLimited(response.status, parsedPayload) && index < config.nearRpcUrls.length - 1) {
        const elapsedMs = Date.now() - startedAt;
        console.warn(
          `[backend.rpc] requestId=${requestId} stage=attempt_rate_limited method=${rpcMethod} upstream=${upstream} status=${response.status} elapsedMs=${elapsedMs}`
        );
        continue;
      }

      const elapsedMs = Date.now() - startedAt;
      console.info(
        `[backend.rpc] requestId=${requestId} stage=attempt_end method=${rpcMethod} upstream=${upstream} status=${response.status} elapsedMs=${elapsedMs}`
      );

      return {
        status: response.status,
        payload: parsedPayload,
        upstream
      };
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const summary = summarizeError(error);
      console.error(
        `[backend.rpc] requestId=${requestId} stage=attempt_error method=${rpcMethod} upstream=${upstream} elapsedMs=${elapsedMs} message=${summary.message}`
      );
      if (summary.stack) {
        console.error(`[backend.rpc] requestId=${requestId} stack=${summary.stack}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const service = new SolanaDerivedPlayerService(config);

  console.info(
    `[backend] startup port=${config.port} network=${config.networkName} contract=${config.contractAccountId} signer=${config.signerAccountId} corsAllowedOrigins=${config.corsAllowedOrigins.join(",")} rpcUrls=${config.nearRpcUrls.join(",")}`
  );

  const server = createServer(async (request, response) => {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();

    try {
      const requestOrigin = request.headers.origin;
      const corsHeaders = buildCorsHeaders(requestOrigin, config.corsAllowedOrigins);
      const method = request.method ?? "UNKNOWN";
      const url = request.url ?? "";

      console.info(
        `[backend.req] requestId=${requestId} stage=start method=${method} url=${url} origin=${requestOrigin ?? "none"}`
      );

      if (request.method === "OPTIONS") {
        if (corsHeaders["access-control-allow-origin"]) {
          response.writeHead(204, corsHeaders);
          console.info(
            `[backend.req] requestId=${requestId} stage=preflight_allow origin=${requestOrigin ?? "none"}`
          );
        } else {
          response.writeHead(403, {
            "content-type": "application/json; charset=utf-8"
          });
          console.warn(
            `[backend.req] requestId=${requestId} stage=preflight_deny origin=${requestOrigin ?? "none"} allowed=${config.corsAllowedOrigins.join(",")}`
          );
        }
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { ok: true }, corsHeaders);
        return;
      }

      if (request.method === "POST" && request.url === "/v1/near-rpc") {
        const body = await readJsonBody(request);
        const rpcResult = await proxyNearRpcRequest(config, body, requestId);
        const responseBody = JSON.stringify(rpcResult.payload);
        response.writeHead(rpcResult.status, {
          ...corsHeaders,
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(responseBody),
          "x-near-rpc-upstream": rpcResult.upstream
        });
        response.end(responseBody);
        const elapsedMs = Date.now() - startedAt;
        console.info(
          `[backend.req] requestId=${requestId} stage=end route=/v1/near-rpc status=${rpcResult.status} upstream=${rpcResult.upstream} elapsedMs=${elapsedMs}`
        );
        return;
      }

      if (request.method === "POST" && request.url === "/v1/players/solana-derived") {
        const body = await readJsonBody(request);
        const payload = validateRequest(body);
        const result = await service.createPlayer(payload);
        sendJson(response, 200, result, corsHeaders);
        const elapsedMs = Date.now() - startedAt;
        console.info(`[backend.req] requestId=${requestId} stage=end route=/v1/players/solana-derived status=200 elapsedMs=${elapsedMs}`);
        return;
      }

      if (request.method === "POST" && request.url === "/v1/faucet/request-tokens") {
        const startedAt = Date.now();
        if (config.networkName !== "testnet") {
          sendJson(response, 403, {
            error: "forbidden",
            message: "Token faucet is only available on testnet"
          }, corsHeaders);
          return;
        }

        const body = await readJsonBody(request);
        const payload = validateFaucetRequest(body);
        console.info(`[backend.faucet] request_start accountId=${payload.accountId} network=${config.networkName}`);

        let playerView: unknown;

        try {
          const playerCheckOutput = await runNearReadOnlyWithRetry(defaultCommandRunner, [
            "contract",
            "call-function",
            "as-read-only",
            config.contractAccountId,
            "get_player_view",
            "json-args",
            JSON.stringify({ account_id: payload.accountId }),
            "network-config",
            config.networkName,
            "now"
          ]);
          playerView = parseNearCliReturnValue(playerCheckOutput);
        } catch (error) {
          if (!(error instanceof Error) || !/rate limit|exceeded the rate limit/i.test(error.message)) {
            throw error;
          }

          console.warn(
            `[backend.faucet] cli_read_only_rate_limited accountId=${payload.accountId} message=${error.message}. Falling back to JSON-RPC.`
          );

          playerView = await viewFunctionWithRpcFallback(config, "get_player_view", {
            account_id: payload.accountId
          });
        }

        if (playerView === null) {
          sendJson(response, 400, {
            error: "player_not_registered",
            message: "Player must be registered before requesting faucet tokens"
          }, corsHeaders);
          return;
        }

        const gameCoinOutput = await runNearWithRetry(defaultCommandRunner, [
          "contract",
          "call-function",
          "as-transaction",
          config.contractAccountId,
          "dev_set_player_game_coin",
          "json-args",
          JSON.stringify({ account_id: payload.accountId, amount: config.faucetGameCoins }),
          "prepaid-gas",
          config.prepaidGas,
          "attached-deposit",
          config.attachedDeposit,
          "sign-as",
          config.signerAccountId,
          "network-config",
          config.networkName,
          "sign-with-keychain",
          "send"
        ]);

        const txRef = `faucet-${payload.accountId.replace(/\./g, "-")}-${Date.now()}`;
        const stableOutput = await runNearWithRetry(defaultCommandRunner, [
          "contract",
          "call-function",
          "as-transaction",
          config.contractAccountId,
          "credit_deposit",
          "json-args",
          JSON.stringify({
            account_id: payload.accountId,
            token_contract_id: config.stableTokenContractId,
            amount: config.faucetStablecoins,
            chain: "faucet",
            tx_ref: txRef
          }),
          "prepaid-gas",
          config.prepaidGas,
          "attached-deposit",
          config.attachedDeposit,
          "sign-as",
          config.signerAccountId,
          "network-config",
          config.networkName,
          "sign-with-keychain",
          "send"
        ]);

        const elapsedMs = Date.now() - startedAt;
        console.info(
          `[backend.faucet] request_ok accountId=${payload.accountId} elapsedMs=${elapsedMs} gameCoinTx=${extractTxHash(gameCoinOutput)} stableTx=${extractTxHash(stableOutput)}`
        );

        sendJson(response, 200, {
          ok: true,
          accountId: payload.accountId,
          network: config.networkName,
          mint: {
            gameCoins: config.faucetGameCoins,
            stablecoins: config.faucetStablecoins
          },
          txHashes: {
            gameCoin: extractTxHash(gameCoinOutput),
            stablecoin: extractTxHash(stableOutput)
          }
        }, corsHeaders);
        console.info(
          `[backend.req] requestId=${requestId} stage=end route=/v1/faucet/request-tokens status=200 elapsedMs=${elapsedMs} accountId=${payload.accountId}`
        );
        return;
      }

      sendJson(response, 404, {
        error: "not_found",
        message: "Route not found"
      }, corsHeaders);
      const elapsedMs = Date.now() - startedAt;
      console.warn(`[backend.req] requestId=${requestId} stage=end route=unknown status=404 elapsedMs=${elapsedMs}`);
    } catch (error) {
      const summary = summarizeError(error);
      const requestOrigin = request.headers.origin;
      const corsHeaders = buildCorsHeaders(requestOrigin, config.corsAllowedOrigins);
      sendJson(response, 400, {
        error: "request_failed",
        message: summary.message
      }, corsHeaders);
      const elapsedMs = Date.now() - startedAt;
      console.error(`[backend.req] requestId=${requestId} stage=error status=400 elapsedMs=${elapsedMs} message=${summary.message}`);
      if (summary.stack) {
        console.error(`[backend.req] requestId=${requestId} stack=${summary.stack}`);
      }
    }
  });

  server.listen(config.port, () => {
    console.log(`backend listening on http://localhost:${config.port}`);
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
