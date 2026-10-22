# Scorecard: Marquee vs. the judging criteria and the field

Criteria (Official Rules §6, equally weighted; ties are broken in this order): **Technological Implementation · Design · Potential Impact · Quality of the Idea**.
Stage One is a pass/fail check that the project fits the theme and really uses Qloo.

## The field (benchmarked on 2026-10-22)

- **Past winners, Qloo LLM Hackathon 2025** (2,893 participants):
  - 1st place, **GeoTaste**: a business-consultant agent with location insights and visualisations.
  - Honourable mentions: **Alloy** (cultural due diligence for M&A), **Resonance AI** (political messaging), **Zesty** ("unrecommendation" engine).
  - **Pattern:** winners serve a *specific professional* with a *decision*, and show Qloo data visually.
- **2026 gallery:** not published yet; 2,104 participants. Public repos created since Sep 30 that mention Qloo (about 40 on GitHub) cluster into:
  - consumer outing and trip planners (TasteRoute, AfterHours, TasteWalk, RideTaste, QlooSense, Taste Quest);
  - brand and market tools (BridgeScout, TasteBridge, Collab Scout, TasteDraft, TasteCanvas);
  - culture programming (COMMON GROUND, ShelfSense, Overture Greenlight);
  - **venue booking:** *Ritish017/encore-qloo* ("Encore — a booking agent with taste"), the closest entry.

## Feature-by-feature: Marquee vs the closest entry

Compared with what **Ritish017/encore-qloo** documents in its README and shows on its public demo (checked 2026-10-22). Its repo (last push Oct 19) holds a README, Dockerfile, deploy config, requirements and docs, but no application source yet, and its demo runs on fixture data. Nothing from it was used; this is a comparison only.

| Capability | Marquee | encore-qloo (as documented) |
|---|---|---|
| Starting point | **Just the venue name.** The venue itself is the Qloo signal; no seed artists needed | Owner names seed artists |
| Formats programmed | **Music, screenings, talks/podcasts, books** in one month | Music acts |
| Output | **Dated month calendar** with labels, promo copy, posters | Ranked acts and a booking memo |
| Per-pick explainability | **"Why this works" on every night:** Qloo signal used, affinity rank in its genre, genre rank for this crowd, reach tier, book vs tribute | Taste-bridge explanation |
| Scoring | **Draw index** from Qloo signals only (fit 50 / genre 25 / reach 25 / growth / bridge) | Booking-fit score (affinity 45, momentum 20 from `/v2/trending`, budget 20, bridge 15) |
| Attendance & money | **Forecast:** expected guests per night, net uplift, return on spend, your idea vs the plan, editable assumptions | — |
| Idea testing | **Gut check:** percentile vs everything tested, go / tweak / rethink, better bet | — |
| Compare venues / cities | **Any two venues in any two cities:** overlap score, genre bars, leanings, shared favourites (UI, API, MCP) | — |
| Growth audience | **Bridge nights** (crowd + `signal.demographics.age`) | — |
| Where to promote | **Flyer zones** (heatmap: localities and geohash cells) | Heatmap hotspots |
| Local ecosystem | **Partners vs rivals** within 1.5 km, **taste twins** in other cities, brand collabs, drafted pitches | Partners |
| Proof against generic AI | Generic-AI vs Marquee panel (with an LLM) and a grounding critic (100% grounded) | LLM-only baseline |
| Provenance | **Every Qloo call** (endpoint, params, ms, cache) in the UI and export | Provenance table |
| Export | **One-click booking pack (.zip):** brief, CSV, .ics, posters, pitches, provenance; plus share link and print | Memo copy / print |
| Agent interface | **Public MCP server** (4 tools) + streaming agent trace | LangGraph agent |
| Works on the hackathon key | Yes; avoids `/v2/trending`, which returns empty results in the hackathon environment | Relies on `/v2/trending` momentum |
| Accessibility & mobile | Keyboard focus rings, aria labels and live regions, reduced motion, AA-contrast text, 390 px layout without horizontal scroll | — (not documented) |
| Tests | 30 (`node:test`, no network) + secret scan | 19 (pytest, per README) |
| Live demo | Real Qloo data, no login | Fixture mode |

Other close entries: **COMMON GROUND** (cultural programme designer) and **Overture Greenlight** plan programmes but for institutions, without venue-level forecasts or comparisons. **Collab Scout** and **BridgeScout** match partners, which is one Marquee panel. **ShelfSense** covers books only.

## Scores (honest self-assessment, 1–10)

| Criterion | Marquee | Strongest comparable (encore-qloo / COMMON GROUND / typical planner) | Why Marquee leads, or the gap |
|---|---|---|---|
| **Technological Implementation** | **9.5** | 7 / 6 / 5 | 9 Qloo tools over 6 entity types, plus tags, demographics, heatmap (locality *and* geohash), location radius, `diversify.by`, demographic signals and `/v2/tags`. The venue itself is the signal; a fallback chain means nothing is ungrounded, a critic verifies it, and every call is logged for provenance. Production client (rate limiter, cache, de-dup, retries), LLM circuit breaker, 30 tests, secret scan, MCP server. **Gap:** the LLM planner needs an LLM on the deployment (see COMPLIANCE #5). |
| **Design** | **9.5** | 6 / 6 / 6 | Animated marquee hero, live agent trace, calendar with evidence on every night, forecast with live sliders, venue comparison, provenance, one-click booking pack. Mobile and keyboard checked. |
| **Potential Impact** | **9** | 7 / 7 / 5 | Independent venues (music rooms, bookshops, indie cinemas, bars with a stage) have no data team. Marquee turns taste into a plan, a guest forecast and a return on spend, which is the language an owner decides in. **Gap:** no real venue testimonial yet. |
| **Quality of the Idea** | **9** | 7 / 7 / 5 | The *venue* is the taste signal, **across formats**; gut checks turn Qloo into a decision tool; bridge nights solve "grow without losing regulars"; comparisons support second rooms and tours. |

## Gaps and what was done

| Gap found in the audit | Status |
|---|---|
| v1 was a single-shot "director" without an agent loop or tool use | ✅ Agent loop with tools, tracer, critic and MCP |
| Qloo 429s under parallel calls | ✅ Token bucket at 7/s, concurrency 6, retries |
| Venue signal silently ignored for some entity types | ✅ Fallback chain venue → signature artists → crowd tags; drops results without affinity |
| Heatmap payloads up to about 30 MB | ✅ Smaller takes, 25 s budget, polygons dropped |
| Partners included competitors | ✅ Split into partners vs rivals |
| No "why", no forecast, no comparison, no full export | ✅ Why-this-works, draw & ROI forecast, venue comparison, booking pack, provenance |
| Name collision with *encore-qloo* | ✅ Renamed to Marquee |
| Duplicate-submission risk with Opener | ✅ Opener made private |
| No live public demo | ✅ https://marquee-venues.vercel.app |
| No tests or CI | ✅ 30 tests and a secret scan. ⚠️ CI workflow written, but the push token lacks the `workflow` scope (user step) |
| No LLM on the live demo | ⚠️ AI Gateway needs a card on the Vercel team, or any OpenAI-compatible key. The rules planner covers it meanwhile |
