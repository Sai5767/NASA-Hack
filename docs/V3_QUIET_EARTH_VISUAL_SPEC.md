# V3 "Quiet Earth" visual spec

Status: tokens shipped (agent D, 15 Nov 2026). Branch `v3-quiet-earth`.
Overrides `docs/V2_FABLE_VISUAL_SPEC.md` wherever they conflict (see `Planning and prompts/frontend_plan_final.txt` sections 3, 4, 11, 12).

The one rule: **black space, white interface, real Earth.** The interface uses black, white and neutral grey only. Colour appears in exactly four named places: the Earth disc, a returned data layer plus its legend, verified news markers, and saved-pin markers.

---

## 1. Source of truth

| What | File | Notes |
| --- | --- | --- |
| CSS custom properties (all tokens) | `frontend/src/styles/theme.css` `:root` | The only `:root` token block in the app. Loaded first by `main.jsx`. |
| Canvas / JS mirror | `frontend/src/lib/tokens.js` `FALLBACK` + `readTokens()` | Canvas reads computed CSS vars once per mount and falls back to this. Keep in sync with theme.css. |
| JS palettes | `frontend/src/lib/theme.js` | `THEMES.mission` (globe base + pin A/B), `DATA_COLORS`, `PIN_COLORS` (new), `NEWS_COLORS` (new). Single theme; all V2 exports kept (`themeOf`, `nextTheme`, `applyTheme`, `savedTheme`, `applyMotionPref`, `motionReduced`). |
| Logo | `frontend/src/components/shell/Logo.jsx` | `default Logo`, named `LogoMark`. Styles `.td-logo*` in theme.css. |

`tests/theme.test.mjs` compares some legacy names literally (`--accent`, `--live`, `--accent-rgb`, `--globe-*`, `--up`, `--down`, `--flat`, `--missing-fg`), so those hold the literal value and their V3 names alias them. Do not swap that around without updating the test.

**Rule for every other stylesheet / component:** use only the V3 names in section 2. Never write a hex, `rgb()`/`rgba()` colour, `px` radius, or `backdrop-filter` in a component stylesheet. The only allowed literal alphas are `rgba(255,255,255,a)` / `rgba(0,0,0,a)` inside a token definition.

---

## 2. Tokens

### 2.1 Interface (black / white / neutral grey)

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `--bg` | `#050505` | Page black. Only page background. | — |
| `--surface` | `#0e0e0e` | The one lifted reading surface: focus panel, sheets, sign-in, popovers, callouts. | — |
| `--surface-scrim` | `rgba(5,5,5,.72)` | Behind a modal sheet only. | — |
| `--grey-900` / `--hover` | `#161616` | Hover fill. | — |
| `--grey-800` / `--selected` | `#1f1f1f` | Selected / pressed fill. | — |
| `--grey-700` / `--border` | `#2a2a2a` | **The** hairline (1px, `--border-width`). Every separator and every outline. | decorative |
| `--grey-600` | `#3d3d3d` | Tracks, disabled outlines, empty meter marks (`--evidence-off`). | — |
| `--grey-500` / `--border-control` | `#6b6b6b` | Input / toggle / slider boundary. | 3.6:1 on surface |
| `--grey-400` / `--text-faint` | `#8c8c8c` | Faint labels, units. | 5.7:1 surface, 6.0:1 bg |
| `--grey-300` / `--text-dim` | `#b3b3b3` | Secondary text. | 9.2:1 |
| `--grey-100` / `--text` | `#f2f2f2` | Primary text. | 17.3:1 |
| `--white` | `#ffffff` | Logo, primary button fill, focus ring. | — |
| `--text-on-light` | `#050505` | Ink on white / on a data swatch. | — |
| `--focus-ring` | `#ffffff` | 2px (`--focus-ring-width`), offset 2px. | ≥14:1 |
| `--focus-halo` | `0 0 0 4px rgba(5,5,5,.85)` | Dark halo outside the ring so it reads on light data cells. | — |
| `--trend-up` / `--trend-down` | `#f2f2f2` | UI trend text/arrows. Direction is the glyph (▲ ▼), never colour. | — |
| `--trend-flat` | `#8c8c8c` | "No clear change" (glyph –). | — |
| `--evidence-on` / `--evidence-off` | `#f2f2f2` / `#3d3d3d` | Filled / empty "How sure are we?" meter marks. | — |
| `--star` | `#d9d9d9` | Sparse static stars (alpha .15–.6). | — |

