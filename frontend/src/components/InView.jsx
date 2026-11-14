import { useEffect, useRef, useState } from "react";

/**
 * Mounts its children only when scrolled into view, so entrance animations
 * play when the reader actually gets there instead of off-screen.
 */
export default function InView({ children, minHeight = 200, className }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <div ref={ref} className={className} style={seen ? undefined : { minHeight }}>
      {seen ? children : null}
    </div>
  );
}
