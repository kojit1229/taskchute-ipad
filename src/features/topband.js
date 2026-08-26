// src/features/topband.js(予定パス)— TaskChute Journal スリム化P3・単位(c)の一部。
//
// 契約: dashboard.js/wish.js/instruments.js(P4レーン)と同じ configureXxx(deps) DIパターン。
// **他ファイルを一切importしない自己完結モジュール**(委譲指示の制約)。
//   deps: { escapeHTML, todayISO, getSettings, getTrackDigest }
//     - escapeHTML(value): string      — 既存app.jsのescapeHTMLと同一契約
//     - todayISO(): "YYYY-MM-DD"       — 既存app.jsのtodayISOと同一契約(実行環境の実時刻の今日)
//     - getSettings(): { twelveWeekStartDate?: "YYYY-MM-DD", birthDate?: "YYYY-MM-DD" }
//       — state.settingsの該当2キーだけを渡す最小DI(getState丸ごとは渡さない)
//
//
// 12週サイクル/今年/年齢カウントダウンの算式(slim-spec.md 裁定10: computeMetrics の
// metric()/ageMetric() を正本とする)を、「他ファイルimport禁止」の制約下でこのファイル内に
// 再実装する(dateSpanMetric/ageSpanMetricが app.js 側 metric()/ageMetric() と同一の日付演算
// ロジック=daysBetween(Math.ceil(ms/86400000))・addDays・addYears・clampを踏襲。日付の
// パースは app.js の parseDate と同じ「数値コンストラクタ new Date(y, m-1, d)」方式のみを使い、
// new Date("文字列") は使わない=iOS Safari の TZ 誤解釈を避ける。taskchute-journal Skill厳守)。
// 参照した app.js 側の実物(2026-08-22時点、git show HEAD:app.js):
//   computeMetrics: 12690 / metric: 12707 / ageMetric: 12716
//   daysBetween: 12988 / addDays: 12965 / addYears: 12982 / clamp: 13038
//   信条3行の文言移設元: 2800
//
// 「Week n/12」は本モジュールのcycleWeekForDate()を単一正本とし、COUNTDOWNと日報で共用する。
// dateSpanMetricのelapsed日数から導出する(定義は本ファイル内コメント参照)。
//
// 【統合時に確認してほしい論点(このレーン単体では判断できない)】
// computeMetrics()は「today」に state.selectedDate(タスクシュートの表示日を切替できる値)を
// 使うが、本モジュールは deps.todayISO()(実時刻の今日)を基準にしている。TOWER上帯は常設
// ヘッダであり「タスクシュートの表示日」ではなく「実際の今日」を見せるのが自然という想定で
// 実装したが、統合時に監督者側で意図どおりか確認すること。

// ---- 依存注入(configureTopband) ----
// 呼び出し前のフォールバック(単体require/importだけでは壊れないための最小スタブ)。
let escapeHTML = (value) => String(value ?? "");
let todayISO = () => "";
let getSettings = () => ({});
let getTrackDigest = () => null;
let _twyScoreExpanded = false;

export function configureTopband(deps) {
  ({ escapeHTML, todayISO, getSettings, getTrackDigest } = deps || {});
}

// v266: COUNTDOWNの内訳は端末保存せず、モバイル/PCで同じ一時状態を共有する。
export function toggleTwyScoreExpanded() {
  _twyScoreExpanded = !_twyScoreExpanded;
}

// ---- 日付演算(自己完結・app.js parseDate/daysBetween/addDays/addYears/clamp と同一ロジック) ----

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "YYYY-MM-DD" → ローカル日付の Date(数値コンストラクタ。new Date("文字列")は使わない)
function parseISO(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDaysLocal(iso, delta) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}

function addYearsLocal(iso, years) {
  const d = parseISO(iso);
  d.setFullYear(d.getFullYear() + years);
  return isoOf(d);
}

function daysBetweenLocal(start, end) {
  const ms = parseISO(end).getTime() - parseISO(start).getTime();
  return Math.ceil(ms / 86400000);
}

