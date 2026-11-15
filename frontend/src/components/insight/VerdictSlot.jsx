import { useRef } from "react";
import "../../styles/insight.css";
import { StateCard } from "../shell/ui.jsx";
import EvidenceDrawer from "./EvidenceDrawer.jsx";
import { HOW_BUTTON, WHY_BUTTON } from "./logic.js";
import VerdictCard from "./VerdictCard.jsx";
import WhyPanel from "./WhyPanel.jsx";

/**
 * Dashboard slot "verdict" (spec 1.6 slot 3, 5.5–5.7). A drop-in replacement for the seam export
 * `VerdictSlot` in components/main/InsightSlots.jsx: same props, plus the optional ones marked (new).
 *
 *   place, variable, trend { data, loading, error }, onRetry(), onOpenDetail(), openDrawer(spec), closeDrawer()
 *   detailLevel       (new) the profile's "plain" | "balanced" | "technical"; technical opens the trace "With the numbers"
 *   onTrendRefreshed  (new) called with a refetched trend after a stale-signature retry in the Why panel
 *
 * Main shows only the plain verdict, one sentence and "See how we know" (plan 7); "See how we know" and the opt-in
 * "Why might this be happening?" open in the single right-hand focus panel.
 */
export function VerdictSlot({ place, variable, trend, onRetry, onOpenDetail, openDrawer, closeDrawer, detailLevel, onTrendRefreshed }) {
  // The shell calls a drawer's render() on every render, so the drawers read the live trend state from this ref
  // (the last complete result is kept while a new one loads, so an open Why answer is not wiped by a refetch).
  const live = useRef({ data: null, loading: false, error: "" });
  live.current = { data: trend?.data ?? (trend?.loading ? live.current.data : null), loading: !!trend?.loading, error: trend?.error ?? "" };
  const props = useRef({});
  props.current = { onOpenDetail, onTrendRefreshed, detailLevel, closeDrawer };
  // Main stays minimal (plan 7): the rail group already names the place and subject, so the heading is for screen readers.
  const heading = `Trend${variable ? ` · ${variable.label}` : ""}${place ? ` · ${place.name}` : ""}`;
  const head = <h2 className="sr-only">{heading}</h2>;
  if (!place) {
    return (
      <>
        {head}
        <StateCard kind="empty" title="Choose a place">Tap the globe or pick one of your places.</StateCard>
      </>
    );
  }
  if (trend?.loading) {
    return (
      <>
        {head}
        <div className="ev-skeleton" aria-hidden="true"><span className="ev-meter ev-meter--sm"><i /><i /><i /></span><b /></div>
        <StateCard kind="loading" title="Checking for change…" slowText="Still working — NASA POWER can be slow." />
      </>
    );
  }
  if (trend?.error) {
    return (
      <>
        {head}
        <StateCard kind="error" title="We couldn't check this place" action={onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}>
          {trend.error}
        </StateCard>
      </>
    );
  }
  const d = trend?.data;
  if (!d) return head;

  const eyebrow = [variable?.label ?? d.variable?.label, place?.name].filter(Boolean).join(" · ");
  const openHow = () =>
    openDrawer?.({
      id: "evidence",
      title: HOW_BUTTON,
      eyebrow,
      render: () => (
        <EvidenceDrawer
          data={live.current.data}
          loading={live.current.loading}
          error={live.current.error}
          defaultView={props.current.detailLevel === "technical" ? "numbers" : "plain"}
          onOpenDetail={
            props.current.onOpenDetail &&
            (() => {
              props.current.closeDrawer?.();
              props.current.onOpenDetail();
            })
          }
        />
      ),
    });
  const openWhy = () =>
    openDrawer?.({
      id: "why",
      title: WHY_BUTTON,
      eyebrow,
      render: () => <WhyPanel data={live.current.data ?? d} onTrendRefreshed={props.current.onTrendRefreshed} />,
    });

  return (
    <>
      {head}
      <VerdictCard compact data={d} onHowTested={openDrawer ? openHow : onOpenDetail} onWhy={openDrawer ? openWhy : undefined} headingLevel={3} />
    </>
  );
}

export default VerdictSlot;
