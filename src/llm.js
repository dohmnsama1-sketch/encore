'use strict';
// Optional LLM layer (OpenAI-compatible chat completions with tool calling).
// Providers, in order: AI_BASE_URL + AI_API_KEY (any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, Gemini, Ollama),
// AI_GATEWAY_API_KEY (Vercel AI Gateway), or the Vercel OIDC token that Vercel injects at runtime (AI Gateway, no secret to manage).
// Marquee never depends on the LLM: every caller has a deterministic fallback.

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';

function config(env = process.env, oidc) {
  if (env.AI_BASE_URL && env.AI_API_KEY) return { base: env.AI_BASE_URL.replace(/\/$/, ''), key: env.AI_API_KEY, model: env.AI_MODEL || 'gpt-4.1-mini', provider: 'custom' };
  if (env.AI_GATEWAY_API_KEY) return { base: GATEWAY, key: env.AI_GATEWAY_API_KEY, model: env.AI_MODEL || 'openai/gpt-4.1-mini', provider: 'vercel-ai-gateway' };
  const tok = oidc || env.VERCEL_OIDC_TOKEN;
  if (tok && env.AI_DISABLE !== '1') return { base: GATEWAY, key: tok, model: env.AI_MODEL || 'openai/gpt-4.1-mini', provider: 'vercel-ai-gateway (oidc)' };
  return null;
}
// Circuit breaker: an auth/billing failure (401/402/403) means the provider is misconfigured, not busy.
// Stop calling it for 15 minutes so every request falls straight through to the rules planner.
const breaker = { until: 0, reason: '' };
const enabled = (env = process.env, oidc) => !!config(env, oidc) && Date.now() >= breaker.until;
function status(env = process.env, oidc) { const c = config(env, oidc); if (!c) return null; return { provider: c.provider, model: c.model, available: Date.now() >= breaker.until, ...(breaker.reason && Date.now() < breaker.until ? { note: breaker.reason } : {}) }; }

async function chat({ messages, tools, json = false, temperature = 0.3, maxTokens = 1800, timeoutMs = 30000 }, env = process.env, oidc) {
  const c = config(env, oidc); if (!c) return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { model: c.model, temperature, max_tokens: maxTokens, messages };
    if (tools && tools.length) { body.tools = tools.map(s => ({ type: 'function', function: s })); body.tool_choice = 'auto'; body.parallel_tool_calls = true; }
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch(`${c.base}/chat/completions`, { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` }, body: JSON.stringify(body) });
    if (!r.ok) { const txt = await r.text().catch(() => ''); const e = new Error(`LLM ${r.status}: ${txt.slice(0, 160)}`); e.status = r.status;
      if ([401, 402, 403].includes(r.status)) { breaker.until = Date.now() + 15 * 60e3; breaker.reason = `LLM provider refused (${r.status}); using the rules planner`; e.llmUnavailable = true; }
      throw e; }
    const j = await r.json(); return j.choices && j.choices[0] && j.choices[0].message;
  } finally { clearTimeout(t); }
}

function parseJSON(text) {
  if (!text) return null; const s = String(text); const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function chatJSON(system, user, env, oidc, opts = {}) {
  const m = await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], json: true, ...opts }, env, oidc);
  return m ? parseJSON(m.content) : null;
}

module.exports = { chat, chatJSON, parseJSON, enabled, config, status, breaker };
