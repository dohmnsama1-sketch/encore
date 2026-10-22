#!/usr/bin/env node
'use strict';
// Fails if anything that looks like a secret or cached Qloo data is tracked in the repo.
const { execSync } = require('child_process'); const fs = require('fs');
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const bad = [];
for (const f of files) {
  if (/(^|\/)\.env$|\.pem$|(^|\/)cache\//.test(f)) bad.push(`${f}: file should never be committed`);
  if (!fs.existsSync(f) || fs.statSync(f).size > 2e6 || /\.(png|jpe?g|gif|mp4|ico|woff2?)$/i.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (/QLOO_API_KEY\s*=\s*['"]?[A-Za-z0-9_\-]{16,}/.test(s)) bad.push(`${f}: hard-coded QLOO_API_KEY`);
  if (/\b(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(s)) bad.push(`${f}: looks like an API token`);
}
if (bad.length) { console.error('Secret check failed:\n' + bad.join('\n')); process.exit(1); }
console.log(`Secret check passed (${files.length} tracked files).`);
