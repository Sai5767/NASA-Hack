/**
 * SEAM — owned by the Globe agent (globe, timeline, weather, news). The shell (App.jsx + shell/Dashboard.jsx) imports
 * these exports and never styles their insides. The export names and the props below are the contract.
 *
 * Props the shell passes (all read-only):
 *   place        { id, name, lat, lon, saved } | null   the active place (null = overview, nothing selected)
 *   variable     { id, label, units, group, ... } | null  the selected /api/variables entry. A primary variable shows the
 *                coarse whole-Earth preview at once (T2M, PRECTOTCORR, CLOUD_AMT), before any place is chosen.
 *   places       saved places [{ id, name, lat, lon }] (max 5) — news is looked up for these only
 *   interests    chosen data-type ids ("heat", "water", "cloud", "land", "wind", "ice")
 *   newsWanted   default true: news markers load automatically (saved places only). Pass false to switch them off.
 *   reducedMotion  OS setting OR the in-app Account preference (also on <html data-motion="reduced">)
 *   page         "main" (these are only mounted on Main)
 *   openDrawer / closeDrawer  the single right-hand drawer slot (also available via useShell() from shell/Drawer.jsx)
 *
 * MainLayersProvider wraps the whole Main page (rail + stage) and holds the shared layer state
 * (components/globe/useGlobeLayers.jsx): coarse preview, monthly frames, forecast, live weather, news, timeline position.
 */
import Globe from "../Globe.jsx";
import ForecastStatus from "../globe/ForecastStatus.jsx";
import GlobeLegend from "../globe/GlobeLegend.jsx";
import LiveWeatherCard from "../globe/LiveWeatherCard.jsx";
import { CapitalCallout, NewsCallout, useOpenNews } from "../globe/News.jsx";
import TimelineRail from "../globe/TimelineRail.jsx";
import { GlobeLayersProvider, LayersBridge, useGlobeLayers, useNewsMarkers } from "../globe/useGlobeLayers.jsx";
import { useShell } from "../shell/Drawer.jsx";
import { useMemo } from "react";
import { capitalMarkers } from "../../lib/capitals.js";
import { isForecastIndex } from "../../lib/globeFrames.js";

export function MainLayersProvider({ place, variable, places, interests, reducedMotion, newsWanted = true, children }) {
  return (
    <GlobeLayersProvider place={place} variable={variable} places={places} interests={interests} reducedMotion={reducedMotion} newsWanted={newsWanted}>
      {children}
    </GlobeLayersProvider>
  );
}

/**
 * The globe stage and the floating timeline: two siblings with the classes layout.css places
 * (`.globe-stage#globe-stage` and `.rail-slot#timeline`). `globeProps` are the shell's Globe props (pins, dots,
 * savedPins, onSavedPinPick / onOpenSavedPin, focus, onPick …); the layer props (coarse, field, markers, liveGlyph)
 * are added here.
 *   onOpenNews(marker)  optional: open the full news detail yourself (default: the news panel in the shell drawer)
 *   rotationPaused      optional explicit pause (rotation otherwise only pauses for drag / marker reading / reduced motion)
 */
export function MainStage({ globeProps = {}, overlay, reducedMotion, onOpenNews, rotationPaused = false }) {
  const L = useGlobeLayers();
  const shell = useShell();
  const newsOpen = shell.drawerId === "news";
  const markers = useNewsMarkers(newsOpen ? L?.openNewsPlace : null);
  // Capital cities for the rotating popups: bundled geography, one popup at a time together with the news (lib/newsCycle.js).
  const capitals = useMemo(() => capitalMarkers(), []);
  const globeMarkers = useMemo(() => [...markers, ...capitals], [markers, capitals]);
  const openNewsPanel = useOpenNews();
  const forecastShown = !!L?.timeline && isForecastIndex(L.timeline, L.index);
  const frame = L?.frame;
  const showField = !!L?.field && !L.field.loading;
  const coarse = L?.coarse?.doc ? L.coarse : null;
  const layerLabel = [
    coarse ? `coarse global preview of ${L.variable?.label ?? "the chosen variable"}, approximate pattern, ${coarse.label}` : "",
    showField && frame
      ? `detailed local data near ${L.place?.name ?? "the selected place"}, ${frame.label}, ${frame.kind === "forecast" ? "forecast, not observed" : "observed"}`
      : "",
  ].filter(Boolean).join("; ");
  const pickNews = (m) => {
    if (onOpenNews) return onOpenNews(m);
    const p = [...(L?.places ?? []), ...(L?.showcasePlaces ?? [])].find((x) => x.id === m.placeId);
    if (p) openNewsPanel(p);
    return undefined;
  };
  // Anything that takes the user's attention pauses the automatic news cycle: an open drawer, and moving the timeline.
  const holdKey = `${L?.index ?? ""}|${L?.scrub?.index ?? ""}|${L?.playing ? 1 : 0}`;
  return (
    <>
      <div className="globe-stage" id="globe-stage">
        <Globe
          idleSpin
          {...globeProps}
          coarse={coarse}
          field={L?.field ?? null}
          markers={globeMarkers}
          renderMarkerCard={(m) => (m.kind === "capital" ? <CapitalCallout marker={m} /> : <NewsCallout marker={m} />)}
          onMarkerPick={pickNews}
          liveGlyph={L?.liveGlyph ?? null}
          // Only an explicit pause or reading the open news detail stops rotation; data layers and playback do not.
          rotationPaused={!!rotationPaused || !!globeProps.rotationPaused}
          newsPaused={!!shell.drawerId}
          newsHoldKey={holdKey}
          layerLabel={layerLabel}
          reducedMotion={reducedMotion ?? L?.reduced}
        >
          {overlay}
          <GlobeLegend
            timeline={L?.timeline}
            variable={L?.variable}
            coarse={L?.coarse}
            showField={showField}
            showForecast={forecastShown}
            showNews={markers.length > 0}
            showLive={!!L?.liveGlyph}
            savedPins={globeProps.savedPins ?? []}
          />
        </Globe>
      </div>
      <div className="rail-slot" id="timeline" tabIndex={-1} aria-label="Timeline">
        <TimelineRail />
      </div>
    </>
  );
}