No other black, grey or white may appear in chrome.

### 2.2 Earth exceptions (inside the globe disc only)

| Token | Value |
| --- | --- |
| `--earth-ocean-lit` (= `--globe-ocean-lit`) | `#1d4a72` |
| `--earth-ocean-dark` (= `--globe-ocean-dark`) | `#061525` |
| `--earth-flat-ocean` (= `--globe-flat-ocean`) | `#0a2236` |
| `--earth-land` (= `--globe-land`) | `#3f5236` (muted temperate green) |
| `--earth-land-dry` | `#6e6146` (muted arid brown) |
| `--earth-ice` | `#e6ebee` (ice, cloud) |
| `--earth-coast` | `rgba(225,232,225,.26)` (non-fluorescent) |
| `--earth-border` | `rgba(255,255,255,.07)` |
| `--earth-graticule` | `rgba(255,255,255,.035)` (optional; sparse) |
| `--earth-atmosphere-rgb` (= `--globe-halo-rgb`) | `120,170,230`, max alpha .22, within ~4% of radius |
| `--earth-limb` | `rgba(150,190,235,.30)` |

JS mirror: `THEMES.mission.globe` in theme.js (already passed to `applyGlobePalette` by App.jsx).

### 2.3 Data scales (on the data layer and its legend only)

Never tint a panel, button, chip or label with these.

| Ramp | Steps 1 → 4 (weak → strong) |
| --- | --- |
| `--data-warm-1..4` (warmer than usual) | `#efd8b8 #e2b182 #d08455 #c0654a` |
| `--data-cool-1..4` (cooler / less cloud) | `#cadcea #9cbfdd #6f9fc9 #4a7fb5` |
| `--data-wet-1..4` (wetter) | `#c3e0dd #8cc3bf #5aa3a0 #3f8a8c` |
| `--data-dry-1..4` (drier) | `#e8dcc0 #cdb88a #ad935e #93804e` |
| `--data-cloud-1..4` (more cloud) | `#8a8a8a #adadad #d0d0d0 #f0f0f0` |
| `--data-neutral` (near usual) | `#7a7a7a` |
| `--text-on-data` | `#050505` (≥4.5:1 on every step) |
| `--data-up` / `--data-down` / `--data-flat` (= `--up`/`--down`/`--flat`) | `#d08455 #6f9fc9 #7a7a7a`: world sample dots and their legend only |
| `--missing-fg`, `--missing-bg`, `--missing-pattern` | neutral grey cross-hatch, labelled "No data" |
| `--forecast-line`, `--forecast-dash` (6 4), `--forecast-hatch`, `--forecast-zone-bg`, `--forecast-fill-alpha` | neutral white hatch + dashed divider + "Forecast" label |
| `--cell-holds` (solid), `--cell-before-only` (dashed), `--cell-stroke` | Scan-cell evidence (item 6): border **style**, not colour |

### 2.4 News attention (verified marker outline, glyph and leader only; never a fill)

| Token | Value | Glyph |
| --- | --- | --- |
| `--news-green` | `#4cc38a` | circle (low attention) |
| `--news-amber` | `#f5b83d` | triangle (medium) |
| `--news-red` | `#f2555a` | diamond (high) |
| `--news-unverified` | `#8c8c8c` | dashed (`--news-unverified-dash: 3 3`), no severity, label "Unverified news context" |
| `--news-border-width` 2px, `--news-leader-width` 1px | | |

JS mirror: `NEWS_COLORS` in theme.js. These three hues may not appear anywhere else (no warn/ok/error states, no chips).

### 2.5 Saved-pin palette (section 12 item 10)

Six marker colours, none near news red/amber/green, always drawn with the pin glyph + text label (colour is never the only cue).

| Token | Value | Name | Outline |
| --- | --- | --- | --- |
| `--pin-1` | `#f5f5f5` | Snow | `--pin-outline` `#050505` |
| `--pin-2` | `#a3a3a3` | Silver | `#050505` |
| `--pin-3` | `#9fd3f0` | Ice | `#050505` |
| `--pin-4` | `#c4b5fd` | Lavender | `#050505` |
| `--pin-5` | `#d6c7a1` | Sand | `#050505` |
| `--pin-6` | `#5c5c5c` | Graphite | `#ffffff` (1px) |

