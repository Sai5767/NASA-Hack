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

function layer(count, seed) {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => `${(rand() * 100).toFixed(2)}vw ${(rand() * 100).toFixed(2)}vh 0 0 var(--star)`).join(",");
}

/**
 * Sparse, static, dim neutral stars behind the whole app (V3: about 60, no twinkle, no drift, no colour).
 * Two layers: many faint 1px stars and a few slightly brighter 2px ones. Opacity lives in theme.css (.starfield).
 */
export default function Starfield() {
  const layers = useMemo(
    () => [
      { shadow: layer(48, 11), size: 1, cls: "stars-a" },
      { shadow: layer(12, 23), size: 2, cls: "stars-b" },
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
