const assert = require('node:assert/strict');
const { buildReadingView } = require('../src/features/daily-reading.js');
const request = { kind: 'feedback', date: '2026-09-12', referenceDate: '2026-09-11' };
assert.equal(buildReadingView(request, { ok: true, text: 'fixture' }, s => `<p>${s}</p>`).html, '<p>fixture</p>');
for (const result of [{ ok: false, status: 401 }, { ok: false, status: 404 }, { ok: true, text: '  ' }])
  assert.throws(() => buildReadingView(request, result, s => s));
console.log('PASS reading view requires successful, nonempty content');