JS: `PIN_COLORS` array in theme.js (`{id, label, hex, outline}`). Store the `id` in localStorage, not the hex.
Pin A / pin B (Duel) stay `--pin-a` (= white `--accent`) and `--pin-b` (= silver `--live`); separate them with the A/B label and a dashed B line.

### 2.6 Type

- `--font-ui`: Space Grotesk Variable: every readable word.
- `--font-value`: JetBrains Mono Variable: values, units next to values, month labels, coordinates, optional technical detail only. Never a sentence, never a paragraph.

| Token | Size | Use |
| --- | --- | --- |
| `--fs-label` | 13px | Short labels, legend keys, units, values. Never sentences. |
| `--fs-small` | 14px | Secondary one-liners, buttons, wordmark. |
| `--fs-body` | 15px | **Minimum body text.** |
| `--fs-lead` | 17px | Group labels, panel lead. |
| `--fs-title` | 20px | Panel title. |
| `--fs-verdict` | 24px | Verdict, sign-in heading. |
| `--fs-display` | 32px | Month readout, big value. |
| `--fs-hero` | 44px | Onboarding question (desktop). |

`--lh-tight 1.15`, `--lh-snug 1.35`, `--lh-body 1.55`; `--fw-regular 400`, `--fw-medium 500`, `--fw-bold 600`; `--tracking-tight -0.01em`, `--tracking-label 0.02em`.
Sentence case everywhere. No uppercase mono eyebrows (`.eyebrow` is now sentence-case Space Grotesk 13px faint).

### 2.7 Space, layout, radius, elevation, motion

- Spacing: `--space-1..16` (4px base: 4 8 12 16 20 24 32 40 48 64).
- Layout: `--topbar-h 56px` (52 phone), `--rail-w 288px` (272 ≤1199px), `--focus-w 420px` (380 ≤1199px), `--timeline-h 44px`, `--hit-min 32px` (44 coarse pointer).
- Radius: `--radius-xs 2px` (swatches), `--radius-sm 6px` (buttons, inputs), `--radius-md 10px` (focus panel, popover, callout, sheet, sign-in), `--radius-pill` (account disc, segmented switch, pill chips). One radius per component.
- Elevation: `--shadow-float` only, only on layers floating over the Earth (popover, callout, tooltip). No glows, no blur, no glass.
- Z: `--z-starfield 0 … --z-toast 60` (unchanged).
- Motion: `--dur-fast 160`, `--dur-base 240`, `--dur-slow 360`, `--dur-page 280`, `--dur-callout 200` (marker → leader → callout), `--dur-frame-fade 220` (adjacent returned frames), `--globe-idle-resume-delay 1000ms`, `--globe-idle-ramp 900ms`, `--globe-idle-deg-per-s 2`. Easing `--ease-standard`, `--ease-in-out`, `--ease-exit`.

### 2.8 Legacy aliases (migrate away)

All V2 names still resolve so nothing breaks, but now point at monochrome values. Replace them with V3 names when you touch a file:

| Legacy | Now resolves to | Replace with |
| --- | --- | --- |
| `--accent`, `--accent-rgb`, `--accent-dim`, `--accent-ink`, `--text-on-accent` | white / white .08 / black | `--text`, `--white`, `--selected`, `--text-on-light` |
| `--live`, `--live-dim` | silver `#a3a3a3` | `--text-dim` + a "Live" label/glyph |
| `--up`, `--down`, `--flat` | data rise/fall | `--trend-*` in UI; `--data-up/down/flat` on a data layer |
| `--state-ok/warn/error/info/stale`, `--ok`, `--amber` | `--text` / `--text-dim` | `--text` + a glyph (✓ ! ✕ ◔) |
| `--type-*` | `--text` | `--text` |
| `--verdict-*` | `--evidence-on` / `--text-faint` | `--evidence-on/off` |
| `--bg-0/1/2`, `--surface-0..3`, `--panel*`, `--scrim`, `--ink-rgb` | `--bg` / `--surface` / `--selected` | `--bg`, `--surface`, `--selected`, `--surface-scrim` |
| `--line`, `--line-strong`, `--line-rgb`, `--line-control` | `--border` / white / `--border-control` | `--border`, `--border-control` |
| `--glow-*` | none / `0,0,0` | delete the rule |
| `--font-display`, `--font-mono`, `--fs-11..44` | `--font-ui`, `--font-value`, new scale (`--fs-11/12/13` → 13px) | V3 type names |
| `--radius`, `--radius-lg` | `--radius-md` | `--radius-md` |
| `--shadow-1/2/3` | none / `--shadow-float` | `--shadow-float` or nothing |
| `--dash-w`, `--drawer-w`, `--rail-h` | `--rail-w`, `--focus-w`, 116px | V3 layout names |
| `--globe-coast/border/graticule/limb/flat` | `--earth-*` | `--earth-*` |
| `--dur-scan-sweep`, `--dur-cell-stagger` | `0ms` | delete radar / stagger |

