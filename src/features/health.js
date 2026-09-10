// v314: personal-dataの健康日次を閲覧専用で取得する。キャッシュはstateへ混ぜず、このモジュール内だけに保持する。
// v334修正(単位13・S-K2): karada/health-daily.jsonはpersonal-dataリポジトリ直下(taskchute/配下
// ではない)にあるため、taskchute/前置なしのfetchGitHubRawTextAtRootを使う(旧fetchGitHubRawTextでは
// 実要求URLがtaskchute/karada/health-daily.jsonとなり404を無音で握りつぶしていた)。
let personalDataReady, fetchGitHubRawTextAtRoot, escapeHTML, addDays, conditionThresholds, todayISO;
// v325: 6時間キャッシュ中でも日を跨いだら当日データを取り直せるよう、取得日を別に保持する。
let connectionIdentity, fetchHealthText, cacheIdentity, requestGeneration = 0;
let healthCache = { fetchedAt: 0, fetchedFor: "", data: undefined };

const HEALTH_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEALTH_CACHE_DAYS = 60;

function configureHealth(deps) {
  ({ personalDataReady, fetchGitHubRawTextAtRoot, escapeHTML, addDays, conditionThresholds, todayISO, connectionIdentity, fetchHealthText } = deps);
}

function validForcedHealthData(value) {
  const ranges = { sleep_min: [0, 1440], steps: [0, Infinity], resting_hr: [20, 150],
    hrv_sdnn: [0, Infinity], active_kcal: [0, Infinity], exercise_min: [0, 1440],
    weight_kg: [20, 300], body_fat_pct: [1, 75] };
  return value !== null && typeof value === "object" && value.schema === 1
    && Array.isArray(value.days)
    && value.days.every((day, index) => day !== null && typeof day === "object" && typeof day.date === "string"
      && (!index || value.days[index - 1].date < day.date)
      && Object.entries(ranges).every(([key, [min, max]]) => day[key] == null
        || typeof day[key] === "number" && Number.isFinite(day[key]) && day[key] >= min && day[key] <= max
          && (key !== "steps" || Number.isInteger(day[key])))
      && ["bed_time", "wake_time"].every(key => day[key] == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(day[key]))
      && (day.sleep_source == null || typeof day.sleep_source === "string"));
}
function validHealthData(value) {
  return value !== null && typeof value === "object" && value.schema === 1 && Array.isArray(value.days)
    && value.days.every(day => day !== null && typeof day === "object" && typeof day.date === "string");
}

function currentHealthIdentity() {
  const identity = connectionIdentity ? connectionIdentity() : (typeof personalDataReady === "function" && personalDataReady() ? "legacy" : null);
  if (identity !== cacheIdentity) {
    cacheIdentity = identity;
    requestGeneration++;
    healthCache = { fetchedAt: 0, fetchedFor: "", data: undefined };
  }
  return identity;
}

async function fetchHealthData({ force = false, refreshIntervalMs = HEALTH_REFRESH_INTERVAL_MS, expectedHashes } = {}) {
  const identity = currentHealthIdentity();
  if (identity === null || !personalDataReady()) return { ok: false, reason: "not_connected" };
  const fetchedFor = todayISO();
  if (!force && healthCache.fetchedFor === fetchedFor && Date.now() - healthCache.fetchedAt < refreshIntervalMs)
    return { ok: true, changed: false, skipped: true };
  const generation = ++requestGeneration;
  const current = () => currentHealthIdentity() === identity && requestGeneration === generation;
  try {
    const result = fetchHealthText ? await fetchHealthText() : { ok: true, text: await fetchGitHubRawTextAtRoot("karada/health-daily.json") };
    if (!current()) return { ok: false, reason: "superseded" };
    if (!result.ok || result.missing) return { ok: false, reason: result.reason || "missing" };
    const parsed = JSON.parse(result.text);
    if (!validHealthData(parsed) || force && (!validForcedHealthData(parsed) || !parsed.days.length
      || parsed.days.some(row => !Number.isFinite(localDateMs(row.date)))))
      return { ok: false, reason: "invalid_health" };
    let sha256;
    if (expectedHashes) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.text));
      sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
      if (!current()) return { ok: false, reason: "superseded" };
      if (!expectedHashes.includes(sha256)) return { ok: false, reason: "hash_mismatch" };
    }
    const next = { ...parsed, days: parsed.days.slice(-HEALTH_CACHE_DAYS) };
    const changed = JSON.stringify(healthCache.data) !== JSON.stringify(next);
    healthCache = { fetchedAt: Date.now(), fetchedFor, data: next };
    return { ok: true, changed, sha256, generatedAt: parsed.generated_at, dataThrough: next.days.at(-1)?.date };
  } catch { return { ok: false, reason: current() ? "invalid_health" : "superseded" }; }
}

