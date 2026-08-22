// tests/journal-core.test.js — 段階4-3抽出(ジャーナルタブ本体+コンディションOS・運動記録・
// 今日行ったお店ログ)のcharacterization test。
// 対象: src/features/journal.js(configureJournal(deps)による依存注入。wish.jsと
// 同じ抽出パターン)、src/state/journal-fold.js(click dispatcherとrenderJournalの共有
// _journalSegmentOverride)。
//
// prep-stage4-journal.md §9 Must級指摘に従い、safeExternalUrl(お店URLのXSS対策)を最優先で
// 固定する([1])。これまでsafeExternalUrlはブラウザE2Eからしか触れられておらず、この関数
// 単体を狙ったNode特性テストが存在しなかった(設計書§6/§9のテスト空白)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const JOURNAL_PATH = path.join(ROOT, "src", "features", "journal.js");
const FOLD_PATH = path.join(ROOT, "src", "state", "journal-fold.js");
const STORE_PATH = path.join(ROOT, "src", "state", "store.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- Node環境にdocument/windowが無いため、import前に最小スタブを用意する ----
const domStubs = {};
global.document = {
  addEventListener: () => {},
  querySelector: (sel) => domStubs[sel] || null,
  querySelectorAll: () => [],
  elementFromPoint: () => null
};
let confirmImpl = () => true;
global.window = { confirm: (...args) => confirmImpl(...args) };

// ---- app.js側の実装と同一(相当)のヘルパー(依存注入のスタブ) ----
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function renderHeader(eyebrow, title) { return `<div class="stub-header">${eyebrow}/${title}</div>`; }
function renderDateBar() { return `<div class="stub-datebar"></div>`; }
function renderMarkdown(text) { return `<div class="stub-md">${escapeHTML(text)}</div>`; }
function renderModal(html) { domStubs["__lastModal"] = html; }
function closeModal() { domStubs["__modalClosed"] = true; }
function personalDataReady() { return false; }
let latestSleepLogWithinImpl = () => null;
function latestSleepLogWithin(date) { return latestSleepLogWithinImpl(date); }
function shortSleepDate(s) { return s; }
function upsertMorningLine(markdown, line) { return `${line}\n\n${markdown}`; }
function renderExperimentSection() { return `<div class="stub-experiment"></div>`; }
const JOURNAL_REQUEST_SECTION = "### 依頼\n(AIにやってほしいことがあれば書く)";

function pad2(value) { return String(value).padStart(2, "0"); }
function dateToISO(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(date, delta) {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateToISO(d);
}
let todayISOValue = "2026-07-28";
function todayISO() { return todayISOValue; }
function nowDateTime() { return "2026-07-28T09:00:00"; }
function weekRange(dateISO) {
  // 土曜起点(app.js本実装と同じ週定義。テストでは固定日から逆算するだけの簡易版)
  const d = parseDate(dateISO);
  const day = d.getDay(); // 0=日 .. 6=土
  const backToSat = (day + 1) % 7;
  const weekStart = addDays(dateISO, -backToSat);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}
function weekDays(weekStart) { return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)); }

let toastCalls = [];
function showToast(message, opts) { toastCalls.push({ message, opts }); }
let saveAndRenderCalls = [];
function saveAndRender(message, opts) { saveAndRenderCalls.push({ message, opts }); }

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const foldMod = await import(pathToFileURL(FOLD_PATH).href);
  const journalMod = await import(pathToFileURL(JOURNAL_PATH).href);
  return { storeMod, foldMod, journalMod };
}