/**
 * One compact rail row (quiet rail spec): a 2–5 word label, a short value, a chevron. The full detail opens in the
 * shell drawer; nothing is requested until then.
 */
function RailRow({ label, value, glyph, onOpen, expanded, tone }) {
  return (
    <button type="button" className={`rail-kv${tone ? ` rail-kv--${tone}` : ""}`} onClick={onOpen} aria-haspopup="dialog" aria-expanded={expanded}>
      {glyph && <span className="rail-kv-glyph" aria-hidden="true">{glyph}</span>}
      <span className="rail-kv-label">{label}</span>
      <span className="rail-kv-value">{value}</span>
      <span className="rail-kv-go" aria-hidden="true">›</span>
    </button>
  );
}

function weatherValue(L) {
  if (!L.place) return "No place yet";
  const s = L.weatherState;
  if (s.kind === "idle") return "Open";
  if (s.kind === "loading") return "Loading…";
  if (s.kind === "available" || s.kind === "stale") {
    const t = L.weatherReq.data?.current?.temperature_c;
    return Number.isFinite(t) ? `${t.toFixed(0)} °C now${s.kind === "stale" ? " · saved" : ""}` : "Available";
  }
  if (s.kind === "unconfigured") return "Not set up";
  if (s.kind === "rate_limited") return "Busy, try later";
  return "Unavailable";
}

function forecastValue(L) {
  if (!L.place || !L.variable) return "No place yet";
  const s = L.forecastStatus;
  if (s.kind === "idle") return "Not checked";
  if (s.kind === "loading") return "Checking…";
  if (s.kind === "error") return "Couldn't check";
  if (s.kind === "withheld") return "Withheld";
  return s.first === s.last ? s.first : `${s.first} – ${s.last}`;
}

/** Live-weather row (plan 4.2): one compact row; the card opens in the drawer and only then requests data. */
export function WeatherSlot() {
  const L = useGlobeLayers();
  const shell = useShell();
  if (!L) return null;
  const open = () =>
    shell.openDrawer({
      id: "live-weather",
      title: L.place ? `Live weather · ${L.place.name}` : "Live weather",
      eyebrow: "Meteomatics, not NASA trend data",
      render: () => <LayersBridge><LiveWeatherCard inPanel /></LayersBridge>,
    });
  return <RailRow label="Live weather" glyph="◔" value={weatherValue(L)} onOpen={open} expanded={shell.drawerId === "live-weather"} />;
}

/** Forecast row: one compact row; /api/monthly-forecast only when the user presses "Check forecast" in the drawer. */
export function ForecastSlot() {
  const L = useGlobeLayers();
  const shell = useShell();
  if (!L) return null;
  const open = () =>
    shell.openDrawer({
      id: "forecast",
      title: "Forecast status",
      eyebrow: "Forecast, not observed",
      render: () => <LayersBridge><ForecastStatus inPanel /></LayersBridge>,
    });
  return (
    <RailRow
      label="Forecast"
      glyph="▨"
      value={forecastValue(L)}
      tone={L.forecastStatus?.kind === "eligible" ? "forecast" : undefined}
      onOpen={open}
      expanded={shell.drawerId === "forecast"}
    />
  );
}

/**
 * V3: Main has no news list (plan 6D). News is discovered through the globe markers, which load automatically.
 * Kept as an export so an older shell import does not break; it renders nothing.
 */
export function NewsSlot() {
  return null;
}
