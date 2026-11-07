import { createServer } from "node:http";

import type { CreateSolanaDerivedPlayerRequest } from "@gladiator/shared-types";

import { defaultCommandRunner, runOrThrow } from "./command-runner.js";
import { loadConfig } from "./config.js";
import { SolanaDerivedPlayerService } from "./solana-derived-player-service.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
} as const;

function sendJson(response: import("node:http").ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...CORS_HEADERS,
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

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const service = new SolanaDerivedPlayerService(config);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/players/solana-derived") {
        const body = await readJsonBody(request);
        const payload = validateRequest(body);
        const result = await service.createPlayer(payload);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && request.url === "/v1/faucet/request-tokens") {
        if (config.networkName !== "testnet") {
          sendJson(response, 403, {
            error: "forbidden",
            message: "Token faucet is only available on testnet"
          });
          return;
        }

        const body = await readJsonBody(request);
        const payload = validateFaucetRequest(body);

        const playerCheckOutput = await runOrThrow(defaultCommandRunner, "near", [
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

        const playerView = parseNearCliReturnValue(playerCheckOutput);

        if (playerView === null) {
          sendJson(response, 400, {
            error: "player_not_registered",
            message: "Player must be registered before requesting faucet tokens"
          });
          return;
        }

        const gameCoinOutput = await runOrThrow(defaultCommandRunner, "near", [
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
        const stableOutput = await runOrThrow(defaultCommandRunner, "near", [
          "contract",
          "call-function",
          "as-transaction",
          config.contractAccountId,
          "credit_deposit",
          "json-args",
          JSON.stringify({
            account_id: payload.accountId,
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
        });
        return;
      }

      sendJson(response, 404, {
        error: "not_found",
        message: "Route not found"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      sendJson(response, 400, {
        error: "request_failed",
        message
      });
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
