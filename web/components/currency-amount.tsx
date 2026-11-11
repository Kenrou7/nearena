export type CurrencyCode = "SC" | "GC";

const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  SC: "Stablecoin",
  GC: "Game coin",
};

export function getCurrencyName(currency: CurrencyCode): string {
  return CURRENCY_NAMES[currency];
}

type CurrencyAmountProps = {
  amount: string;
  currency: CurrencyCode;
};

/**
 * Single place to render an amount with its currency marker.
 * The text tag (SC/GC) is a placeholder until currency icons exist.
 */
export function CurrencyAmount({ amount, currency }: CurrencyAmountProps) {
  return (
    <span className="currency-amount">
      <span className="currency-amount-value">{amount}</span>
      <span
        className={`currency-tag currency-tag-${currency.toLowerCase()}`}
        title={CURRENCY_NAMES[currency]}
      >
        {currency}
      </span>
    </span>
  );
}
