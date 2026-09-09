// Logical save order only; callers inject clocks and the records being changed.
const STAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const CANDIDATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function isEmptyStamp(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function parseStamp(value) {
  if (isEmptyStamp(value)) return null;
  const match = typeof value === "string" && [10, 16, 19].includes(value.length) && CANDIDATE_PATTERN.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1).map(value => Number(value ?? 0));
  // Numeric UTC setters are calendar arithmetic, not conversion of a local clock.
  // setUTCFullYear also preserves years 0000-0099 without the Date 1900 offset.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    return null;
  }
  return date.getTime();
}

function formatStamp(milliseconds) {
  const date = new Date(0);
  date.setTime(milliseconds);
  const year = date.getUTCFullYear();
  if (year > 9999) throw new TypeError("Mutation stamp exceeds the four-digit year format");
  const pad = value => String(value).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * Advance max(now, candidates) by one second, with no future-clock cutoff.
 * The real clock requires valid seconds; candidates also accept minutes or dates.
 * Invalid candidate values are ignored so damaged legacy stamps cannot block saves.
 */
export function nextMutationStamp({ now, candidates = [] }) {
  const values = isEmptyStamp(candidates) ? [] : candidates;
  if (!Array.isArray(values)) throw new TypeError("Mutation stamp candidates must be an array");

  if (typeof now !== "string" || now.length !== 19 || !STAMP_PATTERN.test(now))
    throw new TypeError("Mutation stamp must use YYYY-MM-DDTHH:mm:ss");
  let maximum = parseStamp(now);
  if (maximum === null) throw new TypeError("Mutation stamp requires a real clock");
  for (const value of values) {
    const parsed = parseStamp(value);
    if (parsed !== null && parsed > maximum) maximum = parsed;
  }
  return formatStamp(maximum + 1000);
}

// Preserve nested references and all other fields; the caller owns the original.
export function stamped(record, stamp) {
  return { ...record, updatedAt: stamp };
}
