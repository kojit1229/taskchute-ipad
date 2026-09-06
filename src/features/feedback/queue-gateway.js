// Independent request/queue orchestration. No application, credentials, or network implementation.
import { canonical, validateRequest } from './request-contract.js';
const PREFIX = 'taskchute/requests/feedback-regeneration/';
const LIMIT = 524288;
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const copy = value => structuredClone(value);
const retryable = new Set(['conflict', 'validation_failed', 'communication_timeout', 'communication_failed', 'upstream_unavailable']);
export class GatewayError extends Error {
  constructor(reason, stage) { super(reason); this.reason = reason; this.stage = stage; }
}
const fail = (reason, stage) => { throw new GatewayError(reason, stage); };

function validDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function identity(entry, stage) {
  if (!ownObject(entry) || !validDate(entry.date) || typeof entry.inputHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.inputHash)
      || entry.requestId !== `feedback-${entry.date}-${entry.inputHash}` || !integer(entry.attempt, 1)) fail('invalid_identity', stage);
}
function validStamp(value) {
  return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.(?:[0-9]{3}|[0-9]{6}))?Z$/.test(value)
    && validDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function queueValid(queue) {
  if (!ownObject(queue) || queue.schemaVersion !== 1 || !integer(queue.revision) || !Array.isArray(queue.entries)) fail('invalid_queue', 'queue');
  const ids = new Set(), sequences = new Set();
  for (const entry of queue.entries) {
    identity(entry, 'queue');
    if (!integer(entry.sequence, 1) || ids.has(entry.requestId) || sequences.has(entry.sequence)) fail('invalid_queue', 'queue');
    ids.add(entry.requestId); sequences.add(entry.sequence);
  }
  return queue;
}
function increment(value) {
  if (!integer(value) || value === Number.MAX_SAFE_INTEGER) fail('integer_overflow', 'queue');
  return value + 1;
}

