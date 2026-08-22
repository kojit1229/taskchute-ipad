// src/features/topband.js(予定パス)— TaskChute Journal スリム化P3・単位(c)の一部。
// 上帯コンポーネント(STANDING ORDERS=三つの信条 + COUNTDOWN=12週サイクル・寿命カウントダウン)。
//
// 契約: dashboard.js/wish.js/instruments.js(P4レーン)と同じ configureXxx(deps) DIパターン。
// **他ファイルを一切importしない自己完結モジュール**(委譲指示の制約)。
//   deps: { escapeHTML, todayISO, getSettings }
//     - escapeHTML(value): string      — 既存app.jsのescapeHTMLと同一契約
//     - todayISO(): "YYYY-MM-DD"       — 既存app.jsのtodayISOと同一契約(実行環境の実時刻の今日)
//     - getSettings(): { twelveWeekStartDate?: "YYYY-MM-DD", birthDate?: "YYYY-MM-DD" }
//       — state.settingsの該当2キーだけを渡す最小DI(getState丸ごとは渡さない)
//
// デザイン正: mockup-today-home-v2.html(STANDING ORDERS=sec-creed/sec-creed-pc、
// COUNTDOWN=sec-life/sec-life-pc、ヘッダeyebrowの信条ローテ表示)。HTML構造・クラス名は
// 同ファイルからそのまま採用。
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
// 「Week n/12」表示は既存app.jsのどこにも実装がない新規要素(旧カウントダウンは
// 12WY項目をフィルタで除外しており、12週の週番号表示自体が存在しなかった)。このモジュールが
// dateSpanMetricのelapsed日数から新規に導出する(定義は本ファイル内コメント参照)。
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

export function configureTopband(deps) {
  ({ escapeHTML, todayISO, getSettings } = deps || {});
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

// ---- STANDING ORDERS(三つの信条。ハードコード3行。slim-spec.md §1-2の明記どおり
//      データ連動なし。文言はデザイン正mockup-today-home-v2.htmlの表記に合わせた) ----

const CREEDS = [
  { num: "一", text: "決めた一つは、必ずやり切れる", small: "MIT COMPLETION 100%" },
  { num: "二", text: "進んだ量で測る。実行率で自分を裁かない", small: "MEASURE PROGRESS, NOT RATE" },
  { num: "三", text: "朝に全部を注ぐ。夜は手放して充電する", small: "ALL-IN AT DAWN, RECHARGE AT DUSK" }
];

function creedRowHTML(creed) {
  return `
    <div class="tower-creed-row">
      <span class="tower-creed-num">${escapeHTML(creed.num)}</span>
      <span class="tower-creed-text">${escapeHTML(creed.text)}
        <small>${escapeHTML(creed.small)}</small></span>
    </div>`;
}

// variant: "" = モバイル/右列カード用(class="sec-creed")、"-pc" = PC上帯2用(class="sec-creed-pc")
// モバイル用とPC用で中身(信条3行)は完全に同一。PC/モバイルどちらを見せるかはCSS側
// (.tower-col-right .sec-creed 等を@media(min-width:1280px)で非表示化)に委ねる設計
// (mockup-today-home-v2.htmlの sec-creed / sec-creed-pc がまさにこの二重レンダリング構造)。
export function renderStandingOrders(variant = "") {
  const cls = variant === "-pc" ? "sec-creed-pc" : "sec-creed";
  const rows = CREEDS.map(creedRowHTML).join("");
  return `
    <section class="tower-panel-box ${cls}">
      <h2>STANDING ORDERS <span>三つの信条</span></h2>
      <div class="tower-creed-body">${rows}</div>
    </section>`;
}

// ---- COUNTDOWN(12週サイクル+今年+45歳まで+80歳まで) ----

function lifeCellHTML({ label, pctLabel, remaining, progress, isCycle }) {
  const pct = clampLocal(progress, 0, 100);
  return `
    <div class="tower-life-cell${isCycle ? " is-cycle" : ""}">
      <div class="tower-life-top"><span class="tower-life-label">${escapeHTML(label)}</span><span class="tower-life-pct">${escapeHTML(pctLabel)}</span></div>
      <div class="tower-life-num">${Number(remaining || 0).toLocaleString()}<small> 日</small></div>
      <div class="tower-life-bar"><span style="width:${pct}%"></span></div>
    </div>`;
}

// variant: "" = モバイル/右列カード用(class="sec-life"、内側は"tower-life"のみ=2x2グリッド)
//          "-pc" = PC上帯2用(class="sec-life-pc"、内側は"tower-life tower-life-row"=4列並び)
export function renderCountdown(variant = "") {
  const cls = variant === "-pc" ? "sec-life-pc" : "sec-life";
  const gridCls = variant === "-pc" ? "tower-life tower-life-row" : "tower-life";

  const today = todayISO();
  const settings = (typeof getSettings === "function" ? getSettings() : {}) || {};

  const start12 = settings.twelveWeekStartDate || today;
  const end12 = addDaysLocal(start12, 84);
  const cycle = dateSpanMetric(today, start12, end12);
  const weekNum = cycleWeekNumber(cycle.elapsed);

  const yearStart = `${String(today).slice(0, 4)}-01-01`;
  const yearEnd = `${String(today).slice(0, 4)}-12-31`;
  const year = dateSpanMetric(today, yearStart, yearEnd);

  const cells = [
    lifeCellHTML({ label: "12週サイクル", pctLabel: `Week ${weekNum}/12`, remaining: cycle.remaining, progress: cycle.progress, isCycle: true }),
    lifeCellHTML({ label: "今年", pctLabel: `${clampLocal(year.progress, 0, 100)}%経過`, remaining: year.remaining, progress: year.progress, isCycle: false })
  ];

  if (settings.birthDate) {
    const age45 = ageSpanMetric(today, settings.birthDate, 45);
    const age80 = ageSpanMetric(today, settings.birthDate, 80);
    cells.push(lifeCellHTML({ label: "45歳まで", pctLabel: "—", remaining: age45.remaining, progress: age45.progress, isCycle: false }));
    cells.push(lifeCellHTML({ label: "80歳まで", pctLabel: "—", remaining: age80.remaining, progress: age80.progress, isCycle: false }));
  }

  return `
    <section class="tower-panel-box ${cls}">
      <h2>COUNTDOWN <span>12週サイクル・寿命</span></h2>
      <div class="${gridCls}">${cells.join("")}</div>
    </section>`;
}

// ---- PC上帯2(STANDING ORDERS + COUNTDOWN 横並び合成) ----
export function renderTopbandPC() {
  return `<div class="tower-topband-pc">${renderStandingOrders("-pc")}${renderCountdown("-pc")}</div>`;
}

// ---- ヘッダeyebrow用: 信条1行のローテーション表示 ----
// index を3で正規化して1行分の内側HTML(<span class="tower-eyebrow">の中身)を返す。
// 呼び出し側は <span class="tower-eyebrow">${creedRotationLine(idx)}</span> として使う想定
// (mockup-today-home-v2.htmlのheader部と同一構造)。
export function creedRotationLine(index) {
  const n = CREEDS.length;
  const i = ((Number(index) % n) + n) % n;
  const creed = CREEDS[i];
  return `<b>STANDING ORDER ${i + 1}/${n}</b><em>${escapeHTML(creed.text)}</em><small>⟳ 3行ローテーション</small>`;
}
