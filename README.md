# Encore: the AI programming director for independent venues

**Know what your crowd loves. Fill every night.**

Independent bars, cafés, bookshops and small music rooms live or die by their event calendar. Owners guess at it, and generic LLMs guess too. They suggest "trivia night" and "open mic" to everyone. Encore *knows*. It reads the cultural taste of the people who already love your venue from **Qloo's taste graph** and turns it into a month of events your regulars over-index on, plus partner pitches to the brands and neighbours that share your crowd.

## New in v1.1
- Programme scorecard (crowd fit, Hidden gems, formats, repeats), computed only from Qloo affinity/popularity
- Taste twins worldwide (place insights with no location filter)
- Crowd personas from taste tags
- One-click SVG poster per night

## What the agent does
1. **Find the venue.** `GET /search` (type `urn:entity:place`) resolves the real venue entity.
2. **Read the crowd's taste DNA.** `GET /v2/insights` (taste tags) is signalled by the venue entity.
3. **Plan the lanes.** An LLM planner (or a rules fallback) picks which domains to explore for the owner's goal: live music, screenings, talks and podcasts, book club, watch parties, game nights, brand collabs, neighbour partners.
4. **Query the taste graph per lane, in parallel.** `GET /v2/insights` with `filter.type=urn:entity:{artist|movie|podcast|book|tv_show|video_game|brand}`, `signal.interests.entities=<venue>`, `signal.location.query=<city>` and `feature.explainability=true`. Partners use `filter.type=urn:entity:place` plus `filter.location.query` and exclude the venue itself.
5. **Compose.** A non-repeating 2-nights-a-week calendar, each night anchored on an entity with its **affinity score as the "why"**. Plus promo copy (LLM) and ready-to-send pitches to the top-affinity brand and the top-affinity neighbouring place.
6. **Export.** A one-click `.ics` calendar, and shareable links (`/?venue=…&city=…&goal=…`).
7. **Generic AI vs Encore.** With an LLM configured, the same venue is planned "blind" side by side, so you can see what Qloo adds.

It's also an **agentic tool**: `node src/mcp.js` exposes `encore_plan_month` over MCP for any agent (Claude, Cursor and others).

## Run
```bash
cp .env.example .env    # set QLOO_API_KEY (hackathon key) and optionally an OpenAI-compatible LLM
node server.js          # Node 18+, zero dependencies → http://localhost:8790
npm test
```
Without a key, Encore runs on **fictional sample data**, which is clearly labelled in the UI so the interface can be previewed. The hosted demo uses the live Qloo hackathon API.

Qloo responses are cached **privately in server memory only**. No Qloo data is stored in this repo, as the hackathon terms require.

## Stack
Zero-dependency Node HTTP server · Qloo Insights and Search APIs (hackathon environment, `X-Api-Key`) · optional OpenAI-compatible LLM (Gemini, Groq, OpenRouter, Ollama) · vanilla JS UI · MCP stdio server · `render.yaml` for one-click deploy.

## License
MIT
