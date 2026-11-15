/**
 * SEAM — dashboard slot 3 (evidence verdict, "How did we test this?", manual Why). Owned by Agent 4.
 * The shell renders <VerdictSlot> and never styles its insides. The implementation lives in components/insight/.
 *
 * Props (unchanged contract):
 *   place, variable, trend { data, loading, error, key }, onRetry(), onOpenDetail(), openDrawer(spec), closeDrawer()
 * Optional (new): detailLevel ("plain" | "balanced" | "technical"), onTrendRefreshed(freshTrend).
 *
 * Every number shown comes from the backend response. Nothing here computes a statistic.
 */
export { VerdictSlot } from "../insight/VerdictSlot.jsx";
