// Python feedback-worker/contract.py compatibility. No state, IO, UI, or transport.
const versionOne = value => value === 1;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = reason => { throw new Error(reason); };
const normalize = value => value.replace(/\r\n/g, '\n');
const pythonBlank = value => /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u.test(value);

function utf8(text) {
  if (typeof text !== 'string') fail('invalid_text');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid_utf8');
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('invalid_utf8');
  }
  return new TextEncoder().encode(text);
}

export function canonical(date, snapshot) {
  return JSON.stringify({ date, reportFormatVersion: 1,
    reportMarkdown: normalize(snapshot.reportMarkdown), journalText: normalize(snapshot.journalText) });
}

function canonicalBytes(date, snapshot) {
  // JSON.stringify escapes lone surrogates; Python ensure_ascii=False UTF8 rejects them.
  utf8(date); utf8(snapshot.reportMarkdown); utf8(snapshot.journalText);
  return utf8(canonical(date, snapshot));
}

export async function digest(text, crypto = globalThis.crypto) {
  if (!crypto?.subtle?.digest) fail('crypto_required');
  const bytes = await crypto.subtle.digest('SHA-256', utf8(text));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

export async function makeRequest(date, report, journal, requestedAt, crypto = globalThis.crypto) {
  const snapshot = { reportMarkdown: report, journalText: journal, journalTextUpdatedAt: requestedAt, reportFormatVersion: 1 };
  canonicalBytes(date, snapshot);
  const inputHash = await digest(canonical(date, snapshot), crypto);
  return { schemaVersion: 1, kind: 'feedback-regeneration', date,
    requestId: `feedback-${date}-${inputHash}`, inputHash, requestedAt, snapshot };
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export async function validateRequest(request, today, crypto = globalThis.crypto) {
  // Return this detached input, never the caller-owned object that can change during digest.
  try { request = structuredClone(request); }
  catch { fail('invalid_request'); }
  if (!object(request) || !versionOne(request.schemaVersion)) fail('invalid_schema');
  const date = request.date;
  if (!validDate(date)) fail('invalid_date');
  if (!validDate(today)) fail('invalid_today');
  if (date > today) fail('future_date');
  if (request.kind !== 'feedback-regeneration') fail('invalid_kind');
  const snapshot = request.snapshot;
  if (!object(snapshot) || !versionOne(snapshot.reportFormatVersion)) fail('invalid_snapshot');
  for (const key of ['reportMarkdown', 'journalText', 'journalTextUpdatedAt']) {
    if (typeof snapshot[key] !== 'string') fail('invalid_snapshot_field');
  }
  if (pythonBlank(snapshot.reportMarkdown)) fail('empty_report');
  if (canonicalBytes(date, snapshot).byteLength > 524288) fail('snapshot_too_large');
  const stamp = request.requestedAt;
  // Current canonical Python 3.10 fromisoformat accepts fractional seconds of 3 or 6 digits.
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(?:\d{3}|\d{6}))?Z$/.test(stamp)
      || !validDate(stamp.slice(0, 10)) || Number(stamp.slice(11, 13)) > 23
      || Number(stamp.slice(14, 16)) > 59 || Number(stamp.slice(17, 19)) > 59) fail('invalid_requested_at');
  const expected = await digest(canonical(date, snapshot), crypto);
  if (request.inputHash !== expected) fail('input_hash_mismatch');
  if (request.requestId !== `feedback-${date}-${expected}`) fail('request_id_mismatch');
  return request;
}
