/**
 * SEAM — owned by Agent 3 (globe, timeline, weather, news). The shell (App.jsx + shell/Dashboard.jsx) imports exactly
 * these five exports and never styles their insides. The export names and the props below are the contract.
 *
 * Props the shell passes (all read-only):
 *   place        { id, name, lat, lon, saved } | null   the active place (null = overview, nothing selected)
 *   variable     { id, label, units, group, ... } | null  the selected /api/variables entry
 *   places       saved places [{ id, name, lat, lon }] (max 5) — nothing is loaded for them in the background
 *   interests    chosen data-type ids ("heat", "water", "cloud", "land", "wind", "ice")
 *   reducedMotion  OS setting OR the in-app Account preference (also on <html data-motion="reduced">)
 *   page         "main" (these are only mounted on Main)
 *   openDrawer / closeDrawer  the single right-hand drawer slot (also available via useShell() from shell/Drawer.jsx)
 *
 * MainLayersProvider wraps the whole Main page (dashboard + stage) and holds the shared layer state
 * (components/globe/useGlobeLayers.jsx): monthly frames, forecast, live weather, news, timeline position.
 */
import Globe from "../Globe.jsx";
import ForecastStatus from "../globe/ForecastStatus.jsx";
import GlobeLegend from "../globe/GlobeLegend.jsx";
import LiveWeatherCard from "../globe/LiveWeatherCard.jsx";
import { NewsCard, NewsList, useOpenNews } from "../globe/News.jsx";
import TimelineRail from "../globe/TimelineRail.jsx";
import { GlobeLayersProvider, useGlobeLayers, useNewsMarkers } from "../globe/useGlobeLayers.jsx";
import { useShell } from "../shell/Drawer.jsx";
import { Badge } from "../shell/ui.jsx";
import { isForecastIndex } from "../../lib/globeFrames.js";

export function MainLayersProvider({ place, variable, places, interests, reducedMotion, children }) {
  return (
    <GlobeLayersProvider place={place} variable={variable} places={places} interests={interests} reducedMotion={reducedMotion}>
      {children}
    </GlobeLayersProvider>
  );
}

/**
 * The globe stage and the timeline rail: two siblings with the classes layout.css places
 * (`.globe-stage#globe-stage` and `.rail-slot#timeline`). `globeProps` are the shell's Globe props; the layer props
 * (field, markers, liveGlyph, rotationPaused …) are added here.
 */
export function MainStage({ globeProps, overlay, reducedMotion }) {
  const L = useGlobeLayers();
  const shell = useShell();
  const newsOpen = shell.drawerId === "news";
  const markers = useNewsMarkers(newsOpen ? L?.openNewsPlace : null);
  const openNews = useOpenNews();
  const forecastShown = !!L?.timeline && isForecastIndex(L.timeline, L.index);
  const frame = L?.frame;
  const layerLabel = L?.field && !L.field.loading && frame
    ? `${L.variable?.label ?? ""}, ${frame.label}, ${frame.kind === "forecast" ? "forecast, not observed" : "observed"}, local grid near ${L.place?.name ?? "the selected place"}`
    : "";
  return (
    <>
      <div className="globe-stage" id="globe-stage">
        <Globe
          {...globeProps}
          field={L?.field ?? null}
          markers={markers}
          renderMarkerCard={(m) => <NewsCard card={m.lead} compact />}
          onMarkerPick={(m) => {
            const p = L?.places.find((x) => x.id === m.placeId);
            if (p) openNews(p);
          }}
          liveGlyph={L?.liveGlyph ?? null}
          rotationPaused={!!shell.drawerId || !!L?.playing}
          layerLabel={layerLabel}
          reducedMotion={reducedMotion ?? L?.reduced}
        >
          {overlay}
          <GlobeLegend
            timeline={L?.timeline}
            showField={!!L?.field && !L.field.loading}
            showForecast={forecastShown}
            showNews={markers.length > 0}
            showLive={!!L?.liveGlyph}
          />
        </Globe>
        {forecastShown && (
          <div className="gl-forecast-pill" role="status">
            <Badge kind="forecast">{frame?.badge || "Forecast — not observed data"}</Badge>
          </div>
        )}
      </div>
      <div className="rail-slot" id="timeline" tabIndex={-1} aria-label="Timeline">
        <TimelineRail />
      </div>
    </>
  );
}

/** Dashboard slot 4 (spec 5.8): collapsed by default, no request until expanded or "Show on globe" is on. */
export function WeatherSlot() {
  return <LiveWeatherCard />;
}

/** Dashboard slot 5 (spec 5.10): /api/monthly-forecast only when the user presses "Check forecast". */
export function ForecastSlot() {
  return <ForecastStatus />;
}

/** Dashboard slot 6 (spec 5.9): /api/news lazily, saved places only. */
export function NewsSlot() {
  return <NewsList />;
}
