import { createServer } from "node:http";

import type { CreateSolanaDerivedPlayerRequest } from "@gladiator/shared-types";

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
