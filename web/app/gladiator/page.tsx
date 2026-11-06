"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SessionGate } from "@/components/session-gate";
import {
  getItemDefinitionView,
  getPlayerView,
  getTokenView,
  type PlayerView,
} from "@/lib/near-rpc";
import { getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

type EffectiveBonuses = {
  strength: number;
  dexterity: number;
  vitality: number;
};

function toEquippedTokenIds(player: PlayerView): string[] {
  return [
    player.equipped_weapon_token_id,
    player.equipped_shield_token_id,
    player.equipped_helmet_token_id,
    player.equipped_armor_token_id,
  ].filter((tokenId): tokenId is string => Boolean(tokenId));
}

export default function GladiatorPage() {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [effectiveBonuses, setEffectiveBonuses] = useState<EffectiveBonuses>({
    strength: 0,
    dexterity: 0,
    vitality: 0,
  });
  const [status, setStatus] = useState("Waiting for wallet session.");
  const [loading, setLoading] = useState(false);

  const presentToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });

    window.setTimeout(() => {
      setToast((current) => {
        if (!current || current.id !== id) {
          return current;
        }

        return null;
      });
    }, 4200);
  }, []);

  const refreshProfile = useCallback(async (nearAccountId: string) => {
    setLoading(true);
    setStatus("Fetching on-chain profile...");

    try {
      const playerData = await getPlayerView(nearAccountId);
      setPlayer(playerData);

      if (playerData) {
        const equippedTokenIds = toEquippedTokenIds(playerData);
        if (equippedTokenIds.length === 0) {
          setEffectiveBonuses({ strength: 0, dexterity: 0, vitality: 0 });
        } else {
          const tokenResults = await Promise.allSettled(
            equippedTokenIds.map((tokenId) => getTokenView(tokenId)),
          );
          const itemIds = tokenResults
            .map((result) => {
              if (result.status !== "fulfilled" || !result.value) {
                return null;
              }

              return result.value.item_id;
            })
            .filter((itemId): itemId is string => Boolean(itemId));

          const uniqueItemIds = Array.from(new Set(itemIds));
          const definitionResults = await Promise.allSettled(
            uniqueItemIds.map((itemId) => getItemDefinitionView(itemId)),
          );

          const nextBonuses: EffectiveBonuses = { strength: 0, dexterity: 0, vitality: 0 };
          for (const result of definitionResults) {
            if (result.status !== "fulfilled" || !result.value || !result.value.active) {
              continue;
            }

            nextBonuses.strength += result.value.strength_bonus;
            nextBonuses.dexterity += result.value.dexterity_bonus;
            nextBonuses.vitality += result.value.vitality_bonus;
          }

          setEffectiveBonuses(nextBonuses);
        }

        setStatus(`Profile loaded for ${nearAccountId}.`);
      } else {
        setEffectiveBonuses({ strength: 0, dexterity: 0, vitality: 0 });
        setStatus(`No registered player found for ${nearAccountId}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("Could not refresh profile. Please retry in a few seconds.");
      presentToast(message);
      setPlayer(null);
      setEffectiveBonuses({ strength: 0, dexterity: 0, vitality: 0 });
    } finally {
      setLoading(false);
    }
  }, [presentToast]);

  useEffect(() => {
    const sync = () => {
      setSession(getWalletSession());
    };

    sync();
    return subscribeWalletSession(sync);
  }, []);

  useEffect(() => {
    if (!session) {
      setPlayer(null);
      setStatus("Waiting for wallet session.");
      return;
    }

    if (session.chain !== "near") {
      setPlayer(null);
      setStatus("Gladiator profile requires a NEAR session.");
      return;
    }

    void refreshProfile(session.accountId);
  }, [refreshProfile, session]);

  return (
    <SessionGate
      title="Perfil del Campeon"
      description="Conecta una wallet para ver stats reales del gladiador y datos del contrato."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Gladiador</p>
            <h2>Perfil on-chain</h2>
            <p className="muted">Consulta real al contrato para get_player y get_pot.</p>
          </header>

          <article className="module">
            <div className="status">{status}</div>
            {loading ? <div className="status">Loading profile...</div> : null}
          </article>

          <article className="module gladiator-hero">
            <Image
              src="/assets/gladiators/default-gladiator.svg"
              alt="Gladiator avatar"
              className="gladiator-hero-image"
              width={220}
              height={220}
              priority
            />
            <div className="gladiator-hero-copy">
              <h2>Champion Card</h2>
              <p className="muted">
                Default avatar for v1. Later we can bind this to class/skin per player.
              </p>
              <div className="list-block">
                <div className="list-item">
                  <span>Account</span>
                  <span className="chip">{session?.accountId ?? "none"}</span>
                </div>
                <div className="list-item">
                  <span>Level</span>
                  <span className="chip">{player?.level ?? "-"}</span>
                </div>
                <div className="list-item">
                  <span>XP</span>
                  <span className="chip">{player?.xp ?? "-"}</span>
                </div>
              </div>
            </div>
          </article>

          <section className="game-grid">
            <article className="module">
              <h2>Stats</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item"><span>Level</span><span className="chip">{player.level}</span></div>
                  <div className="list-item"><span>XP</span><span className="chip">{player.xp}</span></div>
                  <div className="list-item">
                    <span>STR</span>
                    <span className="chip">
                      {player.strength + effectiveBonuses.strength}
                      {effectiveBonuses.strength > 0 ? ` (+${effectiveBonuses.strength})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>DEX</span>
                    <span className="chip">
                      {player.dexterity + effectiveBonuses.dexterity}
                      {effectiveBonuses.dexterity > 0 ? ` (+${effectiveBonuses.dexterity})` : ""}
                    </span>
                  </div>
                  <div className="list-item">
                    <span>VIT</span>
                    <span className="chip">
                      {player.vitality + effectiveBonuses.vitality}
                      {effectiveBonuses.vitality > 0 ? ` (+${effectiveBonuses.vitality})` : ""}
                    </span>
                  </div>
                  <div className="list-item"><span>Life</span><span className="chip">{player.current_life}</span></div>
                </div>
              ) : (
                <div className="status">No player loaded for this session.</div>
              )}
            </article>

            <article className="module">
              <h2>Inventory</h2>
              {player ? (
                <div className="list-block">
                  <div className="list-item">
                    <span>Items</span>
                    <span className="chip">{player.owned_item_ids.length}</span>
                  </div>
                  <div className="list-item">
                    <span>Tokens</span>
                    <span className="chip">{player.owned_token_ids.length}</span>
                  </div>
                  <div className="row">
                    <Link className="button-link" href="/inventory">
                      Open inventory manager
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="status">No inventory available.</div>
              )}
            </article>
          </section>
        </section>

        {toast ? (
          <div className="shop-toast" role="status" aria-live="polite">
            <strong>Error</strong>
            <p>{toast.message}</p>
          </div>
        ) : null}
      </main>
    </SessionGate>
  );
}
