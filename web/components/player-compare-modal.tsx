"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getItemDisplayName } from "@/lib/item-catalog";
import { formatScaledInt, parseU128, type PlayerView } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";
import { formatHpProgress } from "@/lib/player-format";

/** Mirrors `CHALLENGE_MIN_HP_BPS` in the game contract (20% of max HP). */
const CHALLENGE_MIN_HP_BPS = 2_000n;

const EQUIP_SLOTS = [
  { label: "Weapon", key: "equipped_weapon_token_id" },
  { label: "Shield", key: "equipped_shield_token_id" },
  { label: "Helmet", key: "equipped_helmet_token_id" },
  { label: "Armor", key: "equipped_armor_token_id" },
] as const;

type StatRow = {
  label: string;
  self: bigint | number;
  rival: bigint | number;
  format: (value: bigint | number) => string;
};

type PlayerCompareModalProps = {
  rivalAccountId: string;
  self: PlayerView | null;
  /** Whether the rival is in the current challenge candidates list. */
  isCandidate: boolean;
  challenging: boolean;
  challengeLocked: boolean;
  onChallenge: () => void;
  onClose: () => void;
};

function compare(a: bigint | number, b: bigint | number): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

function useEquippedNames(player: PlayerView | null | undefined): Record<string, string | null> {
  const tokenIds = EQUIP_SLOTS.map((slot) => player?.[slot.key] ?? null);
  const results = useQueries({
    queries: tokenIds.map((tokenId) => ({
      ...nearQueryOptions.token(tokenId ?? ""),
      enabled: tokenId !== null,
    })),
  });

  return Object.fromEntries(
    EQUIP_SLOTS.map((slot, index) => {
      const tokenId = tokenIds[index];
      if (!tokenId) {
        return [slot.label, null];
      }
      const itemId = results[index]?.data?.item_id;
      return [slot.label, itemId ? getItemDisplayName(itemId) : "…"];
    }),
  );
}

export function PlayerCompareModal({
  rivalAccountId,
  self,
  isCandidate,
  challenging,
  challengeLocked,
  onChallenge,
  onClose,
}: PlayerCompareModalProps) {
  const rivalQuery = useQuery(nearQueryOptions.player(rivalAccountId));
  const rival = rivalQuery.data;
  const selfGear = useEquippedNames(self);
  const rivalGear = useEquippedNames(rival);
  const isSelf = self?.account_id === rivalAccountId;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rows: StatRow[] =
    self && rival
      ? [
          { label: "Level", self: self.level, rival: rival.level, format: String },
          {
            label: "STR",
            self: parseU128(self.effective_strength),
            rival: parseU128(rival.effective_strength),
            format: (value) => formatScaledInt(BigInt(value)),
          },
          {
            label: "DEX",
            self: parseU128(self.effective_dexterity),
            rival: parseU128(rival.effective_dexterity),
            format: (value) => formatScaledInt(BigInt(value)),
          },
          {
            label: "VIT",
            self: parseU128(self.effective_vitality),
            rival: parseU128(rival.effective_vitality),
            format: (value) => formatScaledInt(BigInt(value)),
          },
          {
            label: "Max HP",
            self: parseU128(self.max_hp),
            rival: parseU128(rival.max_hp),
            format: (value) => formatScaledInt(BigInt(value)),
          },
        ]
      : [];

  const selfHp = self ? parseU128(self.current_hp) : 0n;
  const selfMaxHp = self ? parseU128(self.max_hp) : 0n;
  const hpTooLow = self !== null && selfHp < (selfMaxHp * CHALLENGE_MIN_HP_BPS) / 10_000n;

  let challengeBlockedReason: string | null = null;
  if (isSelf) {
    challengeBlockedReason = null;
  } else if (!isCandidate) {
    challengeBlockedReason = "You can only challenge up to 5 ranks above you in your tier.";
  } else if (hpTooLow) {
    challengeBlockedReason = "Your HP is below 20% of max. Drink a potion first.";
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare with ${rivalAccountId}`}
      onClick={onClose}
    >
      <div className="modal-card compare-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="compare-header">
          <h2>{isSelf ? "Your profile" : "Compare"}</h2>
          <button className="cart-line-remove" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        {rivalQuery.isPending ? (
          <div aria-busy="true" className="compare-skeleton">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div className="skeleton arena-row-skeleton-small" key={index} />
            ))}
          </div>
        ) : !rival ? (
          <div className="status">Could not load {rivalAccountId}.</div>
        ) : (
          <>
            <div className="compare-grid" role="table" aria-label="Stats comparison">
              <div className="compare-row compare-row-head" role="row">
                <span role="columnheader" />
                <span role="columnheader" className="compare-name" title={self?.account_id}>
                  You
                </span>
                <span role="columnheader" className="compare-name" title={rivalAccountId}>
                  {isSelf ? "You" : rivalAccountId}
                </span>
              </div>

              {rows.map((row) => {
                const result = compare(row.self, row.rival);
                return (
                  <div className="compare-row" role="row" key={row.label}>
                    <span role="rowheader" className="compare-label">
                      {row.label}
                    </span>
                    <span role="cell" className={result > 0 ? "compare-better" : result < 0 ? "compare-worse" : undefined}>
                      {row.format(row.self)}
                    </span>
                    <span role="cell" className={result < 0 ? "compare-better" : result > 0 ? "compare-worse" : undefined}>
                      {row.format(row.rival)}
                    </span>
                  </div>
                );
              })}

              {self ? (
                <div className="compare-row" role="row">
                  <span role="rowheader" className="compare-label">
                    HP now
                  </span>
                  <span role="cell" className={hpTooLow ? "compare-worse" : undefined}>
                    {formatHpProgress(self)}
                  </span>
                  <span role="cell">{formatHpProgress(rival)}</span>
                </div>
              ) : null}

              {EQUIP_SLOTS.map((slot) => (
                <div className="compare-row compare-row-gear" role="row" key={slot.label}>
                  <span role="rowheader" className="compare-label">
                    {slot.label}
                  </span>
                  <span role="cell">{selfGear[slot.label] ?? "—"}</span>
                  <span role="cell">{rivalGear[slot.label] ?? "—"}</span>
                </div>
              ))}
            </div>

            {!isSelf ? (
              <div className="compare-actions">
                {challengeBlockedReason ? <span className="meta-row">{challengeBlockedReason}</span> : null}
                <button
                  className="primary"
                  disabled={Boolean(challengeBlockedReason) || challengeLocked || challenging}
                  onClick={onChallenge}
                >
                  {challenging ? "Challenging..." : "Challenge"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
