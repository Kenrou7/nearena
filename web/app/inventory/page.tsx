"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrowserWallet, WalletSelector } from "@near-wallet-selector/core";
import { SessionGate } from "@/components/session-gate";
import {
  getItemDefinitionView,
  getPlayerView,
  getTokenView,
  type ItemDefinitionView,
  type PlayerView,
} from "@/lib/near-rpc";
import { getActiveAccountId, initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const CALL_GAS = "100000000000000";

type InventorySlot = "Weapon" | "Shield" | "Helmet" | "Armor";

type InventoryTokenRow = {
  tokenId: string;
  itemId: string;
  slot: InventorySlot | "Unknown";
  active: boolean;
  bonuses: {
    str: number;
    dex: number;
    vit: number;
  };
  equipped: boolean;
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

  return player.equipped_armor_token_id;
}

export default function InventoryPage() {
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
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
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

    setLoading(true);
    setStatus("Refreshing on-chain inventory...");

    try {
      const playerData = await getPlayerView(nearAccountId);
      if (!playerData) {
        setPlayer(null);
        setTokens([]);
        setStatus("Player not registered yet. Register player first from wallet tools.");
        return;
      }

      const tokenResults = await Promise.allSettled(
        playerData.owned_token_ids.map((tokenId) => getTokenView(tokenId)),
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
        uniqueItemIds.map((itemId) => getItemDefinitionView(itemId)),
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
        const slot = (definition?.slot ?? "Unknown") as InventoryTokenRow["slot"];

        let equipped = false;
        if (slot !== "Unknown") {
          equipped = slotToEquippedToken(playerData, slot) === token.token_id;
        }

        return {
          tokenId: token.token_id,
          itemId: token.item_id,
          slot,
          active: definition?.active ?? false,
          bonuses: {
            str: definition?.strength_bonus ?? 0,
            dex: definition?.dexterity_bonus ?? 0,
            vit: definition?.vitality_bonus ?? 0,
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
  }, [nearAccountId, presentToast]);

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
      { str: 0, dex: 0, vit: 0 },
    );

    return {
      strength: player.strength + equippedBonus.str,
      dexterity: player.dexterity + equippedBonus.dex,
      vitality: player.vitality + equippedBonus.vit,
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
                  <div className="list-item"><span>XP</span><span className="chip">{player.xp}</span></div>
                  <div className="list-item">
                    <span>STR</span>
                    <span className="chip">
                      {effectiveStats?.strength ?? player.strength}
                      {(effectiveStats?.bonus.str ?? 0) > 0 ? ` (+${effectiveStats?.bonus.str ?? 0})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>DEX</span>
                    <span className="chip">
                      {effectiveStats?.dexterity ?? player.dexterity}
                      {(effectiveStats?.bonus.dex ?? 0) > 0 ? ` (+${effectiveStats?.bonus.dex ?? 0})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>VIT</span>
                    <span className="chip">
                      {effectiveStats?.vitality ?? player.vitality}
                      {(effectiveStats?.bonus.vit ?? 0) > 0 ? ` (+${effectiveStats?.bonus.vit ?? 0})` : ""}
                    </span>
                  </div>
                  <div className="list-item"><span>Life</span><span className="chip">{player.current_life}</span></div>
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
                        <span className="chip">{entry.tokenId ?? "none"}</span>
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
            {tokens.length > 0 ? (
              tokens.map((token) => (
                <article className="module item-card" key={token.tokenId}>
                  <h2>{token.itemId}</h2>
                  <p className="meta-row">Token: {token.tokenId}</p>

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
                      <span className="chip">+{token.bonuses.str}</span>
                    </div>
                    <div className="price-row">
                      <span>Bonus DEX</span>
                      <span className="chip">+{token.bonuses.dex}</span>
                    </div>
                    <div className="price-row">
                      <span>Bonus VIT</span>
                      <span className="chip">+{token.bonuses.vit}</span>
                    </div>
                  </div>

                  <div className="row">
                    <button
                      className="primary"
                      disabled={token.slot === "Unknown" || token.equipped || Boolean(busyAction)}
                      onClick={() => void equipToken(token.tokenId)}
                    >
                      {busyAction === `equip:${token.tokenId}`
                        ? "Equipping..."
                        : token.equipped
                          ? "Equipped"
                          : "Equip"}
                    </button>
                    <button disabled>
                      Consume (coming soon)
                    </button>
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