export function createQueueGateway({ transport, crypto, today, confirmSavedInput } = {}) {
  if (!transport || !['get', 'put', 'connectionKey'].every(k => typeof transport[k] === 'function')
      || !crypto?.subtle?.digest || typeof today !== 'function' || typeof confirmSavedInput !== 'function') fail('configuration_required', 'input');
  const key = () => {
    let value;
    try { value = transport.connectionKey(); }
    catch { fail('configuration_required', 'input'); }
    if (typeof value !== 'string' || !value) fail('configuration_required', 'input');
    return value;
  };
  const bound = start => { if (key() !== start) fail('connection_changed', 'input'); };
  const encode = value => {
    let bytes;
    try { bytes = new TextEncoder().encode(JSON.stringify(value)); }
    catch { fail('invalid_json', 'input'); }
    if (bytes.byteLength > LIMIT) fail('payload_too_large', 'input');
    return bytes;
  };
  async function read(path, start, stage) {
    bound(start);
    let reply;
    try { reply = await transport.get(path, { fresh: true }); }
    catch { fail('read_unavailable', stage); }
    bound(start);
    if (reply?.status === 404) return { absent: true, sha: null };
    if (![200, 304].includes(reply?.status) || typeof reply.sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(reply.sha)
        || !(reply.bytes instanceof Uint8Array) || reply.bytes.byteLength > LIMIT) fail('invalid_response', stage);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes)); }
    catch { fail('invalid_json', stage); }
    return { value, sha: reply.sha, absent: false };
  }
  async function put(path, value, sha, start, stage) {
    const bytes = encode(value); bound(start);
    let result;
    try {
      result = await transport.put(path, bytes, { expectedSha: sha });
    } catch (error) {
      let reason;
      try { reason = error?.reason; } catch { /* Upstream fields are not trusted. */ }
      if (!retryable.has(reason)) fail('write_unavailable', stage);
      return;
    } finally { bound(start); }
    if (![200, 201].includes(result?.status)) {
      if ([409, 422, 500, 502, 503, 504].includes(result?.status)) return;
      fail('write_rejected', stage);
    }
  }
  async function validated(value, stage) {
    try { return await validateRequest(value, today(), crypto); }
    catch { fail('invalid_request', stage); }
  }
  async function requestRead(id, start) {
    if (typeof id !== 'string' || !/^feedback-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{64}$/.test(id)) fail('invalid_id', 'request');
    const file = await read(PREFIX + `requests/${id}.json`, start, 'request');
    if (file.absent) fail('request_missing', 'request');
    const request = await validated(file.value, 'request'); bound(start);
    if (request.requestId !== id) fail('request_path_mismatch', 'request');
    return request;
  }
  async function ensureRequest(request, start) {
    const path = PREFIX + `requests/${request.requestId}.json`;
    for (let count = 0; count <= 3; count++) {
      const file = await read(path, start, 'request');
      if (!file.absent) {
        const remote = await validated(file.value, 'request'); bound(start);
        if (remote.requestId !== request.requestId || canonical(remote.date, remote.snapshot) !== canonical(request.date, request.snapshot)) fail('immutable_conflict', 'request');
        return remote; // First writer owns requestedAt and audit metadata.
      }
      if (count === 3) fail('request_unconfirmed', 'request');
      await put(path, request, null, start, 'request');
    }
  }
  async function queueRead(start) {
    const file = await read(PREFIX + 'queue.json', start, 'queue');
    return { ...file, value: file.absent ? { schemaVersion: 1, revision: 0, entries: [] } : queueValid(file.value) };
  }
  async function failedProof(request, attempt, start) {
    const file = await read(PREFIX + `results/${request.requestId}/${attempt}.json`, start, 'retry');
    const result = file.value;
    if (file.absent) fail('failure_unconfirmed', 'retry');
    identity(result, 'retry');
    if (result.schemaVersion !== 1 || result.status !== 'failed' || result.attempt !== attempt
        || ['date', 'requestId', 'inputHash'].some(k => result[k] !== request[k])
        || typeof result.reason !== 'string' || !result.reason
        || !validStamp(result.startedAt) || !validStamp(result.updatedAt)) fail('failure_unconfirmed', 'retry');
  }
  async function updateQueue(request, start, failedAttempt = null) {
    const target = failedAttempt === null ? null : increment(failedAttempt);
    for (let count = 0; count <= 3; count++) {
      const file = await queueRead(start), queue = file.value;
      const entry = queue.entries.find(e => e.requestId === request.requestId);
      if (entry && ['date', 'inputHash'].some(k => entry[k] !== request[k])) fail('queue_identity_mismatch', 'queue');
      if (failedAttempt === null && entry) return copy(entry);
      if (failedAttempt !== null) {
        await failedProof(request, failedAttempt, start);
        if (!entry) fail('queue_entry_missing', 'retry');
        if (entry.attempt === target) return copy(entry);
        if (entry.attempt !== failedAttempt) fail('stale_attempt', 'retry');
      }
      if (count === 3) fail('queue_unconfirmed', 'queue');
      const next = copy(queue); next.revision = increment(queue.revision);
      if (failedAttempt !== null) next.entries.find(e => e.requestId === request.requestId).attempt = target;
      else {
        const sequence = increment(queue.entries.reduce((max, e) => Math.max(max, e.sequence), 0));
        next.entries.push({ requestId: request.requestId, date: request.date, inputHash: request.inputHash, sequence, attempt: 1 });
      }
      await put(PREFIX + 'queue.json', next, file.sha, start, 'queue');
    }
  }
  return {
    async readQueue() { return (await queueRead(key())).value; },
    async enqueue(input) {
      const start = key(), request = await validated(input, 'input'); bound(start);
      let receipt;
      try { receipt = await confirmSavedInput(copy(request)); }
      catch { fail('saved_input_unconfirmed', 'input'); }
      bound(start);
      if (!ownObject(receipt) || receipt.date !== request.date || receipt.inputHash !== request.inputHash) fail('saved_input_unconfirmed', 'input');
      const stored = await ensureRequest(request, start);
      const entry = await updateQueue(stored, start);
      return { stage: 'queue_confirmed', request: copy(stored), entry };
    },
    async retry(id, failedAttempt) {
      if (!integer(failedAttempt, 1)) fail('invalid_attempt', 'retry');
      const start = key(), request = await requestRead(id, start);
      const entry = await updateQueue(request, start, failedAttempt);
      return { stage: 'queue_confirmed', request: copy(request), entry };
    },
  };
}
