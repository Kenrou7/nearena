"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BrowserWallet, WalletSelector } from "@near-wallet-selector/core";
import { SessionGate } from "@/components/session-gate";
import {
  formatScaledInt,
  getItemDefinitionView,
  type ItemDefinitionView,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const SHOP_CALL_GAS = "100000000000000";

type CatalogSeed = {
  itemId: string;
  title: string;
  description: string;
  imageSrc: string;
};

type CatalogCard = CatalogSeed & {
  definition: ItemDefinitionView | null;
};

type ShopErrorModalState = {
  title: string;
  message: string;
  details: string;
};

type ShopToastState = {
  id: number;
  message: string;
};

const CATALOG_SEED: CatalogSeed[] = [
  {
    itemId: "nft_axe",
    title: "NFT Axe",
    description: "Weapon class item with strong offensive scaling.",
    imageSrc: "/assets/items/nft_axe.svg",
  },
  {
    itemId: "basic_sword",
    title: "Basic Sword",
    description: "Starter weapon with low entry price for progression.",
    imageSrc: "/assets/items/basic_sword.svg",
  },
  {
    itemId: "basic_shield",
    title: "Basic Shield",
    description: "Defensive item with balanced utility bonuses.",
    imageSrc: "/assets/items/basic_shield.svg",
  },
  {
    itemId: "potion_small",
    title: "Small Potion",
    description: "Consumable potion that restores a small amount of HP.",
    imageSrc: "/assets/items/potion_small.svg",
  },
  {
    itemId: "potion_medium",
    title: "Medium Potion",
    description: "Consumable potion with moderate HP restoration.",
    imageSrc: "/assets/items/potion_medium.svg",
  },
  {
    itemId: "potion_large",
    title: "Large Potion",
    description: "Consumable potion with high HP restoration.",
    imageSrc: "/assets/items/potion_large.svg",
  },
];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Wallet selector init timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function asBigInt(value: string | number | undefined): bigint {
  if (value === undefined) {
    return 0n;
  }

  if (typeof value === "number") {
    return BigInt(Math.max(0, Math.trunc(value)));
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 0n;
  }

  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

export default function ShopPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [browserWallet, setBrowserWallet] = useState<BrowserWallet | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [catalog, setCatalog] = useState<CatalogCard[]>([]);
  const [status, setStatus] = useState("Loading shop data...");
  const [loading, setLoading] = useState(false);
  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<ShopErrorModalState | null>(null);
  const [toast, setToast] = useState<ShopToastState | null>(null);

  const nearAccountId = useMemo(() => {
    if (!session || session.chain !== "near") {
      return null;
    }

    return session.accountId;
  }, [session]);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => {
      setSession(getWalletSession());
    });
  }, []);

  const ensureNearSelector = useCallback(async (): Promise<WalletSelector> => {
    if (selector) {
      return selector;
    }

    const nearWallet = await withTimeout(initNearWallet(NETWORK_ID, CONTRACT_ID), 12000);
    setSelector(nearWallet.selector);
    return nearWallet.selector;
  }, [selector]);

  const ensureNearBrowserWallet = useCallback(async (): Promise<BrowserWallet> => {
    if (browserWallet) {
      return browserWallet;
    }

    const nearSelector = await ensureNearSelector();
    const wallet = (await nearSelector.wallet()) as BrowserWallet;
    setBrowserWallet(wallet);
    return wallet;
  }, [browserWallet, ensureNearSelector]);

  const errorContextBase = useMemo(
    () => ({
      chain: session?.chain ?? "none",
      accountId: nearAccountId ?? session?.accountId ?? "none",
      contractId: CONTRACT_ID,
      networkId: NETWORK_ID,
    }),
    [nearAccountId, session],
  );

  const presentErrorModal = useCallback(
    (title: string, message: string, extra: Record<string, string>) => {
      const timestamp = new Date().toISOString();
      const details = [
        `timestamp: ${timestamp}`,
        `title: ${title}`,
        `message: ${message}`,
        `chain: ${errorContextBase.chain}`,
        `accountId: ${errorContextBase.accountId}`,
        `contractId: ${errorContextBase.contractId}`,
        `networkId: ${errorContextBase.networkId}`,
        ...Object.entries(extra).map(([key, value]) => `${key}: ${value}`),
      ].join("\n");

      setErrorModal({
        title,
        message,
        details,
      });
    },
    [errorContextBase],
  );

  const presentToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });

    window.setTimeout(() => {
      setToast((current) => {
        if (!current || current.id !== id) {
          return current;
        }

        return null;
      });
    }, 4200);
  }, []);

  const refreshShopData = useCallback(async () => {
    if (!nearAccountId) {
      setPlayer(null);
      setCatalog(
        CATALOG_SEED.map((item) => ({
          ...item,
          definition: null,
        })),
      );
      if (session?.chain === "solana") {
        setStatus("Shop purchase is enabled with a NEAR wallet session.");
      } else {
        setStatus("Connect a NEAR wallet session to load balances and item pricing.");
      }
      return;
    }

    const cachedPlayer = queryClient.getQueryData<PlayerView | null>(nearQueryKeys.player(nearAccountId));
    const cachedCatalog = CATALOG_SEED.map((item) => {
      const definition = queryClient.getQueryData<ItemDefinitionView | null>(nearQueryKeys.itemDefinition(item.itemId));
      return {
        ...item,
        definition: definition ?? null,
      };
    });

    const hasAnyCachedCatalog = cachedCatalog.some((entry) => entry.definition !== null);
    if (cachedPlayer !== undefined || hasAnyCachedCatalog) {
      if (cachedPlayer !== undefined) {
        setPlayer(cachedPlayer);
      }
      setCatalog(cachedCatalog);
      setStatus("Shop loaded from cache. Syncing latest state...");
    }

    setLoading(true);
    setStatus((current) =>
      current.includes("cache") ? current : "Refreshing balances and on-chain catalog...",
    );

    try {
      const [playerData, itemDefsResult] = await Promise.all([
        queryClient.fetchQuery(nearQueryOptions.player(nearAccountId)),
        Promise.allSettled(
          CATALOG_SEED.map((item) => queryClient.fetchQuery(nearQueryOptions.itemDefinition(item.itemId))),
        ),
      ]);

      const itemDefs = itemDefsResult.map((entry) => {
        if (entry.status === "fulfilled") {
          return entry.value;
        }

        return null;
      });
      const failedItems = itemDefsResult.filter((entry) => entry.status === "rejected").length;

      setPlayer(playerData);
      setCatalog(
        CATALOG_SEED.map((item, index) => ({
          ...item,
          definition: itemDefs[index],
        })),
      );

      if (!playerData) {
        setStatus("Player not registered yet. Use wallet tools to register_player first.");
      } else if (failedItems > 0) {
        setStatus(
          `Shop synced with partial catalog (${failedItems}/${CATALOG_SEED.length} item definitions failed). Retry in a few seconds.`,
        );
      } else {
        setStatus("Shop synced from contract. Choose one token per purchase.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to load shop data: ${message}`);
      presentToast("Could not refresh shop data. Please retry in a few seconds.");
    } finally {
      setLoading(false);
    }
  }, [nearAccountId, presentToast, queryClient, session?.chain]);

  useEffect(() => {
    void refreshShopData();
  }, [refreshShopData]);

  useEffect(() => {
    if (!nearAccountId) {
      setBrowserWallet(null);
      return;
    }

    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function setupSelector() {
      try {
        const nearWallet = await ensureNearSelector();
        if (!mounted) {
          return;
        }

        const subscription = nearWallet.store.observable.subscribe(() => {
          if (!mounted) {
            return;
          }

          const active = getActiveAccountId(nearWallet);
          if (!active) {
            return;
          }

          if (active !== nearAccountId) {
            setStatus("Detected another NEAR account in wallet. Refreshing shop...");
            void refreshShopData();
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } catch {
        // Selector setup errors are already shown in wallet flow; no-op here.
      }
    }

    void setupSelector();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [ensureNearSelector, nearAccountId, refreshShopData]);

  useEffect(() => {
    if (!nearAccountId) {
      return;
    }

    void ensureNearBrowserWallet().catch(() => {
      // Best-effort warm-up; buy flow surfaces errors explicitly.
    });
  }, [ensureNearBrowserWallet, nearAccountId]);

  const stableBalance = asBigInt(player?.stablecoin_balance);
  const gameBalance = asBigInt(player?.game_coins);

  async function buyWithToken(itemId: string, token: "stable" | "game") {
    if (!nearAccountId) {
      setStatus("NEAR session is required to buy items.");
      return;
    }

    try {
      setBuyingItemId(`${itemId}:${token}`);
      setStatus(`Submitting ${token} purchase transaction...`);

      if (!browserWallet) {
        setStatus("Preparing wallet session. Click buy once again to confirm in wallet.");
        await ensureNearBrowserWallet();
        return;
      }

      await browserWallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: token === "stable" ? "buy_item" : "buy_item_with_game_coin",
              args: {
                item_id: itemId,
              },
              gas: SHOP_CALL_GAS,
              deposit: "0",
            },
          },
        ],
      });

      await invalidateNearQueries(queryClient);

      setStatus("Purchase sent successfully. Refreshing balances...");
      await refreshShopData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isPopupBlock = message.toLowerCase().includes("couldn't open popup window");
      const userMessage = isPopupBlock
        ? "Wallet popup was blocked by the browser. Allow popups for this site, keep Meteor Wallet extension enabled, and try again."
        : message;

      setStatus(`Purchase failed: ${userMessage}`);
      presentErrorModal("Purchase failed", userMessage, {
        action: token === "stable" ? "buy_item" : "buy_item_with_game_coin",
        token,
        itemId,
        rawError: message,
      });
    } finally {
      setBuyingItemId(null);
    }
  }

  return (
    <SessionGate
      title="Mercado de Arena"
      description="Conecta una wallet para comprar items y gestionar equipamiento."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Tienda</p>
            <h2>Mercado de Arena</h2>
            <p className="muted">Compra por stablecoin o game coin, nunca mezcladas en la misma transaccion.</p>
          </header>

          <article className="module">
            <h2>Balances del jugador</h2>
            <div className="balance-grid">
              <div className="balance-card">
                <p className="muted">Game coin (ficticio)</p>
                <strong>{formatScaledInt(player?.game_coins)}</strong>
              </div>
              <div className="balance-card">
                <p className="muted">Stablecoin</p>
                <strong>{formatScaledInt(player?.stablecoin_balance)}</strong>
              </div>
            </div>
            <div className="status">{status}</div>
          </article>

          <article className="module">
            <h2>Inventario on-chain</h2>
            {player ? (
              <div className="list-block">
                <div className="list-item">
                  <span>Item IDs</span>
                  <span className="chip">{player.owned_item_ids.length}</span>
                </div>
                <div className="list-item">
                  <span>Token IDs</span>
                  <span className="chip">{player.owned_token_ids.length}</span>
                </div>

                <div>
                  <p className="muted">Owned item IDs</p>
                  {player.owned_item_ids.length > 0 ? (
                    <div className="row">
                      {player.owned_item_ids.map((itemId) => (
                        <span className="chip" key={`item-${itemId}`}>
                          {itemId}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="status">No owned item IDs yet.</div>
                  )}
                </div>

                <div>
                  <p className="muted">Owned token IDs</p>
                  {player.owned_token_ids.length > 0 ? (
                    <div className="row">
                      {player.owned_token_ids.map((tokenId) => (
                        <span className="chip" key={`token-${tokenId}`}>
                          {tokenId}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="status">No owned token IDs yet.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="status">No inventory loaded yet. Connect NEAR and refresh shop data.</div>
            )}
          </article>

          <section className="shop-grid">
            {catalog.map((item) => {
              const definition = item.definition;
              const stablePrice = asBigInt(definition?.price_stablecoin);
              const gamePrice = asBigInt(definition?.price_game_coin);
              const stableEnabled =
                Boolean(nearAccountId) &&
                Boolean(player) &&
                Boolean(definition?.active) &&
                stablePrice > 0n &&
                stableBalance >= stablePrice;
              const gameEnabled =
                Boolean(nearAccountId) &&
                Boolean(player) &&
                Boolean(definition?.active) &&
                gamePrice > 0n &&
                gameBalance >= gamePrice;

              return (
                <article className="module item-card" key={item.itemId}>
                  <Image
                    src={item.imageSrc}
                    alt={item.title}
                    className="item-image"
                    width={420}
                    height={280}
                  />
                  <div>
                    <h2>{item.title}</h2>
                    <p className="muted">{item.description}</p>
                    <p className="meta-row">ID: {item.itemId}</p>
                  </div>

                  <div className="price-grid">
                    <div className="price-row">
                      <span>Price (stable)</span>
                      <span className="chip">{formatScaledInt(definition?.price_stablecoin)}</span>
                    </div>
                    <div className="price-row">
                      <span>Price (game)</span>
                      <span className="chip">{formatScaledInt(definition?.price_game_coin)}</span>
                    </div>
                    <div className="price-row">
                      <span>Slot</span>
                      <span className="chip">{definition?.slot ?? "Unknown"}</span>
                    </div>
                    <div className="price-row">
                      <span>Status</span>
                      <span className={`chip ${definition?.active ? "chip-good" : "chip-bad"}`}>
                        {definition?.active ? "Active" : "Inactive / Missing"}
                      </span>
                    </div>
                  </div>

                  <div className="row">
                    <button
                      className="primary"
                      disabled={
                        !stableEnabled ||
                        loading ||
                        Boolean(buyingItemId) ||
                        session?.chain !== "near"
                      }
                      onClick={() => buyWithToken(item.itemId, "stable")}
                    >
                      {buyingItemId === `${item.itemId}:stable`
                        ? "Buying..."
                        : "Buy with stable"}
                    </button>
                    <button
                      disabled={
                        !gameEnabled ||
                        loading ||
                        Boolean(buyingItemId) ||
                        session?.chain !== "near"
                      }
                      onClick={() => buyWithToken(item.itemId, "game")}
                    >
                      {buyingItemId === `${item.itemId}:game`
                        ? "Buying..."
                        : "Buy with game coin"}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </section>

        {errorModal ? (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Shop error dialog">
            <div className="modal-card error-modal-card">
              <strong>{errorModal.title}</strong>
              <p>{errorModal.message}</p>

              <details>
                <summary>More details</summary>
                <pre className="error-details-block">{errorModal.details}</pre>
              </details>

              <div className="row">
                <button className="primary" onClick={() => setErrorModal(null)}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {toast ? (
          <div className="shop-toast" role="status" aria-live="polite">
            <strong>Error</strong>
            <p>{toast.message}</p>
          </div>
        ) : null}
      </main>
    </SessionGate>
  );
}
