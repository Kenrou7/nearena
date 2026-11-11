const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:8787";

type SolanaDerivedPlayerResponse = {
  playerAccountId: string;
  alreadyRegistered: boolean;
};

/**
 * Returns the NEAR account that plays for a Solana address (derived via chain signatures),
 * registering it on the game contract the first time. Idempotent on the backend.
 */
export async function resolveSolanaPlayerAccount(solanaAddress: string): Promise<string> {
  const response = await fetch(`${BACKEND_BASE_URL}/v1/players/solana-derived`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ solanaAddress }),
  });

  const data = (await response.json()) as Partial<SolanaDerivedPlayerResponse> & { message?: string };
  if (!response.ok || typeof data.playerAccountId !== "string") {
    throw new Error(data.message ?? `Could not resolve the NEAR account for ${solanaAddress}`);
  }
  return data.playerAccountId;
}
