// Optional OpenAI-compatible LLM. Returns null when not configured so callers fall back.
async function chatJSON(system, user, env = process.env) {
  if (!(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL)) return null;
  const r = await fetch(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
    body: JSON.stringify({ model: env.AI_MODEL, temperature: 0.4, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  if (!r.ok) throw new Error(`LLM ${r.status}`);
  const t = (await r.json()).choices[0].message.content;
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}
module.exports = { chatJSON, enabled: (env = process.env) => !!(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) };
