"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BrowserWallet, WalletSelector } from "@near-wallet-selector/core";
import { SessionGate } from "@/components/session-gate";
import {
  formatScaled,
  formatScaledInt,
  parseU128,
  type ItemDefinitionView,
  type PlayerView,
} from "@/lib/near-rpc";
import { invalidateNearQueries, nearQueryKeys, nearQueryOptions } from "@/lib/near-query";
import { getItemDisplayName, getItemPresentation } from "@/lib/item-catalog";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const CALL_GAS = "100000000000000";

type InventorySlot = "Weapon" | "Shield" | "Helmet" | "Armor" | "Consumable";

type InventoryTokenRow = {
  tokenId: string;
  itemId: string;
  itemName: string;
  imageSrc: string;
  slot: InventorySlot | "Unknown";
  active: boolean;
  bonuses: {
    str: bigint;
    dex: bigint;
    vit: bigint;
  };
  percentBonuses: {
    strBps: number;
    dexBps: number;
    vitBps: number;
  };
  equipped: boolean;
};

type InventoryItemGroup = {
  itemId: string;
  sample: InventoryTokenRow;
  tokens: InventoryTokenRow[];
};

type InventoryErrorModalState = {
  title: string;
  message: string;
  details: string;
};

type InventoryToastState = {
  id: number;
  message: string;
};

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

