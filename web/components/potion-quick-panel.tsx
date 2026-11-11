import Image from "next/image";
import { CurrencyAmount, getCurrencyName, type CurrencyCode } from "@/components/currency-amount";
import type { BuyToken } from "@/lib/game-actions";
import { formatScaledInt } from "@/lib/near-rpc";

export type PotionRow = {
  itemId: string;
  title: string;
  imageSrc: string;
  healAmount: bigint;
  ownedTokenIds: string[];
  prices: Record<BuyToken, bigint>;
};

type PotionQuickPanelProps = {
  potions: PotionRow[] | null;
  balances: Record<BuyToken, bigint> | null;
  hpFull: boolean;
  disabled: boolean;
  /** Token ids already queued to be consumed. */
  queuedTokenIds: ReadonlySet<string>;
  onConsume: (tokenId: string, potion: PotionRow) => void;
  onAddToCart: (potion: PotionRow, token: BuyToken) => void;
  inCart: (itemId: string, token: BuyToken) => number;
  cartFull: boolean;
};

const TOKEN_CURRENCY: Record<BuyToken, CurrencyCode> = {
  stable: "SC",
  game: "GC",
};

export function PotionQuickPanel({
  potions,
  balances,
  hpFull,
  disabled,
  queuedTokenIds,
  onConsume,
  onAddToCart,
  inCart,
  cartFull,
}: PotionQuickPanelProps) {
  return (
    <article className="module arena-potions">
      <h2>Potions</h2>
      {potions === null ? (
        <div className="potion-list" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div className="potion-row" key={index} aria-hidden="true">
              <div className="skeleton potion-thumb" />
              <div className="potion-info">
                <div className="skeleton skeleton-line skeleton-line-title" />
                <div className="skeleton skeleton-line skeleton-line-short" />
              </div>
            </div>
          ))}
        </div>
      ) : potions.length === 0 ? (
        <div className="status">No potions available right now.</div>
      ) : (
        <div className="potion-list">
          {potions.map((potion) => {
            const owned = potion.ownedTokenIds.length;
            const available = potion.ownedTokenIds.filter((tokenId) => !queuedTokenIds.has(tokenId));
            const nextTokenId = available[0];
            const queued = owned - available.length;
            const purchasable = (["stable", "game"] as const).filter((token) => potion.prices[token] > 0n);

            return (
              <div className="potion-row" key={potion.itemId}>
                <Image src={potion.imageSrc} alt="" className="potion-thumb" width={84} height={56} />
                <div className="potion-info">
                  <strong>{potion.title}</strong>
                  <span className="potion-meta">
                    +{formatScaledInt(potion.healAmount)} HP · {owned > 0 ? `×${owned}` : "none owned"}
                  </span>
                </div>
                <div className="potion-actions">
                  {owned > 0 ? (
                    <button
                      className="primary buy-button"
                      disabled={disabled || hpFull || !nextTokenId}
                      title={
                        hpFull
                          ? "HP is already full"
                          : nextTokenId
                            ? `Queue drinking one ${potion.title}`
                            : "All your units are already queued"
                      }
                      onClick={() => nextTokenId && onConsume(nextTokenId, potion)}
                    >
                      Use
                      {queued > 0 ? (
                        <span className="cart-count-bubble" aria-label={`${queued} queued`}>
                          {queued}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                  {purchasable.map((token) => {
                    const currency = TOKEN_CURRENCY[token];
                    const insufficient = balances !== null && balances[token] < potion.prices[token];
                    const count = inCart(potion.itemId, token);
                    return (
                      <button
                        key={token}
                        className="buy-button"
                        disabled={balances === null || insufficient || cartFull}
                        title={
                          insufficient
                            ? `Not enough ${getCurrencyName(currency)}`
                            : cartFull
                              ? "Cart is full for one transaction"
                              : `Add to cart, paying with ${getCurrencyName(currency)}`
                        }
                        aria-label={`Add ${potion.title} to cart with ${getCurrencyName(currency)}`}
                        onClick={() => onAddToCart(potion, token)}
                      >
                        <span aria-hidden="true">+</span>
                        <CurrencyAmount amount={formatScaledInt(potion.prices[token])} currency={currency} />
                        {count > 0 ? (
                          <span className="cart-count-bubble" aria-label={`${count} in cart`}>
                            {count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
