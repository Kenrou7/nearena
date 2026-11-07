import type { BackendConfig } from "./config.js";

const DEFAULT_RPC_ATTEMPTS_PER_URL = 2;
const DEFAULT_RPC_BASE_DELAY_MS = 220;
const DEFAULT_RPC_REQUEST_TIMEOUT_MS = 2_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRateLimitMessage(message: string): boolean {
  return /rate limit|too many requests|429/i.test(message);
}

function decodeResultBytes(bytes: unknown): string {
  if (!Array.isArray(bytes)) {
    throw new Error("Invalid RPC response: result bytes are missing");
  }

  const buffer = Buffer.from(bytes as number[]);
  return buffer.toString("utf8");
}

export async function viewFunctionWithRpcFallback(
  config: BackendConfig,
  methodName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const payloadBase64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  let lastError: unknown;

  for (let endpointIndex = 0; endpointIndex < config.nearRpcUrls.length; endpointIndex += 1) {
    const rpcUrl = config.nearRpcUrls[endpointIndex] ?? "";
    for (let attempt = 1; attempt <= DEFAULT_RPC_ATTEMPTS_PER_URL; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, DEFAULT_RPC_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `${methodName}-${Date.now()}`,
            method: "query",
            params: {
              request_type: "call_function",
              finality: "final",
              account_id: config.contractAccountId,
              method_name: methodName,
              args_base64: payloadBase64
            }
          })
        });

        const json = (await response.json()) as {
          error?: { message?: string; data?: unknown };
          result?: { result?: unknown };
        };

        if (!response.ok) {
          const message = `HTTP ${response.status} on ${rpcUrl}`;
          if (isRateLimitMessage(message) && attempt < DEFAULT_RPC_ATTEMPTS_PER_URL) {
            const elapsedMs = Date.now() - startedAt;
            console.warn(
              `[backend.near-rpc] status=rate_limited method=${methodName} endpoint=${rpcUrl} elapsedMs=${elapsedMs} endpointIndex=${endpointIndex + 1}/${config.nearRpcUrls.length} attempt=${attempt}/${DEFAULT_RPC_ATTEMPTS_PER_URL}`
            );
            await delay(DEFAULT_RPC_BASE_DELAY_MS * attempt);
            continue;
          }

          throw new Error(message);
        }

        if (json.error) {
          const rpcMessage = json.error.message ?? JSON.stringify(json.error.data ?? json.error);
          if (isRateLimitMessage(rpcMessage) && attempt < DEFAULT_RPC_ATTEMPTS_PER_URL) {
            const elapsedMs = Date.now() - startedAt;
            console.warn(
              `[backend.near-rpc] status=rate_limited method=${methodName} endpoint=${rpcUrl} elapsedMs=${elapsedMs} endpointIndex=${endpointIndex + 1}/${config.nearRpcUrls.length} attempt=${attempt}/${DEFAULT_RPC_ATTEMPTS_PER_URL} message=${rpcMessage}`
            );
            await delay(DEFAULT_RPC_BASE_DELAY_MS * attempt);
            continue;
          }

          throw new Error(`RPC query failed on ${rpcUrl}: ${rpcMessage}`);
        }

        const rawValue = decodeResultBytes(json.result?.result);
        const elapsedMs = Date.now() - startedAt;
        console.info(
          `[backend.near-rpc] status=ok method=${methodName} endpoint=${rpcUrl} elapsedMs=${elapsedMs} endpointIndex=${endpointIndex + 1}/${config.nearRpcUrls.length} attempt=${attempt}/${DEFAULT_RPC_ATTEMPTS_PER_URL}`
        );

        if (rawValue.trim() === "") {
          return null;
        }

        return JSON.parse(rawValue) as unknown;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const elapsedMs = Date.now() - startedAt;
        console.warn(
          `[backend.near-rpc] status=error method=${methodName} endpoint=${rpcUrl} elapsedMs=${elapsedMs} endpointIndex=${endpointIndex + 1}/${config.nearRpcUrls.length} attempt=${attempt}/${DEFAULT_RPC_ATTEMPTS_PER_URL} message=${message}`
        );
        const mayRetrySameEndpoint = isRateLimitMessage(message) && attempt < DEFAULT_RPC_ATTEMPTS_PER_URL;
        if (mayRetrySameEndpoint) {
          await delay(DEFAULT_RPC_BASE_DELAY_MS * attempt);
          continue;
        }

        break;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}