(async () => {
  const { storeMod, foldMod, journalMod } = await loadModules();

  journalMod.configureJournal({
    escapeHTML, renderHeader, renderDateBar, renderMarkdown, renderModal, closeModal,
    addDays, todayISO, weekRange, weekDays, showToast, nowDateTime, saveAndRender,
    personalDataReady, latestSleepLogWithin, shortSleepDate, upsertMorningLine,
    renderExperimentSection, JOURNAL_REQUEST_SECTION
  });

  function setBaseState(extra = {}) {
    storeMod.setState({
      selectedDate: "2026-07-28",
      journals: {},
      journalMeta: {},
      settings: { morningEnergyLog: {}, github: {}, journalTemplate: "" },
      condition: { logs: {} },
      storeVisits: [],
      sleep: { logs: {} },
      modal: null,
      ...extra
    });
    // click dispatcher側のオーバーライドはセッション非永続のため、テスト間でも都度リセットする
    Object.keys(foldMod._journalSegmentOverride).forEach((k) => delete foldMod._journalSegmentOverride[k]);
  }

  console.log("[1] safeExternalUrl(最優先・XSS対策): http(s)以外のスキームは空文字にフェイルセーフする");
  {
    check("https://はそのまま", journalMod.safeExternalUrl("https://example.com/page") === "https://example.com/page");
    check("http://もそのまま", journalMod.safeExternalUrl("http://example.com") === "http://example.com");
    check("javascript:は空文字(XSS)", journalMod.safeExternalUrl("javascript:alert(1)") === "");
    check("data:text/htmlは空文字(XSS)", journalMod.safeExternalUrl("data:text/html,<script>alert(1)</script>") === "");
    check("大文字HTTPS://も許可(iフラグ)", journalMod.safeExternalUrl("HTTPS://example.com") === "HTTPS://example.com");
    check("前後空白はtrimしてから判定", journalMod.safeExternalUrl("  https://example.com  ") === "https://example.com");
    check("空文字は空文字", journalMod.safeExternalUrl("") === "");
    check("undefinedは空文字(例外を投げない)", journalMod.safeExternalUrl(undefined) === "");
    check("null は空文字(例外を投げない)", journalMod.safeExternalUrl(null) === "");
    check("javascript:に偽装した文字列(先頭に空白+javascript:)も空文字", journalMod.safeExternalUrl("  javascript:alert(1)") === "");
  }

  console.log("[2] ensureJournal/defaultJournal: 日付ヘッダの正規表現置換が1箇所だけ・複数行本文でも安全");
  {
    setBaseState();
    journalMod.ensureJournal("2026-07-28");
    const created = storeMod.state.journals["2026-07-28"];
    check("新規作成時にヘッダへ選択日が入る", created.startsWith("# 2026-07-28 のジャーナル"));
    check("依頼セクション(JOURNAL_REQUEST_SECTION)が末尾に含まれる", created.includes("### 依頼"));

    console.log("  -- 既存のjournalTemplate(別日付でヘッダが焼き込まれている)を使う場合、対象日だけ置換 --");
    setBaseState({
      settings: {
        morningEnergyLog: {}, github: {},
        journalTemplate: "# 2020-01-01 のジャーナル\n\n本文中に # 2020-01-01 のジャーナル という文字列が2回目として出てもヘッダ行以外は変えない\n複数行\nテンプレ"
      }
    });
    journalMod.ensureJournal("2026-07-28");
    const withTpl = storeMod.state.journals["2026-07-28"];
    const headerLines = withTpl.split("\n").filter((l) => /^# \d{4}-\d{2}-\d{2} のジャーナル/.test(l));
    check("ヘッダ行が対象日の1行だけに置換される", headerLines.length === 1 && headerLines[0] === "# 2026-07-28 のジャーナル", JSON.stringify(headerLines));
    check("本文中の同一文字列(見出しでない行)は書き換えない", withTpl.includes("本文中に # 2020-01-01 のジャーナル という文字列が2回目として出てもヘッダ行以外は変えない"));
    check("複数行の本文がそのまま保持される", withTpl.includes("複数行\nテンプレ"));

    console.log("  -- 既存ジャーナルがある日は上書きしない --");
    setBaseState({ journals: { "2026-07-28": "既存の内容" } });
    journalMod.ensureJournal("2026-07-28");
    check("既存の内容を保持する(再生成しない)", storeMod.state.journals["2026-07-28"] === "既存の内容");
  }

  console.log("[3] storeVisitsForDate: 削除済みを除外し、createdAt昇順でソートする");
  {
    setBaseState({
      storeVisits: [
        { id: "a", date: "2026-07-28", deleted: false, createdAt: "2026-07-28T10:00:00" },
        { id: "b", date: "2026-07-28", deleted: false, createdAt: "2026-07-28T08:00:00" },
        { id: "c", date: "2026-07-28", deleted: true, createdAt: "2026-07-28T05:00:00" },
        { id: "d", date: "2026-07-27", deleted: false, createdAt: "2026-07-27T09:00:00" }
      ]
    });
    const visits = journalMod.storeVisitsForDate("2026-07-28");
    check("対象日のみ・削除済み(c)を除外・2件", visits.length === 2 && visits.every((v) => v.id !== "c"), JSON.stringify(visits.map((v) => v.id)));
    check("createdAt昇順(b→a)でソートされる", visits[0].id === "b" && visits[1].id === "a", JSON.stringify(visits.map((v) => v.id)));
  }

  console.log("[4] lastGymRecord: 指定日(excludeDate)自身を除外・同種目のみ・日付降順の最初の1件");
  {
    setBaseState({
      condition: {
        logs: {
          "2026-07-28": { gym: [{ id: "g0", exercise: "ベンチプレス", weight: 60, reps: 8 }] },
          "2026-07-27": { gym: [{ id: "g1", exercise: "ベンチプレス", weight: 55, reps: 10 }] },
          "2026-07-20": { gym: [{ id: "g2", exercise: "ベンチプレス", weight: 50, reps: 10 }] },
          "2026-07-26": { gym: [{ id: "g3", exercise: "スクワット", weight: 80, reps: 5 }] }
        }
      }
    });
    const rec = journalMod.lastGymRecord("ベンチプレス", "2026-07-28");
    check("当日(excludeDate)自身は除外し、直近(07-27)を返す", rec?.date === "2026-07-27" && rec?.weight === 55, JSON.stringify(rec));
    check("別種目(スクワット)は対象外", journalMod.lastGymRecord("デッドリフト", "2026-07-28") === null);
  }

  console.log("[5] ensureConditionLog: 遅延初期化の既定形・2回目呼び出しは同一オブジェクトを返す(上書きしない)");
  {
    setBaseState();
    const log1 = journalMod.ensureConditionLog("2026-07-28");
    check("既定形(sleepHours:null等)で初期化される", log1.sleepHours === null && log1.meds === null && Array.isArray(log1.gym) && log1.gym.length === 0, JSON.stringify(log1));
    log1.sleepHours = 7;
    const log2 = journalMod.ensureConditionLog("2026-07-28");
    check("2回目呼び出しでも既存の値を上書きしない(同一オブジェクト参照)", log2.sleepHours === 7 && log2 === log1);
  }

  console.log("[6] 主観睡眠の入力UI廃止・服薬/余力/夜の体調: 旧睡眠値を保ったまま他項目を保存する");
  {
    setBaseState({ condition: { logs: { "2026-07-28": {
      sleepHours: 7, meds: null, capacity: "", morningRecordedAt: "",
      eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: []
    } } } });
    const morningHtml = journalMod.renderConditionMorningExtra("2026-07-28");
    check("睡眠プリセットUIが存在しない", !morningHtml.includes('data-action="set-sleep"') && !morningHtml.includes("💤 睡眠"));

    journalMod.toggleConditionMeds("2026-07-28");
    check("服薬トグルでtrueになる", storeMod.state.condition.logs["2026-07-28"].meds === true);
    check("服薬操作は旧睡眠値を書き換えない", storeMod.state.condition.logs["2026-07-28"].sleepHours === 7);
    check("morningRecordedAtが記録される", !!storeMod.state.condition.logs["2026-07-28"].morningRecordedAt);
    journalMod.toggleConditionMeds("2026-07-28");
    check("再トグルでfalseに戻る", storeMod.state.condition.logs["2026-07-28"].meds === false);

    journalMod.setConditionCapacity("2026-07-28", "full");
    check("余力が保存される", storeMod.state.condition.logs["2026-07-28"].capacity === "full");
    journalMod.setConditionCapacity("2026-07-28", "full");
    check("同じ値の再タップで解除される(トグル)", storeMod.state.condition.logs["2026-07-28"].capacity === "");

    journalMod.setEveningMood("2026-07-28", 3);
    check("夜の体調が保存される", storeMod.state.condition.logs["2026-07-28"].eveningMood === 3);
    check("eveningRecordedAtが記録される", !!storeMod.state.condition.logs["2026-07-28"].eveningRecordedAt);
  }

  console.log("[7] conditionRecordedCountThisWeek: 朝の体調 or コンディション記録のいずれかがある日を今週分だけ数える");
  {
    todayISOValue = "2026-07-28";  // 火曜(2026-07-28)。週の起点(土曜)は07-25
    setBaseState({
      settings: { morningEnergyLog: { "2026-07-26": 7 }, github: {}, journalTemplate: "" },
      condition: { logs: { "2026-07-27": { morningRecordedAt: "2026-07-27T07:00:00" } } }
    });
    const count = journalMod.conditionRecordedCountThisWeek();
    check("今週(07-25〜07-31)内の2日分をカウント", count === 2, String(count));
  }

  console.log("[8] renderJournal: _journalSegmentOverride(src/state/journal-fold.js共有)がある場合は時刻ベース既定より優先される");
  {
    setBaseState();
    let html = journalMod.renderJournal();
    check("renderJournalが例外を投げず描画する", typeof html === "string" && html.includes("journal-segment-morning"));
    check("ジャーナルに日報生成・Markdown保存ボタンがある",
      html.includes('data-action="generate-report"') && html.includes('data-action="download-report"'));
    check("未生成時はAI用コピーボタンを出さない", !html.includes('data-action="report-copy-ai"'));

    setBaseState({ reports: { "2026-07-28": "# 日報" } });
    html = journalMod.renderJournal();
    check("生成済み日報があればAI用コピーボタンが出る", html.includes('data-action="report-copy-ai"'));

    foldMod._journalSegmentOverride.morning = false;
    foldMod._journalSegmentOverride.evening = true;
    html = journalMod.renderJournal();
    const morningBlock = /<details class="fold journal-segment journal-segment-morning"[^>]*>/.exec(html)?.[0] || "";
    const eveningBlock = /<details class="fold journal-segment journal-segment-evening"[^>]*>/.exec(html)?.[0] || "";
    check("overrideでmorning=falseにすると朝segmentはopenが付かない", !morningBlock.includes("open"), morningBlock);
    check("overrideでevening=trueにすると夜segmentはopenが付く", eveningBlock.includes("open"), eveningBlock);

    console.log("  -- overrideを消すと時刻ベース既定に戻る --");
    delete foldMod._journalSegmentOverride.morning;
    delete foldMod._journalSegmentOverride.evening;
    const RealDate = global.Date;
    class MorningFixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(2026, 6, 28, 9, 0, 0);
        else super(...args);
      }
    }
    global.Date = MorningFixedDate;
    try {
      html = journalMod.renderJournal();
      const morningBlock2 = /<details class="fold journal-segment journal-segment-morning"[^>]*>/.exec(html)?.[0] || "";
      const eveningBlock2 = /<details class="fold journal-segment journal-segment-evening"[^>]*>/.exec(html)?.[0] || "";
      check("9時(14時前)は朝segmentがopen(時刻ベース既定)", morningBlock2.includes("open"), morningBlock2);
      check("9時は夜segmentがopenでない", !eveningBlock2.includes("open"), eveningBlock2);
    } finally {
      global.Date = RealDate;
    }
  }

  console.log(failures === 0 ? "\njournal-core: 全件成功" : `\njournal-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