async function hydrateHealthData(refreshIntervalMs) {
  return (await fetchHealthData({ refreshIntervalMs })).changed === true;
}
function forceHealthData(expectedHashes) {
  return fetchHealthData({ force: true, expectedHashes });
}

function invalidateHealthCache() {
  healthCache.fetchedAt = 0;
}

function localDateMs(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return NaN;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : NaN;
}

function latestHealthWithin(todayIso, maxAgeDays = 7) {
  currentHealthIdentity();
  const todayMs = localDateMs(todayIso);
  if (!Number.isFinite(todayMs)) return null;
  const days = healthCache.data?.days;
  if (!Array.isArray(days)) return null;
  for (let index = days.length - 1; index >= 0; index--) {
    const row = days[index];
    if (row.date > todayIso) continue;
    const rowMs = localDateMs(row.date);
    const ageDays = (todayMs - rowMs) / 86400000;
    if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= maxAgeDays) return row;
  }
  return null;
}

function healthForDate(iso) {
  currentHealthIdentity();
  const days = healthCache.data?.days;
  return Array.isArray(days) ? days.find((row) => row.date === iso) || null : null;
}

function healthMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function healthNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sleepText(minutes) {
  return Number.isFinite(minutes)
    ? `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, "0")}m` : "—";
}

function conditionFromHealth(days, todayIso) {
  const row = Array.isArray(days) ? days.find((day) => day?.date === todayIso) : null;
  const empty = {
    level: "unknown", sleepMin: null, bedTime: null, wakeTime: null, restingHr: null, hrv: null,
    ySteps: null, yExerciseMin: null, yActiveKcal: null, stepsAvg7: null, reasons: []
  };
  if (!row) return empty;
  const thresholds = conditionThresholds();
  const yesterday = addDays(todayIso, -1);
  const yesterdayRow = days.find((day) => day?.date === yesterday) || {};
  const baselineFrom = addDays(todayIso, -thresholds.baselineLookbackDays);
  const baselineRows = days.filter((day) => day?.date >= baselineFrom && day.date < todayIso);
  const baseline = (key) => {
    const values = baselineRows.map((day) => healthNumber(day[key])).filter((value) => value !== null);
    return values.length >= thresholds.baselineMinSamples ? healthMedian(values) : null;
  };
  const sleepMin = healthNumber(row.sleep_min);
  const restingHr = healthNumber(row.resting_hr);
  const hrv = healthNumber(row.hrv_sdnn);
  const factors = [];
  if (sleepMin !== null) {
    if (sleepMin < thresholds.sleepDeficitH * 60) factors.push({ level: "deficit", text: `睡眠 ${sleepText(sleepMin)}` });
    else if (sleepMin < thresholds.sleepLowH * 60) factors.push({ level: "low", text: `睡眠 ${sleepText(sleepMin)}` });
  }
  const hrvBaseline = baseline("hrv_sdnn");
  if (hrvBaseline > 0 && hrv !== null) {
    const pct = (hrv - hrvBaseline) / hrvBaseline * 100;
    if (pct <= thresholds.hrvDeficitPct) factors.push({ level: "deficit", text: `HRV ${Math.round(pct)}%`.replace("-", "−") });
    else if (pct <= thresholds.hrvLowPct) factors.push({ level: "low", text: `HRV ${Math.round(pct)}%`.replace("-", "−") });
  }
  const hrBaseline = baseline("resting_hr");
  if (hrBaseline !== null && restingHr !== null) {
    const diff = restingHr - hrBaseline;
    if (diff >= thresholds.hrDeficitBpm) factors.push({ level: "deficit", text: `HR +${Math.round(diff)}bpm` });
    else if (diff >= thresholds.hrLowBpm) factors.push({ level: "low", text: `HR +${Math.round(diff)}bpm` });
  }
  const stepFrom = addDays(todayIso, -7);
  const stepValues = days.filter((day) => day?.date >= stepFrom && day.date < todayIso)
    .map((day) => healthNumber(day.steps)).filter((value) => value !== null);
  const reasons = [...factors.filter((factor) => factor.level === "deficit"), ...factors.filter((factor) => factor.level === "low")]
    .map((factor) => factor.text);
  return {
    level: factors.some((factor) => factor.level === "deficit") ? "deficit" : factors.length ? "low" : "normal",
    sleepMin, bedTime: typeof row.bed_time === "string" ? row.bed_time : null,
    wakeTime: typeof row.wake_time === "string" ? row.wake_time : null, restingHr, hrv,
    ySteps: healthNumber(yesterdayRow.steps), yExerciseMin: healthNumber(yesterdayRow.exercise_min),
    yActiveKcal: healthNumber(yesterdayRow.active_kcal),
    stepsAvg7: stepValues.length ? stepValues.reduce((sum, value) => sum + value, 0) / stepValues.length : null,
    reasons
  };
}

