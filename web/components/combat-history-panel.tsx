"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CurrencyAmount } from "@/components/currency-amount";
import { opponentOf, viewerCoinDelta, viewerOutcome, viewerRankChange } from "@/lib/combat-history";
import type { ChallengeResultView, CombatRole } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";

const ROLE_TABS: { role: CombatRole; label: string }[] = [
  { role: "Attacks", label: "Attacks" },
  { role: "Defenses", label: "Defenses" },
];

const OUTCOME_LETTER = { win: "W", loss: "L", draw: "D" } as const;

type CombatHistoryPanelProps = {
  accountId: string;
  onInspect: (accountId: string) => void;
  onOpen: (result: ChallengeResultView) => void;
};

export function CombatHistoryPanel({ accountId, onInspect, onOpen }: CombatHistoryPanelProps) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<CombatRole>("Attacks");
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const history = useInfiniteQuery(nearQueryOptions.combatHistory(accountId, role));

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const total = history.data?.pages[0]?.total ?? 0;

  async function openCombat(combatId: number) {
    setOpenError(null);
    setOpeningId(combatId);
    try {
      const result = await queryClient.fetchQuery(nearQueryOptions.combatReplay(combatId));
      if (!result) {
        throw new Error("This combat is no longer stored.");
      }
      onOpen(result);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <article className="module arena-history">
      <div className="arena-history-header">
        <h2>Combat history</h2>
        <div className="arena-history-tabs" role="tablist" aria-label="Combat role">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.role}
              role="tab"
              aria-selected={role === tab.role}
              className={role === tab.role ? "arena-history-tab-active" : undefined}
              onClick={() => setRole(tab.role)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {history.isPending ? (
        <div aria-busy="true" className="list-block">
          {[0, 1, 2].map((index) => (
            <div className="skeleton arena-row-skeleton-small" key={index} />
          ))}
        </div>
      ) : history.isError ? (
        <div className="status">Could not load combat history: {history.error.message}</div>
      ) : items.length === 0 ? (
        <div className="status">
          {role === "Attacks" ? "You have not challenged anyone yet." : "Nobody has challenged you yet."}
        </div>
      ) : (
        <div className="list-block arena-scroll">
          {items.map((summary) => {
            const outcome = viewerOutcome(summary, accountId);
            const opponent = opponentOf(summary, accountId);
            const coins = viewerCoinDelta(summary, accountId);
            const rank = viewerRankChange(summary, accountId);
            return (
              <div className="list-item arena-compact-row arena-history-row" key={summary.id}>
                <span className={`arena-outcome arena-outcome-${outcome}`}>{OUTCOME_LETTER[outcome]}</span>
                <button className="arena-account arena-account-link" onClick={() => onInspect(opponent)}>
                  {opponent}
                </button>
                <span className="arena-history-meta">
                  {coins !== 0n ? (
                    <span className={coins > 0n ? "arena-delta-up" : "arena-delta-down"}>
                      {coins > 0n ? "+" : "−"}
                      <CurrencyAmount value={coins > 0n ? coins : -coins} currency="GC" />
                    </span>
                  ) : null}
                  {rank ? (
                    <span className={rank.after < rank.before ? "arena-delta-up" : "arena-delta-down"}>
                      #{rank.before} → #{rank.after}
                    </span>
                  ) : null}
                  <span className="meta-row">
                    {new Date(summary.timestamp_sec * 1000).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </span>
                {summary.replayable ? (
                  <button disabled={openingId !== null} onClick={() => void openCombat(summary.id)}>
                    {openingId === summary.id ? "Loading..." : "Open"}
                  </button>
                ) : null}
              </div>
            );
          })}
          {history.hasNextPage ? (
            <button
              className="arena-history-more"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading..." : `Load more (${items.length}/${total})`}
            </button>
          ) : null}
        </div>
      )}

      {openError ? (
        <div className="status" role="alert">
          Could not open combat: {openError}
        </div>
      ) : null}
    </article>
  );
}
