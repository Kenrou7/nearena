"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useActionQueue } from "@/components/action-queue-provider";
import { MAX_QUEUED_ACTIONS, type QueuedAction } from "@/lib/action-queue";
import { getItemPresentation } from "@/lib/item-catalog";

type DisplayRow =
  | { kind: "slot"; key: string; action: Exclude<QueuedAction, { kind: "consume" }> }
  | { kind: "consume"; key: string; itemId: string; count: number };

function toDisplayRows(actions: readonly QueuedAction[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const consumeCounts = new Map<string, number>();

  for (const action of actions) {
    if (action.kind === "consume") {
      consumeCounts.set(action.itemId, (consumeCounts.get(action.itemId) ?? 0) + 1);
    } else {
      rows.push({ kind: "slot", key: `slot:${action.slot}`, action });
    }
  }

  for (const [itemId, count] of consumeCounts) {
    rows.push({ kind: "consume", key: `consume:${itemId}`, itemId, count });
  }
  return rows;
}

export function ActionQueueBar() {
  const queue = useActionQueue();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = queue.actions.length;

  useEffect(() => {
    if (count === 0) {
      setOpen(false);
    }
  }, [count]);

  if (count === 0 && !error) {
    return null;
  }

  async function handleApply() {
    setError(null);
    try {
      await queue.apply();
      setOpen(false);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    }
  }

  const rows = toDisplayRows(queue.actions);

  return (
    <div className="dock-panel" role="region" aria-label="Pending inventory actions">
      {open ? (
        <div className="cart-panel" id="action-queue-panel">
          <div className="cart-panel-header">
            <strong>Pending actions</strong>
            <span className="meta-row">
              {count}/{MAX_QUEUED_ACTIONS} per transaction · gear changes apply before potions
            </span>
          </div>
          <ul className="cart-lines">
            {rows.map((row) => {
              if (row.kind === "consume") {
                const presentation = getItemPresentation(row.itemId);
                return (
                  <li className="cart-line queue-line" key={row.key}>
                    <Image src={presentation.imageSrc} alt="" className="cart-line-thumb" width={84} height={56} />
                    <span className="cart-line-name">
                      Drink {presentation.title}
                      {row.count > 1 ? ` ×${row.count}` : ""}
                    </span>
                    <button
                      className="cart-line-remove"
                      aria-label={`Drink one ${presentation.title} less`}
                      disabled={queue.applying}
                      onClick={() => queue.cancelOneConsume(row.itemId)}
                    >
                      −
                    </button>
                  </li>
                );
              }

              const { action } = row;
              const presentation = action.kind === "equip" ? getItemPresentation(action.itemId) : null;
              return (
                <li className="cart-line queue-line" key={row.key}>
                  {presentation ? (
                    <Image src={presentation.imageSrc} alt="" className="cart-line-thumb" width={84} height={56} />
                  ) : (
                    <span className="cart-line-thumb queue-unequip-mark" aria-hidden="true">
                      ⤫
                    </span>
                  )}
                  <span className="cart-line-name">
                    {presentation ? `Equip ${presentation.title}` : `Unequip ${action.slot.toLowerCase()}`}
                    <span className="chip queue-slot-chip">{action.slot}</span>
                  </span>
                  <button
                    className="cart-line-remove"
                    aria-label={`Cancel ${action.kind} ${action.slot}`}
                    disabled={queue.applying}
                    onClick={() => queue.cancelSlotChange(action.slot)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="row">
            <button className="cart-clear" onClick={queue.clear} disabled={queue.applying}>
              Discard all
            </button>
          </div>
        </div>
      ) : null}

      <div className="cart-summary">
        <button
          className="cart-toggle"
          aria-expanded={open}
          aria-controls="action-queue-panel"
          onClick={() => setOpen((value) => !value)}
          disabled={count === 0}
        >
          Pending · {count} {count === 1 ? "action" : "actions"} {open ? "▾" : "▴"}
        </button>
        <div className="cart-totals" />
        <button
          className="primary cart-buy"
          disabled={count === 0 || queue.applying}
          title="Apply every pending action in one transaction"
          onClick={() => void handleApply()}
        >
          {queue.applying ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? (
        <div className="cart-message cart-message-error" role="alert">
          Could not apply actions: {error}
          <button className="cart-line-remove" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