function conditionFromCachedHealth(todayIso) {
  currentHealthIdentity();
  const days = personalDataReady() ? healthCache.data?.days : null;
  return conditionFromHealth(Array.isArray(days) ? days : [], todayIso);
}

function cachedHealthData() {
  currentHealthIdentity();
  return typeof personalDataReady === "function" && personalDataReady() ? healthCache.data : undefined;
}

function formatHealthReason(reason) {
  return String(reason).replace(/^HRV /, "心拍変動 ").replace(/^HR /, "安静時心拍数 ")
    .replace(/bpm\b/g, "拍/分").replace(/(\d+)h(\d+)m/g, "$1時間$2分");
}

function conditionCommentText(cond) {
  if (cond?.level === "unknown") return "今朝の睡眠データはまだありません";
  const steps = healthNumber(cond?.ySteps);
  const average = healthNumber(cond?.stepsAvg7);
  const gymKg = healthNumber(cond?.yGymKg);
  const gym = gymKg > 0 ? `・筋トレ ${gymKg.toLocaleString("ja-JP")}kg` : "";
  let activity = "";
  if (steps !== null && average > 0 && steps >= average * 1.3) {
    activity = `昨日は歩数 ${steps.toLocaleString("ja-JP")}${gym} と活動量が多め ─ `;
  } else if (steps !== null && average > 0 && steps <= average * 0.7) {
    activity = `昨日の活動は控えめ(歩数 ${steps.toLocaleString("ja-JP")}${gym}) ─ `;
  }
  const hasSleep = Number.isFinite(cond?.sleepMin);
  const sleep = formatHealthReason(sleepText(cond?.sleepMin));
  const reasonSentence = (reason) => `${formatHealthReason(reason)} ${reason.startsWith("HRV ") ? "が低めです。" : reason.startsWith("HR ") ? "が高めです。" : "と短めです。"}`;
  if (cond.level === "deficit") {
    return `${reasonSentence(cond.reasons?.[0] || "体調データ")}${activity}今日は重要なこと1つに絞り、午後に15分の休憩を入れましょう`;
  }
  if (cond.level === "low") return `${hasSleep ? `睡眠 ${sleep}。` : reasonSentence(cond.reasons?.[0] || "体調データ")}${activity}今日は詰め込まず最も大切なことを優先しましょう`;
  return `${hasSleep ? `睡眠 ${sleep} で十分。` : "今朝の睡眠データは未取得。"}${activity}今日は集中の山を1つ作る日に`;
}

function healthSummaryHTML(todayIso, exact = false) {
  const row = personalDataReady() ? (exact ? healthForDate(todayIso) : latestHealthWithin(todayIso)) : null;
  if (!row) return `<div class="bm-health"><div class="bm-health-src">${escapeHTML("健康データ 未取得")}</div></div>`;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const value = (item) => finite(item) ? item.toLocaleString("ja-JP") : "—";
  const sleep = finite(row.sleep_min)
    ? `${Math.floor(row.sleep_min / 60)}時間${String(row.sleep_min % 60).padStart(2, "0")}分` : "—";
  const bed = typeof row.bed_time === "string" ? row.bed_time : "—";
  const wake = typeof row.wake_time === "string" ? row.wake_time : "—";
  const ageDays = (localDateMs(todayIso) - localDateMs(row.date)) / 86400000;
  const source = `Apple Health経由 · ${row.date.slice(5)}時点${ageDays >= 2 ? " (古い)" : ""}`;
  const summary = `💤 睡眠 ${sleep}(${bed}→${wake})・安静時心拍数 ${value(row.resting_hr)}拍/分・心拍変動 ${value(row.hrv_sdnn)}ミリ秒・歩数 ${value(row.steps)}歩・体重 ${value(row.weight_kg)}kg`;
  return `<div class="bm-health"><div>${escapeHTML(summary)}</div><div class="bm-health-src">${escapeHTML(source)}</div></div>`;
}

export {
  HEALTH_REFRESH_INTERVAL_MS, configureHealth, hydrateHealthData, invalidateHealthCache, forceHealthData,
  latestHealthWithin, healthForDate, healthSummaryHTML,
  cachedHealthData, conditionFromHealth, conditionFromCachedHealth, conditionCommentText
};
