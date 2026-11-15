# V2 Globe, Timeline, Live Weather and News: wiring note (Agent 3)

Nothing committed. `npm test` and `npm run build` pass. App.jsx was not edited. The work is already wired into Main through the seam
`frontend/src/components/main/MainLayers.jsx`, which App.jsx imports today. Nothing else needs mounting for Main.

## Where things mount

| Export (MainLayers.jsx) | App.jsx usage today | Renders |
| --- | --- | --- |
| `MainLayersProvider` | wraps the Main page with `layerProps` | `GlobeLayersProvider` (components/globe/useGlobeLayers.jsx): all layer state and requests |
| `MainStage` | `<MainStage {...layerProps} globeProps={mainGlobeProps} overlay={null} />` | `.globe-stage#globe-stage` (Globe + legend + forecast pill) and `.rail-slot#timeline` (TimelineRail) |
| `WeatherSlot` | dashboard slot 4 | `LiveWeatherCard` |
| `ForecastSlot` | dashboard slot 5 | `ForecastStatus` |
| `NewsSlot` | dashboard slot 6 | `NewsList`; cards and globe markers open `NewsPanel` in the shell drawer (`id: "news"`) |

## Components (frontend/src/components/globe/)

- `useGlobeLayers.jsx`: `GlobeLayersProvider({ place, variable, places, reducedMotion })`, `useGlobeLayers()`, `useNewsMarkers(openPlaceId)`,
  `useNewsSnapshot()` (a small store, because the shell renders the drawer outside the provider). `GlobeLayersContext` is exported for tests.
- `TimelineRail.jsx`: no props, reads the context.
- `ForecastStatus.jsx`, `LiveWeatherCard.jsx`: no props.
- `News.jsx`: `NewsList`, `NewsPanel({ placeId, placeName })`, `NewsCard({ card, as, onOpen, compact })`, `useOpenNews()`.
- `GlobeLegend.jsx`: `{ timeline, showField, showForecast, showNews, showLive, sampleSites }`.
- `LiveGlyph.jsx`: `{ model, reduced }` (positioned by Globe).
- `fieldLayer.js`: canvas drawing for the local field (`drawField`, `makePatterns`).
- Styles: `frontend/src/styles/globe.css`, imported by Globe.jsx, TimelineRail.jsx and News.jsx (main.jsx does not need to change).
- Pure logic, all tested: `lib/globeFrames.js` (timeline), `lib/ramp.js` (colour classes), `lib/tokens.js` (CSS tokens for canvas, linear-RGB mix),
  `lib/globeNews.js`, `lib/liveWeather.js`, `lib/memoCache.js`.

## Globe.jsx props

The existing props are unchanged: `pins`, `cells`, `cellHalf`, `selectedCell`, `dots`, `onDotPick`, `focus`, `modeRequest`, `busy`, `idleSpin`,
`onPick`, `children`. Onboarding and Explore keep working.

New optional props: `field`, `markers`, `renderMarkerCard`, `onMarkerPick`, `liveGlyph`, `rotationPaused`, `onCellFocus`, `layerLabel` (added to the
`aria-label`) and `reducedMotion`. The OS setting and `<html data-motion="reduced">` (`motionReduced()`) are honoured as well. Dots also accept
`sign: "up" | "down"` (a direction notch inside dots with r ≥ 6) and `failed: true` (a hollow, dotted 3.5px dot).

Behaviour changes, per spec 4.2 and 3.1:
- Idle rotation is 2°/s. It starts 8 s after the last interaction and ramps up over 1.2 s.
- Rotation pauses on drag, wheel, keys, focus anywhere in the globe, hovering a dot, cell or marker, a camera flight, `rotationPaused`, a hidden tab,
  reduced motion, and whenever a field or live glyph is shown. It also needs k ≤ 1.2.
- A "Pause rotation" toggle appears when `idleSpin` is on.
- The halo is now 0.28 alpha over R×0.97–1.20, and the radar sweeps once per 2.2 s.
- `.globe-scan` is removed while any data layer is visible.
- Dot `shadowBlur` is capped at 6.
- Keys pressed on HUD or marker buttons no longer reach the globe's key handler. Before this, Enter on a zoom button also dropped a pin.
- When a new local grid arrives, the camera flies to it, capped at k = 14.

## API functions used (frontend/src/api.js, unchanged; nothing appended)

`fetchMonthlyFrames`, `fetchMonthlyForecast`, `fetchLiveWeather`, `fetchNews`.

Request budget:
- Frames: the active place and variable only. The years run from `current_year - range` to last year (range 3/5/10, default 3), on the API's default grid.
- Forecast: only after "Check forecast".
- Live weather: the active place only, and only while the card is expanded or "Show on globe" is on.
- News: saved places only, sent as `Name:lat:lon`. It loads on first scroll into view or on "Load news context". The backend's global rotation
  stories are dropped client-side. The list is filtered to the selected variable's data type plus `climate_science`, with a "Show all" toggle.
- Every slot has its own AbortController, so a new selection cancels the stale request.
- Responses are cached in memory only, bounded, for about 15 min.

## For the integration lead (App.jsx is owned by the Shell)

1. Explore ▸ World: pass `sign: p.sign` (or the direction from `slope_per_decade`) and `failed: !p.ok` in `worldDots` / `lapseDots` to get the spec 3.5
   notch and hollow failure dots. Show `<GlobeLegend sampleSites />` (or the S10 line) as a Globe child in World mode. `World.jsx` and `TimeLapse.jsx`
   now print "Sample sites, not a complete global map".
2. `mainGlobeProps.busy` (trend loading) still drives the radar. The field's own loading state also drives it.

## Known limits

- I could not run the app in a browser: starting the dev and API servers was not permitted in this session. I checked the render paths with a
  server-side render smoke test (every rail, forecast, weather and news state, plus MainStage, rendered from the fixtures) and with unit tests.
  Canvas drawing, interaction, reduced motion and the responsive layout still need a manual browser check.
- When some observed cells end before `alignment.common_end_month`, forecast months can share calendar labels with trailing missing observed
  months. They stay in separate zones with their own badges, and the forecast card states the training end month.
- Hovering a field cell shows the spec tooltip. Field cells are not individual keyboard focus targets; the "Show grid values as a table"
  disclosure is the keyboard and screen-reader equivalent.
