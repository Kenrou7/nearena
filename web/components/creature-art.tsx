import Image from "next/image";

/** Illustrations for PvE creatures, keyed by the contract's `creature_id`. */
const CREATURE_ART: Record<string, { src: string; alt: string }> = {
  wolf: { src: "/assets/creatures/wolf.jpeg", alt: "Wolf" },
};

/**
 * Fixed-ratio frame: the image covers it (cropping the edges if needed), so every creature
 * card has the same height whatever the source image size.
 */
export function CreatureArt({ creatureId }: { creatureId: string }) {
  const art = CREATURE_ART[creatureId];
  if (!art) {
    return null;
  }
  return (
    <div className="creature-art">
      <Image src={art.src} alt={art.alt} fill sizes="(max-width: 700px) 100vw, 400px" />
    </div>
  );
}
