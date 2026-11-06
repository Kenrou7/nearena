export type WalletSessionChain = "near" | "solana";

export type WalletSession = {
  chain: WalletSessionChain;
  accountId: string;
  playerAccountId?: string;
};

const STORAGE_KEY = "gladiator.wallet.session.v1";
const CHANGE_EVENT = "gladiator-wallet-session-change";

export function getWalletSession(): WalletSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WalletSession>;
    if (!parsed || (parsed.chain !== "near" && parsed.chain !== "solana")) {
      return null;
    }

    if (typeof parsed.accountId !== "string" || parsed.accountId.trim().length === 0) {
      return null;
    }

    return {
      chain: parsed.chain,
      accountId: parsed.accountId,
      playerAccountId:
        typeof parsed.playerAccountId === "string" && parsed.playerAccountId.length > 0
          ? parsed.playerAccountId
          : undefined,
    };
  } catch {
    return null;
  }
}

export function setWalletSession(next: WalletSession | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!next) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeWalletSession(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) {
      handler();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, handler as EventListener);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, handler as EventListener);
  };
}
