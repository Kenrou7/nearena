"use client";

import type { WalletSelector } from "@near-wallet-selector/core";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addToCart,
  cartUnits,
  parseStoredCart,
  setLineQuantity,
  switchLineCurrency,
  type CartLine,
} from "@/lib/cart";
import { buyItemsAction, type BuyToken } from "@/lib/game-actions";
import { invalidateNearQueries } from "@/lib/near-query";
import { initNearWallet, type NearNetworkId } from "@/lib/near-wallet";
import { getWalletSession } from "@/lib/wallet-session";

const CONTRACT_ID = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() || "nearena-v1.testnet";
const NETWORK_ID =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() as NearNetworkId | undefined) || "testnet";
const CART_STORAGE_KEY = "nearena-cart-v1";

type CartContextValue = {
  lines: CartLine[];
  units: number;
  add: (itemId: string, currency: BuyToken, quantity?: number) => void;
  setQuantity: (itemId: string, currency: BuyToken, quantity: number) => void;
  switchCurrency: (itemId: string, currency: BuyToken) => void;
  clear: () => void;
  checkingOut: boolean;
  checkout: () => Promise<void>;
  /** Increments after every successful checkout so pages can refresh their own data. */
  checkoutVersion: number;
};

const CartContext = createContext<CartContextValue | null>(null);

function readStoredCart(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStoredCart(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Persistence is a convenience; the in-memory cart keeps working.
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutVersion, setCheckoutVersion] = useState(0);
  const selectorRef = useRef<WalletSelector | null>(null);

  useEffect(() => {
    setLines(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      writeStoredCart(lines);
    }
  }, [hydrated, lines]);

  const add = useCallback((itemId: string, currency: BuyToken, quantity = 1) => {
    setLines((current) => addToCart(current, itemId, currency, quantity));
  }, []);

  const setQuantity = useCallback((itemId: string, currency: BuyToken, quantity: number) => {
    setLines((current) => setLineQuantity(current, { itemId, currency }, quantity));
  }, []);

  const switchCurrency = useCallback((itemId: string, currency: BuyToken) => {
    setLines((current) => switchLineCurrency(current, { itemId, currency }));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const checkout = useCallback(async () => {
    const session = getWalletSession();
    if (!session || session.chain !== "near") {
      throw new Error("A NEAR wallet session is required to buy items.");
    }
    if (lines.length === 0) {
      throw new Error("The cart is empty.");
    }

    setCheckingOut(true);
    try {
      if (!selectorRef.current) {
        selectorRef.current = (await initNearWallet(NETWORK_ID, CONTRACT_ID)).selector;
      }
      const wallet = await selectorRef.current.wallet();
      await wallet.signAndSendTransaction({
        signerId: session.accountId,
        receiverId: CONTRACT_ID,
        actions: [buyItemsAction(lines)],
      });

      setLines([]);
      await invalidateNearQueries(queryClient);
      setCheckoutVersion((version) => version + 1);
    } finally {
      setCheckingOut(false);
    }
  }, [lines, queryClient]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      units: cartUnits(lines),
      add,
      setQuantity,
      switchCurrency,
      clear,
      checkingOut,
      checkout,
      checkoutVersion,
    }),
    [add, checkingOut, checkout, checkoutVersion, clear, lines, setQuantity, switchCurrency],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside <CartProvider>.");
  }
  return context;
}
