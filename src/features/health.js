// v314: personal-dataの健康日次を閲覧専用で取得する。キャッシュはstateへ混ぜず、このモジュール内だけに保持する。
let personalDataReady, fetchGitHubRawText, escapeHTML;
let healthCache = { fetchedAt: 0, data: undefined };

const HEALTH_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEALTH_CACHE_DAYS = 60;

function configureHealth(deps) {
  ({ personalDataReady, fetchGitHubRawText, escapeHTML } = deps);
}

function validHealthData(value) {
  return value !== null && typeof value === "object" && value.schema === 1
    && Array.isArray(value.days)
    && value.days.every((day) => day !== null && typeof day === "object" && typeof day.date === "string");
}

async function hydrateHealthData(refreshIntervalMs) {
  if (!personalDataReady()) return false;
  if (Date.now() - healthCache.fetchedAt < refreshIntervalMs) return false;
  let next;
  try {
    const raw = await fetchGitHubRawText("karada/health-daily.json");
    const parsed = raw ? JSON.parse(raw) : null;
    if (validHealthData(parsed)) next = { ...parsed, days: parsed.days.slice(-HEALTH_CACHE_DAYS) };
  } catch (_) {
    // 壊れたJSON・取得失敗は前回正常データを維持し、次の定期更新へ任せる。
  }
  const previous = healthCache.data;
  healthCache.fetchedAt = Date.now();
  if (!next) return false;
  healthCache.data = next;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

function localDateMs(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return NaN;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : NaN;
}

function latestHealthWithin(todayIso, maxAgeDays = 7) {
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

function healthSummaryHTML(todayIso) {
  const row = personalDataReady() ? latestHealthWithin(todayIso) : null;
  if (!row) return `<div class="bm-health"><div class="bm-health-src">${escapeHTML("健康データ 未取得")}</div></div>`;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const value = (item) => finite(item) ? item.toLocaleString("ja-JP") : "—";
  const sleep = finite(row.sleep_min)
    ? `${Math.floor(row.sleep_min / 60)}h${String(row.sleep_min % 60).padStart(2, "0")}m` : "—";
  const bed = typeof row.bed_time === "string" ? row.bed_time : "—";
  const wake = typeof row.wake_time === "string" ? row.wake_time : "—";
  const ageDays = (localDateMs(todayIso) - localDateMs(row.date)) / 86400000;
  const source = `Apple Health経由 · ${row.date.slice(5)}時点${ageDays >= 2 ? " (古い)" : ""}`;
  const summary = `💤 睡眠 ${sleep}(${bed}→${wake})・安静HR ${value(row.resting_hr)}・HRV ${value(row.hrv_sdnn)}・歩数 ${value(row.steps)}・体重 ${value(row.weight_kg)}`;
  return `<div class="bm-health"><div>${escapeHTML(summary)}</div><div class="bm-health-src">${escapeHTML(source)}</div></div>`;
}

export {
  HEALTH_REFRESH_INTERVAL_MS, configureHealth, hydrateHealthData, latestHealthWithin, healthSummaryHTML
};
