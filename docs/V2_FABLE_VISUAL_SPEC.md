# Trend Detective V2 — Visual Specification (Agent 1, visual director)

Status: design specification only. No production code was changed to write it.
Audience: Agents 2, 3, 4 (implementation) and Agent 5 (integration).
Sources read: `Planning and prompts/frontend_plan_final.txt`, `README.md`, `docs/REQUIREMENTS.md`, `docs/V2_API_CONTRACT.md`,
`frontend/src/App.jsx`, `frontend/src/components/*`, `frontend/src/styles/*`, `frontend/src/lib/theme.js`, `frontend/src/lib/profile.js`.

How to use this document

- Token names, class names and the fixed strings in section 0 are the shared contract between agents. Do not rename them without
  telling the integration lead.
- Where this spec and `docs/V2_API_CONTRACT.md` disagree about data, the contract wins. Where a field this spec needs does not
  exist in the contract, it is listed under "Open design questions" (section 9) and a safe default is given.
- Everything numeric shown to the user comes from the backend. Nothing in this spec asks the browser to compute a statistic.
  Colour-class lookup, formatting and layout are the only client-side arithmetic.

Contents

0. Fixed strings (exact copy)
1. Page structure and responsive wireframes
2. Design tokens (ready-to-paste CSS) and contrast table
3. Globe data-layer styles
4. Motion storyboard and reduced-motion behaviour
5. Component inventory and states
6. Asset rules
7. Mapping table: spec element → file/component and owner
8. Accessibility checklist for implementers
9. Open design questions for the owner

---

## 0. Fixed strings (exact copy, do not paraphrase)

