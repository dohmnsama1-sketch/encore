'use strict';
// Vercel Function entry: every /api/* request is rewritten here (see vercel.json). Static UI is served from /public.
const { handle } = require('../src/app');
module.exports = (req, res) => handle(req, res);
