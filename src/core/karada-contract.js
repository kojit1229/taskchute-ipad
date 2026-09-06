const uuid = value => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(value);
const sha = value => typeof value === "string" && /^[\da-f]{40,64}$/.test(value);
export function utcTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value || "");
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, Number((m[7] || "").padEnd(3, "0"))));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    && h < 24 && mi < 60 && s < 60 ? t.getTime() : NaN;
}
export function validKaradaRequest(value) {
  return value?.schema === 1 && uuid(value.requestId) && Number.isFinite(utcTime(value.requestedAt))
    && Object.keys(value).sort().join() === "requestId,requestedAt,schema";
}
export function validKaradaResponse(value, metadata = false) {
  if (value?.schema !== 1 || !["processing", "success", "no_data", "failed"].includes(value.status)
    || !Number.isFinite(utcTime(value.updatedAt))) return false;
  if (metadata && value.status === "processing") return false;
  if (!metadata && !(uuid(value.requestId) || value.requestId === null && value.status === "failed"
    && value.reason === "invalid_request" && sha(value.requestSha))) return false;
  if (!metadata && !sha(value.requestSha)) return false;
  if (!(value.lastSuccessfulAt === null || Number.isFinite(utcTime(value.lastSuccessfulAt)))) return false;
  if (!(value.dataThrough === null || /^\d{4}-\d{2}-\d{2}$/.test(value.dataThrough)
    && Number.isFinite(utcTime(`${value.dataThrough}T00:00:00Z`)))) return false;
  if (!(value.healthSha256 === null || /^[\da-f]{64}$/.test(value.healthSha256))) return false;
  const present = [value.healthSha256, value.dataThrough, value.lastSuccessfulAt].filter(Boolean).length;
  if (value.status === "success" && present !== 3 || value.status === "no_data" && present !== 0 && present !== 3) return false;
  return value.reason === null || typeof value.reason === "string" && value.reason.length <= 120;
}
export const karadaTerminal = value => ["success", "no_data", "failed"].includes(value?.status);
export const responseMatches = (response, request, requestSha) => response?.requestId === request?.requestId
  && response?.requestSha === requestSha;