---

## 3. Base rules shipped in theme.css

`body` is flat `--bg` (no gradients, no grid `body::before`). `.card` is `--surface` + hairline + `--radius-md`, no blur, no HUD brackets. `.btn` is transparent with a `--border-control` outline; `.btn-primary` is white with black ink, no glow. `.chip` is a hairline pill; `.chip.on` is `--selected` with a white outline. `.seg` is a pill with a white selected segment. `.field` inputs are `--bg` with a `--border-control` outline, Space Grotesk 15px (mono only for `type=number`). `.term` has a dotted faint underline and a `--surface` popover. Focus is a white ring + dark halo. Selection is white .22. Stars are static and dimmed (`.starfield` opacity .55, no twinkle/drift).

Also changed: `layout.css` (top bar flat `--bg` + hairline, no blur; brand sentence case, no tagline; Main/Explore switch selected = `--selected`; `.globe` has no card frame/gradient/glow; `.globe-scan` hidden; HUD/tooltip monochrome; `.tabs` are an underline row), `motion.css` (no twinkle/drift, no staggered reveals, glow keyframes neutralised), `extras.css` (crash screen + `.up-text`/`.down-text` monochrome).

---

## 4. Colour exceptions: rules

1. Earth colours only inside the clipped globe disc. The atmosphere rim never extends into chrome as a page glow.
2. Data colours only on the drawn data layer and the one compact legend beside it. The legend is the only HTML element allowed `--data-*`.
3. News colours only on a verified marker's outline, glyph and leader. The callout body stays `--surface` with a `--border` hairline. Unverified = `--news-unverified`, dashed, no severity.
4. Pin colours only on the saved-pin marker and its swatch in the Saved tab / Save-pin picker.
5. Trend direction and evidence strength in UI are monochrome: arrow glyph + filled marks + label. Never red/blue, never red/amber/green.

---

## 5. Logo construction

`<Logo />` (`components/shell/Logo.jsx`): 24×24 grid, `stroke="currentColor"`, round caps/joins, colour `--white` via `.td-logo`.

1. **Orbit**: elliptical arc rx 10, ry 5, centred at (12,12), rotated −25°, drawn 300° (`M -9.4 -1.71 A 10 5 0 1 1 -7.66 3.21`), open on the left where the trend enters. Stroke 1.25, opacity .9.
2. **Earth**: solid dot r 2.6 at (12,12).
3. **Trend**: one polyline `M 2.75 17.25 L 8 14 L 12 12 L 15.25 12.9 L 21.25 6.25`, stroke 1.6: rises through the dot, dips slightly, then climbs to the upper right.
4. **Wordmark**: "Trend Detective", Space Grotesk 500, 14px, tracking .02em, `--text`, 8px gap. Sentence case (no all-caps).

Sizes: 20px (phone top bar), 24px (default), 28px (sign-in). Strokes stay ≥1px at 20px. No NASA marks, seals, worm, meatball or lookalike. No glow / drop-shadow.

Accessibility: with the wordmark, the SVG is `aria-hidden` and the visible text is the name. With `wordmark={false}` the SVG gets `role="img"` + `aria-label="Trend Detective"`. With `href`/`onClick` it renders an `<a>` (logo returns to Main).

Usage: `import Logo from "./Logo.jsx"; <Logo href="#/main" onClick={goMain} />`. Shell (E) replaces `BrandMark` / `Brand` in `ui.jsx` / `TopBar.jsx` and the welcome header with it.

