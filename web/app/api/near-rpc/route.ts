import { NextResponse } from "next/server";

const DEFAULT_UPSTREAMS_BY_NETWORK: Record<string, string[]> = {
  testnet: [
    "https://near-testnet.drpc.org",
    "https://test.rpc.fastnear.com",
    "https://archival-rpc.testnet.near.org",
  ],
  mainnet: [
    "https://near.drpc.org",
    "https://free.rpc.fastnear.com",
    "https://archival-rpc.mainnet.near.org",
  ],
};
const DEFAULT_REQUEST_TIMEOUT_MS = 2_500;

function resolveRequestTimeoutMs(): number {
  const raw = process.env.NEAR_RPC_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 500) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return parsed;
}

function resolveNearNetworkId(): "testnet" | "mainnet" {
  const raw =
    process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim().toLowerCase() ||
    process.env.NEAR_NETWORK_ID?.trim().toLowerCase() ||
    "testnet";

  return raw === "mainnet" ? "mainnet" : "testnet";
}

function sanitizeUpstreamUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const url of urls) {
    const value = url.trim();
    if (!value || seen.has(value)) {
      continue;
    }

    if (!/^https?:\/\//i.test(value)) {
      continue;
    }

    seen.add(value);
    sanitized.push(value);
  }

  return sanitized;
}

function parseUpstreamUrls(): string[] {
  const networkId = resolveNearNetworkId();

  const networkSpecificKey =
    networkId === "mainnet" ? "NEAR_RPC_URLS_MAINNET" : "NEAR_RPC_URLS_TESTNET";
  const fromNetworkList = sanitizeUpstreamUrls(
    (process.env[networkSpecificKey] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const fromList = sanitizeUpstreamUrls(
    (process.env.NEAR_RPC_URLS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const single = sanitizeUpstreamUrls([process.env.NEAR_RPC_URL?.trim() || ""]);

  return sanitizeUpstreamUrls([
    ...fromNetworkList,
    ...fromList,
    ...single,
    ...DEFAULT_UPSTREAMS_BY_NETWORK[networkId],
  ]);
}

export async function POST(request: Request) {
  let body: string;

  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const upstreamUrls = parseUpstreamUrls();
  const requestTimeoutMs = resolveRequestTimeoutMs();
  let lastStatus = 502;
  let lastMessage = "Failed to reach NEAR RPC upstream";

  for (let index = 0; index < upstreamUrls.length; index += 1) {
    const upstreamUrl = upstreamUrls[index] ?? "";
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);

    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });

      if (upstream.status === 429) {
        lastStatus = 429;
        lastMessage = `Rate-limited by upstream ${upstreamUrl}`;
        const elapsedMs = Date.now() - startedAt;
        console.warn(
          `[near-rpc-proxy] upstream=${upstreamUrl} status=429 elapsedMs=${elapsedMs} attempt=${index + 1}/${upstreamUrls.length}`,
        );
        continue;
      }

      const payloadText = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "";
      const isJsonContentType = /application\/json/i.test(contentType);

      if (!isJsonContentType) {
        lastStatus = 502;
        lastMessage = `Upstream ${upstreamUrl} returned non-JSON content (status ${upstream.status})`;
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        lastStatus = 502;
        lastMessage = `Upstream ${upstreamUrl} returned malformed JSON (status ${upstream.status})`;
        continue;
      }

      const elapsedMs = Date.now() - startedAt;
      console.info(
        `[near-rpc-proxy] upstream=${upstreamUrl} status=${upstream.status} elapsedMs=${elapsedMs} attempt=${index + 1}/${upstreamUrls.length}`,
      );

      return NextResponse.json(payload, {
        status: upstream.status,
        headers: {
          "x-near-rpc-upstream": upstreamUrl,
        },
      });
    } catch (error) {
      lastStatus = 502;
      lastMessage =
        error instanceof Error
          ? `Failed upstream ${upstreamUrl}: ${error.message}`
          : `Failed upstream ${upstreamUrl}`;
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        `[near-rpc-proxy] upstream=${upstreamUrl} status=error elapsedMs=${elapsedMs} attempt=${index + 1}/${upstreamUrls.length} message=${lastMessage}`,
      );
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json({ error: lastMessage }, { status: lastStatus });
}