| ID | Where | Text |
| --- | --- | --- |
| S1 | Sign-in page, under the form | `Demo account — your password is not saved or sent.` |
| S2 | Account panel, top notice | `Stored on this device for this demo. This is not a secure online account.` |
| S3 | Why panel, always visible | `These are possible explanations, not proof that one cause created this local trend.` |
| S4 | Every news card and the news panel | `news context, not scientific evidence` (render the item's own `label` field; this is its value) |
| S5 | News item with `publisher_verified: false` | `Unverified news context` |
| S6 | Observed frame badge | the frame's own `badge` field, currently `Observed (NASA POWER)` |
| S7 | Forecast frame badge | the frame's own `badge` field, currently `Forecast — not observed data` |
| S8 | Live weather card and globe glyph | the response's own `label` field, currently `Meteomatics weather forecast — not NASA trend data` |
| S9 | Local grid caption | the response's own `grid.resolution_note` (full text in the caption drawer); short form on the rail: `Coarse local grid, not a global satellite image` |
| S10 | World mode legend | `Sample sites, not a complete global map` |
| S11 | Verdict labels | the four `evidence_trace.verdict.label` values from the backend, unedited |
| S12 | Evidence drawer header note | `Every number here was calculated on the server. This page only displays it.` |
| S13 | News severity legend | `Border colour is an editorial attention label from keywords in the headline. It is not an official warning.` |
| S14 | Footer / About | `Independent project, not endorsed by NASA.` (existing text, keep) |

Prefer the backend's own `label`, `badge`, `reason`, `source_note`, `disclaimer`, `context_note`, `empty_reason` strings over
hard-coded copies wherever the contract supplies them. The table gives the fallback text and the wording to test against.

---

## 1. Page structure

### 1.1 Flow

```
first visit ──► SIGN-IN ──► ONBOARDING 1/2 ──► ONBOARDING 2/2 ──► MAIN (dashboard + globe + timeline)
                               (places)          (data types)        │  ▲
                                   └──── "Skip for now" ─────────────┘  │  one click, history-aware
returning visit (td-profile-v2 valid, onboarding done or skipped) ──► MAIN ◄──► EXPLORE
Account ▸ Reset ──► profile removed ──► SIGN-IN
```

- The dashboard is never rendered behind the sign-in or onboarding screens (not blurred, not dimmed: absent).
- The existing `Boot.jsx` splash is retired from the first-run path. The sign-in page is the opening screen.
- Page identity lives in the URL so back/forward work: push a history entry on a page change (Main ↔ Explore, Explore tool
  change), replace it on parameter changes (place, variable, month). The existing share hash (`lib/share.js`) keeps working.

### 1.2 Breakpoints

| Name | Width | Layout |
| --- | --- | --- |
| `desktop-wide` | ≥ 1440px | dashboard 380px, globe fills the rest |
| `desktop` | 1200–1439px | dashboard 340px, globe fills the rest |
| `tablet` | 768–1199px | globe full width, dashboard is a left drawer, summary strip always visible |
| `mobile` | < 768px | globe, then timeline, then dashboard as stacked cards in normal page scroll |

CSS: `@media (min-width: 1200px)`, `@media (min-width: 768px) and (max-width: 1199.98px)`, `@media (max-width: 767.98px)`.
Use `100dvh` (with a `100vh` fallback) for full-height layouts. Touch targets are at least 44×44px when `(pointer: coarse)`,
at least 32×32px otherwise.

### 1.3 Sign-in page

Centred card on the plain space background. Behind it: the existing procedural starfield and a static, decorative arc of the
globe's limb (a CSS radial gradient, bottom of the viewport, 12% opacity). No rotating globe here; nothing that looks like data.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                         (◎) TREND DETECTIVE                                  │
│                   Earth system case files                                    │
│                                                                              │
│                 ┌────────────────────────────────────┐                       │
│                 │ Sign in                            │  card: 400px wide     │
│                 │                                    │  padding 32px         │
│                 │ EMAIL                              │  radius --radius-lg   │
│                 │ [ you@example.com                ] │  inputs 44px tall     │
│                 │ PASSWORD                           │                       │
│                 │ [ ••••••••                 (show)] │                       │
│                 │                                    │                       │
│                 │ [            Sign in             ] │  primary, full width  │
│                 │                                    │                       │
│                 │ ⓘ Demo account — your password is  │  S1, --text-dim, 13px │
│                 │   not saved or sent.               │  never hidden         │
│                 └────────────────────────────────────┘                       │
│        Independent project, not endorsed by NASA.  ·  About                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Mobile: card becomes full width minus 16px gutters, padding 24px, vertically top-aligned at 12dvh.
- Labels are real `<label>` elements above the fields (mono, 12px, uppercase). No placeholder-only labelling.
- Errors: inline under the field, `--state-error` text plus a leading `✕` glyph, `aria-describedby` on the input, focus moves to
  the first invalid field. Copy: `Enter a valid email address.` / `Enter a password.`
- There is no "forgot password", "create account" or social sign-in control: they would imply a real account system.
- Password input: `autocomplete="off"`, never mirrored into any other element. (Agent 2: discard after validation.)
- On success the card content cross-fades to onboarding step 1 inside the same frame (see 4.7); no full-page reload.

### 1.4 Onboarding (exactly two questions)

Same centred frame, widened to 720px on desktop/tablet (full width on mobile). Progress shown as `Question 1 of 2` plus two
segment bars. `Continue` is disabled until the question has at least one answer; `Skip for now` is a visible text button on every
step and leads to Main with defaults. `Back` appears on step 2.

```
Step 1 — Preferred locations                              Step 2 — Data types I care about
┌───────────────────────────────────────────────────┐    ┌───────────────────────────────────────────────────┐
│ QUESTION 1 OF 2   ▰▰▰▰▰▱▱▱▱▱                       │    │ QUESTION 2 OF 2   ▰▰▰▰▰▰▰▰▰▰                       │
│ Which places matter to you?                       │    │ Which kinds of data do you care about?            │
│ Choose up to five. You can change them later.     │    │ Pick any. These decide what your dashboard loads. │
│                                                   │    │                                                   │
│ [🔍 Search a city or place…                    ]  │    │ ┌───────────┐ ┌───────────┐ ┌───────────┐         │
│  ┌ suggestions list (max 6 rows, 44px each) ┐     │    │ │ ◍ Heat    │ │ ◍ Rain &  │ │ ◍ Clouds &│         │
│  │ Phoenix, USA                    33.4 -112.1│   │    │ │           │ │   water   │ │  sunlight │         │
│  └────────────────────────────────────────────┘   │    │ └───────────┘ └───────────┘ └───────────┘         │
│                                                   │    │ ┌───────────┐ ┌───────────┐ ┌───────────┐         │
│ Or pin on the map:  [ Open the pin map ]          │    │ │ ◍ Land &  │ │ ◍ Wind &  │ │ ◍ Ice &   │         │
│                                                   │    │ │   plants  │ │ atmosphere│ │   oceans  │         │
│ YOUR PLACES  2 of 5                               │    │ └───────────┘ └───────────┘ └───────────┘         │
│ (Phoenix ✕) (Delhi ✕)                             │    │  tile: min 148×96px, aria-pressed toggle          │
│                                                   │    │                                                   │
│ Skip for now                        [ Continue ]  │    │ Back    Skip for now                  [ Finish ]  │
└───────────────────────────────────────────────────┘    └───────────────────────────────────────────────────┘
```

- "Open the pin map" expands a 320px-tall instance of the existing globe inside the card (no data layers, idle rotation off).
  Clicking drops a pin and adds a chip named by nearest known place or by coordinates. Keyboard: existing arrow/Enter controls.
- At five places the search and map stop adding and the counter reads `5 of 5 — remove one to add another`.
- Data-type tiles: inline SVG icon tinted with the type token (section 2, `--type-*`), label, and a check mark in the corner when
  selected (selection is never colour-only). Tile labels, exactly: `Heat`, `Rain & water`, `Clouds & sunlight`, `Land & plants`,
  `Wind & atmosphere`, `Ice & oceans`.
- Mobile: tiles in two columns; the action row is sticky at the bottom of the viewport.

### 1.5 Top bar (all signed-in pages)

Height 56px desktop/tablet, 52px mobile. Background `--surface-0` at 80% with 12px backdrop blur, 1px bottom border `--line`.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ (◎) TREND DETECTIVE                              [ Main | Explore ]        ( V ) Account ▾   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
  brand: existing magnifier mark,                   2-item segmented nav       32px initial disc
  wordmark 16px/700, letter-spacing .14em           (role="navigation",        + "Account" label
  tagline hidden below 1200px                       aria-current="page")       (label hidden < 768px)
```

- Only three things live here: brand, the Main/Explore switch, the Account button. Case files, Glossary, Explain, About and the
  theme switch move out (Case files / Glossary / Explain / learning resources → Explore; About and theme → Account panel footer).
- Mobile: the Main/Explore switch stays in the bar (two 44px segments); the wordmark shortens to the mark plus `TD`.
- The version-mismatch warning that lives in today's footer moves to a full-width `--state-warn` strip directly under the top bar.

### 1.6 Main dashboard — desktop (≥ 1200px)

No page scroll. The dashboard column scrolls internally; the globe and timeline never scroll away.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR                                                                              56px    │
├────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ DASHBOARD  340/380px   │  GLOBE STAGE  (1fr × 1fr)                                           │
│ padding 16, gap 12     │  ┌ locator+readout ┐                       ┌ Globe|Map  − + ◎ ┐     │
│ ┌────────────────────┐ │  └─────────────────┘                       └──────────────────┘     │
│ │ PLACE SWITCHER     │ │                                                                     │
│ │ (Phoenix)(Delhi)(+)│ │                    .  ·  ˙  ·  .                                    │
│ ├────────────────────┤ │                 ·                 ·        ┌ news card (closed) ┐   │
│ │ DATA PICKER        │ │               ·     ▓▓▒▒░░          ·      │▌Headline…          │   │
│ │ (Heat)(Rain)(Cloud)│ │              ·      ▓▒▒░░▨   ◈       ·     │ BBC News · 14 Nov  │   │
│ │ [Air temperature ▾]│ │               ·     ▒▒░░░░          ·      └────────────────────┘   │
│ ├────────────────────┤ │                 ·                 ·                                 │
│ │ VERDICT CARD       │ │                    ˙  ·  .  ·  ˙                                    │
│ │ ▮▮▮ Strong evidence│ │  ┌ legend (ramp, missing, forecast, markers) ┐                      │
│ │ ▲ +0.60 °C/decade  │ │  └────────────────────────────────────────────┘   drag · rotate …   │
│ │ [How did we test?] │ ├─────────────────────────────────────────────────────────────────────┤
│ │ [Why might this…?] │ │  TIMELINE RAIL  132px                                               │
│ ├────────────────────┤ │  [▶] [⏮][⏭]  0.5× 1× 2× 4×     MAR 2024   ▣ Observed (NASA POWER)   │
│ │ LIVE WEATHER CARD  │ │  ┃▁▂▃▂▁▂▄▅▃▂▁▂▃▄▅▆▄▃▂▃▄▅▆▅▃▂▃▅▆▇▅▄●▃▄┃▨▨▨┃   range: 3y 5y 10y      │
│ ├────────────────────┤ │   2022        2023        2024       ┆ forecast                     │
│ │ FORECAST STATUS    │ │  NASA POWER · °C · Coarse local grid, not a global satellite image  │
│ ├────────────────────┤ └─────────────────────────────────────────────────────────────────────┤
│ │ NEWS CONTEXT list  │
│ ├────────────────────┤   grid: columns [var(--dash-w)] [1fr]; rows [1fr] [var(--rail-h)]
│ │ Sources · Explore ▸│   height: calc(100dvh - 56px); globe stage min-height 420px
└─┴────────────────────┘
```

Dashboard card order (top to bottom) and what each loads:

1. Place switcher — saved places as a radio group of chips (max five), plus `+` (opens Account ▸ places). Loads nothing.
2. Data picker — only the user's chosen data types as chips, then a variable select filtered to that type. Loads nothing until
   a place is active.
3. Verdict card — `GET /api/trend` for the active place and variable only.
4. Live weather card — `GET /api/live-weather` for the active place only, and only when the card is expanded or its
   "Show on globe" toggle is on. Collapsed by default.
5. Forecast status — `GET /api/monthly-forecast` only when the user presses `Check forecast`; never automatic.
6. News context — `GET /api/news` when this section first scrolls into view or is expanded (lazy), for saved places only.
7. Footer row — `Sources & credits`, `Open Explore ▸`.

Other saved places are not fetched in the background. Their chips show the name only.

### 1.7 Main dashboard — tablet (768–1199px)

```
┌────────────────────────────────────────────────────────────────┐
│ TOP BAR                                                 56px   │
├────────────────────────────────────────────────────────────────┤
│ [☰ Dashboard]  Phoenix · Air temperature · ▮▮▮ Strong evidence │  summary strip 48px, always visible
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                 GLOBE STAGE (full width)                       │  height: calc(100dvh - 56 - 48 - 132px)
│                                                                │  min-height 360px
├────────────────────────────────────────────────────────────────┤
│ TIMELINE RAIL                                          132px   │
└────────────────────────────────────────────────────────────────┘

Drawer open:
┌──────────────────────┬─────────────────────────────────────────┐
│ DASHBOARD DRAWER     │▒▒▒▒▒▒▒▒▒▒▒▒ scrim (rgba(3,5,10,.56)) ▒▒▒│  drawer 360px, slides from the left
│ (same cards as       │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  role="dialog" aria-modal="true"
│  desktop) [✕ Close]  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  Esc / scrim click closes, focus returns
└──────────────────────┴─────────────────────────────────────────┘
```

The summary strip is a button (whole strip opens the drawer) showing place, variable and the verdict label with its meter.

### 1.8 Main dashboard — mobile (< 768px)

Normal vertical page scroll. No detent bottom sheet for the dashboard itself; detail views (news, evidence, why, account) open
as full-height sheets.

```
┌──────────────────────────┐
│ (◎) TD   [Main|Explore] V│ 52px
├──────────────────────────┤
│ Phoenix ▾ · Air temp ▾   │ sticky place bar 44px
├──────────────────────────┤
│                          │
│       GLOBE STAGE        │ width 100%, height min(100vw, 52dvh), min 300px
│   controls: 44px, top-   │ canvas keeps touch-action: none, so at least 120px of
│   right; legend collapses│ non-canvas page must be visible in the first viewport
│   to a [Key] button      │ for scrolling
├──────────────────────────┤
│ [▶]  MAR 2024  ▣ Observed│ timeline rail, 2 rows, 116px
│ ┃▁▂▃▅▃▂▁▃▅▆●▃┃▨▨┃  1× ▾  │ speed becomes a select; step buttons 44px
│ NASA POWER · °C · Coarse…│
├──────────────────────────┤
│ VERDICT CARD             │ stacked cards, 16px gutters, 12px gap
├──────────────────────────┤
│ LIVE WEATHER CARD        │
├──────────────────────────┤
│ FORECAST STATUS          │
├──────────────────────────┤
│ NEWS CONTEXT (cards)     │
├──────────────────────────┤
│ Sources · Open Explore ▸ │
└──────────────────────────┘
```

- The place bar's two controls open native-feeling pickers (a sheet with the place radio group / the data-type and variable list).
- No control is smaller than 44×44px. No hover-only information: every globe tooltip is also reachable by tap and listed in text.

### 1.9 Explore page

The existing two-column tool layout (`.stage` in `layout.css`) becomes the Explore page almost unchanged: it already works.

```
Desktop                                                          Mobile
┌────────────────────────────────────────────────────────────┐   ┌──────────────────────────┐
│ TOP BAR                                                    │   │ TOP BAR                  │
├────────────────────────────────────────────────────────────┤   ├──────────────────────────┤
│ EXPLORE   Advanced tools for digging deeper                │   │ EXPLORE                  │
│ [Sweep][Scan][Duel][World][Vitals][Ledger][Events]│[Detail]│   │ ◂ [Sweep][Scan][Duel] ▸  │ tabs scroll
│ [Learn]                               role="tablist"       │   ├──────────────────────────┤ horizontally
├──────────────────────────────┬─────────────────────────────┤   │ GLOBE (collapsible,      │
│ GLOBE (sticky, 44%)          │ SETUP PANEL (existing)      │   │  300px, [Hide map])      │
│ World mode: sample-site dots │ TOOL PANEL (existing        │   ├──────────────────────────┤
│ + "Sample sites, not a       │  Sweep/Scan/Duel/World/     │   │ SETUP PANEL              │
│   complete global map"       │  Vitals/Ledger/Events,      │   │ TOOL PANEL               │
│                              │  Detail = statistical       │   │                          │
│                              │  detail of the case file,   │   │                          │
│                              │  Learn = glossary, explainer│   │                          │
│                              │  case files, about)         │   │                          │
└──────────────────────────────┴─────────────────────────────┘   └──────────────────────────┘
```

- Reached in one click from the top bar switch (and from the dashboard footer link). Selected place and variable carry over in
  both directions.
- Tabs: `Sweep`, `Scan`, `Duel`, `World`, `Vitals`, `Ledger`, `Events`, then a divider, `Detail` (the current case-file Detail
  view: collapsible statistical sections) and `Learn` (Glossary, Explainer, guided case files, About/credits).
- Tab strip: one row, `role="tablist"`, arrow keys move, each tab change pushes a history entry. On widths where the row does not
  fit it scrolls horizontally with fade masks at the edges; it never wraps to a crowded second row.
- World tab keeps the existing sample-site time-lapse (`TimeLapse.jsx`) and gains string S10 in the legend.

---

## 2. Design tokens

### 2.1 Principles

- One dark theme, "mission". Data colours do not change with any UI theme. If the old `nebula`/`classic` themes are kept as an
  optional preference they may only override the UI block (backgrounds, text, accent), never the data block.
- Existing token names (`--bg-0`, `--panel`, `--line`, `--text`, `--accent`, `--up`, `--down`, `--flat`, `--amber`, `--ok`,
  `--font-*`, `--radius`, `--ease`) are kept and re-pointed so the ~1,700 lines of existing CSS keep working.
- The UI accent is violet. It is deliberately not a data colour (data uses amber/red, cyan/blue, teal, ochre, slate; news uses
  green/amber/red; live weather uses pink). Never use `--accent` to encode a value.
- Canvas code must not hard-code hex values. Read tokens once per mount/theme change:
  `getComputedStyle(document.documentElement).getPropertyValue("--data-warm-3").trim()` and cache them in a plain object
  (suggested helper: `lib/tokens.js`, owned by Agent 3; `lib/theme.js` keeps a static fallback for tests with no DOM).

### 2.2 Ready-to-paste block

```css
/* Trend Detective V2 "mission" tokens. Paste at the top of styles/theme.css (replacing the old :root block)
   or into a new styles/tokens.css imported first in main.jsx. */
:root {
  color-scheme: dark;

  /* ---- Background and surfaces ---- */
  --bg-0: #05070d;            /* page, near-black */
  --bg-1: #0a0f1c;            /* raised page areas, rail background */
  --bg-2: #111a2e;            /* wells, inputs on hover */
  --surface-0: #0a0f1c;
  --surface-1: #0e1524;       /* cards */
  --surface-2: #152038;       /* raised cards, popovers, drawers */
  --surface-3: #1c2a47;       /* selected rows, pressed states */
  --scrim: rgba(3, 5, 10, 0.56);
  --panel: rgba(14, 21, 36, 0.82);          /* legacy name: translucent card */
  --panel-solid: #0e1524;                   /* legacy name */
  --panel-raised: rgba(21, 32, 56, 0.86);   /* legacy name */
  --ink-rgb: 5, 7, 13;                      /* legacy name */

  /* ---- Text ---- */
  --text: #e8eefc;            /* 15.7:1 on surface-1 */
  --text-dim: #aab6d3;        /*  9.0:1 on surface-1 */
  --text-faint: #8c99ba;      /*  6.4:1 on surface-1, 5.0:1 on surface-3: smallest text allowed is 12px */
  --text-on-accent: #120a2e;  /*  8.5:1 on --accent */
  --text-on-data: #05070d;    /* dark ink for labels printed on a data colour, >= 4.9:1 on every ramp step */

  /* ---- Lines and borders ---- */
  --line-rgb: 125, 160, 230;
  --line: rgba(var(--line-rgb), 0.16);          /* decorative separators only (1.3:1) */
  --line-strong: rgba(var(--line-rgb), 0.36);   /* card outlines (2.0:1): never the only cue for a control */
  --line-control: #6c80ad;                      /* input/button/toggle boundaries: >= 3.6:1 on surfaces 0-3 */

  /* ---- Accent (interface only, never data) ---- */
  --accent-rgb: 179, 161, 255;
  --accent: #b3a1ff;          /* 8.2:1 on surface-1 */
  --accent-dim: rgba(var(--accent-rgb), 0.16);
  --accent-ink: #120a2e;      /* legacy name, same as --text-on-accent */
  --glow-rgb: 120, 150, 255;

  /* ---- Focus ---- */
  --focus-ring: #ffffff;                        /* 14.3:1 or better on every surface */
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  --focus-halo: 0 0 0 5px rgba(var(--accent-rgb), 0.45);   /* outer halo so the ring also shows on light data cells */

  /* ---- Globe base (decorative, procedural) ---- */
  --globe-ocean-lit: #12356b;
  --globe-ocean-dark: #061226;
  --globe-flat-ocean: #0a1a36;
  --globe-land: #1b3555;
  --globe-coast: rgba(159, 196, 255, 0.60);
  --globe-border: rgba(159, 196, 255, 0.16);
  --globe-graticule: rgba(125, 160, 230, 0.10);
  --globe-halo-rgb: 110, 160, 255;              /* atmosphere halo, max alpha 0.28 */
  --globe-limb: rgba(150, 200, 255, 0.40);

  /* ---- Data: thermal diverging ramp (above / below the cell's own monthly normal) ---- */
  --data-warm-1: #f7dc8f;     /* slightly above */
  --data-warm-2: #f9b54a;
  --data-warm-3: #f77f35;
  --data-warm-4: #ff5340;     /* far above */
  --data-cool-1: #a6e3f2;     /* slightly below */
  --data-cool-2: #5cc0f5;
  --data-cool-3: #5a9dff;
  --data-cool-4: #5683ff;     /* far below */
  --data-neutral: #9aa4b8;    /* near normal */

  /* ---- Data: water diverging ramp (wetter / drier than normal) ---- */
  --data-wet-1: #a5ecd9;
  --data-wet-2: #4fd1b5;
  --data-wet-3: #25b3a3;
  --data-wet-4: #1a9c93;
  --data-dry-1: #ead9b0;
  --data-dry-2: #d1ac6b;
  --data-dry-3: #bd8a47;
  --data-dry-4: #a8733a;

  /* ---- Data: cloud ramp (more cloud than normal; "less cloud" uses --data-cool-*) ---- */
  --data-cloud-1: #aab4c8;
  --data-cloud-2: #c5cddc;
  --data-cloud-3: #dfe5ef;
  --data-cloud-4: #ffffff;

  /* ---- Data: single-colour identities (chips, sparklines, icons) ---- */
  --data-water: #38bdf8;
  --data-cloud: #d5dceb;
  --up: #ff7a5c;              /* legacy: rising trend, always with a ▲ */
  --up-dim: rgba(255, 122, 92, 0.16);
  --down: #5ab4ff;            /* legacy: falling trend, always with a ▼ */
  --down-dim: rgba(90, 180, 255, 0.16);
  --flat: #9aa4b8;            /* legacy: no clear trend */

  /* ---- Data-type tints (onboarding tiles, picker chips: icon and 2px underline only) ---- */
  --type-heat: #f77f35;
  --type-water: #4fd1b5;
  --type-cloud: #c5cddc;
  --type-land: #d1ac6b;
  --type-wind: #9aa4b8;
  --type-ice: #a6e3f2;

  /* ---- Missing data: neutral pattern, never a data colour ---- */
  --missing-fg: #8c97b0;                        /* cross-hatch strokes and dotted outline */
  --missing-bg: rgba(140, 151, 176, 0.10);
  --missing-pattern: repeating-linear-gradient(45deg, rgba(140, 151, 176, 0.55) 0 1px, transparent 1px 6px),
                     repeating-linear-gradient(-45deg, rgba(140, 151, 176, 0.55) 0 1px, transparent 1px 6px);

  /* ---- Forecast: hatch + dashed outline + label, on top of the data colour ---- */
  --forecast-line: #e9e4ff;                     /* dashed outline and divider */
  --forecast-dash: 6 4;                         /* canvas setLineDash([6, 4]); SVG stroke-dasharray */
  --forecast-fill-alpha: 0.55;                  /* data colour is drawn at this alpha under the hatch */
  --forecast-hatch: repeating-linear-gradient(45deg, rgba(233, 228, 255, 0.70) 0 1.5px, transparent 1.5px 8px);
  --forecast-zone-bg: rgba(233, 228, 255, 0.06);

  /* ---- Live weather (Meteomatics): its own identity, never on the trend ramps ---- */
  --live: #ff8fd6;            /* 8.8:1 on surface-1 */
  --live-dim: rgba(255, 143, 214, 0.16);

  /* ---- News attention labels: border and glyph only, never a fill ---- */
  --news-green: #3ddc97;      /* glyph: circle */
  --news-amber: #ffb938;      /* glyph: triangle */
  --news-red: #ff5a52;        /* glyph: diamond */
  --news-unverified: #8c99ba; /* dashed neutral border */
  --news-border-width: 2px;

  /* ---- Interface states ---- */
  --state-ok: #3ddc97;
  --state-warn: #ffb938;
  --state-error: #ff6b63;
  --state-info: #aab6d3;
  --state-stale: #ffb938;     /* always with a clock glyph and the age in text */
  --ok: var(--state-ok);      /* legacy */
  --amber: var(--state-warn); /* legacy */

  /* ---- Evidence verdict (one hue; the tier is carried by the meter count, border style and label) ---- */
  --verdict-strong: #b3a1ff;
  --verdict-some: #b3a1ff;
  --verdict-none: #9aa4b8;
  --verdict-insufficient: #8c99ba;

  /* ---- Typography ---- */
  --font-display: "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Consolas, monospace;
  --fs-11: 0.6875rem;   /* uppercase mono eyebrows only, letter-spacing .12em */
  --fs-12: 0.75rem;     /* captions, badges: the minimum for sentence text */
  --fs-13: 0.8125rem;   /* secondary text, chips, buttons-sm */
  --fs-15: 0.9375rem;   /* body (root stays 15px equivalent) */
  --fs-17: 1.0625rem;   /* card titles */
  --fs-20: 1.25rem;     /* section titles, verdict label on mobile */
  --fs-24: 1.5rem;      /* verdict label, sign-in title */
  --fs-32: 2rem;        /* timeline month readout, live temperature */
  --fs-44: 2.75rem;     /* onboarding question on desktop */
  --lh-tight: 1.15;
  --lh-snug: 1.35;
  --lh-body: 1.55;
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-bold: 700;
  --tracking-eyebrow: 0.12em;
  --tracking-brand: 0.14em;

  /* ---- Spacing (4px base) ---- */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* ---- Layout ---- */
  --topbar-h: 56px;
  --dash-w: 340px;
  --rail-h: 132px;
  --drawer-w: 480px;
  --hit-min: 32px;

  /* ---- Radii ---- */
  --radius-xs: 4px;     /* heat-map legend swatches, badges */
  --radius-sm: 8px;     /* buttons-sm, inputs */
  --radius-md: 10px;    /* buttons, chips' inner controls */
  --radius: 14px;       /* cards (legacy name) */
  --radius-lg: 20px;    /* globe stage, sign-in card, sheets */
  --radius-pill: 999px;

  /* ---- Shadows and glows ---- */
  --shadow-1: 0 2px 8px rgba(0, 0, 0, 0.40);
  --shadow-2: 0 12px 32px rgba(0, 0, 0, 0.50);
  --shadow-3: 0 24px 64px rgba(0, 0, 0, 0.60);
  --glow-accent: 0 0 26px rgba(var(--accent-rgb), 0.30);
  --glow-globe: 0 0 60px rgba(var(--globe-halo-rgb), 0.08);
  --glow-live: 0 0 18px rgba(255, 143, 214, 0.35);

  /* ---- Z-index layers ---- */
  --z-starfield: 0;
  --z-content: 1;
  --z-globe-hud: 3;       /* legend, zoom controls, readout */
  --z-globe-tip: 5;       /* tooltips, closed news card */
  --z-rail: 10;
  --z-topbar: 20;
  --z-popover: 30;        /* term tooltips, account popover */
  --z-drawer: 40;         /* dashboard drawer, evidence drawer, sheets (with scrim) */
  --z-modal: 50;
  --z-toast: 60;

  /* ---- Motion (see section 4) ---- */
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);           /* legacy: standard decelerate */
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-linear: linear;
  --dur-instant: 80ms;
  --dur-fast: 160ms;
  --dur-base: 240ms;
  --dur-slow: 360ms;
  --dur-page: 320ms;
  --dur-fly: 1400ms;
  --dur-cell-reveal: 450ms;
  --dur-cell-stagger: 650ms;
  --dur-scan-sweep: 2200ms;
  --dur-frame-fade-max: 360ms;
  --frame-dwell-05x: 1200ms;
  --frame-dwell-1x: 600ms;
  --frame-dwell-2x: 300ms;
  --frame-dwell-4x: 150ms;
  --globe-idle-deg-per-s: 2;        /* one revolution in 180 s */
  --globe-idle-resume-delay: 8000ms;
  --globe-idle-ramp: 1200ms;
}

@media (min-width: 1440px) { :root { --dash-w: 380px; } }
@media (max-width: 1199.98px) { :root { --drawer-w: 420px; } }
@media (max-width: 767.98px) { :root { --topbar-h: 52px; --rail-h: 116px; } }
@media (pointer: coarse) { :root { --hit-min: 44px; } }

:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
  box-shadow: var(--focus-halo);
}
```

JavaScript fallback palette for `lib/theme.js` (same values as the CSS; used when there is no DOM):

```js
mission: {
  label: "Mission",
  colors: { a: "#b3a1ff", b: "#ff8fd6" },
  accentRgb: "179,161,255",
  globe: {
    atmosphere: "110,160,255", oceanA: "#12356b", oceanB: "#061226", flatOcean: "#0a1a36", land: "#1b3555",
    coast: "rgba(159, 196, 255, 0.60)", border: "rgba(159, 196, 255, 0.16)", grid: "rgba(125, 160, 230, 0.10)",
  },
}
```

### 2.3 Contrast table (WCAG 2.x relative-luminance ratios, calculated for this spec)

Text and interface (AA needs 4.5:1 for text, 3:1 for large text and for interface boundaries/graphics):

| Foreground | on `--bg-0` | on `--surface-1` | on `--surface-2` | on `--surface-3` | Result |
| --- | --- | --- | --- | --- | --- |
| `--text` #e8eefc | 17.3 | 15.7 | 13.9 | 12.3 | AAA |
| `--text-dim` #aab6d3 | 9.9 | 9.0 | 8.0 | 7.0 | AAA |
| `--text-faint` #8c99ba | 7.1 | 6.4 | 5.7 | 5.0 | AA |
| `--accent` #b3a1ff | 9.1 | 8.2 | 7.3 | 6.4 | AA |
| `--line-control` #6c80ad | 5.1 | 4.6 | 4.1 | 3.6 | AA (non-text 3:1) |
| `--focus-ring` #ffffff | 20.1 | 18.2 | 16.2 | 14.3 | AA |
| `--live` #ff8fd6 | 9.7 | 8.8 | 7.8 | 6.9 | AA |
| `--news-green` #3ddc97 | 11.4 | 10.3 | 9.2 | 8.1 | AA |
| `--news-amber` #ffb938 | 11.8 | 10.6 | 9.5 | 8.3 | AA |
| `--news-red` #ff5a52 | 6.6 | 5.9 | 5.3 | 4.7 | AA |
| `--state-error` #ff6b63 | 7.2 | 6.5 | 5.8 | 5.1 | AA |
| `--up` #ff7a5c | 7.9 | 7.1 | 6.3 | 5.6 | AA |
| `--down` #5ab4ff | 9.0 | 8.2 | 7.3 | 6.4 | AA |
| `--missing-fg` #8c97b0 | 6.9 | 6.2 | 5.5 | 4.9 | AA |
| `--text-on-accent` on `--accent` | 8.5 | | | | AA |

`--line` (1.3:1) and `--line-strong` (2.0:1) are below 3:1 on purpose: they are decorative. Any control whose boundary is needed
to recognise it (inputs, toggles, the timeline track, unselected chips) uses `--line-control`.

Data colours on the globe (graphics need 3:1 against what they sit on):

| Step | on lit ocean #12356b | on land #1b3555 | on dark ocean #061226 |
| --- | --- | --- | --- |
| `--data-warm-1 … 4` | 8.2 / 6.2 / 4.6 / 3.8 | 8.6 / 6.5 / 4.8 / 3.9 | all ≥ 5.8 |
| `--data-cool-1 … 4` | 7.8 / 5.4 / 4.4 / 3.5 | 8.2 / 5.7 / 4.6 / 3.6 | all ≥ 5.4 |
| `--data-wet-1 … 4` | 8.2 / 5.8 / 4.6 / 3.6 | 8.6 / 6.1 / 4.8 / 3.7 | all ≥ 5.5 |
| `--data-dry-1 … 4` | 7.9 / 5.2 / 3.9 / **2.96** | 8.3 / 5.4 / 4.1 / 3.1 | all ≥ 4.6 |
| `--data-cloud-1 … 4` | 5.3 / 6.9 / 8.7 / 11.0 | 5.6 / 7.3 / 9.2 / 11.6 | all ≥ 8 |
| `--data-neutral` | 4.4 | 4.6 | above 6 |
| cell outline (white at 60%) | 5.4 | 5.5 | 8.3 |

`--data-dry-4` on the brightest part of the ocean is 2.96:1, just under 3:1. This is covered by the mandatory cell outline
(5.4:1), which every valid cell carries (section 3.2). Do not remove the outline.

The numbers above are for opaque colours. Cells are drawn at the alphas in 3.2; the outline, sign glyph and the text readout are
what guarantee legibility, not the fill alone.

### 2.4 Colour-blind and non-colour rules

- Both diverging pairs are built on an orange↔blue or ochre↔teal axis, not red↔green, so the two directions stay apart for the
  common red-green deficiencies. This is by construction; it was not run through a simulator. Agent 5: verify with a
  deuteranopia/protanopia/tritanopia simulator before release.
- Inside every ramp, lightness falls steadily from step 1 to step 4 on both sides, so lightness alone cannot tell "above" from
  "below". Therefore direction is always doubled: `+`/`−` glyph in each cell (when the cell is ≥ 36px), `▲`/`▼` in every readout,
  signed numbers in text, and a legend with words (`Above its normal` / `Below its normal`).
- News: green/amber/red always travel with a shape (circle / triangle / diamond) and the backend's `severity_label` text.
- Verdict: one hue; the tier is the number of filled meter bars (3/2/1/0), the border style and the label text.
- Forecast vs missing vs observed are distinguished by pattern, not hue: observed = flat fill + solid outline; forecast =
  one-direction diagonal hatch over the colour + dashed outline; missing = neutral two-direction cross-hatch, no colour, dotted
  outline, `×` glyph.
- Stale is never colour-only: clock glyph plus the age in words.

### 2.5 Which ramp for which variable

Chosen by the variable's `group` (from `/api/variables`) with two per-variable exceptions. The client only looks up a class; the
anomaly values come from the backend.

| Variable group / id | Above its normal | Below its normal | Legend words |
| --- | --- | --- | --- |
| `Heat` (T2M, T2M_MAX, T2M_MIN …) | `--data-warm-*` | `--data-cool-*` | Warmer / Cooler than its normal |
| `Water` (PRECTOTCORR, humidity, soil wetness) | `--data-wet-*` | `--data-dry-*` | Wetter / Drier than its normal |
| `CLOUD_AMT` | `--data-cloud-*` | `--data-cool-*` | More cloud / Less cloud than its normal |
| everything else (`Sun & clouds` radiation, `Wind & pressure`, `Land`) | `--data-warm-*` | `--data-cool-*` | Above / Below its normal |

Class breaks (display binning only): four steps each side plus neutral. Use a symmetric scale fixed for the whole loaded frame
set so colours are comparable across months: `scale = the largest absolute cell anomaly in the loaded frames` (a maximum, not a
statistic), neutral band = |anomaly| < 0.1 × scale, then four equal-width steps up to the scale. Print the break values in the
legend with the unit. Forecast frames use the same scale as the observed frames they follow.

---

## 3. Globe data-layer styles

Capability boundary, restated for every implementer: the backend has no global raster. It has (a) a local 1×1 to 3×3 grid near
the selected place, (b) sample-site points for the world survey, (c) one point of live weather, (d) news located at a saved
place's approximate coordinates. No layer may fill, blur, interpolate or glow beyond those footprints. No full-Earth colour wash,
no smoothed gradients between cells, no contours.

### 3.1 Base globe (decorative, procedural)

- Keep the existing canvas renderer (`Globe.jsx`): ocean radial gradient (`--globe-ocean-lit` → `--globe-ocean-dark`), Natural
  Earth land in `--globe-land`, coast `--globe-coast` 0.8px, borders `--globe-border` 0.5px, graticule `--globe-graticule` 0.6px,
  limb darkening, limb line `--globe-limb` 1.2px.
- Atmosphere halo: radial gradient from R×0.97 to R×1.20, alpha 0.28 → 0. Restrained: it must not reach the HUD corners.
- Lighting is a fixed top-left highlight. No real-time day/night terminator and no drifting cloud texture: either could be read
  as live data in an app that has a cloud variable. (Asset rules, section 6.)
- Remove the CRT scan-line overlay (`.globe-scan`) while any data layer is visible; it reduces legibility of hatch patterns.
- Draw order, bottom to top: halo → ocean → graticule → land → borders → limb shading → **local field cells** → uncertainty
  circles → sample-site dots → live-weather glyph → place pins/reticle → news markers → selection/focus outlines.

### 3.2 Local observed field (the heat map): 1×1 to 3×3 cells

Geometry

- One quadrilateral per API cell, centred on the cell's `lat`/`lon`, drawn as a geographic polygon with the existing `cellRing`
  helper so it rotates and foreshortens with the globe. Half-width in degrees = half the centre-to-centre spacing
  (`size_degrees / (n − 1) / 2` for n > 1; `size_degrees / 2` for n = 1). Cells therefore tile with a visible gap:
  inset every polygon by 1.5 screen px so adjacent cells never merge into one smooth surface.
- Each cell shows a 2px dot at its exact centre (`rgba(5,7,13,.6)`) when the cell is ≥ 28px: the value is sampled at that point.
- The whole grid gets a bracket frame (four corner brackets, 10px arms, 1.5px, `--text-dim`) 6px outside its extent, with a small
  mono tag above the top-left bracket: `LOCAL GRID · 3×3 · NASA POWER`. The frame is what says "this patch is all we have here".
- Camera: when a place becomes active, fly so the grid extent spans about 35% of the smaller stage dimension, capped at the
  globe's zoom limit (current `K_LIMITS.globe` max 14; raising it to 18 is acceptable). At overview zoom the grid collapses to
  the bracket frame plus a single 10px swatch coloured by the frame's `mean_anomaly` class, so nothing implies detail that
  cannot be seen.

Observed cell style

| Property | Value |
| --- | --- |
| Fill | ramp colour for the cell's anomaly class (2.5) |
| Fill alpha | neutral 0.55; steps 1–4: 0.70, 0.78, 0.86, 0.92 |
| Outline | 1px solid white at 60% alpha (mandatory, see 2.3) |
| Sign glyph | `+` / `−` centred, mono 700 11px, `--text-on-data`, only when the cell is ≥ 36px on screen; none for neutral |
| Hover / keyboard focus | outline 2px solid #ffffff plus outer 2px `rgba(179,161,255,.6)`; tooltip (below) |
| Selected | outline 2.4px #ffffff, bracket ticks at the corners |
| Glow / blur | none. No `shadowBlur` on cells, ever |

Tooltip / readout for a cell (also the row text of the accessible table): `r1 c2 · 33.45°N 112.07°W · Mar 2024 · 21.4 °C ·
+0.8 °C vs its own March normal · Observed (NASA POWER)`.

### 3.3 Missing cell

- Fill `--missing-bg`, then the two-direction neutral cross-hatch (canvas: an 8×8 offscreen pattern with both diagonals, 1px,
  `--missing-fg` at 0.55 alpha; CSS: `--missing-pattern`), outline 1px dotted (`setLineDash([2, 3])`) `--missing-fg`.
- Centre glyph `×` (mono 11px, `--missing-fg`) when ≥ 28px. Tooltip: `No data for this cell this month`.
- A cell that failed entirely (`cells[].ok === false`) uses the same style for every frame and the tooltip
  `This cell could not be loaded`.
- Never give a missing cell a ramp colour, a neighbour's colour, an average, or a faded copy of its previous frame.
- If every cell in a frame is missing, the grid frame stays, all cells are patterned, and the rail readout says
  `No data this month` instead of an anomaly.

### 3.4 Forecast cell and the observed/forecast boundary

Rendered only when `/api/monthly-forecast` returns `eligible: true`.

| Property | Value |
| --- | --- |
| Fill | ramp colour for the forecast anomaly, at `--forecast-fill-alpha` (0.55) |
| Overlay | one-direction 45° hatch (canvas: 8×8 pattern, 1.5px line, `--forecast-line` at 0.70 alpha; CSS: `--forecast-hatch`) |
| Outline | 2px dashed `--forecast-line`, dash `[6, 4]` |
| Grid frame | brackets switch to dashed; tag reads `FORECAST · NOT OBSERVED` |
| Uncertainty | the cell tooltip prints `lo`–`hi` from the API (`11.97 to 13.25 °C`); no extra visual |
| On-globe badge | pill pinned to the top-centre of the stage for as long as a forecast frame is shown: hatch swatch + S7 |

Boundary rules

- On the timeline rail the observed and forecast zones are separate segments with a 2px dashed vertical divider
  (`--forecast-line`), a 12px gap, and labels `Observed` (left) and `Forecast` (right) above the track.
- Playback stops at the last observed month. Entering the forecast zone takes a deliberate action (step forward, drag past the
  divider, or the `Show forecast` button). There is never a cross-fade across the divider (section 4.4).
- When the forecast is withheld, the forecast zone is drawn as an empty outlined slot containing a lock glyph and
  `Forecast withheld`; activating it opens the Forecast status card with the backend `reason`. The observed timeline is unaffected.
- When the forecast has not been requested, the slot shows `Check forecast` (a button).

### 3.5 Sample-site dots (world mode, Explore ▸ World only)

- Keep today's dot encoding (`worldDots` / `lapseDots` in `App.jsx`): colour = direction (`--up` / `--down` / `--flat`),
  white ring = holds after correction, radius 4–9px = signal vs noise; time-lapse blends grey toward `--up`/`--down`.
- Add a second, non-colour direction cue: a 5px `▲` or `▼` notch drawn inside dots of radius ≥ 6px.
- Sites that failed: 3.5px hollow dot, 1px dotted `--missing-fg` (replace today's solid grey fill).
- No halo larger than the dot (cap `shadowBlur` at 6), no connecting surface, no Voronoi shading, no heat blur between dots.
- Legend always includes S10 as its first line.

### 3.6 News markers

One marker per saved place that has stories (all stories for a place share that place's coordinates). The marker is a rounded
square "tag" so it cannot be confused with round data dots or the reticle pin.

```
 closed marker            closed card (hover, focus, or active place)         expanded (click / Enter / Space)
   ┌────┐                 ┌──────────────────────────────────────┐            opens the News panel (5.9), focus moves
   │ ▲ 3│◄─ count         │▌▲ Flood warning issued for river …   │            to its heading; Esc returns focus to
   └─┬──┘                 │▌  BBC News · 14 Nov 2026             │            the marker
     │ 8px leader         │▌  Weather / environmental watch ·    │
     ● anchor             │▌  near Delhi (approximate)           │
                          │▌  news context, not scientific evid… │
                          └──────────────────────────────────────┘
```

| State | Marker | Card |
| --- | --- | --- |
| Verified, closed | 28×28px (44px hit area), radius 8px, fill `--surface-2` at 92%, 2px solid border in the severity colour, severity glyph inside (● / ▲ / ◆) in the same colour, count badge when > 1 | 260px wide, `--surface-2`, 2px left+outline border in the severity colour, headline 13px/700 two-line clamp in `--text`, meta 12px `--text-dim` |
| Verified, open (panel showing) | same, plus 2px white outer ring and the uncertainty circle (below) | — (panel is open) |
| Unverified only | 24×24px, fill `--surface-1` at 80%, 1.5px **dashed** `--news-unverified` border, hollow glyph outline in `--news-unverified`, no colour fill, no glow, no pulse | 240px, 1.5px dashed `--news-unverified` border, headline 13px/500 in `--text-dim`, first meta line is S5; the severity colour appears only as a 8px hollow shape, and `severity_label` is not shown |
| Mixed (verified + unverified at one place) | marker border = highest severity among **verified** stories only; unverified stories never raise the colour | list in panel: verified first |
| Stale | adds a 10px clock glyph at the marker's top-right in `--state-stale` | adds `Updated 42 min ago` (from `cache_age_seconds` / `fetched_at`) |
| Loading | marker replaced by a 24px dashed neutral square with a slow opacity pulse; no severity colour | card: skeleton lines and `Looking for news context… (first load can take up to 20 seconds)` |
| Back of globe | not drawn; the dashboard list still shows the stories | |

- The closed card's "one-line overview" is composed only from fields that exist: `{severity_label} · near {location_name}
  (approximate)` for verified stories; `Unverified news context · near {location_name} (approximate)` for unverified. Do not
  generate or truncate article text (see open question Q3).
- Markers rotate with the globe (projected each frame like pins). At most one closed card is shown on the globe at a time; on
  mobile the on-globe card is suppressed and the dashboard list is used.
- Location precision: when a marker is open, draw a geographic circle of radius `uncertainty_km` around the anchor: 1px dashed
  `--text-faint`, no fill. The panel states `Location: city centre, approximate (within about 50 km)`.
- The severity border never uses emergency iconography (no sirens, no exclamation triangle with "WARNING", no flashing).
  The legend carries S13.
- Red markers do not pulse. Nothing about a news marker animates continuously.

### 3.7 Live weather (Meteomatics) point layer

Optional layer, toggled from the Live weather card (`Show on globe`), default off. It is a point, so it is drawn as a glyph in
screen space, never as an area.

```
            cloud arc (0–100 %)
          ╭───────────╮
        ╭─┤   21°C    ├─╮      centre: current temperature, mono 700 15px, --text
 wind   │ │   LIVE    │ │      three 4px arcs on 60° gaps, track rgba(255,255,255,.12), value in --live
 arc    ╰─┤           ├─╯      diameter 72px (56px below 768px); anchored 44px above-right of the place pin
          ╰───────────╯        with a 1px --live leader line to a 6px ring at the exact point
            rain arc
   [ LIVE · Meteomatics ]      chip below: mono 11px, --live border, fill --surface-2
```

- Arc scales (display only): cloud 0–100%; hourly precipitation 0–10 mm (clamped, `≥10` shown in text); wind 0–20 m/s (clamped).
- A `null` value draws that arc's track dashed with no value arc; the card shows `—`. Never estimate a missing value.
- The glyph and its leader are the only `--live` coloured things on the globe. It never tints cells, and it is hidden while a
  forecast frame is displayed only if they overlap; otherwise both can be visible because they look nothing alike.
- Stale (`status: "stale"`): arcs drop to 50% alpha, the chip becomes `STALE · Meteomatics · 14:09 UTC` with a clock glyph.
- Unconfigured / unavailable: no glyph at all; the toggle is disabled with the backend `reason` beside it.
- Do not draw concentric geographic rings, a radius of influence, or a gradient around the point.
- The 1–72 hour series is shown only inside the Live weather card on its own hour axis (5.8). It is never placed on the monthly
  timeline rail and never shares an axis with NASA or forecast frames.

### 3.8 Legend (bottom-left of the stage)

One compact card (`--surface-2` at 88%, radius 10px, padding 10px 12px, mono 11–12px), contents depend on what is visible:

```
AIR TEMPERATURE · vs each cell's own monthly normal (°C)
−2.4 ▼ [■][■][■][■] [■] [■][■][■][■] ▲ +2.4        ← nine swatches, 18×10px, radius 2px, break values under ends
Cooler than its normal        Warmer than its normal
[▩] No data     [▨ ┄] Forecast — not observed data
[▲] News (attention label, not a warning)   [◔] Live weather point (Meteomatics)
Coarse local grid, not a global satellite image
```

Only rows for layers currently on are shown. On mobile the legend is a `Key` button that opens a sheet with the same content.

---

## 4. Motion storyboard

Guiding rule: motion shows a change in the data or a change of place in the interface. Nothing loops for decoration while data is
on screen, and nothing animates in a way that looks like data arriving before it has.

### 4.1 Tokens

All durations and easings are in the token block (2.2). Canvas code reads the same numbers (via `lib/tokens.js` or mirrored
constants in one file) so CSS and canvas stay in step.

### 4.2 Globe idle rotation

| Aspect | Value |
| --- | --- |
| Speed | 2° of longitude per second, eastward-moving surface (one turn in 180 s). Today's value is 6°/s (`dt * 0.006`): change to `dt * 0.002` |
| When allowed | Main page, globe mode (not flat map), camera at overview zoom (k ≤ 1.2), no place layer active, tab visible, motion not reduced |
| Start / resume | ramps from 0 to full speed over 1200ms (`--globe-idle-ramp`), 8000ms after the last interaction |
| Pauses immediately on | pointer down or drag on the canvas; wheel/pinch; any key handled by the globe; keyboard focus anywhere inside the globe stage (`:focus-within`); pointer over a marker or cell; a camera fly-to; timeline playing or being scrubbed; any drawer, sheet, panel or modal open; `document.visibilityState === "hidden"`; `prefers-reduced-motion: reduce`; the in-app "Reduce motion" preference |
| Never rotates | while a local field, forecast frame or live glyph is displayed (the camera holds on the place); on the sign-in/onboarding pin map; on Explore unless the World tab is idle with no selection |

A visible `Pause rotation` / `Resume rotation` toggle sits with the zoom controls (WCAG 2.2.2: moving content longer than five
seconds needs a pause control).

### 4.3 Camera

- Fly-to a place: 1400ms (`--dur-fly`), ease-in-out cubic, with the existing zoom-out arc. Zoom buttons: 380ms.
- Selecting a different saved place: one fly-to; cells of the old place fade out over 160ms before the flight, new cells are not
  drawn until their data arrives (the scan state covers the wait).

### 4.4 Timeline: scrub, play, speeds, cross-fade

| Aspect | Value |
| --- | --- |
| Default state | paused on the most recent observed month. No autoplay, ever, including after loading |
| Play | advances one calendar month per dwell: 0.5× = 1200ms, 1× = 600ms (default), 2× = 300ms, 4× = 150ms |
| End of play | stops on the last observed month; the play button becomes `Replay`. No looping. Never continues into the forecast |
| Scrub (drag / arrow keys) | snaps to whole months; the frame changes instantly with no tween while the thumb is moving; pauses playback |
| Step buttons | ±1 month, instant |
| Thumb motion | CSS transform, `--dur-fast` linear between months while playing; instant while dragging |
| Month readout | numbers and month label switch at the start of each dwell; digits do not roll or count up |

Cross-fade between frames (playback only)

- Duration = `min(0.6 × dwell, 360ms)` → 360 / 360 / 180 / 90ms at the four speeds, linear, then hold for the rest of the dwell.
- A cell may tween its colour from frame A to frame B only if all of these hold: A and B are consecutive calendar months in the
  API response; both are observed frames; the cell is non-missing in both. Tween in a perceptual-ish space (interpolate the two
  class colours in linear RGB); the tween is a display transition only.
- The readout text never shows an in-between value. It shows frame A's numbers, then frame B's.
- Valid → missing: the fill fades out (opacity only) over the fade duration, then the missing pattern appears. Missing → valid:
  the pattern is removed at once and the fill fades in. Missing → missing: no change. Colour is never carried through a gap.
- Non-adjacent months (a gap in the series, a jump from a click on the track, a wrap from last to first on Replay): hard cut.
- Observed ↔ forecast: hard cut plus the divider cue: the grid frame brackets switch to dashed and the on-globe forecast badge
  appears with a 160ms opacity fade. No colour tween across the divider.
- Forecast frame to forecast frame (adjacent horizons): colour tween allowed, hatch and dashed outline stay constant.

### 4.5 Data arrival and the "data-scan" loading state

While a request for the local grid is in flight:

1. The place pin shows the existing radar sweep (`drawRadar`), slowed to one sweep per 2200ms (`--dur-scan-sweep`), in `--accent`.
2. The grid frame brackets are drawn at the expected extent with empty cell outlines: 1px dashed `--text-faint`, **no fill**.
   The outlines brighten one after another (alpha 0.3 → 0.8 → 0.3, 180ms per cell, row by row) to suggest scanning.
3. The rail shows a skeleton track (no bars) and the caption `Requesting NASA POWER monthly data… nothing is shown yet.`
   (`role="status"`).
4. No ramp colour, no placeholder bars, no fake numbers appear before the response does.

On arrival: cells fill with the existing centre-out ripple (450ms per cell, up to 650ms stagger, ease-out cubic), the rail bars
grow from the baseline over 240ms, the radar stops. If the response is partial, failed cells go straight to the missing style.

After 8 s of waiting, add `Still working — NASA POWER can be slow.` After an error, the outlines stop animating and the error
state (5.2) replaces the caption.

### 4.6 News, weather and panels

| Element | Motion |
| --- | --- |
| News marker appears | opacity 0 → 1 and scale 0.9 → 1, 160ms, once. No pulse afterwards, any severity |
| Closed news card | opacity + 4px rise, 160ms in, 80ms out |
| News panel / evidence drawer / account panel | slide 24px + fade, 240ms `--ease-standard` in, 160ms `--ease-exit` out; scrim fades 160ms |
| Dashboard drawer (tablet) | translateX −100% → 0, 240ms in, 160ms out |
| Mobile sheets | translateY 100% → 0, 320ms `--ease-standard` in, 240ms out |
| Live glyph arcs | sweep from 0 to value over 360ms once on first draw; value changes on refresh are instant |
| Verdict meter | bars fill left to right, 80ms apart, once per new result. No stamp/slam animation (retire `slam`/`thud` on Main) |
| Cards entering the dashboard | existing `rise` 14px/550ms is too much for a dense column: use 8px / 240ms, stagger 40ms, max 5 items |
| Buttons, chips | colour/border 160ms; press translateY(1px) 80ms |

### 4.7 Page flips

| Transition | Motion |
| --- | --- |
| Sign-in → onboarding → Main | the card's content cross-fades (160ms out, 240ms in, 8px rise). On Finish/Skip the card fades out (240ms) and the Main layout fades in (320ms); the globe begins idle rotation only after the fade completes |
| Main ↔ Explore | 320ms (`--dur-page`): outgoing page opacity 1 → 0 and translateX 0 → −12px (to Explore) or +12px (back to Main) in the first 160ms with `--ease-exit`; incoming page opacity 0 → 1 and translateX ±12px → 0 over 240ms with `--ease-standard`. Browser back/forward use the same motion in the matching direction |
| Explore tab change | panel content cross-fade 160ms; no slide |

After a page flip, focus moves to the new page's `<h1>` (`tabindex="-1"`), a polite live region announces `Main dashboard` /
`Explore`, and scroll resets to top. Place, variable, month and playback state are preserved (playback pauses on leaving Main).
Input is never blocked during a transition: a second click during the 320ms cancels the first and completes immediately.

### 4.8 Reduced motion (`prefers-reduced-motion: reduce`, or the in-app "Reduce motion" preference)

The global rule in `motion.css` (durations forced to ~0) stays as a safety net. Canvas and timers need explicit handling:

| Feature | Reduced-motion behaviour |
| --- | --- |
| Globe idle rotation | off; the rotation toggle is hidden; arrow keys and drag still rotate |
| Camera fly-to | instant jump (existing `dur: 1`) |
| Radar sweep / scanning outlines | static: dashed outlines at fixed 0.6 alpha plus the status text; no sweep |
| Cell reveal ripple | all cells appear at once |
| Timeline play | still available because it is user-started and conveys data: frames change as hard cuts, no cross-fade, and speeds are limited to 0.5× and 1× (no more than about two changes per second). Play is never started automatically |
| Thumb, bars, meter, live arcs | jump to final state |
| Panels, drawers, sheets, page flips | appear/disappear with no slide; a 1-frame opacity change at most |
| Starfield twinkle and drift | off (static stars) |
| Pin pulse rings | off (existing behaviour) |
| News marker entrance | none |
| Smooth scrolling | off |

Nothing in the product flashes more than three times per second in any mode.

---

## 5. Component inventory

Class names below are the styling contract; component file names are suggestions (owners in section 7).

### 5.1 Shared primitives

| Component | Class | Notes |
| --- | --- | --- |
| Card | `.card` (existing) | `--surface-1`, 1px `--line-strong`, radius `--radius`, padding 16px. Retire `.hud-card` corner brackets on Main except the verdict card |
| Button | `.btn`, `.btn-primary`, `.btn-sm`, `.btn-ghost`, `.btn-danger` | height 40px (32px sm, 44px on coarse pointers); primary = `--accent` fill, `--text-on-accent`; danger = 1px `--state-error` border, `--state-error` text |
| Chip / toggle chip | `.chip`, `.chip.on` | unselected border `--line-control`; selected adds a check glyph, not just colour |
| Segmented control | `.seg` (existing) | used for Main/Explore, speed, range, Globe/Map |
| Badge | `.td-badge` + modifier | pill, mono 11px uppercase, 1px border, padding 2px 8px. Modifiers: `--observed` (solid `--text-dim` border, `▣`), `--forecast` (dashed `--forecast-line` border, hatch swatch), `--live` (`--live` border), `--stale` (`--state-stale` border, clock), `--unverified` (dashed `--news-unverified`), `--source` (plain) |
| State card | `.td-state` + `--loading / --empty / --error / --stale / --withheld / --nokey / --ratelimited / --unavailable` | see 5.2 |
| Drawer / sheet | `.td-drawer` (right, `--drawer-w`), `.td-sheet` (mobile, full height) | `role="dialog"`, `aria-modal="true"`, labelled by its heading, Esc closes, focus trapped, focus returns to the opener (reuse the logic in `Modal.jsx`) |
| Disclosure | `<details class="td-disclosure">` or button + region | chevron rotates 90°, 160ms |
| Source line | `.td-source` | mono 11–12px `--text-faint`: `Source · unit · period · fetched time`, source name links to `provenance.source_url` |

### 5.2 Standard states (every data-bearing component implements the ones that apply)

Anatomy of a state card: 20px glyph, one-line title (15px/600), one or two lines of explanation (13px `--text-dim`, the backend
`reason`/`message` when there is one), optional single action. Left rule 3px in the state colour. Never an empty box, never a
spinner alone.

| State | Glyph + colour | Title pattern | Body | Action | ARIA |
| --- | --- | --- | --- | --- | --- |
| Loading | scan bars, `--accent` | `Loading {thing}…` | what is being requested from whom; after 8 s add `Still working…` | `Cancel` when cancellable | `role="status"` polite |
| Empty | hollow circle, `--text-faint` | `Nothing to show yet` / specific (`No environmental stories found near Delhi`) | backend `empty_reason` if present; what the user can do | optional | none |
| Error | `✕`, `--state-error` | `We couldn't load {thing}` | plain message; no stack, no status code jargon, never an upstream body | `Try again` | `role="alert"` |
| Stale | clock, `--state-stale` | `Showing saved data from {time}` | backend `reason` if present; age in words (`42 minutes old`) | `Refresh` | polite |
| Withheld forecast | lock, `--forecast-line` | `Forecast withheld` | backend `reason` verbatim; `Observed history is still available.` | `How forecasts are checked` (opens detail) | none |
| No key / unconfigured | plug, `--state-info` | `{Feature} isn't set up on this server` | backend `reason`; what still works (`Showing curated published context instead.`) | none | none |
| Rate-limited | hourglass, `--state-warn` | `Too many requests for now` | `Try again in about {retry_after_seconds} seconds.` plus what is shown meanwhile | `Try again` (disabled until the time has passed) | polite |
| Unavailable (provider down) | cloud-off, `--state-info` | `{Provider} is unavailable right now` | backend `reason` | `Try again` | polite |
| Unverified news | hollow shape, `--news-unverified` | S5 | publisher name, `We could not confirm this publisher against our list.` | `Open source ↗` | none |
| Storage blocked | disk-off, `--state-warn` | `Your browser is blocking storage` | `Your choices will last only until this tab closes.` | none | polite, shown once under the top bar |
| Partial | half-filled square, `--state-warn` | `Some of this didn't load` | which parts (`2 of 9 grid cells`, or `partial_failures` places) | `Retry the missing parts` | polite |

"No key", "unconfigured", "withheld" and "rate-limited" are normal states, styled calmly in neutral/amber. Only a genuine failure
uses `--state-error`.

### 5.3 Sign-in, onboarding, account

| Component | States |
| --- | --- |
| `SignIn` | idle; field error (inline, per field); submitting (button shows `Signing in…` for at most 240ms: no network call exists); storage blocked (S-state strip, sign-in still works for the session) |
| `Onboarding` step 1 | empty (Continue disabled, helper `Choose at least one place, or skip for now`); searching (list skeleton); no match (`No place found — try another spelling or pin it on the map`); place service error (search disabled, pin map still works); limit reached (5 of 5) |
| `Onboarding` step 2 | none selected (Finish disabled); some selected |
| `AccountButton` | closed; open (`aria-expanded`); shows the first letter of the display label in a 32px disc with 1px `--line-control` border |
| `AccountPanel` | see below |

Account panel (desktop/tablet: right drawer `--drawer-w` max 420px; mobile: full-height sheet):

```
┌ Account ─────────────────────────────── ✕ ┐
│ ⓘ Stored on this device for this demo.    │  S2: --state-info rule, 13px, always first, not dismissible
│   This is not a secure online account.    │
│                                           │
│ SIGNED IN AS                              │
│ v***@example.com            [Edit label]  │  display-safe label only
│                                           │
│ MY PLACES  3 of 5                         │
│ ⠿ Phoenix                            ✕    │  reorder (buttons ▲▼ for keyboard), remove
│ ⠿ Delhi                              ✕    │
│ [ + Add a place ]                         │
│                                           │
│ DATA TYPES I CARE ABOUT                   │
│ [✓ Heat] [✓ Rain & water] [ Clouds & …]   │
│                                           │
│ PREFERENCES                               │
│ Reduce motion            ( off | on )     │
│ Detail level   ( Plain | Balanced | Tech )│
│                                           │
│ YOUR DATA                                 │
│ [Export profile] [Import profile]         │
│ [Reset and sign out]   ← .btn-danger      │
│                                           │
│ About & credits · Version 223a8c6         │
└───────────────────────────────────────────┘
```

States: default; saved (inline `Saved on this device` for 2 s, polite); import error (`That file isn't a Trend Detective
profile`); storage blocked (controls work for the session, notice explains); reset confirmation (modal:
`Remove your profile from this device?` / `This deletes your saved places and preferences here and returns to the sign-in page.`
/ `Cancel` · `Remove and sign out`).

### 5.4 Dashboard pieces

| Component | Content | States |
| --- | --- | --- |
| `PlaceSwitcher` | radio-group chips of saved places; active chip filled `--accent-dim` + check | no places (skipped onboarding): one card `Add a place to start` with a button and `or click the globe`; one place; five places (wraps to two rows) |
| `DataPicker` | data-type chips (only the chosen types, each with its `--type-*` icon), then a `<select>` of variables in that type | no types chosen: shows all six types with a hint `Showing everything — pick favourites in Account`; variables loading; variables error |
| Summary strip (tablet) / place bar (mobile) | place · variable · verdict meter + label | verdict loading (meter skeleton), error (`—`) |

### 5.5 Evidence verdict card (`VerdictCard`)

The lead is direction, rate, period, source and uncertainty. No p-value on this card.

```
┌ EVIDENCE CHECK · AIR TEMPERATURE · PHOENIX ──────────┐
│ ▮▮▮  Strong evidence of a trend                      │  meter + verdict.label (24px/700)
│                                                      │
│ ▲ Rising   +0.60 °C per decade                       │  direction chip + slope_per_decade + units (mono 20px)
│ 95% range +0.54 to +0.66 · about +2.59 °C in total   │  ci_low/high_per_decade, total_change (13px dim)
│ 1981–2024 · 44 complete years · NASA POWER           │  completeness + source (12px faint)
│                                                      │
│ Air temperature … rose over 1981–2024 …              │  verdict.summary, 3-line clamp + "more"
│                                                      │
│ [ How did we test this? ]  [ Why might this be … ? ] │
└──────────────────────────────────────────────────────┘
```

The four verdict states (keyed on `evidence_trace.verdict.code`; label text always from the backend):

| `code` (tier) | Meter | Card left rule | Direction row | Rate row | Buttons |
| --- | --- | --- | --- | --- | --- |
| `strong_evidence` (3) | 3 of 3 bars filled, `--verdict-strong` | 3px solid `--verdict-strong` | chip with `▲ Rising` in `--up` or `▼ Falling` in `--down` (words from `direction`) | full size, `--text` | both |
| `some_evidence` (2) | 2 of 3 filled, third outlined | 3px solid `--verdict-some` at 60% alpha | same chip, colour at 70% alpha, plus the word `careful` in the label from the backend | full size | both |
| `no_clear_evidence` (1) | 1 of 3 filled in `--verdict-none` | 3px solid `--verdict-none` | neutral chip `◆ No clear direction` in `--flat` (no warm/cool colour) | best-estimate rate and range shown at 15px `--text-dim`, prefixed `Best estimate` | both (Why will return the backend's `no_evidence` state) |
| `insufficient_data` (0) | 0 filled, three dashed outlines | 3px **dashed** `--verdict-insufficient` | none | replaced by `{years_used} complete years found; at least {min_years_required} are needed.` | `How did we test this?` only; the Why button is not rendered |

The meter is `role="img"` with `aria-label="Evidence level 3 of 3"`. The ladder of all four labels (`verdict.ladder`) is shown
as a small vertical list inside the evidence drawer with the current rung marked, so users can see where this result sits.

Card states: loading (skeleton: meter outline, two text bars, `Checking the evidence…`); error; stale case signature handled
silently by a refetch; new result (meter fill animation once).

### 5.6 "How did we test this?" drawer (`EvidenceDrawer`)

Right drawer over the globe (desktop/tablet), full-height sheet (mobile). The dashboard stays visible on desktop.

```
┌ How did we test this? ───────────────────────────── ✕ ┐
│ Air temperature · Phoenix · 1981–2024                 │
│ ⓘ Every number here was calculated on the server.     │  S12
│   This page only displays it.                         │
│ View:  ( Plain words | With the numbers )             │  one global toggle; default from the profile detail level
│                                                       │
│ ① Count complete 12-month years                       │  step.title (17px/600)
│   Used 44 complete 12-month years …                   │  step.plain_explanation
│   ▸ Method and values                                 │  disclosure: step.method_label + step.values as a
│                                                       │  two-column mono table (key · value), keys humanised
│ ② …                                                   │
│ ⋮                                                     │  numbered rail: 24px discs joined by a 1px --line-strong line
│                                                       │
│ CHECKS  5 of 5 passed                                 │  evidence_trace.checks: ✓ Passed / ✕ Not passed + text
│ WHERE THIS RESULT SITS                                │  verdict.ladder with the current rung marked
│ CAVEATS                                               │  evidence_trace.caveats as a list
│ Source: NASA Langley Research Center (LaRC) POWER … ↗ │
└───────────────────────────────────────────────────────┘
```

- "With the numbers" opens every disclosure and additionally shows the `mann_kendall`, `regression_and_serial_correlation`
  and `correction_status` blocks as labelled tables. p-values appear only here, formatted by the existing `formatP`.
- Pass/fail uses `✓`/`✕` plus the words, `--state-ok` / `--text-dim` (a failed check is information, not an error: no red).
- States: loading (if opened before the trend returns); a missing `steps` array → `The step-by-step trace isn't available for
  this result` with the summary still shown; error.

### 5.7 "Why might this be happening?" panel (`WhyPanel`)

Opened only by the button, only after a valid analysis. Same drawer slot as 5.6 (opening one closes the other).

```
┌ Why might this be happening? ────────────────────── ✕ ┐
│ ⚠ These are possible explanations, not proof that one │  S3: pinned at the top of the scroll area (position:
│   cause created this local trend.                     │  sticky), --state-warn rule, 13px/600, never dismissible,
│                                                       │  present in every state including loading and fallback
│ [status banner — see table]                           │
│                                                       │
│ SUMMARY                                               │  response.summary
│ POSSIBLE DRIVERS                                      │
│ ┌──────────────────────────────────────────────────┐  │
│ │ Published science · well established             │  │  evidence_type badge + confidence (words from backend)
│ │ Title                                            │  │
│ │ Explanation text … [1][2]                        │  │  citation chips → anchors in the Sources list
│ └──────────────────────────────────────────────────┘  │
│ LIMITATIONS                                           │  response.limitations as a list
│ SOURCES                                               │
│ [1] Rantanen et al. (2022) … nature.com ↗             │  real <a>, target=_blank rel="noopener noreferrer",
│                                                       │  domain always visible
│ Ask a follow-up (optional)                            │
│ [ short question…                         ] [ Ask ]   │  single-line, length-limited, manual submit only
│ Generated 15 Nov 2026 00:00 UTC · cached              │
└───────────────────────────────────────────────────────┘
```

Evidence-type badges: `measured_local_trend` → `Measured here` (`.td-badge--observed`); `published_literature` →
`Published science` (`.td-badge--source`). A driver card for the measured trend never looks like a cause: it is listed first
under the sub-heading `What was measured`.

| `status` | Banner (colour, glyph) | Copy | Body |
| --- | --- | --- | --- |
| (before click) | — | button `Why might this be happening?` under the verdict | — |
| loading | `--accent`, scan bars | `Looking for published explanations… this is on request only and can take a little while.` | S3 + skeleton cards |
| `ok` | none (or `.td-badge--source` `Searched published science`) | — | full content |
| `fallback` | `--state-info`, book | `The live search wasn't available, so this is our curated summary of published science.` | full content from the fallback |
| `no_key` | `--state-info`, plug | `Live explanations aren't set up on this server. This is our curated summary of published science.` | full content from the fallback |
| `rate_limited` | `--state-warn`, hourglass | `Too many requests for now. Try again in about {retry_after_seconds} seconds. Meanwhile, here is our curated summary.` | fallback content; `Ask` disabled until the time passes |
| `no_evidence` | `--state-info`, hollow circle | when `fallback_reason` is `no_significant_trend`: `There isn't a clear trend here to explain yet.` otherwise: `We couldn't find a substantiated explanation for this trend.` | summary/limitations if present; an empty `drivers` list shows no "Possible drivers" heading at all |
| HTTP 422 (stale signature) | none | `Refreshing the analysis…` for the single automatic retry | then the resulting state |
| network / other error | `--state-error`, `✕` | `We couldn't load explanations.` + `Try again` | S3 remains visible |

Never render a driver without at least one citation link (the backend already removes them; the UI must not add its own text).

### 5.8 Live weather card (`LiveWeatherCard`)

```
┌ LIVE WEATHER ─────────────────── [LIVE · Meteomatics] ┐   left rule 3px --live
│ Meteomatics weather forecast — not NASA trend data    │   S8, 12px, always visible
│  21 °C      ☁ 40 %     ☂ 0.0 mm     ༄ 3.2 m/s         │   current.* ; null → "—"
│  Next 24 hours                    ( 24h | 48h | 72h ) │
│  ▁▂▃▄▅▅▄▃▂▁▁▂▃▄▅▅▄▃▂▁▁▂▃▄   temperature line (--live)   │   own hour axis, tick every 6 h, "now" marker
│  ▂ ▂     ▃▅▂               rain bars (--data-water)    │
│ Valid from 14:00 UTC · fetched 14:09 UTC               │   request.start, fetched_at
│ [ ] Show on globe                                      │   toggles the point glyph (3.7)
│ Meteomatics operational weather data. It is separate … │   source_note
└────────────────────────────────────────────────────────┘
```

| State | Presentation |
| --- | --- |
| Collapsed (default) | one row: title, `.td-badge--live`, chevron. No request is made until expanded |
| Loading | skeleton numbers; `Requesting Meteomatics…` |
| `available` | as drawn |
| `stale` | `.td-badge--stale` `Saved at 14:09 UTC`; numbers at 70% alpha; backend `reason`; `Refresh` |
| `unconfigured` | `.td-state--nokey` inside the card with the backend `reason`; `Show on globe` disabled; card stays collapsed-height. Calm, not an error |
| `unavailable` (includes provider rate limit) | `.td-state--unavailable` with the backend `reason`; `Try again` |
| HTTP 422 / network error | `.td-state--error` |
| Value `null` | `—` with `title="Not supplied by Meteomatics"`; gaps in the line/bars are left as gaps |

The hour chart never appears on, next to, or styled like the monthly rail: different colour (`--live`), different axis labels
(hours), and its own caption.

### 5.9 News (`NewsList` in the dashboard, `NewsPanel` when opened, markers per 3.6)

Closed card (list and on-globe): 2px border in the severity colour (verified) or 1.5px dashed neutral (unverified); severity
glyph; headline; `publisher · date`; one-line overview (3.6); S4 in 11px `--text-faint`.

News panel (drawer/sheet, opened from a marker or card):

```
┌ News context · Delhi ────────────────────────────── ✕ ┐
│ news context, not scientific evidence                 │  S4, pinned
│ ⓘ Border colour is an editorial attention label …     │  S13
│ Updated 15 Nov 2026 00:00 UTC   [stale badge if stale]│
│ Location: city centre, approximate (within ~50 km)    │
│                                                       │
│ ┃▲ Severe heatwave advisory issued across …           │  verified: full headline, no clamp
│ ┃  BBC News · 14 Nov 2026 · Weather / environmental   │  severity_label
│ ┃  watch · heat & wildfire                            │  category, humanised
│ ┃  Read at bbc.com ↗                                  │
│                                                       │
│ ┆◇ Unverified news context                            │  unverified block: dashed rule, --text-dim headline
│ ┆  "Headline …"  — example-site.com · 13 Nov 2026     │  no severity_label, hollow glyph
│ ┆  We could not confirm this publisher against our    │
│ ┆  list. Read at example-site.com ↗                   │
└───────────────────────────────────────────────────────┘
```

| State | Presentation |
| --- | --- |
| Not yet requested | section header with `Load news context` button (or auto on first scroll into view) |
| Loading (slow first call) | three skeleton cards + `Looking for news context… the first load can take up to 20 seconds.`; after 10 s add `Still looking…` |
| Items | verified sorted first, then unverified under the sub-heading `Unverified news context` |
| No stories | `.td-state--empty` with `empty_reason` or `No environmental stories found near {place}` |
| Stale | `.td-badge--stale` + age from `cache_age_seconds`; items still shown |
| Partial (`partial_failures`) | `.td-state--partial`: `News for {place} didn't arrive in time` with `Retry` |
| Provider error | `.td-state--error` with `Try again`; never placeholder headlines |

### 5.10 Timeline rail (`TimelineRail`) and forecast status

Rail anatomy (desktop; see wireframe 1.6):

- Row 1 (44px): play/pause button (44×44, primary outline), step back / step forward, speed segmented control
  (`0.5×` `1×` `2×` `4×`), month readout (mono `--fs-32`, e.g. `MAR 2024`), kind badge (S6 or S7), mean readout
  (`▲ +0.6 °C vs normal`, from `mean_anomaly`), spacer, range control (`3y` `5y` `10y`).
- Row 2 (48px): track. One bar per month, height ∝ |`mean_anomaly`| on the fixed scale, rising from a centre baseline for
  above-normal and hanging below it for below-normal, coloured by ramp class. Missing months are a patterned full-height slot
  (`--missing-pattern`), never a zero-height bar. Year labels under January ticks. Thumb: 3px × 48px `#ffffff` line with a 14px
  round handle and `--focus-halo` on focus. Divider and forecast zone per 3.4 (`--forecast-zone-bg` + hatch, dashed top border).
- Row 3 (20px): `.td-source` caption: `NASA POWER (observed/reanalysis) · °C · 3×3 local grid ≈ 2° wide · Coarse local grid,
  not a global satellite image` with an `ⓘ` that opens the full `grid.resolution_note`, `provenance.caveat` and coverage counts.
- The slider is a real `<input type="range">` stretched over the track (visually transparent, the custom thumb mirrors it):
  `min=0`, `max=frames−1`, `step=1`, `aria-label="Month"`,
  `aria-valuetext="March 2024, observed, NASA POWER, mean plus 0.6 degrees Celsius versus normal"`. Arrow keys ±1 month,
  PageUp/PageDown ±12 months, Home/End first/last. Space/Enter on the play button toggles play; the slider never steals Space.
- Below the rail, a visually compact `Show grid values as a table` disclosure renders the current frame as an HTML table
  (rows × columns, value, anomaly, `Missing` in words): the keyboard/screen-reader equivalent of the canvas heat map.

| Rail state | Presentation |
| --- | --- |
| No place active | rail present but empty: `Choose a place to see its history` |
| Loading | skeleton track + status text (4.5); controls disabled |
| Ready, paused | as drawn |
| Playing | play button shows pause; thumb advances |
| At end | play button shows `Replay` |
| Partial coverage | `.td-badge` `2 of 9 cells missing` next to the caption; opens coverage details |
| Error | `.td-state--error` in the track area; `Try again` |
| Forecast not requested / withheld / eligible | per 3.4 |
| Forecast frame selected | readout badge = S7, month readout gains a dashed underline, caption switches to `Statistical forecast from NASA POWER history · not observed` |

Forecast status card (dashboard):

| State | Presentation |
| --- | --- |
| Not requested | `Check forecast` button + `1–3 month statistical outlook, shown only if it passes its own accuracy checks.` |
| Loading | `Backtesting the forecast… this can take a while.` |
| Eligible | `.td-badge--forecast`; `Forecast available: Jan–Mar 2025`; `Show on timeline`; disclosure `How good is it?` → `selected_model_label`, skill vs seasonal-naive, coverage (`calibration.empirical_coverage` vs `nominal_coverage`), number of backtests: all backend values |
| Withheld | `.td-state--withheld` with `reason` verbatim; for `unsupported_variable` add nothing else |
| Error | `.td-state--error` |

---

## 6. Asset rules

Shipped assets (all already in the repository's dependencies; no new downloads needed):

| Asset | Use | Source | Licence | Attribution shown |
| --- | --- | --- | --- | --- |
| Space Grotesk Variable | UI text | `@fontsource-variable/space-grotesk` (self-hosted) | SIL Open Font License 1.1 | About & credits |
| JetBrains Mono Variable | numbers, labels | `@fontsource-variable/jetbrains-mono` (self-hosted) | SIL Open Font License 1.1 | About & credits |
| Land and country outlines, 1:110m | globe base map | Natural Earth via the `world-atlas` npm package | Natural Earth: public domain; `world-atlas` package: ISC | About & credits (`Made with Natural Earth`) |
| Brand mark (magnifier + trend line) | top bar, sign-in | existing inline SVG in `App.jsx`, project's own work | project licence | — |
| Icons (data types, state glyphs, news shapes, weather) | everywhere | new inline SVGs drawn for this project, 24px grid, 1.75px stroke, `currentColor`; or Unicode geometric glyphs | project's own work | — |
| Stars, halo, lighting, scan sweep, hatch/missing patterns | atmosphere and data treatments | procedural (CSS gradients, canvas) | none needed | — |

Rules

1. No NASA logo ("meatball" or "worm"), no NASA insignia, no agency seals, anywhere, including the sign-in page, favicon,
   loading states and README screenshots. "NASA" appears only as plain text naming a data source, next to S14.
2. No satellite photograph or imagery texture is shipped in V2. The globe is the procedural vector globe. Reasons: the plan
   requires a documented source, licence and performance budget before any real layer is used, and the canvas renderer has no
   textured-sphere path today.
3. If the owner later approves a real imagery layer, it must be recorded in `DATA_SOURCES_APIS_AND_AI_MODELS.txt` with source
   URL, licence/usage terms, date retrieved and file size, be credited on screen next to the globe (`Imagery: {source}`),
   be labelled as a static base image with its acquisition period, and never be animated to look live.
4. No-asset fallback (this is the default, not an exception): if any font fails to load the stack falls back to `system-ui` /
   `ui-monospace`; if the map data fails, the globe draws ocean, graticule and limb only with the notice
   `Map outlines unavailable`; icons are inline so they cannot fail separately.
5. Decorative effects must stay obviously decorative: no cloud swirls, weather fronts, aurora, city lights, storm spirals,
   day/night terminator or "live" pulses on the base globe. Stars are confined to the page background, outside the globe disc.
6. No stock photos, no AI-generated imagery presented as Earth observation, no third-party icon fonts or CDN-loaded assets
   (everything is bundled; the app must work offline apart from its own API).
7. Screenshots and recordings used in the handoff must come from the running app.

---

## 7. Mapping table: spec element → file and owner

"Change" = existing file; "New" = suggested new file. Names of new files are suggestions; the class and token names are not.

| Spec element | § | File / component | Action | Owner |
| --- | --- | --- | --- | --- |
| Token block, focus ring, legacy re-pointing | 2.2 | `frontend/src/styles/theme.css` (or new `styles/tokens.css` imported first in `main.jsx`) | Change | Agent 2 |
| `mission` JS palette | 2.2 | `frontend/src/lib/theme.js` | Change | Agent 2 |
| Motion tokens, reduced-motion CSS net | 4 | `frontend/src/styles/motion.css` | Change | Agent 2 |
| App shell grid, breakpoints, page flip | 1.5–1.9, 4.7 | `frontend/src/App.jsx`, `frontend/src/styles/layout.css`; new `components/AppShell.jsx`, `styles/shell.css` | Change + New | Agent 2 |
| Top bar, Main/Explore switch, Account button | 1.5 | new `components/TopBar.jsx` (extracted from `App.jsx` header) | New | Agent 2 |
| URL/history page state | 1.1 | `frontend/src/lib/share.js`; new `lib/route.js` | Change + New | Agent 2 |
| Sign-in page | 1.3, 5.3 | new `components/SignIn.jsx`; retire `components/Boot.jsx` from first run | New | Agent 2 |
| Two-question onboarding | 1.4, 5.3 | `components/Intake.jsx` → new `components/Onboarding.jsx` (five-question wizard removed) | Change / New | Agent 2 |
| Profile storage `td-profile-v2` | 5.3 | `frontend/src/lib/profile.js`, `frontend/src/hooks.js`; new `lib/profileStore.js` | Change + New | Agent 2 |
| Account panel (S2, export/import/reset) | 5.3 | new `components/AccountPanel.jsx`; reuse `components/Modal.jsx` focus logic; `components/Dialogs.jsx` (About moves here) | New + Change | Agent 2 |
| Left dashboard, place switcher, data picker, summary strip, mobile place bar | 1.6–1.8, 5.4 | `components/Home.jsx`, `components/Watchlist.jsx`, `components/SetupPanel.jsx`, `components/ForYou.jsx` → new `components/Dashboard.jsx`, `PlaceSwitcher.jsx`, `DataPicker.jsx` | Change / New | Agent 2 |
| Shared primitives: badge, state card, drawer, sheet, disclosure | 5.1, 5.2 | new `components/ui/Badge.jsx`, `StateCard.jsx`, `Drawer.jsx`; `styles/panels.css`; `components/Loading.jsx`, `ErrorCard` in `App.jsx` | New + Change | Agent 2 (Agents 3 and 4 consume; until delivered, use the class names directly) |
| Base globe palette, halo, draw order, scan-line removal | 3.1 | `frontend/src/components/Globe.jsx`, `styles/layout.css` (`.globe*`, `.hud*`) | Change | Agent 3 |
| Idle rotation speed, pause rules, rotation toggle | 4.2 | `components/Globe.jsx` (`step`, `idleAt`, `onKeyDown`) | Change | Agent 3 |
| Local field cells, missing pattern, forecast hatch, grid frame | 3.2–3.4 | `components/Globe.jsx` (new field layer beside the existing `cells` layer); new `components/globe/fieldLayer.js`, `lib/ramp.js`, `lib/tokens.js`; `lib/geo.js` | Change + New | Agent 3 |
| Data-scan loading state | 4.5 | `components/Globe.jsx` (`drawRadar`), new field layer | Change | Agent 3 |
| Sample-site dots (direction notch, hollow failures, S10) | 3.5 | `App.jsx` (`worldDots`, `lapseDots`), `components/Globe.jsx` dot drawing, `components/World.jsx`, `components/TimeLapse.jsx`, `lib/lapse.js` | Change | Agent 3 (coordinate the `App.jsx` helpers with Agent 2) |
| News markers, closed card, uncertainty circle | 3.6 | `components/Globe.jsx`; new `components/globe/newsLayer.js`, `components/NewsMarkerCard.jsx` | Change + New | Agent 3 |
| News list and news panel | 5.9 | new `components/NewsList.jsx`, `components/NewsPanel.jsx`, `styles/news.css` | New | Agent 3 |
| Live weather glyph on the globe | 3.7 | `components/Globe.jsx`; new `components/globe/liveLayer.js` | Change + New | Agent 3 |
| Live weather card | 5.8 | new `components/LiveWeatherCard.jsx`, `styles/weather.css` | New | Agent 3 |
| Timeline rail, grid-values table, forecast slot | 3.4, 4.4, 5.10 | new `components/TimelineRail.jsx`, `styles/timeline.css`; `styles/lapse.css` as reference | New | Agent 3 |
| Forecast status card | 5.10 | new `components/ForecastStatus.jsx` | New | Agent 3 |
| Legend | 3.8 | `App.jsx` (`.globe-legend` blocks) → new `components/GlobeLegend.jsx` | Change / New | Agent 3 |
| Evidence verdict card (four states) | 5.5 | `components/Overview.jsx`, `components/CaseParts.jsx` (`Verdict`), `styles/overview.css` → new `components/VerdictCard.jsx` | Change / New | Agent 4 |
| "How did we test this?" drawer | 5.6 | new `components/EvidenceDrawer.jsx`; reuses `components/Term.jsx`, `lib/format.js` | New | Agent 4 |
| "Why might this be happening?" panel (S3, five statuses) | 5.7 | new `components/WhyPanel.jsx`; `components/Suspects.jsx` and `lib/explain.js` as references | New | Agent 4 |
| API-state hooks (abort, stale, retry-once on 422) | 5.2 | `frontend/src/hooks.js`, `frontend/src/api.js`; new `lib/useApiState.js` | Change + New | Agent 4 |
| Explore page, tab strip, Detail and Learn tabs | 1.9 | new `components/ExplorePage.jsx`; existing `Sweep.jsx`, `Scan.jsx`, `Duel.jsx`, `World.jsx`, `Vitals.jsx`, `Ledger.jsx`, `Events.jsx`, `CaseFile.jsx`, `ForecastLab.jsx`, `Archetypes.jsx`, `Explainer.jsx`, `Dialogs.jsx` (Glossary, Cases) kept and re-housed | New + Change | Agent 4 |
| Final contrast/colour-blind check, reduced-motion check, source inventory of assets | 2.3, 2.4, 4.8, 6 | tests, `DATA_SOURCES_APIS_AND_AI_MODELS.txt`, final handoff | — | Agent 5 |

Shared seams to agree with the integration lead before coding:

- `Globe.jsx` new props (suggested): `field` (`{ cells, half, kind: "observed" | "forecast", loading }`), `markers`
  (news), `liveGlyph`, `rotationPaused`, `onMarkerPick`, `onCellFocus`. The existing `cells`/`dots`/`pins` props stay for Explore.
- Dashboard slots: Agent 2's `Dashboard.jsx` renders slots in the order of 1.6; Agents 3 and 4 supply the components for
  slots 3–6. A slot is a plain `<section class="card">`; no agent styles another agent's slot from outside.
- The right-hand drawer slot is single-occupancy (evidence, why, news, account): opening one closes the others.

---

## 8. Accessibility checklist for implementers

- Every canvas feature has an HTML equivalent: grid values table (5.10), news list (5.9), live weather card (5.8), place switcher
  (5.4). The globe keeps `role="application"` with its key instructions; add the active layer to its `aria-label`
  (`…showing Air temperature, March 2024, observed`).
- Focus order on Main: top bar → dashboard (place, data, verdict, weather, forecast, news) → globe → globe controls → timeline.
  A `Skip to globe` and a `Skip to timeline` link sit at the top of the DOM.
- Focus is always visible (white ring + violet halo), including on canvas-drawn focus targets (cells, markers), which draw the
  same ring on the canvas.
- Live regions: one polite region for timeline month changes while stepping (not while playing: announce only on pause, to
  avoid a flood), one for load states, `role="alert"` only for real errors.
- Colour is never the only carrier (2.4). Text never sits on a data colour except the single `+`/`−` glyph in `--text-on-data`.
- Text can be zoomed to 200% without loss: the dashboard column scrolls, the rail wraps row 1 into two lines, nothing is
  clipped by fixed heights (use `min-height`, not `height`, on cards).
- Motion: pause control for rotation; no autoplay; reduced-motion table (4.8) is a release gate.
- Drawers and sheets trap focus, close on Esc, and return focus to the opener. Page flips move focus to the new `<h1>`.

---

## 9. Open design questions for the owner

| # | Question | Default used in this spec |
| --- | --- | --- |
| Q1 | Interface accent colour: violet (`#b3a1ff`, continuity with today's default theme and clearly not a data colour) or a cooler "mission" blue-white? A blue accent would sit close to the cooling ramp. | Violet |
| Q2 | Keep the old `nebula` / `classic` themes as a preference, or ship the single `mission` theme? | Single theme; theme switch removed from the top bar |
| Q3 | The news contract has no summary/overview field (only title, publisher, date, category, severity label, location). The plan asks for a "one-line overview" and "full available summary". | Compose the line from existing fields only; no article text is generated or scraped |
| Q4 | `publisher_verified` is not yet in `docs/V2_API_CONTRACT.md` at the time of writing. Is it a plain boolean on each item, and is there a publisher-list note the UI should link to? | Plain boolean per item; a missing field is treated as `false` (shown as unverified) |
| Q5 | Should unverified stories show their keyword severity at all? | Hollow neutral shape only, no severity colour on the border, `severity_label` hidden |
| Q6 | On entering Main, should the camera fly straight to the first saved place and request its 3×3 grid (9 NASA calls), or stay on the rotating overview until the user activates a place? | Stay on the rotating overview; the grid is requested when the user selects a place or presses play. This honours the request budget and keeps the "rotating Earth" opening |
| Q7 | Local grid request size. With the API default (`n=3`, `size=2.0`) each drawn tile is 1° wide, about twice the native ~0.5° cell, so tiles are sample points drawn large. A smaller `size` (about 1.25) would make tiles match the native resolution but cover a smaller patch. | Use the API default; tiles are inset with a centre dot and the caption states the grid is coarse |
| Q8 | Zoom limit: showing a 3° patch at a readable size needs globe zoom near the current maximum (k = 14), where 110m coastlines look blocky. Raise the limit to 18 and/or accept the coarse coastline? | Cap at the current limit; grid spans about 35% of the stage |
| Q9 | Is there a "Sign out" that keeps preferences, separate from "Reset"? The plan only defines Reset (removes the profile and returns to sign-in). | One control: `Reset and sign out` |
| Q10 | Follow-up question length for the Why panel: the contract says "optional short question" without a limit. | Single-line input; use the backend's limit once documented (placeholder 200 characters) |
| Q11 | Explore gains two non-tool tabs, `Detail` (statistical sections of the case file) and `Learn` (glossary, explainer, guided cases, about). Acceptable, or should Detail stay reachable from the verdict card only? | Both tabs in Explore, plus a `See full statistical detail` link in the evidence drawer |
| Q12 | The "Reduce motion" in-app preference and "Detail level" are extra UI preferences stored in `td-profile-v2`. Keep both? | Keep both; they are harmless UI preferences |
| Q13 | Colour-blind safety of the ramps is by construction and by redundant glyphs, not yet simulator-tested. Is a simulator check by Agent 5 sufficient, or does the owner want a named palette (for example a published colour-blind-safe diverging scheme) substituted? | Agent 5 verifies; glyph redundancy is mandatory either way |