function clampLocal(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

// app.js metric() 相当(12週サイクル・今年で共用)
function dateSpanMetric(today, start, end) {
  const total = Math.max(1, daysBetweenLocal(start, end));
  const elapsed = clampLocal(daysBetweenLocal(start, today), 0, total);
  const remaining = Math.max(0, daysBetweenLocal(today, end));
  const progress = Math.round((elapsed / total) * 100);
  return { total, elapsed, remaining, progress };
}

// app.js ageMetric() 相当(45歳まで・80歳までで共用)
function ageSpanMetric(today, birthDate, age) {
  const target = addYearsLocal(birthDate, age);
  const totalDays = Math.max(1, daysBetweenLocal(birthDate, target));
  const elapsedDays = Math.max(0, daysBetweenLocal(birthDate, today));
  const remaining = Math.max(0, daysBetweenLocal(today, target));
  const progress = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
  return { totalDays, elapsedDays, remaining, progress };
}

// 12週サイクルの週番号(新規導出。定義: 経過日数0〜6日目=Week1、7〜13日目=Week2、…と
// 7日刻みで進み、84日目(サイクル終端)以降はWeek12に張り付く。elapsedは
// dateSpanMetricで既に[0, total]にクランプ済みの値を渡す前提)
function cycleWeekNumber(elapsedDays) {
  return clampLocal(Math.floor(elapsedDays / 7) + 1, 1, 12);
}

// v231: 日付に対応する12週サイクルの週番号。開始日未設定時は対象日を開始日としてWeek 1を返す。
export function cycleWeekForDate(dateISO) {
  const date = dateISO || todayISO();
  const settings = (typeof getSettings === "function" ? getSettings() : {}) || {};
  const start = settings.twelveWeekStartDate || date;
  const cycle = dateSpanMetric(date, start, addDaysLocal(start, 84));
  return cycleWeekNumber(cycle.elapsed);
}

// ---- STANDING ORDERS(三つの信条。ハードコード3行。slim-spec.md §1-2の明記どおり
//      データ連動なし。文言はデザイン正mockup-today-home-v2.htmlの表記に合わせた) ----

const CREEDS = [
  { num: "一", text: "決めた一つは、必ずやり切れる", small: "MIT COMPLETION 100%" },
  { num: "二", text: "進んだ量で測る。実行率で自分を裁かない", small: "MEASURE PROGRESS, NOT RATE" },
  { num: "三", text: "朝に全部を注ぐ。夜は手放して充電する", small: "ALL-IN AT DAWN, RECHARGE AT DUSK" }
];

function creedRowHTML(creed) {
  return `
    <div class="so-item"><span class="so-num">${escapeHTML(creed.num)}</span><span><em>${escapeHTML(creed.text)}</em>
        <small>${escapeHTML(creed.small)}</small></span>
    </div>`;
}

export function renderStandingOrders() {
  const rows = CREEDS.map(creedRowHTML).join("");
  return `
    <section class="tower-glass-panel so-row" aria-label="STANDING ORDERS"><div class="so-grid">${rows}</div>
    </section>`;
}

// ---- COUNTDOWN(12週サイクル+今年+45歳まで+80歳まで) ----

function lifeCellHTML({ label, pctLabel, remaining, progress, isCycle, extraHTML = "" }) {
  const pct = clampLocal(progress, 0, 100);
  return `
    <div class="life-sig${isCycle ? " wy" : ""}"><span>${escapeHTML(label)}</span><strong>${Number(remaining || 0).toLocaleString()}<em>${isCycle ? "/12" : "日"}</em></strong><div class="life-bar"><i style="width:${pct}%"></i></div>
      ${extraHTML}
    </div>`;
}

function twyScoreSignalClass(digest) {
  const { hasMeta, score, scoreTarget } = digest;
  if (!hasMeta || score.status === "na" || score.status === "uncommitted") return "is-na";
  return score.pct >= scoreTarget ? "is-good" : score.pct >= 70 ? "is-mid" : "is-low";
}

function twyScoreSignalWord(cls, digest) {
  if (cls === "is-good") return "軌道内";
  if (cls === "is-mid") return "要注意";
  if (cls === "is-low") return "遅延";
  if (digest.score.status === "na") return "免除";
  if (digest.score.status === "uncommitted") return "対象0";
  return "未確定";
}

function twyTracksFootHTML(tracksFootLines) {
  if (!tracksFootLines.length) return "";
  const rows = tracksFootLines.map(({ track, status, paceLabel, metaLabel }) => `
    <div class="twy-track-line">
      <span class="t-state s-${status.state === "warn" && status.label === "期限超過" ? "overdue" : status.state}">${escapeHTML(status.label)}</span>
      <span class="t-name">${escapeHTML(track.name)}</span>
      <span class="t-pace ${paceLabel.sign}">${escapeHTML(paceLabel.text)}</span>
      <span class="t-meta">${escapeHTML(metaLabel)}</span>
    </div>`).join("");
  return `<div class="twy-tracks-foot">${rows}</div>`;
}

function twyScoreDetailHTML(digest, cls) {
  const { score, scoreTarget, tracksFootLines } = digest;
  const barPct = score.status === "scored" ? clampLocal(score.pct, 0, 100) : 0;
  const detailValue = score.status === "scored" ? `${score.pct}<small>% (${score.done}/${score.total})</small>`
    : score.status === "na" ? "N/A<small>(免除)</small>" : "確定<small>(対象0コマ)</small>";
  const barCls = cls === "is-good" || cls === "is-mid" || cls === "is-low" ? cls : "";
  return `
    <div class="twy-score-detail">
      <div class="twy-score-top"><span class="twy-score-label">今週 実行</span><span class="twy-score-val ${cls}">${detailValue}</span></div>
      <div class="twy-score-bar ${barCls}"><span style="width:${barPct}%"></span><i style="left:${clampLocal(scoreTarget, 0, 100)}%"></i></div>
      <span class="twy-score-target">目安${scoreTarget}</span>
      ${twyTracksFootHTML(tracksFootLines)}
    </div>`;
}

function twyScoreHTML(digest) {
  if (!digest.hasMeta) {
    const prevText = digest.prevScore !== null ? `<small>・先週${digest.prevScore}%</small>` : "";
    return `<div class="twy-score is-na"><span class="twy-score-label">12WY</span><span class="twy-score-val">未確定${prevText}</span></div>`;
  }
  const cls = twyScoreSignalClass(digest);
  const word = twyScoreSignalWord(cls, digest);
  const valueText = digest.score.status === "scored" ? `${digest.score.done}/${digest.score.total}`
    : digest.score.status === "na" ? "N/A" : "確定0";
  return `
    <div class="twy-score${_twyScoreExpanded ? " is-open" : ""}">
      <button type="button" class="twy-score-signal ${cls}" data-action="twy-score-toggle" aria-expanded="${_twyScoreExpanded ? "true" : "false"}">
        <span class="twy-score-label">12WY</span>
        <span class="twy-score-val">${escapeHTML(valueText)}<small>・${escapeHTML(word)}</small></span>
        <span class="twy-score-caret">${_twyScoreExpanded ? "▾" : "▸"}</span>
      </button>
      ${_twyScoreExpanded ? twyScoreDetailHTML(digest, cls) : ""}
    </div>`;
}

function twyCommitBannerHTML(digest) {
  if (digest.hasMeta || !digest.candidateCount) return "";
  return `<div class="twy-commit-banner"><span>⚠ 今週の週次コミットが未確定です(候補 ${digest.candidateCount}件)</span>
    <button type="button" data-action="twy-open-commit">今週を確定</button></div>`;
}

export function renderLifeBand() {
  const today = todayISO();
  const settings = (typeof getSettings === "function" ? getSettings() : {}) || {};
  const digest = typeof getTrackDigest === "function" ? getTrackDigest() : null;

  const start12 = settings.twelveWeekStartDate || today;
  const end12 = addDaysLocal(start12, 84);
  const cycle = dateSpanMetric(today, start12, end12);
  const weekNum = cycleWeekForDate(today);

  const yearStart = `${String(today).slice(0, 4)}-01-01`;
  const yearEnd = `${String(today).slice(0, 4)}-12-31`;
  const year = dateSpanMetric(today, yearStart, yearEnd);

  const cells = [
    lifeCellHTML({ label: "12WY WEEK", pctLabel: `Week ${weekNum}/12`, remaining: weekNum, progress: cycle.progress, isCycle: true,
      extraHTML: digest ? `${twyScoreHTML(digest)}${twyCommitBannerHTML(digest)}` : "" }),
    lifeCellHTML({ label: "今年", pctLabel: `${clampLocal(year.progress, 0, 100)}%経過`, remaining: year.remaining, progress: year.progress, isCycle: false })
  ];

  if (settings.birthDate) {
    const age45 = ageSpanMetric(today, settings.birthDate, 45);
    const age80 = ageSpanMetric(today, settings.birthDate, 80);
    cells.push(lifeCellHTML({ label: "45歳まで", pctLabel: "—", remaining: age45.remaining, progress: age45.progress, isCycle: false }));
    cells.push(lifeCellHTML({ label: "80歳まで", pctLabel: "—", remaining: age80.remaining, progress: age80.progress, isCycle: false }));
  }

  return `
    <section class="tower-glass-panel life-band"><span class="tower-beacon" aria-hidden="true"><i></i></span><span class="life-title">LIFE BAND</span><div class="life-sigs">${cells.join("")}</div>
    </section>`;
}
