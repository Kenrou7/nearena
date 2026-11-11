import Image from "next/image";
import { formatScaled } from "@/lib/near-rpc";

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

/** Decimals shown per currency: SC prices can be fractional (e.g. 0.375), GC are whole. */
const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  SC: 3,
  GC: 0,
};

/** Formats a scaled on-chain amount for display, trimming trailing zeros ("1.250" -> "1.25"). */
export function formatCurrency(value: string | number | bigint | undefined, currency: CurrencyCode): string {
  const formatted = formatScaled(value, CURRENCY_DECIMALS[currency]);
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
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
  /** Raw scaled on-chain amount; formatting depends on the currency. */
  value: string | number | bigint | undefined;
  currency: CurrencyCode;
};

export function CurrencyAmount({ value, currency }: CurrencyAmountProps) {
  return (
    <span className="currency-amount">
      <CurrencyIcon currency={currency} />
      <span className="currency-amount-value">{formatCurrency(value, currency)}</span>
    </span>
  );
}
