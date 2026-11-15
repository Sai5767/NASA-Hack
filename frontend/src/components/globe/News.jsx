/**
 * News context (spec 3.6, 5.9): the closed card (globe and dashboard list), the dashboard list (slot 6) and the
 * focus-managed panel opened in the shell's right-hand drawer.
 *
 * News is context, not scientific evidence. Verified stories get a thin severity border with a shape glyph;
 * `publisher_verified: false` stories read "Unverified news context", are dimmer, have a dashed neutral border and
 * never show a severity colour or `severity_label`. Nothing here is an official warning.
 */
import { useEffect, useRef } from "react";
import { newsCard, newsState, NEWS_LABEL, SEVERITY_NOTE, SLOW_TEXT, UNVERIFIED_LABEL, CATEGORY_LABEL, INTEREST_CATEGORIES } from "../../lib/globeNews.js";
import { Badge, StateCard } from "../shell/ui.jsx";
import { useShell } from "../shell/Drawer.jsx";
import { useGlobeLayers, useNewsSnapshot } from "./useGlobeLayers.jsx";
import "../../styles/globe.css";

/** Closed card: border, glyph, headline, publisher · date, one-line overview, the fixed label. */
export function NewsCard({ card, as = "div", onOpen, compact = false }) {
  const Tag = as;
  const props = as === "button" ? { type: "button", onClick: onOpen, "aria-haspopup": "dialog" } : {};
  return (
    <Tag className={`news-card news-card--${card.tone}${compact ? " is-compact" : ""}`} {...props}>
      <span className="news-glyph" aria-hidden="true">{card.glyph}</span>
      <span className="news-text">
        {!card.verified && <span className="news-unverified mono">{UNVERIFIED_LABEL}</span>}
        <span className="news-headline">{card.headline}</span>
        <span className="news-meta">{card.publisher}{card.date ? ` · ${card.date}` : ""}</span>
        <span className="news-overview">{card.overview}</span>
        <span className="news-label mono">{card.label}</span>
      </span>
    </Tag>
  );
}

/**
 * Compact globe callout (plan 6D): severity glyph, a one/two-line headline, publisher and date. Nothing else.
 * Verified: the glyph carries the attention colour (the callout body stays a neutral surface with a hairline).
 * Unverified: no severity at all, a dashed neutral outline and the words "Unverified news context".
 */
export function NewsCallout({ marker }) {
  const c = marker?.lead;
  if (!c) return null;
  const more = (marker.count ?? 1) - 1;
  return (
    <span className={`gl-callout-body${c.verified ? "" : " is-unverified"}`}>
      <span className="gl-callout-top">
        {c.verified ? (
          <span className={`gl-callout-glyph news-tone--${c.tone}`} aria-hidden="true">{c.glyph}</span>
        ) : (
          <span className="gl-callout-unverified">{UNVERIFIED_LABEL}</span>
        )}
        <span className="gl-callout-headline">{c.headline}</span>
      </span>
      <span className="gl-callout-meta">
        {c.publisher}
        {c.date ? ` · ${c.date}` : ""}
        {more > 0 ? ` · +${more} more` : ""}
      </span>
    </span>
  );
}

