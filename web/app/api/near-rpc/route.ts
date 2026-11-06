import { NextResponse } from "next/server";

const DEFAULT_UPSTREAMS = [
  "https://near-testnet.drpc.org",
  "https://test.rpc.fastnear.com",
  "https://archival-rpc.testnet.near.org",
];
const REQUEST_TIMEOUT_MS = 10_000;

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
  const fromList = sanitizeUpstreamUrls(
    (process.env.NEAR_RPC_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  );

  if (fromList.length > 0) {
    return fromList;
  }

  const single = process.env.NEAR_RPC_URL?.trim();
  if (single && /^https?:\/\//i.test(single)) {
    return [single];
  }

  return sanitizeUpstreamUrls(DEFAULT_UPSTREAMS);
}

function getRetryDelayMs(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) {
    return 650;
  }

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(250, seconds * 1000);
  }

  const retryAtMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(retryAtMs)) {
    return Math.max(250, retryAtMs - Date.now());
  }

  return 650;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function POST(request: Request) {
  let body: string;

  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const upstreamUrls = parseUpstreamUrls();
  let lastStatus = 502;
  let lastMessage = "Failed to reach NEAR RPC upstream";

  for (const upstreamUrl of upstreamUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

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
        const delayMs = getRetryDelayMs(upstream.headers.get("retry-after"));
        await sleep(delayMs);
        continue;
      }

      const payload = await upstream.text();

      // For non-rate-limit responses, preserve the upstream payload and status.
      return new NextResponse(payload, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "x-near-rpc-upstream": upstreamUrl,
        },
      });
    } catch (error) {
      lastStatus = 502;
      lastMessage =
        error instanceof Error
          ? `Failed upstream ${upstreamUrl}: ${error.message}`
          : `Failed upstream ${upstreamUrl}`;
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json({ error: lastMessage }, { status: lastStatus });
}