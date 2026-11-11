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
  busyAction: string | null;
  onConsume: (tokenId: string, potion: PotionRow) => void;
  onBuy: (potion: PotionRow, token: BuyToken) => void;
};

const TOKEN_CURRENCY: Record<BuyToken, CurrencyCode> = {
  stable: "SC",
  game: "GC",
};

export function potionConsumeKey(itemId: string): string {
  return `consume:${itemId}`;
}

export function potionBuyKey(itemId: string, token: BuyToken): string {
  return `buy:${itemId}:${token}`;
}

export function PotionQuickPanel({
  potions,
  balances,
  hpFull,
  disabled,
  busyAction,
  onConsume,
  onBuy,
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
            const nextTokenId = potion.ownedTokenIds[0];
            const consumeKey = potionConsumeKey(potion.itemId);
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
                      title={hpFull ? "HP is already full" : `Drink one ${potion.title}`}
                      onClick={() => nextTokenId && onConsume(nextTokenId, potion)}
                    >
                      {busyAction === consumeKey ? "..." : "Use"}
                    </button>
                  ) : null}
                  {purchasable.map((token) => {
                    const currency = TOKEN_CURRENCY[token];
                    const insufficient = balances !== null && balances[token] < potion.prices[token];
                    return (
                      <button
                        key={token}
                        className="buy-button"
                        disabled={disabled || balances === null || insufficient}
                        title={
                          insufficient
                            ? `Not enough ${getCurrencyName(currency)}`
                            : `Buy with ${getCurrencyName(currency)}`
                        }
                        aria-label={`Buy ${potion.title} with ${getCurrencyName(currency)}`}
                        onClick={() => onBuy(potion, token)}
                      >
                        {busyAction === potionBuyKey(potion.itemId, token) ? (
                          "..."
                        ) : (
                          <CurrencyAmount amount={formatScaledInt(potion.prices[token])} currency={currency} />
                        )}
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