function slotToEquippedToken(player: PlayerView, slot: InventorySlot): string | null {
  if (slot === "Weapon") {
    return player.equipped_weapon_token_id;
  }
  if (slot === "Shield") {
    return player.equipped_shield_token_id;
  }
  if (slot === "Helmet") {
    return player.equipped_helmet_token_id;
  }

  if (slot === "Consumable") {
    return null;
  }

  return player.equipped_armor_token_id;
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [browserWallet, setBrowserWallet] = useState<BrowserWallet | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [tokens, setTokens] = useState<InventoryTokenRow[]>([]);
  const [status, setStatus] = useState("Loading inventory...");
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<InventoryErrorModalState | null>(null);
  const [toast, setToast] = useState<InventoryToastState | null>(null);

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

  const presentErrorModal = useCallback(
    (title: string, message: string, extra: Record<string, string>) => {
      const details = [
        `timestamp: ${new Date().toISOString()}`,
        `title: ${title}`,
        `message: ${message}`,
        `chain: ${session?.chain ?? "none"}`,
        `accountId: ${nearAccountId ?? session?.accountId ?? "none"}`,
        `contractId: ${CONTRACT_ID}`,
        `networkId: ${NETWORK_ID}`,
        ...Object.entries(extra).map(([key, value]) => `${key}: ${value}`),
      ].join("\n");

      setErrorModal({ title, message, details });
    },
    [nearAccountId, session],
  );

  const ensureNearSelector = useCallback(async (): Promise<WalletSelector> => {
    if (selector) {
      return selector;
    }

    const nearWallet = await withTimeout(initNearWallet(NETWORK_ID, CONTRACT_ID), 12_000);
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

  const refreshInventory = useCallback(async () => {
    if (!nearAccountId) {
      setPlayer(null);
      setTokens([]);
      setStatus("Connect a NEAR wallet session to load inventory.");
      return;
    }

    const cachedPlayer = queryClient.getQueryData<PlayerView | null>(nearQueryKeys.player(nearAccountId));
    if (cachedPlayer !== undefined && cachedPlayer) {
      setPlayer(cachedPlayer);
      setStatus("Inventory loaded from cache. Syncing latest state...");
    }

    setLoading(true);
    setStatus((current) =>
      current.includes("cache") ? current : "Refreshing on-chain inventory...",
    );

    try {
      const playerData = await queryClient.fetchQuery(nearQueryOptions.player(nearAccountId));
      if (!playerData) {
        setPlayer(null);
        setTokens([]);
        setStatus("Player not registered yet. Register player first from wallet tools.");
        return;
      }

      const tokenResults = await Promise.allSettled(
        playerData.owned_token_ids.map((tokenId) => queryClient.fetchQuery(nearQueryOptions.token(tokenId))),
      );

      const tokensWithMetadata = tokenResults
        .map((result, index) => {
          if (result.status !== "fulfilled" || !result.value) {
            return {
              token_id: playerData.owned_token_ids[index],
              item_id: "unknown",
            };
          }

          return result.value;
        })
        .filter((entry): entry is { token_id: string; item_id: string } => Boolean(entry));

      const uniqueItemIds = Array.from(new Set(tokensWithMetadata.map((token) => token.item_id)));
      const definitionResults = await Promise.allSettled(
        uniqueItemIds.map((itemId) => queryClient.fetchQuery(nearQueryOptions.itemDefinition(itemId))),
      );

      const definitionMap = new Map<string, ItemDefinitionView | null>();
      uniqueItemIds.forEach((itemId, index) => {
        const result = definitionResults[index];
        if (result.status === "fulfilled") {
          definitionMap.set(itemId, result.value);
          return;
        }

        definitionMap.set(itemId, null);
      });

      const tokenRows: InventoryTokenRow[] = tokensWithMetadata.map((token) => {
        const definition = definitionMap.get(token.item_id);
        const itemPresentation = getItemPresentation(token.item_id);
        const slot = (definition?.slot ?? "Unknown") as InventoryTokenRow["slot"];

        let equipped = false;
        if (slot !== "Unknown") {
          equipped = slotToEquippedToken(playerData, slot) === token.token_id;
        }

        return {
          tokenId: token.token_id,
          itemId: token.item_id,
          itemName: itemPresentation.title,
          imageSrc: itemPresentation.imageSrc,
          slot,
          active: definition?.active ?? false,
          bonuses: {
            str: parseU128(definition?.strength_bonus),
            dex: parseU128(definition?.dexterity_bonus),
            vit: parseU128(definition?.vitality_bonus),
          },
          percentBonuses: {
            strBps: definition?.strength_percent_bps ?? 0,
            dexBps: definition?.dexterity_percent_bps ?? 0,
            vitBps: definition?.vitality_percent_bps ?? 0,
          },
          equipped,
        };
      });

      setPlayer(playerData);
      setTokens(tokenRows);
      setStatus("Inventory synced from contract.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("Could not refresh inventory. Please retry in a few seconds.");
      presentToast(message);
    } finally {
      setLoading(false);
    }
  }, [nearAccountId, presentToast, queryClient]);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

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
          if (active && active !== nearAccountId) {
            setStatus("Detected another NEAR account in wallet. Refreshing inventory...");
            void refreshInventory();
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } catch {
        // Selector setup errors are handled by action flow.
      }
    }

    void setupSelector();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [ensureNearSelector, nearAccountId, refreshInventory]);

  async function equipToken(tokenId: string) {
    if (!nearAccountId) {
      setStatus("NEAR session is required to equip items.");
      return;
    }

    try {
      setBusyAction(`equip:${tokenId}`);
      setStatus(`Equipping ${tokenId}...`);

      const wallet = await ensureNearBrowserWallet();
      await wallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "equip",
              args: { token_id: tokenId },
              gas: CALL_GAS,
              deposit: "0",
            },
          },
        ],
      });

      await invalidateNearQueries(queryClient);

      setStatus("Equip transaction sent. Refreshing inventory...");
      await refreshInventory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Equip failed: ${message}`);
      presentErrorModal("Equip failed", message, {
        action: "equip",
        tokenId,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function consumeToken(tokenId: string) {
    if (!nearAccountId) {
      setStatus("NEAR session is required to consume items.");
      return;
    }

    try {
      setBusyAction(`consume:${tokenId}`);
      setStatus(`Consuming ${tokenId}...`);

      const wallet = await ensureNearBrowserWallet();
      await wallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "consume",
              args: { token_id: tokenId },
              gas: CALL_GAS,
              deposit: "0",
            },
          },
        ],
      });

      setStatus("Consume transaction sent. Refreshing inventory...");
      await refreshInventory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Consume failed: ${message}`);
      presentErrorModal("Consume failed", message, {
        action: "consume",
        tokenId,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function unequipSlot(slot: InventorySlot) {
    if (!nearAccountId) {
      setStatus("NEAR session is required to unequip items.");
      return;
    }

    try {
      setBusyAction(`unequip:${slot}`);
      setStatus(`Unequipping ${slot}...`);

      const wallet = await ensureNearBrowserWallet();
      await wallet.signAndSendTransaction({
        signerId: nearAccountId,
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "unequip",
              args: { slot },
              gas: CALL_GAS,
              deposit: "0",
            },
          },
        ],
      });

      await invalidateNearQueries(queryClient);

      setStatus("Unequip transaction sent. Refreshing inventory...");
      await refreshInventory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Unequip failed: ${message}`);
      presentErrorModal("Unequip failed", message, {
        action: "unequip",
        slot,
      });
    } finally {
      setBusyAction(null);
    }
  }

  const equippedSummary = useMemo(() => {
    if (!player) {
      return [];
    }

    return [
      {
        slot: "Weapon" as InventorySlot,
        tokenId: player.equipped_weapon_token_id,
      },
      {
        slot: "Shield" as InventorySlot,
        tokenId: player.equipped_shield_token_id,
      },
      {
        slot: "Helmet" as InventorySlot,
        tokenId: player.equipped_helmet_token_id,
      },
      {
        slot: "Armor" as InventorySlot,
        tokenId: player.equipped_armor_token_id,
      },
    ];
  }, [player]);

  // One card per item: duplicates of the same item collapse into a single card with a count.
  const itemGroups = useMemo(() => {
    const groups = new Map<string, InventoryItemGroup>();
    for (const token of tokens) {
      const existing = groups.get(token.itemId);
      if (existing) {
        existing.tokens.push(token);
      } else {
        groups.set(token.itemId, { itemId: token.itemId, sample: token, tokens: [token] });
      }
    }

    return Array.from(groups.values(), (group) => {
      const equipped = group.tokens.some((token) => token.equipped);
      // Consume any unit; equip prefers a unit that is not already equipped.
      const actionToken = group.tokens.find((token) => !token.equipped) ?? group.tokens[0];
      return { ...group, equipped, actionTokenId: actionToken.tokenId };
    });
  }, [tokens]);

  const effectiveStats = useMemo(() => {
    if (!player) {
      return null;
    }

    const equippedBonus = tokens.reduce(
      (acc, token) => {
        if (!token.equipped || !token.active) {
          return acc;
        }

        acc.str += token.bonuses.str;
        acc.dex += token.bonuses.dex;
        acc.vit += token.bonuses.vit;
        return acc;
      },
      { str: 0n, dex: 0n, vit: 0n },
    );

    return {
      strength: parseU128(player.effective_strength),
      dexterity: parseU128(player.effective_dexterity),
      vitality: parseU128(player.effective_vitality),
      bonus: equippedBonus,
    };
  }, [player, tokens]);

  return (
    <SessionGate
      title="Armory"
      description="Connect a wallet to manage equipment and on-chain inventory."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Inventory</p>
            <h2>Armory and Gear</h2>
            <p className="muted">
              Equip and unequip NFT gear from your on-chain inventory. Consumables are planned for a
              future contract iteration.
            </p>
          </header>

          <article className="module">
            <div className="status">{status}</div>
            {loading ? <div className="status">Loading inventory...</div> : null}
            <div className="row">
              <button onClick={() => void refreshInventory()} disabled={loading || Boolean(busyAction)}>
                Refresh
              </button>
              <Link className="button-link" href="/gladiator">
                Back to gladiator
              </Link>
            </div>
          </article>

          <section className="game-grid">
            <article className="module">
              <h2>Player stats</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item"><span>Level</span><span className="chip">{player.level}</span></div>
                  <div className="list-item"><span>XP</span><span className="chip">{formatScaledInt(player.xp)}</span></div>
                  <div className="list-item">
                    <span>STR</span>
                    <span className="chip">
                      {effectiveStats ? formatScaledInt(effectiveStats.strength) : formatScaledInt(player.effective_strength)}
                      {(effectiveStats?.bonus.str ?? 0n) > 0n ? ` (+${formatScaledInt(effectiveStats?.bonus.str.toString())})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>DEX</span>
                    <span className="chip">
                      {effectiveStats ? formatScaledInt(effectiveStats.dexterity) : formatScaledInt(player.effective_dexterity)}
                      {(effectiveStats?.bonus.dex ?? 0n) > 0n ? ` (+${formatScaledInt(effectiveStats?.bonus.dex.toString())})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>VIT</span>
                    <span className="chip">
                      {effectiveStats ? formatScaledInt(effectiveStats.vitality) : formatScaledInt(player.effective_vitality)}
                      {(effectiveStats?.bonus.vit ?? 0n) > 0n ? ` (+${formatScaledInt(effectiveStats?.bonus.vit.toString())})` : ""}
                    </span>
                  </div>
                  <div className="list-item"><span>HP</span><span className="chip">{formatScaledInt(player.current_hp)}</span></div>
                </div>
              ) : (
                <div className="status">No player loaded for this session.</div>
              )}
            </article>

            <article className="module">
              <h2>Equipped</h2>
              {equippedSummary.length > 0 ? (
                <div className="list-block">
                  {equippedSummary.map((entry) => (
                    <div className="list-item" key={entry.slot}>
                      <span>{entry.slot}</span>
                      <div className="row">
                        <span className="chip">
                          {entry.tokenId
                            ? getItemDisplayName(tokens.find((token) => token.tokenId === entry.tokenId)?.itemId ?? entry.tokenId)
                            : "none"}
                        </span>
                        <button
                          onClick={() => void unequipSlot(entry.slot)}
                          disabled={!entry.tokenId || Boolean(busyAction)}
                        >
                          {busyAction === `unequip:${entry.slot}` ? "Unequipping..." : "Unequip"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="status">No equipment loaded yet.</div>
              )}
            </article>
          </section>

          <section className="shop-grid">
            {itemGroups.length > 0 ? (
              itemGroups.map(({ itemId, sample: token, tokens: groupTokens, equipped, actionTokenId }) => (
                <article className="module item-card" key={itemId}>
                  <h2>{token.itemName}</h2>
                  <div className="item-image-frame">
                    <img className="item-image" src={token.imageSrc} alt={token.itemName} />
                    {groupTokens.length > 1 ? (
                      <span
                        className="item-owned-badge"
                        title={`You own ${groupTokens.length} of this item`}
                        aria-label={`You own ${groupTokens.length} of this item`}
                      >
                        ×{groupTokens.length}
                      </span>
                    ) : null}
                  </div>
                  <p className="meta-row">Item: {token.itemId}</p>
                  <p className="meta-row" title={groupTokens.map((entry) => entry.tokenId).join(", ")}>
                    {groupTokens.length > 1 ? `Tokens: ${groupTokens.length}` : `Token: ${token.tokenId}`}
                  </p>

                  <div className="price-grid">
                    <div className="price-row">
                      <span>Slot</span>
                      <span className="chip">{token.slot}</span>
                    </div>
                    <div className="price-row">
                      <span>Status</span>
                      <span className={`chip ${token.active ? "chip-good" : "chip-bad"}`}>
                        {token.active ? "Active" : "Inactive / Unknown"}
                      </span>
                    </div>
                    <div className="price-row">
                      <span>Bonus STR</span>
                      <span className="chip">+{formatScaled(token.bonuses.str.toString())}</span>
                    </div>
                    <div className="price-row">
                      <span>Bonus DEX</span>
                      <span className="chip">+{formatScaled(token.bonuses.dex.toString())}</span>
                    </div>
                    <div className="price-row">
                      <span>Bonus VIT</span>
                      <span className="chip">+{formatScaled(token.bonuses.vit.toString())}</span>
                    </div>
                  </div>

                  <div className="item-stat-grid" aria-label={`Item stats for ${token.itemName}`}>
                    <div className="item-stat-row">
                      <span className="item-stat-label">STR</span>
                      <div className="item-stat-track" role="presentation">
                        <div
                          className="item-stat-fill item-stat-fill-strength"
                          style={{ width: `${Math.min(100, Number((token.bonuses.str * 100n) / 5_000_000n))}%` }}
                        />
                      </div>
                      <span className="item-stat-value">+{formatScaled(token.bonuses.str.toString())}</span>
                    </div>
                    <div className="item-stat-row">
                      <span className="item-stat-label">DEX</span>
                      <div className="item-stat-track" role="presentation">
                        <div
                          className="item-stat-fill item-stat-fill-dexterity"
                          style={{ width: `${Math.min(100, Number((token.bonuses.dex * 100n) / 5_000_000n))}%` }}
                        />
                      </div>
                      <span className="item-stat-value">+{formatScaled(token.bonuses.dex.toString())}</span>
                    </div>
                    <div className="item-stat-row">
                      <span className="item-stat-label">VIT</span>
                      <div className="item-stat-track" role="presentation">
                        <div
                          className="item-stat-fill item-stat-fill-vitality"
                          style={{ width: `${Math.min(100, Number((token.bonuses.vit * 100n) / 10_000_000n))}%` }}
                        />
                      </div>
                      <span className="item-stat-value">+{formatScaled(token.bonuses.vit.toString())}</span>
                    </div>
                    {(token.percentBonuses.strBps > 0 || token.percentBonuses.dexBps > 0 || token.percentBonuses.vitBps > 0) ? (
                      <div className="item-percent-bonuses">
                        <span>Percent bonuses:</span>
                        <span className="chip">STR {(token.percentBonuses.strBps / 100).toFixed(2)}%</span>
                        <span className="chip">DEX {(token.percentBonuses.dexBps / 100).toFixed(2)}%</span>
                        <span className="chip">VIT {(token.percentBonuses.vitBps / 100).toFixed(2)}%</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="row">
                    {token.slot === "Consumable" ? (
                      <button
                        className="primary"
                        disabled={!token.active || Boolean(busyAction)}
                        onClick={() => void consumeToken(actionTokenId)}
                      >
                        {busyAction === `consume:${actionTokenId}` ? "Consuming..." : "Consume"}
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={token.slot === "Unknown" || equipped || Boolean(busyAction)}
                        onClick={() => void equipToken(actionTokenId)}
                      >
                        {busyAction === `equip:${actionTokenId}`
                          ? "Equipping..."
                          : equipped
                            ? "Equipped"
                            : "Equip"}
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <article className="module">
                <h2>No items yet</h2>
                <p className="muted">Buy items in the shop to populate your armory.</p>
                <div className="row">
                  <Link className="button-link" href="/shop">
                    Go to shop
                  </Link>
                </div>
              </article>
            )}
          </section>

          {errorModal ? (
            <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Inventory error dialog">
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
        </section>
      </main>
    </SessionGate>
  );
}
