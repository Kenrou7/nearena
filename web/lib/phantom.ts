type PhantomPublicKey = { toString: () => string; toBase58?: () => string };

export type PhantomAccountResponse = {
  publicKey: PhantomPublicKey;
};

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: PhantomPublicKey | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<PhantomAccountResponse>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
};

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { phantom?: { solana?: PhantomProvider } }).phantom?.solana;
  if (!candidate || !candidate.isPhantom) {
    return null;
  }

  return candidate;
}
