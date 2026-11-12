"use client";

import Image from "next/image";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { getItemPresentation } from "@/lib/item-catalog";
import type { PlayerView } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";

const SLOTS = [
  { label: "Weapon", tokenOf: (player: PlayerView) => player.equipped_weapon_token_id },
  { label: "Shield", tokenOf: (player: PlayerView) => player.equipped_shield_token_id },
  { label: "Helmet", tokenOf: (player: PlayerView) => player.equipped_helmet_token_id },
  { label: "Armor", tokenOf: (player: PlayerView) => player.equipped_armor_token_id },
] as const;

/** The four equipment slots with the item worn in each, linking to the inventory to change them. */
export function EquippedGear({ player }: { player: PlayerView }) {
  const slots = SLOTS.map((slot) => ({ label: slot.label, tokenId: slot.tokenOf(player) }));
  const tokens = useQueries({
    queries: slots.map((slot) => ({
      ...nearQueryOptions.token(slot.tokenId ?? ""),
      enabled: slot.tokenId !== null,
    })),
  });

  return (
    <article className="module">
      <div className="gear-header">
        <h2>Equipment</h2>
        <Link className="button-link" href="/inventory">
          Manage
        </Link>
      </div>
      <div className="gear-grid">
        {slots.map((slot, index) => {
          const token = tokens[index];
          const itemId = token.data?.item_id;
          const item = itemId ? getItemPresentation(itemId) : null;
          return (
            <div className={item ? "gear-slot" : "gear-slot gear-slot-empty"} key={slot.label}>
              {slot.tokenId && token.isPending ? (
                <div className="skeleton gear-slot-art" aria-busy="true" />
              ) : item ? (
                <Image className="gear-slot-art" src={item.imageSrc} alt={item.title} width={96} height={64} />
              ) : (
                <div className="gear-slot-art gear-slot-placeholder" aria-hidden="true" />
              )}
              <span className="gear-slot-label">{slot.label}</span>
              <span className="gear-slot-item">{item ? item.title : slot.tokenId ? "…" : "Empty"}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
