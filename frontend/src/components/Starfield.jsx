import { useMemo } from "react";

// Small seeded generator so the sky is the same on every load.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layer(count, seed, color) {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => `${(rand() * 100).toFixed(2)}vw ${(rand() * 100).toFixed(2)}vh 0 0 ${color}`).join(",");
}

/** Fixed, drifting, twinkling stars behind the whole app. Pure CSS animation. */
export default function Starfield() {
  const layers = useMemo(
    () => [
      { shadow: layer(140, 11, "rgba(190,210,255,0.75)"), size: 1, cls: "stars-a" },
      { shadow: layer(60, 23, "rgba(190,230,255,0.85)"), size: 2, cls: "stars-b" },
      { shadow: layer(16, 37, "rgba(77,255,217,0.9)"), size: 3, cls: "stars-c" },
    ],
    [],
  );
  return (
    <div className="starfield" aria-hidden="true">
      {layers.map((l) => (
        <i key={l.cls} className={l.cls} style={{ width: l.size, height: l.size, boxShadow: l.shadow }} />
      ))}
    </div>
  );
}
