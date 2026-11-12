/** Flat illustrations for PvE creatures, keyed by the contract's `creature_id`. */

type Point = readonly [number, number];
type Shape = { kind: "fill" | "line"; color: string; points: readonly Point[] };

const AXIS = 120;
const INK = "#0a0809";
const BLOOD = "#ff2438";
const MOON = "#7d1520";
const BONE = "#f3ece2";

function toPoints(points: readonly Point[], mirrored: boolean): string {
  return points.map(([x, y]) => `${mirrored ? 2 * AXIS - x : x},${y}`).join(" ");
}

/** Draws each shape on the left half and its mirror on the right, so faces stay symmetric. */
function Symmetric({ shapes }: { shapes: readonly Shape[] }) {
  return (
    <>
      {shapes.map((shape, index) =>
        [false, true].map((mirrored) =>
          shape.kind === "fill" ? (
            <polygon key={`${index}-${mirrored}`} points={toPoints(shape.points, mirrored)} fill={shape.color} />
          ) : (
            <polyline
              key={`${index}-${mirrored}`}
              points={toPoints(shape.points, mirrored)}
              fill="none"
              stroke={shape.color}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />
          ),
        ),
      )}
    </>
  );
}

const WOLF_HEAD: readonly Shape[] = [
  // Black head with tall ears and a spiked ruff
  {
    kind: "fill",
    color: INK,
    points: [
      [120, 44], [104, 48], [90, 56], [70, 12], [64, 62], [50, 74], [30, 76], [46, 90], [22, 104], [48, 110],
      [28, 130], [56, 130], [46, 152], [76, 142], [84, 160], [100, 168], [110, 186], [120, 190],
    ],
  },
  // Open jaws
  { kind: "fill", color: "#4a0a0c", points: [[120, 150], [98, 143], [88, 149], [99, 169], [120, 175]] },
  // Solid red eyes, slanted in a glare
  { kind: "fill", color: BLOOD, points: [[78, 90], [112, 101], [104, 108], [88, 106]] },
  // Fangs
  { kind: "fill", color: BONE, points: [[91, 145], [99, 171], [104, 147]] },
  { kind: "fill", color: BONE, points: [[106, 148], [109, 157], [112, 149]] },
  { kind: "fill", color: BONE, points: [[113, 150], [116, 157], [119, 150]] },
  { kind: "fill", color: BONE, points: [[101, 174], [107, 153], [112, 176]] },
  { kind: "fill", color: BONE, points: [[113, 175], [116, 165], [119, 175]] },
  // Thin light cuts: ears, brow, snout, snarl wrinkles, fur
  { kind: "line", color: BONE, points: [[73, 26], [86, 57], [72, 66]] },
  { kind: "line", color: BONE, points: [[70, 82], [114, 95]] },
  { kind: "line", color: BONE, points: [[112, 110], [109, 134], [120, 132]] },
  { kind: "line", color: BONE, points: [[92, 120], [104, 116]] },
  { kind: "line", color: BONE, points: [[92, 128], [104, 124]] },
  { kind: "line", color: BONE, points: [[46, 100], [62, 97]] },
  { kind: "line", color: BONE, points: [[44, 122], [64, 117]] },
  { kind: "line", color: BONE, points: [[62, 140], [76, 131]] },
];

function WolfArt() {
  return (
    <svg viewBox="0 0 240 200" role="img" aria-label="Wolf" className="creature-art">
      {/* Torn blood moon behind the head */}
      <path
        d="M120 10 L140 15 L154 11 L170 22 L188 28 L196 44 L210 56 L210 74 L218 92 L210 110 L212 128 L198 142
           L190 160 L172 166 L156 180 L138 176 L120 186 L102 176 L84 180 L68 166 L50 160 L42 142 L28 128
           L30 110 L22 92 L30 74 L30 56 L44 44 L52 28 L70 22 L86 11 L100 15 Z"
        fill={MOON}
      />
      <Symmetric shapes={WOLF_HEAD} />
    </svg>
  );
}

const CREATURE_ART: Record<string, () => React.JSX.Element> = {
  wolf: WolfArt,
};

export function CreatureArt({ creatureId }: { creatureId: string }) {
  const Art = CREATURE_ART[creatureId];
  return Art ? <Art /> : null;
}
