"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WalletSelector } from "@near-wallet-selector/core";
import { SessionGate } from "@/components/session-gate";
import { useCart } from "@/components/cart-provider";
import { MAX_CART_UNITS, quantityInCart } from "@/lib/cart";
import { CurrencyAmount, getCurrencyName, type CurrencyCode } from "@/components/currency-amount";
import {
  formatScaled,
  formatScaledInt,
  type ItemDefinitionView,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getItemPresentation, SHOP_ITEM_IDS, type ItemPresentation } from "@/lib/item-catalog";
import { buildItemStatMetrics } from "@/lib/item-stats";
import { countOwnedItems } from "@/lib/owned-items";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "http://localhost:8787";

type CatalogLoadState = "pending" | "ready" | "failed";

type CatalogCard = ItemPresentation & {
  definition: ItemDefinitionView | null;
  loadState: CatalogLoadState;
};

type BuyToken = "stable" | "game";

const TOKEN_CURRENCY: Record<BuyToken, CurrencyCode> = {
  stable: "SC",
  game: "GC",
};

type ShopToastState = {
  id: number;
  message: string;
};

const CATALOG_SEED = SHOP_ITEM_IDS.map((itemId) => getItemPresentation(itemId));

const PENDING_CATALOG: CatalogCard[] = CATALOG_SEED.map((item) => ({
  ...item,
  definition: null,
  loadState: "pending",
}));

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
  const cart = useCart();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [catalog, setCatalog] = useState<CatalogCard[]>(PENDING_CATALOG);
  const [status, setStatus] = useState("Loading shop data...");
  const [loading, setLoading] = useState(false);
  const [requestingTokens, setRequestingTokens] = useState(false);
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
    // Item definitions are public views: load them even without a NEAR session.
    const cachedCatalog = CATALOG_SEED.map((item): CatalogCard => {
      const cached = queryClient.getQueryData<ItemDefinitionView | null>(
        nearQueryKeys.itemDefinition(item.itemId),
      );
      if (cached === undefined) {
        return { ...item, definition: null, loadState: "pending" };
      }

      return { ...item, definition: cached, loadState: "ready" };
    });
    setCatalog(cachedCatalog);

    if (!nearAccountId) {
      setPlayer(null);
      if (session?.chain === "solana") {
        setStatus("Shop purchase is enabled with a NEAR wallet session.");
      } else {
        setStatus("Connect a NEAR wallet session to load balances and item pricing.");
      }
    } else {
      const cachedPlayer = queryClient.getQueryData<PlayerView | null>(nearQueryKeys.player(nearAccountId));
      const hasAnyCachedCatalog = cachedCatalog.some((entry) => entry.loadState === "ready");
      if (cachedPlayer !== undefined) {
        setPlayer(cachedPlayer);
      }
      setStatus(
        cachedPlayer !== undefined || hasAnyCachedCatalog
          ? "Shop loaded from cache. Syncing latest state..."
          : "Refreshing balances and on-chain catalog...",
      );
    }

    setLoading(true);

    try {
      const [playerData, itemDefsResult] = await Promise.all([
        nearAccountId
          ? queryClient.fetchQuery(nearQueryOptions.player(nearAccountId))
          : Promise.resolve(null),
        Promise.allSettled(
          CATALOG_SEED.map((item) => queryClient.fetchQuery(nearQueryOptions.itemDefinition(item.itemId))),
        ),
      ]);

      const failedItems = itemDefsResult.filter((entry) => entry.status === "rejected").length;

      setCatalog(
        CATALOG_SEED.map((item, index): CatalogCard => {
          const result = itemDefsResult[index];
          if (result.status === "fulfilled") {
            return { ...item, definition: result.value, loadState: "ready" };
          }

          // Keep a previously cached definition rather than dropping the card on a transient error.
          const cached = cachedCatalog[index];
          return cached.loadState === "ready" ? cached : { ...item, definition: null, loadState: "failed" };
        }),
      );

      if (!nearAccountId) {
        if (failedItems > 0) {
          presentToast("Some shop items could not be loaded. Please retry in a few seconds.");
        }
        return;
      }

      setPlayer(playerData);

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
  }, [refreshShopData, cart.checkoutVersion]);

  useEffect(() => {
    if (!nearAccountId) {
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

  async function requestTokens() {
    if (!nearAccountId) {
      setStatus("NEAR session is required to request tokens.");
      return;
    }

    if (NETWORK_ID !== "testnet") {
      setStatus("Token request is only available on testnet.");
      return;
    }

    if (!player) {
      setStatus("Register player first before requesting tokens.");
      return;
    }

    try {
      setRequestingTokens(true);
      setStatus("Requesting testnet tokens from backend...");

      const response = await fetch(`${BACKEND_BASE_URL}/v1/faucet/request-tokens`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ accountId: nearAccountId }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        const message = payload.message ?? payload.error ?? `Faucet request failed (${response.status})`;
        throw new Error(message);
      }

      setStatus("Tokens minted successfully. Refreshing balances...");
      await invalidateNearQueries(queryClient);
      await refreshShopData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Token request failed: ${message}`);
      presentToast(message);
    } finally {
      setRequestingTokens(false);
    }
  }

  const stableBalance = asBigInt(player?.stablecoin_balance);
  const gameBalance = asBigInt(player?.game_coins);

  const ownedCounts = useMemo(() => countOwnedItems(player?.owned_item_ids ?? []), [player]);

  const visibleCatalog = catalog.filter(
    (item) => item.loadState === "pending" || (item.loadState === "ready" && item.definition?.active === true),
  );

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
            {nearAccountId && player && NETWORK_ID === "testnet" ? (
              <div className="row">
                <button
                  className="primary"
                  onClick={() => void requestTokens()}
                  disabled={requestingTokens || loading}
                >
                  {requestingTokens ? "Requesting tokens..." : "Request testnet tokens"}
                </button>
              </div>
            ) : null}
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
                      {Array.from(ownedCounts, ([itemId, count]) => (
                        <span className="chip" key={`item-${itemId}`}>
                          {getItemPresentation(itemId).title}
                          {count > 1 ? ` ×${count}` : ""}
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

          {visibleCatalog.length === 0 ? (
            <div className="status">No items available in the shop right now.</div>
          ) : null}

          <section className="shop-grid" aria-busy={visibleCatalog.some((item) => item.loadState === "pending")}>
            {visibleCatalog.map((item) => {
              const definition = item.definition;
              if (item.loadState === "pending" || !definition) {
                return (
                  <article className="module item-card item-card-skeleton" key={item.itemId} aria-hidden="true">
                    <div className="skeleton skeleton-image" />
                    <div className="skeleton skeleton-line skeleton-line-title" />
                    <div className="skeleton skeleton-line" />
                    <div className="skeleton skeleton-line skeleton-line-short" />
                    <div className="row">
                      <div className="skeleton skeleton-button" />
                      <div className="skeleton skeleton-button" />
                    </div>
                  </article>
                );
              }

              const statMetrics = buildItemStatMetrics(definition);
              const prices: Record<BuyToken, bigint> = {
                stable: asBigInt(definition.price_stablecoin),
                game: asBigInt(definition.price_game_coin),
              };
              const balances: Record<BuyToken, bigint> = {
                stable: stableBalance,
                game: gameBalance,
              };
              const purchasableTokens = (["stable", "game"] as const).filter((token) => prices[token] > 0n);
              const cartFull = cart.units >= MAX_CART_UNITS;

              const ownedCount = ownedCounts.get(item.itemId) ?? 0;

              return (
                <article className="module item-card" key={item.itemId}>
                  <div className="item-image-frame">
                    <Image
                      src={item.imageSrc}
                      alt={item.title}
                      className="item-image"
                      width={420}
                      height={280}
                    />
                    {ownedCount > 0 ? (
                      <span
                        className="item-owned-badge"
                        title={`Tenés ${ownedCount} de este item`}
                        aria-label={`Tenés ${ownedCount} de este item`}
                      >
                        ×{ownedCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="item-card-header">
                    <h2>{item.title}</h2>
                    <span className="chip">{definition.slot}</span>
                  </div>
                  <p className="muted item-card-description" title={item.description}>
                    {item.description}
                  </p>

                  <div className="item-stat-grid" aria-label={`Item stats for ${item.title}`}>
                    {statMetrics.map((metric) => (
                      <div className="item-stat-row" key={`${item.itemId}:${metric.key}`}>
                        <span className="item-stat-label">{metric.label}</span>
                        <div className="item-stat-track" role="presentation">
                          <div
                            className={`item-stat-fill item-stat-fill-${metric.fillClass}`}
                            style={{ width: `${metric.fillWidth}%` }}
                          />
                        </div>
                        <span className="item-stat-value">+{formatScaled(metric.flatBonus.toString())}</span>
                      </div>
                    ))}
                    {statMetrics.some((metric) => metric.percentBps > 0) ? (
                      <div className="item-percent-bonuses">
                        <span>Percent bonuses:</span>
                        {statMetrics
                          .filter((metric) => metric.percentBps > 0)
                          .map((metric) => (
                            <span className="chip" key={`${item.itemId}:${metric.key}:pct`}>
                              {metric.label} {(metric.percentBps / 100).toFixed(2)}%
                            </span>
                          ))}
                      </div>
                    ) : null}
                  </div>

                  {purchasableTokens.length > 0 ? (
                    <div className="item-buy-row">
                      <span className="item-buy-label">Agregar</span>
                      {purchasableTokens.map((token) => {
                        const currency = TOKEN_CURRENCY[token];
                        const insufficient = Boolean(player) && balances[token] < prices[token];
                        const inCart = quantityInCart(cart.lines, item.itemId, token);

                        return (
                          <button
                            key={token}
                            className={`buy-button${token === "stable" ? " primary" : ""}`}
                            disabled={cartFull || insufficient || cart.checkingOut}
                            title={
                              insufficient
                                ? `Saldo insuficiente de ${getCurrencyName(currency)}`
                                : cartFull
                                  ? `El carrito admite hasta ${MAX_CART_UNITS} items por transacción`
                                  : `Agregar al carrito pagando con ${getCurrencyName(currency)}`
                            }
                            aria-label={`Agregar ${item.title} al carrito con ${getCurrencyName(currency)}`}
                            onClick={() => cart.add(item.itemId, token)}
                          >
                            <span aria-hidden="true">+</span>
                            <CurrencyAmount amount={formatScaledInt(prices[token])} currency={currency} />
                            {inCart > 0 ? (
                              <span className="cart-count-bubble" aria-label={`${inCart} en el carrito`}>
                                {inCart}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        </section>

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
