import { useEffect, useState } from "react";

const DEFAULT_STEPS = [
  "Contacting NASA POWER…",
  "Pulling decades of monthly records…",
  "Removing the seasonal cycle…",
  "Running trend tests…",
  "Checking how robust the result is…",
];

/** Progress readout with rotating status lines while an analysis runs. */
export default function Loading({ steps = DEFAULT_STEPS, title = "Investigating" }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((n) => (n + 1) % steps.length), 1100);
    return () => clearInterval(timer);
  }, [steps.length]);
  return (
    <div className="loading" role="status" aria-live="polite">
      <p className="eyebrow">{title}</p>
      <p className="loading-line mono">{steps[i]}</p>
      <div className="loading-bar" aria-hidden="true"><i /></div>
    </div>
  );
}
