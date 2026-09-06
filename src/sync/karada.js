import { validKaradaRequest, validKaradaResponse, karadaTerminal, responseMatches } from "../core/karada-contract.js";
const REQUEST = "taskchute/requests/karada-request.json";
const RESPONSE = "taskchute/requests/karada-response.json";
const ALLOWED = [REQUEST, RESPONSE, "karada/import-status.json", "karada/health-daily.json"];
export function createKaradaTransport({ connection, headers, fetch: request = globalThis.fetch, now = () => new Date().toISOString(), makeId = () => crypto.randomUUID(), timeoutMs = 30000 }) {
  let previous = "", generation = 0;
  function session() {
    const conn = connection();
    // Credentials remain in this closure; only an opaque generation leaves the gateway.
    const key = conn ? JSON.stringify([conn.owner, conn.repo, conn.branch, conn.token]) : "";
    if (key !== previous) { previous = key; generation++; }
    return { conn, generation };
  }
  const identity = () => { const s = session(); return s.conn ? s.generation : null; };
  const current = s => session().generation === s.generation && Boolean(session().conn);
  async function bounded(operation) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([operation(controller.signal), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  function url(s, path) {
    if (!ALLOWED.includes(path)) throw new Error("Unsupported import path");
    const c = s.conn;
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`;
  }
  async function read(path, s = session()) {
    if (!s.conn) return { ok: false, reason: "not_connected" };
    try {
      return await bounded(async signal => {
      const rawHealth = path === "karada/health-daily.json";
      const res = await request(url(s, path), { signal, cache: "no-store", headers: { ...headers(s.conn.token), Accept: rawHealth ? "application/vnd.github.raw+json" : "application/vnd.github+json" } });
      if (!current(s)) return { ok: false, reason: "connection_changed" };
      if (res.status === 404) return { ok: true, missing: true };
      if (!res.ok) return { ok: false, reason: res.status === 401 || res.status === 403 ? "auth" : "network" };
      if (rawHealth) {
        const text = await res.text();
        if (!current(s)) return { ok: false, reason: "connection_changed" };
        return new TextEncoder().encode(text).length <= 4000000 ? { ok: true, text } : { ok: false, reason: "invalid_file" };
      }
      const body = await res.json();
      if (!current(s)) return { ok: false, reason: "connection_changed" };
      if (body.encoding !== "base64" || typeof body.content !== "string" || !/^[\da-f]{40,64}$/i.test(body.sha || "")) return { ok: false, reason: "invalid_file" };
      const bytes = Uint8Array.from(atob(body.content.replace(/\s/g, "")), c => c.charCodeAt(0));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (bytes.length > (path.endsWith("health-daily.json") ? 4000000 : 16384)) return { ok: false, reason: "invalid_file" };
      let data;
      try { data = JSON.parse(text); } catch { return { ok: true, sha: body.sha, invalid: true, text }; }
      return { ok: true, sha: body.sha, data, text };
      });
    } catch { return { ok: false, reason: "network" }; }
  }
  async function inspect() {
    const s = session();
    const [req, res] = await Promise.all([read(REQUEST, s), read(RESPONSE, s)]);
    if (!current(s)) return { ok: false, reason: "connection_changed" };
    if (!req.ok || !res.ok) return { ok: false, reason: req.reason || res.reason };
    if (!res.missing && !validKaradaResponse(res.data)) return { ok: false, reason: "invalid_response" };
    const response = res.data;
    const invalidResolved = response?.requestId === null && response?.status === "failed"
      && response?.reason === "invalid_request" && response?.requestSha === req.sha;
    if (!req.missing && !validKaradaRequest(req.data) && !invalidResolved) return { ok: false, reason: "invalid_request" };
    return { ok: true, request: !invalidResolved && validKaradaRequest(req.data) ? req.data : null, requestSha: req.sha,
      response, invalidResolved, session: s };
  }
  async function submit() {
    const before = await inspect();
    if (!before.ok) return before;
    if (before.request && !(responseMatches(before.response, before.request, before.requestSha) && karadaTerminal(before.response))) return { ...before, joined: true };
    const s = before.session;
    const payload = { schema: 1, requestId: makeId(), requestedAt: now() };
    if (!current(s)) return { ok: false, reason: "connection_changed" };
    try {
      return await bounded(async signal => {
      const res = await request(url(s, REQUEST), { signal, method: "PUT", headers: { ...headers(s.conn.token), Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Request health import", branch: s.conn.branch, content: btoa(JSON.stringify(payload)), ...(before.requestSha ? { sha: before.requestSha } : {}) }) });
      if (!current(s)) return { ok: false, reason: "connection_changed" };
      if (res.status === 409 || res.status === 422) {
        const winner = await inspect();
        return winner.ok && winner.request ? { ...winner, joined: true } : { ok: false, reason: "conflict" };
      }
      if (!res.ok) return { ok: false, reason: "send_failed" };
      const body = await res.json();
      if (!current(s)) return { ok: false, reason: "connection_changed" };
      if (!/^[\da-f]{40,64}$/i.test(body.content?.sha || "")) return { ok: false, reason: "send_uncertain" };
      return { ok: true, request: payload, requestSha: body.content.sha, joined: false };
      });
    } catch { return { ok: false, reason: "send_uncertain" }; }
  }
  return { identity, read, inspect, submit, invalidate() { generation++; previous = ""; } };
}