/** The panel body (rendered in the shell drawer). Reads live news state, so a retry or refresh updates it. */
export function NewsPanel({ placeId, placeName }) {
  const snap = useNewsSnapshot();
  const list = snap.stories.filter((s) => s.place.id === placeId);
  const st = newsState(snap.req, list);
  const verified = list.filter((s) => s.item.publisher_verified === true).map((s) => newsCard(s.item, { showcase: s.place.showcase === true }));
  const unverified = list.filter((s) => s.item.publisher_verified !== true).map((s) => newsCard(s.item, { showcase: s.place.showcase === true }));
  const first = verified[0] ?? unverified[0];
  return (
    <div className="news-panel">
      <p className="news-panel-label">News context, not scientific evidence or an official warning.</p>
      <p className="small dim"><span aria-hidden="true">ⓘ </span>{SEVERITY_NOTE}</p>
      <p className="small faint mono">
        {snap.req?.data?.fetched_at ? `Updated ${new Date(snap.req.data.fetched_at).toUTCString().replace(" GMT", " UTC")}` : ""}
        {st.stale && <> <Badge kind="stale">Saved copy · {st.age}</Badge></>}
      </p>
      {first && <p className="small">{first.precision}</p>}
      {st.kind === "loading" && <StateCard kind="loading" title="Looking for news context…" slowAfter={10000} slowText="Still looking…">{SLOW_TEXT}</StateCard>}
      {st.kind === "error" && (
        <StateCard kind="error" title="We couldn't load news context" action={<button type="button" className="btn btn-sm" onClick={snap.retry}>Try again</button>}>
          {st.message}
        </StateCard>
      )}
      {(st.kind === "empty" || (st.kind === "items" && !list.length)) && (
        <StateCard kind="empty" title={`No environmental stories found near ${placeName}`}>{st.reason}</StateCard>
      )}
      {verified.length > 0 && (
        <ul className="news-panel-list">
          {verified.map((c) => (
            <li key={c.id} className={`news-entry news-entry--${c.tone}`}>
              <span className="news-glyph" aria-hidden="true">{c.glyph}</span>
              <div>
                <p className="news-headline full">{c.headline}</p>
                <p className="news-meta">{[c.publisher, c.date, c.severityLabel, c.category].filter(Boolean).join(" · ")}</p>
                {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">Read at {c.host} ↗</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {unverified.length > 0 && (
        <>
          <h3 className="news-sub">{UNVERIFIED_LABEL}</h3>
          <ul className="news-panel-list">
            {unverified.map((c) => (
              <li key={c.id} className="news-entry news-entry--unverified">
                <span className="news-glyph" aria-hidden="true">{c.glyph}</span>
                <div>
                  <p className="news-headline full">“{c.headline}”</p>
                  <p className="news-meta">{[c.publisher, c.date].filter(Boolean).join(" · ")}</p>
                  <p className="small dim">We could not confirm this publisher against our list.</p>
                  {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">Read at {c.host} ↗</a>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {st.partial?.length > 0 && (
        <StateCard kind="partial" title="Some news didn't arrive in time" action={<button type="button" className="btn btn-sm" onClick={snap.retry}>Retry</button>}>
          {st.partial.map((p) => p.location_name).filter(Boolean).join(", ")}
        </StateCard>
      )}
    </div>
  );
}

/** Open the news panel for one saved place in the shell's single right-hand drawer. */
export function useOpenNews() {
  const shell = useShell();
  const L = useGlobeLayers();
  return (place) => {
    L?.setOpenNewsPlace(place.id);
    shell.openDrawer({
      id: "news",
      title: `News context · ${place.name}`,
      eyebrow: "News context, not scientific evidence",
      render: () => <NewsPanel placeId={place.id} placeName={place.name} />,
    });
  };
}

/**
 * Legacy V2 dashboard list (not shown on Main in V3; markers are the discovery path). Kept for Explore or a test that
 * still imports it. Loads lazily (first scroll into view, or the button), saved places only.
 */
export function NewsList() {
  const L = useGlobeLayers();
  const ref = useRef(null);
  const openNews = useOpenNews();
  useEffect(() => {
    if (!L || L.newsWanted || !L.places.length) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) L.setNewsWanted(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [L?.newsWanted, L?.places.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!L) return null;

  const head = (
    <header className="slot-head">
      <h2 className="slot-title">News context</h2>
      <Badge kind="source">{NEWS_LABEL}</Badge>
    </header>
  );
  if (!L.places.length) {
    return (
      <div ref={ref}>
        {head}
        <StateCard kind="empty" title="Save a place to see news near it">News is only looked up for your saved places.</StateCard>
      </div>
    );
  }
  const st = newsState(L.newsReq, L.stories);
  const hidden = L.allStories.length - L.stories.length;
  const cats = INTEREST_CATEGORIES[L.interest];
  let body;
  if (st.kind === "idle") {
    body = <button type="button" className="btn btn-sm" onClick={() => L.setNewsWanted(true)}>Load news context</button>;
  } else if (st.kind === "loading") {
    body = (
      <>
        <div className="news-skeleton" aria-hidden="true"><i /><i /><i /></div>
        <StateCard kind="loading" title="Looking for news context…" slowAfter={10000} slowText="Still looking…">{SLOW_TEXT}</StateCard>
      </>
    );
  } else if (st.kind === "error") {
    body = (
      <StateCard kind="error" title="We couldn't load news context" action={<button type="button" className="btn btn-sm" onClick={() => L.loadNews(true)}>Try again</button>}>
        {st.message}
      </StateCard>
    );
  } else if (st.kind === "empty") {
    body = (
      <StateCard kind="empty" title={hidden > 0 ? "No stories about this data type" : "No environmental stories found near your places"}>
        {hidden > 0 ? `${hidden} other environmental ${hidden === 1 ? "story" : "stories"} found.` : st.reason}
      </StateCard>
    );
  } else {
    body = (
      <ul className="news-list">
        {L.stories.map(({ item, place }) => (
          <li key={item.id}>
            <NewsCard card={newsCard(item)} as="button" onOpen={() => openNews(place)} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div ref={ref} className="news-slot">
      {head}
      {st.stale && <p className="small"><Badge kind="stale">Saved copy · {st.age}</Badge></p>}
      {body}
      {st.partial?.length > 0 && (
        <StateCard kind="partial" title="Some news didn't arrive in time" action={<button type="button" className="btn btn-sm" onClick={() => L.loadNews(true)}>Retry</button>}>
          {st.partial.map((p) => p.location_name).filter(Boolean).join(", ")}
        </StateCard>
      )}
      {cats && (L.allStories.length > 0) && (
        <p className="small faint">
          {L.showAllNews ? "Showing every environmental story near your places. " : `Showing ${cats.map((c) => CATEGORY_LABEL[c]).join(", ")} and climate-science stories. `}
          {(hidden > 0 || L.showAllNews) && (
            <button type="button" className="linklike" onClick={() => L.setShowAllNews(!L.showAllNews)}>
              {L.showAllNews ? "Match my data type" : `Show all (${hidden} more)`}
            </button>
          )}
        </p>
      )}
      <p className="small faint">{SEVERITY_NOTE}</p>
    </div>
  );
}
