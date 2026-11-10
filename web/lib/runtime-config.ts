const DEFAULT_NEAR_RPC_PROXY_PATH = "/api/near-rpc";
let hasWarnedMixedContent = false;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function warnIfLikelyMixedContent(targetUrl: string, context: string): void {
  if (hasWarnedMixedContent || typeof window === "undefined") {
    return;
  }

  if (window.location.protocol === "https:" && /^http:\/\//i.test(targetUrl)) {
    hasWarnedMixedContent = true;
    console.error(
      `[web.config] ${context} resolves to an insecure HTTP URL (${targetUrl}) while the page is HTTPS. Browser may block requests as mixed content. Use an HTTPS backend URL.`
    );
  }
}

export function resolveBackendBaseUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!value) {
    return null;
  }

  const normalized = trimTrailingSlashes(value);
  warnIfLikelyMixedContent(normalized, "NEXT_PUBLIC_BACKEND_URL");
  return normalized;
}

export function resolveNearRpcProxyPath(): string {
  const override = process.env.NEXT_PUBLIC_NEAR_RPC_PROXY_PATH?.trim();

  // Absolute URL for external backend proxy.
  if (override && /^https?:\/\//i.test(override)) {
    warnIfLikelyMixedContent(override, "NEXT_PUBLIC_NEAR_RPC_PROXY_PATH");
    return override;
  }

  // Same-origin path (works in local Next.js runtime).
  if (override && override.startsWith("/")) {
    return override;
  }

  // If the specific proxy path is not set, derive it from backend URL.
  const backendBaseUrl = resolveBackendBaseUrl();
  if (backendBaseUrl) {
    const derived = `${backendBaseUrl}/v1/near-rpc`;
    warnIfLikelyMixedContent(derived, "derived near-rpc proxy path");
    return derived;
  }

  return DEFAULT_NEAR_RPC_PROXY_PATH;
}
