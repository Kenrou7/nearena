"use client";

import Image from "next/image";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { CurrencyAmount, CurrencyIcon, getCurrencyName, type CurrencyCode } from "@/components/currency-amount";
import { cartTotals, MAX_CART_UNITS } from "@/lib/cart";
import type { BuyToken } from "@/lib/game-actions";
import { getItemPresentation } from "@/lib/item-catalog";
import { formatScaledInt, parseU128, type ItemDefinitionView } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const TOKEN_CURRENCY: Record<BuyToken, CurrencyCode> = {
  stable: "SC",
  game: "GC",
};

function priceFor(definition: ItemDefinitionView | null | undefined, currency: BuyToken): bigint | null {
  if (!definition) {
    return null;
  }
  return parseU128(currency === "stable" ? definition.price_stablecoin : definition.price_game_coin);
}

export function CartBar() {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => setSession(getWalletSession()));
  }, []);

  const nearAccountId = session?.chain === "near" ? session.accountId : null;
  const playerQuery = useQuery({
    ...nearQueryOptions.player(nearAccountId ?? ""),
    enabled: nearAccountId !== null,
  });
  const player = nearAccountId ? playerQuery.data ?? null : null;

  const itemIds = useMemo(() => Array.from(new Set(cart.lines.map((line) => line.itemId))), [cart.lines]);
  const definitionQueries = useQueries({
    queries: itemIds.map((itemId) => nearQueryOptions.itemDefinition(itemId)),
  });
  const definitions = new Map<string, ItemDefinitionView | null | undefined>(
    itemIds.map((itemId, index) => [itemId, definitionQueries[index]?.data]),
  );

  const totals = cartTotals(cart.lines, (itemId, currency) => priceFor(definitions.get(itemId), currency));
  const balances: Record<BuyToken, bigint> | null = player
    ? { stable: parseU128(player.stablecoin_balance), game: parseU128(player.game_coins) }
    : null;
  const short: Record<BuyToken, boolean> = {
    stable: Boolean(totals && balances && totals.stable > balances.stable),
    game: Boolean(totals && balances && totals.game > balances.game),
  };
  const canCheckout =
    nearAccountId !== null && player !== null && totals !== null && !short.stable && !short.game && !cart.checkingOut;

  useEffect(() => {
    if (cart.units === 0) {
      setOpen(false);
    }
  }, [cart.units]);

  if (cart.units === 0 && !error) {
    return null;
  }

  async function handleCheckout() {
    setError(null);
    try {
      await cart.checkout();
      setOpen(false);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : String(checkoutError));
    }
  }

  let blockedReason: string | null = null;
  if (!nearAccountId) {
    blockedReason = "Connect a NEAR wallet to buy.";
  } else if (!player) {
    blockedReason = "Register your player to buy.";
  } else if (short.stable || short.game) {
    blockedReason = `Not enough ${short.stable ? getCurrencyName("SC") : getCurrencyName("GC")}.`;
  }

  return (
    <div className="dock-panel" role="region" aria-label="Shopping cart">
      {open ? (
        <div className="cart-panel" id="cart-panel">
          <div className="cart-panel-header">
            <strong>Cart</strong>
            <span className="meta-row">
              {cart.units}/{MAX_CART_UNITS} items per transaction
            </span>
          </div>
          <ul className="cart-lines">
            {cart.lines.map((line) => {
              const presentation = getItemPresentation(line.itemId);
              const definition = definitions.get(line.itemId);
              const unitPrice = priceFor(definition, line.currency);
              const otherCurrency: BuyToken = line.currency === "stable" ? "game" : "stable";
              const otherPrice = priceFor(definition, otherCurrency);
              const currency = TOKEN_CURRENCY[line.currency];

              return (
                <li className="cart-line" key={`${line.itemId}:${line.currency}`}>
                  <Image src={presentation.imageSrc} alt="" className="cart-line-thumb" width={84} height={56} />
                  <span className="cart-line-name">{presentation.title}</span>
                  <button
                    className="cart-currency-toggle"
                    disabled={cart.checkingOut || !otherPrice || otherPrice <= 0n}
                    title={`Pay with ${getCurrencyName(TOKEN_CURRENCY[otherCurrency])} instead`}
                    aria-label={`Paying with ${getCurrencyName(currency)}. Switch to ${getCurrencyName(TOKEN_CURRENCY[otherCurrency])}`}
                    onClick={() => cart.switchCurrency(line.itemId, line.currency)}
                  >
                    <CurrencyIcon currency={currency} decorative />
                    <span aria-hidden="true">⇄</span>
                  </button>
                  <div className="cart-stepper">
                    <button
                      aria-label={`Remove one ${presentation.title}`}
                      disabled={cart.checkingOut}
                      onClick={() => cart.setQuantity(line.itemId, line.currency, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span aria-label="Quantity">{line.quantity}</span>
                    <button
                      aria-label={`Add one ${presentation.title}`}
                      disabled={cart.checkingOut || cart.units >= MAX_CART_UNITS}
                      onClick={() => cart.setQuantity(line.itemId, line.currency, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <span className="cart-line-total">
                    {unitPrice === null ? (
                      "…"
                    ) : (
                      <CurrencyAmount amount={formatScaledInt(unitPrice * BigInt(line.quantity))} currency={currency} />
                    )}
                  </span>
                  <button
                    className="cart-line-remove"
                    aria-label={`Remove ${presentation.title} from cart`}
                    disabled={cart.checkingOut}
                    onClick={() => cart.setQuantity(line.itemId, line.currency, 0)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="row">
            <button className="cart-clear" onClick={cart.clear} disabled={cart.checkingOut}>
              Empty cart
            </button>
          </div>
        </div>
      ) : null}

      <div className="cart-summary">
        <button
          className="cart-toggle"
          aria-expanded={open}
          aria-controls="cart-panel"
          onClick={() => setOpen((value) => !value)}
          disabled={cart.units === 0}
        >
          Cart · {cart.units} {cart.units === 1 ? "item" : "items"} {open ? "▾" : "▴"}
        </button>
        <div className="cart-totals">
          {totals === null ? (
            <span className="meta-row">…</span>
          ) : (
            (["stable", "game"] as const)
              .filter((token) => totals[token] > 0n)
              .map((token) => (
                <span key={token} className={short[token] ? "cart-total-short" : undefined}>
                  <CurrencyAmount amount={formatScaledInt(totals[token])} currency={TOKEN_CURRENCY[token]} />
                </span>
              ))
          )}
        </div>
        <button
          className="primary cart-buy"
          disabled={!canCheckout || cart.units === 0}
          title={blockedReason ?? "Buy everything in one transaction"}
          onClick={() => void handleCheckout()}
        >
          {cart.checkingOut ? "Buying..." : "Buy"}
        </button>
      </div>

      {error || blockedReason ? (
        <div className={`cart-message${error ? " cart-message-error" : ""}`} role={error ? "alert" : undefined}>
          {error ? `Purchase failed: ${error}` : blockedReason}
          {error ? (
            <button className="cart-line-remove" aria-label="Dismiss" onClick={() => setError(null)}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
