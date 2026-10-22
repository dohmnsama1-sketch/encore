#!/usr/bin/env node
'use strict';
// MCP stdio transport: `npx encore-mcp` or `node bin/encore-mcp.js`, with QLOO_API_KEY in the environment.
require('../src/env').loadEnv();
const { handle } = require('../src/mcp'); const { makeQloo } = require('../src/app');
const deps = { qloo: makeQloo(), env: process.env };
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    handle(msg, deps).then(res => { if (res) process.stdout.write(JSON.stringify(res) + '\n'); });
  }
});
