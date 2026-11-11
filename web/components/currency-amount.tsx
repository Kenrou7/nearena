import Image from "next/image";

export type CurrencyCode = "SC" | "GC";

const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  SC: "Stablecoin (USDT)",
  GC: "Game coin",
};

const CURRENCY_ICONS: Record<CurrencyCode, string> = {
  SC: "/assets/currency/usdt.svg",
  GC: "/assets/currency/game-coin.svg",
};

export function getCurrencyName(currency: CurrencyCode): string {
  return CURRENCY_NAMES[currency];
}

type CurrencyIconProps = {
  currency: CurrencyCode;
  size?: number;
  /** Decorative icons are hidden from screen readers when the name is already conveyed elsewhere. */
  decorative?: boolean;
};

/** Single place that maps a currency to its icon. */
export function CurrencyIcon({ currency, size = 16, decorative = false }: CurrencyIconProps) {
  return (
    <Image
      src={CURRENCY_ICONS[currency]}
      alt={decorative ? "" : CURRENCY_NAMES[currency]}
      title={CURRENCY_NAMES[currency]}
      width={size}
      height={size}
      className="currency-icon"
      aria-hidden={decorative ? true : undefined}
    />
  );
}

type CurrencyAmountProps = {
  amount: string;
  currency: CurrencyCode;
};

export function CurrencyAmount({ amount, currency }: CurrencyAmountProps) {
  return (
    <span className="currency-amount">
      <CurrencyIcon currency={currency} />
      <span className="currency-amount-value">{amount}</span>
    </span>
  );
}