---

## 6. Responsive wireframe

### Desktop (≥1200px, reference 1440×900)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◎ Trend Detective                         Main | Explore                   (V) │ 56px, --bg, hairline below
├──────────────┬────────────────────────────────────────────────┬───────────────┤
│ Place        │                                                │ (empty at     │
│  Paris  ▾    │                    · ·      ·                  │  rest)        │
│ ──────────── │              .-~~~~~~~~-.                      │               │
│ Following    │            /  EARTH       \     ·              │ focus panel   │
│  Temperature │           |   60–72% of    |                   │ 420px --surface│
│ ──────────── │            \  stage height/                    │ opens for:    │
│ Snapshot     │              '-.______.-'                      │ account, news,│
│  ▲ Clear     │   ‹  ▶  May 2024 ───────●──────────  ›         │ evidence, live│
│    change ▮▮▯│        thin floating scrubber, lower third     │ weather, Why  │
│  288px rail  │   legend: Warmer ▬▬▬ Cooler   (i)              │ one close (×) │
└──────────────┴────────────────────────────────────────────────┴───────────────┘
```
Rail = three groups separated by one hairline each, no boxes. No news list. The scrubber has no box: just controls on black, or a `--surface` pill at most.

### Tablet (768–1199px)

```
┌─────────────────────────────────────────────┐
│ ◎ Trend Detective      Main | Explore    (V) │
├─────────────────────────────────────────────┤
│               EARTH (dominant)              │
│   ‹ ▶ May 2024 ─────●────── ›               │
├─────────────────────────────────────────────┤
│ Paris ▾ · Temperature ▾ · ▲ Clear change  ⌃ │  compact bottom sheet (peek), swipe/tap up to expand
└─────────────────────────────────────────────┘
Focus panel: right drawer 380px over the globe, with scrim.
```

### Phone (<768px, reference 375×812)

```
┌───────────────────────┐
│ ◎        Main|Explore (V)│ 52px; wordmark hidden, mark 20px
├───────────────────────┤
│                       │
│      EARTH (first)    │
│                       │
│ ‹ ▶ May 24 ───●──── › │ ≥44px touch targets
├───────────────────────┤
│ ─  Paris · Temp · ▲   │ bottom sheet peek (one row)
└───────────────────────┘
Focus panel: full-height bottom sheet. One news callout open at a time; it never covers its point.
```

---

## 7. Per-file to-do for other agents (grep-based, 15 Nov 2026)

Counts are matches of legacy tokens / literal colours / radius px / tiny font (<13px) / uppercase. Re-run:
`rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|gradient\(|backdrop-filter|drop-shadow|--accent|--live\b|--up\b|--down\b|--amber|--ok\b|--state-|--type-|--pin-[ab]|--glow|border-radius:\s*\d+px|font-size:\s*1[0-2](\.\d)?px|uppercase" frontend/src/styles/<file>`

### E: Shell (`shell.css`, `ui.jsx`, `TopBar.jsx`, `Onboarding.jsx`, `App.jsx` welcome)
- `--accent` ×7, `--state-warn` ×5, `--state-error` ×4, `--state-ok` ×1, `--live` ×3, `--up/--down` ×2 → V3 names (sec 2.8).
- l.117 welcome-limb `radial-gradient(... --globe-ocean-lit ... --globe-halo-rgb ...)`: delete; the welcome uses the real Globe.
- l.325 `rgba(10, 15, 28, 0.92)`: blue-black → `--surface`.
- l.89–92 `.td-scanbars` (`scanPulse`): replace with a static/fade loading mark.
- uppercase ×4, px radii ×5 → sentence case, `--radius-*`.
- `.td-badge--live` → `--text-dim` border + "Live" text.
- `Onboarding.jsx` hard-codes `#b3a1ff` (violet): remove; `--type` tints are now `--text`.
- Replace `BrandMark`/`Brand` with `Logo` (section 5). Drop "Earth system case files" tagline.
- `Starfield.jsx` (whoever owns it): star colours `rgba(190,210,255,…)` and `rgba(${accentRgb},.9)` → `--star` neutral `#d9d9d9`; fewer stars (~60), drop layer c; App.jsx passes `accentRgb`, which can go.
- Saved pins (item 10): use `PIN_COLORS` from theme.js; store `id`.

### F: Globe (`globe.css`, `Globe.jsx`, `globe/*`)
- `Globe.jsx` `PAL` fallback still has V2 blues (`#12356b #061226 #0a1a36 #1b3555`, coast `rgba(159,196,255,.6)`); App overrides via `applyGlobePalette(THEMES.mission.globe)`, but update the fallback to the `--earth-*` values (sec 2.2) and add land-dry / ice if the renderer uses them.
- `Globe.jsx` l.609 radar uses `--accent`: remove radar (prohibited motion). `IDLE_RESUME_MS 8000` → `--globe-idle-resume-delay` 1000ms.
- `globe.css`: fallbacks `#152038` ×7, `#0e1524` ×2, `#1c2a47` → drop the fallback, use `--surface` / `--selected`.
- `--live` ×11 (live glyph, `.lw*`): silver now; make it `--text`/`--text-dim` + "Live" label.
- `.gl-sw-forecast` l.75 `rgba(247,127,53,.55)` → `var(--forecast-hatch)` over the current ramp swatch, or `--data-neutral`.
- `--amber` ×5 → `--text-dim` + clock glyph for stale.
- `--news-*` ×28: OK on marker outline/glyph/leader only; check none is a callout fill or card border. `.news-card--unverified` dashed `--news-unverified` ✓.
- `.gl-marker.is-open { box-shadow: 0 0 0 2px #fff }` → `--white`; `.rail-thumb` `#fff` → `--white`.
- `.rail-skeleton` `repeating-linear-gradient` → plain `--border` line.
- tiny fonts ×7 (9–11px, e.g. `.gl-live-word 9px` uppercase) → `--fs-label`; radii px ×14 → `--radius-*`.
- `fieldLayer.js`: literal `rgba(…)` ×5 + `#ffffff`: read `--missing-fg`, `--forecast-line`, `--white` via tokens.
- Scan cells (item 6): `--cell-holds` solid, `--cell-before-only` dashed, `--cell-stroke`; not news colours.
- Saved pins: `PIN_COLORS[i].hex` fill + `.outline` ring + text label.

### G: Insight / Explore (`insight.css`, `ledger.css`, `explainer.css`, `events.css`, `ml.css`, `panels.css`, `overview.css`, `extras.css` (non-base), `lib/events.js`, `Archetypes.jsx`)
- `insight.css`: `--state-ok/warn` ×4, `--up/--down` ×4, `--accent` ×2 → `--trend-*`, `--evidence-*`; tiny fonts ×8; uppercase ×2.
- `ledger.css` (item 4): `--up/--down` ×6 → `--trend-*` with ▲ ▼ glyph legend; l.37–38 `rgba(125,255,155,.5)` green / `rgba(255,194,77,.5)` amber confidence borders → `--border` + solid/dashed style; `--ok`, `--amber` → `--text`.
- `explainer.css`: `--accent` ×6 → `--text` / `--selected`.
- `events.css`: `--amber` ×5, l.10 `rgba(255,194,77,.06)` → `--border` left rule, no fill.
- `ml.css`: pink `rgba(255,107,213,…)` ×3, neon green `#5dffb0` ×4 / `rgba(93,255,176,…)` ×2, amber band `rgba(255,194,77,.17)` → monochrome (`--text`, `--border`, forecast band = `--forecast-zone-bg` + hatch); `--pin-b` ×5 now silver.
- `panels.css` (107 lines, largest debt): `--accent` ×26, `--up/--down` ×19, `--amber` ×7, `#5dffb0` ×5, `#ffc24d` ×2, red/amber/pink `rgba()` ×12, `.verdict::before` gradients, `.boot-*` glows, `.loading-bar` scan animation, `.target.b.on` pink shadow, `.case-card:hover` lift + glow, radii px ×21, tiny fonts ×23.
- `overview.css`: `--accent` ×9, `--up/--down` ×4, `backdrop-filter` ×2, tiny fonts ×6.
- `extras.css` (beyond the base rules D changed): `.suspect.linked` neon green, `.finding`/`.spatial` accent left rules, `.gauge*` red glow, `.vital.up/down` coloured top borders, `.pulse-line` drop-shadow, radii px ×11.
- `lib/events.js`: `#ff6a5c #ffc24d #4da6ff #4dffd9 #a8c8ff #c79bff` → monochrome or, if it labels a data series, a `--data-*` token.
- `Archetypes.jsx` `CLUSTER_COLORS` (`#4dffd9 #ff6bd5 #ffc24d #a78bfa #b6ff5c #ff9f43`, neon) → reuse `PIN_COLORS` hexes (6 neutral-safe) or shapes; App.jsx world legend uses them.

### J: Charts (`charts.css`, `components/charts/*`, `lib/chart.js`)
- `charts.css` l.46–49 amber zones/threshold `rgba(255,194,77,…)` → `--forecast-zone-bg` / `--border` dashed; `--accent` ×5 → `--text`.
- `ForecastChart.jsx`, `Emergence.jsx`: `#04060d` (blue-black) → `--bg`; `#fff` → `--white`.
- `TrendChart.jsx` uses `--accent-rgb` (now white) ✓, `#fff/#ffffff` → `--white`. `DuelChart.jsx` `--pin-a/b` (white/silver): add dash to B.
- `lib/chart.js` literal `rgb(6…)` → token.
- Lines: observed = `--text` 1.5px; trend fit = `--text-dim` dashed; forecast = `--forecast-line` dashed + hatch band; no-data = `--missing-pattern`.

### Lapse (`lapse.css`, whoever owns TimeLapse)
- `--accent` ×2 → `--text`; l.13 `rgba(var(--ink-rgb),.55)` + `backdrop-filter: blur(6px)` → `--surface`, no blur.

### App.jsx (Integration / E)
- l.111 `stroke: "rgba(160,170,200,0.5)"` (blue-grey) → `--missing-fg` from `DATA_COLORS.failed`.

---

## 8. Visual regression checklist

Run at 1440×900, 1024×768 and 375×812, for first-run, sign-in, both onboarding questions, Main (empty / loading / populated / error / stale), Explore tabs, Account, focus panel, news callout.

**Colour**
- [ ] DevTools: `getComputedStyle` of every visible chrome element: backgrounds only `#050505`, `#0e0e0e`, `#161616`, `#1f1f1f`, `#ffffff`, transparent.
- [ ] No violet, pink, teal, neon green, decorative blue anywhere outside the globe disc, data legend, news markers and saved pins.
- [ ] `rg "#b3a1ff|#ff8fd6|#5dffb0|#ffc24d|255, 107, 213|93, 255, 176|backdrop-filter" frontend/src` returns nothing.
- [ ] No gradient on page, top bar, rail, panels or buttons. No grid background, scan lines or radar.
- [ ] Red/amber/green only on verified news marker outline/glyph/leader. Unverified = grey dashed, labelled.
- [ ] Trend ▲ ▼ – and evidence meters readable in grayscale (DevTools → Rendering → emulate achromatopsia).
- [ ] Data layer legend is the only HTML with data colours.

**Lines, radii, shadows**
- [ ] Every hairline is `#2a2a2a` 1px; every control outline `#6b6b6b`.
- [ ] Each component uses one radius from 2 / 6 / 10 / pill. No nested bordered boxes, no corner brackets.
- [ ] Shadow only on floating popovers/callouts (`--shadow-float`). No coloured shadow or glow.

**Type**
- [ ] Body ≥15px; no sentence below 13px; labels sentence case; mono only on values/months/coords.
- [ ] 200% browser zoom: no clipped text, no horizontal scroll at 1440 or 375.

**Focus and motion**
- [ ] Tab through every view: white 2px ring visible on black and on light data cells.
- [ ] Reduced motion (OS and Account toggle): Earth still, no transitions, stars static.
- [ ] Stars static and dim; no twinkle/drift; no staggered text reveals.

**Logo**
- [ ] Logo crisp at 20, 24 and 28px; recognisable in pure white on `#050505`; accessible name "Trend Detective"; logo returns to Main.

**Layout**
- [ ] Earth 60–72% of stage height on desktop; not inside a card; right side empty at rest.
- [ ] Rail is three groups with hairlines only; no news list on Main.
- [ ] Main at 1440×900 has fewer than 60 prose words.
- [ ] Tablet/phone: rail is a bottom sheet, not a stack under the globe; scrubber attached to the globe, ≥44px targets.
