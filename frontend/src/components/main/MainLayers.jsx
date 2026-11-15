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
import { NewsCallout, useOpenNews } from "../globe/News.jsx";
import TimelineRail from "../globe/TimelineRail.jsx";
import { GlobeLayersProvider, useGlobeLayers, useNewsMarkers } from "../globe/useGlobeLayers.jsx";
import { useShell } from "../shell/Drawer.jsx";
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
    const p = L?.places.find((x) => x.id === m.placeId);
    if (p) openNewsPanel(p);
    return undefined;
  };
  return (
    <>
      <div className="globe-stage" id="globe-stage">
        <Globe
          idleSpin
          {...globeProps}
          coarse={coarse}
          field={L?.field ?? null}
          markers={markers}
          renderMarkerCard={(m) => <NewsCallout marker={m} />}
          onMarkerPick={pickNews}
          liveGlyph={L?.liveGlyph ?? null}
          // Only an explicit pause or reading the open news detail stops rotation; data layers and playback do not.
          rotationPaused={!!rotationPaused || !!globeProps.rotationPaused}
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

/** Live-weather row (plan 4.2): collapsed by default, no request until expanded or "Show on globe" is on. */
export function WeatherSlot() {
  return <LiveWeatherCard />;
}

/** Forecast row: /api/monthly-forecast only when the user presses "Check forecast". */
export function ForecastSlot() {
  return <ForecastStatus />;
}

/**
 * V3: Main has no news list (plan 6D). News is discovered through the globe markers, which load automatically.
 * Kept as an export so an older shell import does not break; it renders nothing.
 */
export function NewsSlot() {
  return null;
}
