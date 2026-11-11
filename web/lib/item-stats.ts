import type { ItemDefinitionView } from "./near-rpc";

export type ItemStatMetric = {
  key: string;
  label: string;
  flatBonus: bigint;
  percentBps: number;
  fillClass: "strength" | "dexterity" | "vitality";
  fillWidth: number;
};

const FILL_DENOMINATORS: Record<string, bigint> = {
  strength: 5_000_000n,
  dexterity: 5_000_000n,
  vitality: 10_000_000n,
  hp: 50_000_000n
};

const LABELS: Record<string, string> = {
  strength: "STR",
  dexterity: "DEX",
  vitality: "VIT",
  hp: "HP"
};

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.max(0, Math.trunc(value)));
  }

  if (typeof value === "string") {
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

  return 0n;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

function normalizeStatKey(rawKey: string, slot: ItemDefinitionView["slot"] | undefined): string {
  if (slot === "Consumable" && rawKey === "vitality") {
    return "hp";
  }

  return rawKey;
}

function inferFillClass(normalizedKey: string): "strength" | "dexterity" | "vitality" {
  if (normalizedKey === "strength") {
    return "strength";
  }

  if (normalizedKey === "dexterity") {
    return "dexterity";
  }

  return "vitality";
}

function inferLabel(normalizedKey: string): string {
  const known = LABELS[normalizedKey];
  if (known) {
    return known;
  }

  return normalizedKey.replace(/_/g, " ").toUpperCase();
}

function computeFillWidth(normalizedKey: string, flatBonus: bigint): number {
  const denominator = FILL_DENOMINATORS[normalizedKey] ?? 10_000_000n;
  if (denominator <= 0n) {
    return 0;
  }

  return Math.min(100, Number((flatBonus * 100n) / denominator));
}

export function buildItemStatMetrics(definition: ItemDefinitionView | null): ItemStatMetric[] {
  if (!definition) {
    return [];
  }

  const record = definition as unknown as Record<string, unknown>;
  const flatKeys = Object.keys(record)
    .filter((key) => key.endsWith("_bonus"))
    .map((key) => key.replace(/_bonus$/, ""));
  const percentKeys = Object.keys(record)
    .filter((key) => key.endsWith("_percent_bps"))
    .map((key) => key.replace(/_percent_bps$/, ""));

  const statKeys = Array.from(new Set([...flatKeys, ...percentKeys]));

  return statKeys
    .map((rawKey) => {
      const flatBonus = toBigInt(record[`${rawKey}_bonus`]);
      const percentBps = toNumber(record[`${rawKey}_percent_bps`]);
      const normalizedKey = normalizeStatKey(rawKey, definition.slot);

      return {
        key: normalizedKey,
        label: inferLabel(normalizedKey),
        flatBonus,
        percentBps,
        fillClass: inferFillClass(normalizedKey),
        fillWidth: computeFillWidth(normalizedKey, flatBonus)
      } satisfies ItemStatMetric;
    })
    .filter((metric) => metric.flatBonus > 0n || metric.percentBps > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}
