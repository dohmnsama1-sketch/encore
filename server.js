'use strict';
// Local server: static UI from /public + the same API the Vercel deployment runs. Zero dependencies.
require('./src/env').loadEnv();
const http = require('http'); const fs = require('fs'); const path = require('path');
const { handle } = require('./src/app'); const llm = require('./src/llm');
const PORT = Number(process.env.PORT || 8790); const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) return handle(req, res);
  const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
  const f = path.normalize(path.join(PUB, rel));
  if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(f).pipe(res);
});
if (require.main === module) server.listen(PORT, () => console.log(`Encore on http://localhost:${PORT} (Qloo: ${process.env.QLOO_API_KEY ? 'live' : 'SAMPLE DATA'}; LLM: ${llm.enabled() ? llm.config().provider : 'off, rules planner'})`));
module.exports = { server };
