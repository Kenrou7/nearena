const DEFAULT_NEAR_RPC_PROXY_PATH = "/api/near-rpc";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveBackendBaseUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!value) {
    return null;
  }

  return trimTrailingSlashes(value);
}

export function resolveNearRpcProxyPath(): string {
  const override = process.env.NEXT_PUBLIC_NEAR_RPC_PROXY_PATH?.trim();

  // Absolute URL for external backend proxy.
  if (override && /^https?:\/\//i.test(override)) {
    return override;
  }

  // Same-origin path (works in local Next.js runtime).
  if (override && override.startsWith("/")) {
    return override;
  }

  // If the specific proxy path is not set, derive it from backend URL.
  const backendBaseUrl = resolveBackendBaseUrl();
  if (backendBaseUrl) {
    return `${backendBaseUrl}/v1/near-rpc`;
  }

  return DEFAULT_NEAR_RPC_PROXY_PATH;
}
