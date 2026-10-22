# Scorecard: Encore vs. the judging criteria and the field

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
  - **venue booking:** *Ritish017/encore-qloo* ("Encore — a booking agent with taste": LangGraph + Groq, artist search seeded by artists the owner names, `/v2/trending` momentum, partners, heatmap, ground check).

## Scores (honest self-assessment, 1–10)

| Criterion | Encore v2 | Strongest comparable (encore-qloo / COMMON GROUND / typical planner) | Why Encore leads, or the gap |
|---|---|---|---|
| **Technological Implementation** | **9** | 7 / 6 / 5 | 8 Qloo tools over 6 entity types, plus tags, demographics, heatmap (locality *and* geohash), location radius, `diversify.by`, demographic signals and `/v2/tags`. It discovers the crowd **from the venue itself**, with no seed artists needed. A signal-validity fallback means nothing is ever ungrounded, and a critic verifies grounding. Production-grade client: rate limiter, cache, de-dup, retries, fail-fast. 26 tests, secret scan, MCP server. **Gap:** the LLM planner only runs once an LLM is configured on the deployment; `/v2/trending` isn't used. |
| **Design** | **9** | 6 / 6 / 6 | A complete product, not a demo: live agent trace, strategy plus scorecard, crowd chart, genre radar, dated calendar cards with images and posters, gut-check widget, taste map, partners and rivals, pitches, `.ics` / brief / share / print exports, deep links. **Gap:** mobile pass and an accessibility audit (contrast is fine; keyboard focus not fully audited). |
| **Potential Impact** | **8.5** | 7 / 7 / 5 | A specific audience: independent music venues, bookshops, indie cinemas and bars with a stage, which have no data team and struggle to fill quiet weeknights. Every output is actionable that day (book this act, put flyers here, email this neighbour). **Gap:** no real venue testimonial; adding one quote would be strong. |
| **Quality of the Idea** | **9** | 7 / 7 / 5 | A non-obvious use of Qloo: the *venue* is the taste signal. It works **across formats** (a jazz club's crowd also over-indexes on specific films and podcasts), and the *gut check* turns Qloo into a decision tool ("salsa: 30th percentile, rethink"). Bridge nights solve the real "grow without losing regulars" problem. The **Generic-AI vs Encore** proof shows why Qloo matters. **Risk:** the name and pitch overlap with encore-qloo (see COMPLIANCE #3). |

## Gaps and what was done

| Gap found in the audit | Status |
|---|---|
| v1 was a single-shot "director" without an agent loop or tool use | ✅ Rebuilt as an agent loop with tools, tracer, critic and MCP |
| Qloo 429s under parallel calls | ✅ Token bucket at 7/s, concurrency 6, retries |
| Venue signal silently ignored for some entity types, which made gut checks score the 100th percentile and put ungrounded nights in the calendar | ✅ Fallback chain venue → signature artists → crowd tags; drops results without affinity |
| Heatmap payloads up to about 30 MB and slow | ✅ Smaller takes, 25 s budget, polygons dropped, run in parallel early |
| Partners included competitors | ✅ Split into partners vs rivals |
| Noisy London flyer zones (small estates) | ✅ Popularity ≥ 0.8 filter and name cleaning |
| No tests or CI | ✅ 26 tests and a secret scan. ⚠️ The CI workflow is written, but the push token lacks the `workflow` scope (user step) |
| No live public demo | ⚠️ Vercel deploy blocked on a team re-authorisation by the user |
| No LLM key | ⚠️ Vercel AI Gateway via OIDC on the deployment, or the user adds any OpenAI-compatible key. The rules planner is the fallback. |
| Name collision with *encore-qloo* | 🚩 Decision for the user |
| Duplicate-submission risk with Opener | 🚩 Decision for the user (COMPLIANCE #16) |
