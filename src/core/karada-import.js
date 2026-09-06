import { validKaradaResponse, responseMatches, utcTime } from "./karada-contract.js";

export function createKaradaImport({ transport, forceHealthData, notify = () => {}, refresh = () => {}, now = Date.now }) {
  let identity, generation = 0, busy = false;
  let state = { phase: "idle" };
  function syncIdentity() {
    const next = transport.identity();
    if (next !== identity) {
      identity = next; generation++; busy = false;
      state = { phase: next === null ? "disconnected" : "idle" };
    }
    return identity;
  }
  const current = g => { syncIdentity(); return generation === g; };
  function update(value, g) {
    if (!current(g)) return;
    state = { ...state, ...value }; notify();
  }
  async function rememberedMetadata(g) {
    const result = await transport.read("karada/import-status.json");
    if (result.ok && validKaradaResponse(result.data, true)) {
      update({ lastSuccessfulAt: result.data.lastSuccessfulAt || state.lastSuccessfulAt,
        dataThrough: result.data.dataThrough || state.dataThrough }, g);
    }
  }
  async function finish(response, g) {
    if (response.status === "failed") { await rememberedMetadata(g); update({ phase: "failed" }, g); return; }
    if (response.status === "no_data" && response.healthSha256 === null) {
      await rememberedMetadata(g);
      update({ phase: "no_data", lastSuccessfulAt: response.lastSuccessfulAt || state.lastSuccessfulAt,
        dataThrough: response.dataThrough || state.dataThrough }, g);
      return;
    }
    update({ phase: "refreshing" }, g);
    const metadata = await transport.read("karada/import-status.json");
    if (!current(g)) return;
    if (!metadata.ok || metadata.invalid || !metadata.missing && !validKaradaResponse(metadata.data, true)) {
      update({ phase: "update_failed" }, g); return;
    }
    const newer = !metadata.missing && utcTime(metadata.data.updatedAt) >= utcTime(response.updatedAt);
    const adopted = newer && metadata.data.healthSha256 ? metadata.data : response;
    // A newer publication is authoritative: do not accept the older response hash.
    const result = await forceHealthData([adopted.healthSha256]);
    if (!current(g)) return;
    if (!result.ok) { update({ phase: "update_failed" }, g); return; }
    update({ phase: response.status, lastSuccessfulAt: adopted.lastSuccessfulAt || state.lastSuccessfulAt,
      dataThrough: adopted.dataThrough || state.dataThrough }, g);
    refresh();
  }
  async function adopt(result, g) {
    if (!current(g)) return;
    if (!result.ok) { update({ phase: "read_failed" }, g); return; }
    if (!result.request) {
      await rememberedMetadata(g);
      update({ phase: result.invalidResolved ? "failed" : "idle" }, g); return;
    }
    update({ request: result.request, requestSha: result.requestSha, phase: "waiting" }, g);
    if (!responseMatches(result.response, result.request, result.requestSha)) return;
    if (result.response.status === "processing") update({ phase: "processing" }, g);
    else await finish(result.response, g);
  }
  async function run(send = false) {
    if (syncIdentity() === null || busy) return;
    busy = true;
    const g = generation;
    update({ phase: send ? "sending" : state.phase === "idle" ? "checking" : state.phase }, g);
    try { await adopt(await (send ? transport.submit() : transport.inspect()), g); }
    catch { update({ phase: "read_failed" }, g); }
    finally { if (current(g)) { busy = false; notify(); } }
  }
  function snapshot() {
    syncIdentity();
    return { ...state, busy, waited: state.request ? now() - utcTime(state.request.requestedAt) : 0 };
  }
  return { snapshot, restore: () => run(), submit: () => run(true) };
}
