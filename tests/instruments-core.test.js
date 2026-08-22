// instruments-core.test.js — 新計器盤(src/features/instruments.js予定)のcharacterization test。
//
// p4-interface.md §5の指定どおり、ブラウザ不要のNodeテスト。instruments.jsを直importし、
// node:assertとの組み合わせだけで完結する(`node tests/instruments-core.test.js` 単独実行可能)。
// フォーマットは既存fast-nodeテスト(tests/avoid-core.test.js等)のcheck()パターンに合わせる。
//
// カバー対象(依頼書の完了条件どおり):
//   earlyBirdStats: 連続日数の基本 / 欠損日での切断 / 当日未チェックは切断しない(進行中扱い)/
//                   自己ベスト / 累計 / 直近28日窓の境界
//   ironSummary:    当日0kg・目標既定2000・累計

const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const MODULE_PATH = path.join(__dirname, "..", "src", "features", "instruments.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// app.js本体版addDaysと同じ契約(数値コンストラクタnew Date(y,m,d)を使う。文字列パースはしない)。
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHeader(eyebrow, title) {
  return `<div class="stub-header">${eyebrow}/${title}</div>`;
}

// 早起きログを作る補助: baseDateから連続する日数分だけ logs[date] を埋める(古い→新しいの順)。
function logsFor(dates) {
  const logs = {};
  for (const d of dates) logs[d] = { checkedAt: `${d}T05:30` };
  return logs;
}

(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  const { configureInstruments, renderInstruments, earlyBirdStats, ironSummary } = mod;

  let registeredActions = null;
  configureInstruments({
    getState: () => ({}),
    escapeHTML,
    todayISO: () => "2026-08-22",
    addDays,
    renderHeader,
    registerActions: (actions) => { registeredActions = actions; }
  });

  console.log("[0] configureInstruments: instruments-open-iron-logをregisterActionsへ登録する");
  {
    check("registerActionsが呼ばれる", registeredActions !== null);
    check(
      "instruments-open-iron-logアクションが登録される(関数)",
      typeof registeredActions?.["instruments-open-iron-log"] === "function"
    );
  }

  const TODAY = "2026-08-22";

  console.log("[1] earlyBirdStats: 連続日数の基本(直近3日連続チェック済み)");
  {
    const state = { earlyBird: { logs: logsFor(["2026-08-20", "2026-08-21", "2026-08-22"]) } };
    const s = earlyBirdStats(state, TODAY);
    check("currentStreak=3(当日含む3連続)", s.currentStreak === 3, `got ${s.currentStreak}`);
    check("totalCount=3", s.totalCount === 3, `got ${s.totalCount}`);
    check("bestStreak=3", s.bestStreak === 3, `got ${s.bestStreak}`);
  }

  console.log("[2] earlyBirdStats: 欠損日での切断(1日空くと過去分は繋がらない)");
  {
    // 08-19はチェック済みだが08-20が欠損。08-21,08-22は連続。
    const state = { earlyBird: { logs: logsFor(["2026-08-19", "2026-08-21", "2026-08-22"]) } };
    const s = earlyBirdStats(state, TODAY);
    check("currentStreak=2(08-21,08-22の2連続。08-20欠損で08-19とは繋がらない)", s.currentStreak === 2, `got ${s.currentStreak}`);
    check("totalCount=3(欠損があっても累計は3のまま)", s.totalCount === 3, `got ${s.totalCount}`);
  }

  console.log("[3] earlyBirdStats: 当日未チェックは切断しない(進行中扱い)");
  {
    // 当日(08-22)は未チェック。08-19〜08-21の3日は連続してチェック済み。
    const state = { earlyBird: { logs: logsFor(["2026-08-19", "2026-08-20", "2026-08-21"]) } };
    const s = earlyBirdStats(state, TODAY);
    check(
      "currentStreak=3(当日未チェックでも直前の3連続は切断されない)",
      s.currentStreak === 3,
      `got ${s.currentStreak}`
    );
  }

  console.log("[3b] earlyBirdStats: 当日未チェック かつ 前日も未チェック(ダブル欠損)は0");
  {
    const state = { earlyBird: { logs: logsFor(["2026-08-15", "2026-08-16"]) } };
    const s = earlyBirdStats(state, TODAY);
    check("currentStreak=0(08-21,08-22とも欠損)", s.currentStreak === 0, `got ${s.currentStreak}`);
  }

  console.log("[4] earlyBirdStats: 自己ベスト(過去の最長runが現在のストリークより長い)");
  {
    // 過去に5連続(08-01〜08-05)の実績があり、直近は当日含め2連続(08-21,08-22)。
    const state = {
      earlyBird: {
        logs: logsFor([
          "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05",
          "2026-08-21", "2026-08-22"
        ])
      }
    };
    const s = earlyBirdStats(state, TODAY);
    check("currentStreak=2", s.currentStreak === 2, `got ${s.currentStreak}`);
    check("bestStreak=5(過去の最長runを保持する)", s.bestStreak === 5, `got ${s.bestStreak}`);
    check("totalCount=7", s.totalCount === 7, `got ${s.totalCount}`);
  }

  console.log("[4b] earlyBirdStats: 自己ベスト(進行中の当日ストリークが過去最長を超えるケース)");
  {
    // 過去最長は2連続(08-01,08-02)。直近は当日含め4連続(08-19〜08-22)。
    const state = {
      earlyBird: {
        logs: logsFor(["2026-08-01", "2026-08-02", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"])
      }
    };
    const s = earlyBirdStats(state, TODAY);
    check("currentStreak=4", s.currentStreak === 4, `got ${s.currentStreak}`);
    check("bestStreak=4(進行中の当日ストリーク自体が新しい自己ベスト)", s.bestStreak === 4, `got ${s.bestStreak}`);
  }

  console.log("[5] earlyBirdStats: 累計(欠損があっても全期間のチェック日数合計)");
  {
    const state = { earlyBird: { logs: logsFor(["2026-06-01", "2026-06-03", "2026-08-22"]) } };
    const s = earlyBirdStats(state, TODAY);
    check("totalCount=3", s.totalCount === 3, `got ${s.totalCount}`);
  }

  console.log("[6] earlyBirdStats: 直近28日窓の境界(today-27は含む・today-28は含まない)");
  {
    const inBoundaryDate = addDays(TODAY, -27);
    const outBoundaryDate = addDays(TODAY, -28);
    const state = { earlyBird: { logs: logsFor([outBoundaryDate, inBoundaryDate, TODAY]) } };
    const s = earlyBirdStats(state, TODAY);
    check("last28の長さは28", s.last28.length === 28, `got ${s.last28.length}`);
    check(`last28[0].date は today-27(${inBoundaryDate})`, s.last28[0].date === inBoundaryDate, `got ${s.last28[0].date}`);
    check("last28[0].checked=true(境界日=today-27は含まれる)", s.last28[0].checked === true);
    check(`last28[27].date は today(${TODAY})`, s.last28[27].date === TODAY, `got ${s.last28[27].date}`);
    check("last28[27].checked=true(当日もチェック済みなら含まれる)", s.last28[27].checked === true);
    check(
      "today-28(窓の外)は last28 に含まれない",
      !s.last28.some((d) => d.date === outBoundaryDate)
    );
  }

  console.log("[7] earlyBirdStats: state.earlyBirdが未定義でも落ちない(防御的読み取り)");
  {
    const s = earlyBirdStats({}, TODAY);
    check("currentStreak=0", s.currentStreak === 0);
    check("bestStreak=0", s.bestStreak === 0);
    check("totalCount=0", s.totalCount === 0);
    check("last28の長さは28", s.last28.length === 28);
  }

  console.log("[8] ironSummary: 当日0kg・目標既定2000・累計0(データなし)");
  {
    const s = ironSummary({}, TODAY);
    check("todayKg=0", s.todayKg === 0, `got ${s.todayKg}`);
    check("targetKg=2000(既定値)", s.targetKg === 2000, `got ${s.targetKg}`);
    check("lifetimeKg=0", s.lifetimeKg === 0, `got ${s.lifetimeKg}`);
  }

  console.log("[9] ironSummary: 当日セットの総重量(Σ weight×reps)と累計・目標設定値");
  {
    const state = {
      settings: { ironDailyTarget: 1500 },
      condition: {
        logs: {
          "2026-08-20": { gym: [{ exercise: "ベンチプレス", weight: 60, reps: 10 }] }, // 600kg
          [TODAY]: {
            gym: [
              { exercise: "ベンチプレス", weight: 60, reps: 10 }, // 600kg
              { exercise: "ショルダープレス", weight: 30, reps: 8 } // 240kg
            ]
          }
        }
      }
    };
    const s = ironSummary(state, TODAY);
    check("todayKg=840", s.todayKg === 840, `got ${s.todayKg}`);
    check("targetKg=1500(settings.ironDailyTarget反映)", s.targetKg === 1500, `got ${s.targetKg}`);
    check("lifetimeKg=1440(当日840+過去600)", s.lifetimeKg === 1440, `got ${s.lifetimeKg}`);
  }

  console.log("[10] ironSummary: settings.ironManualBaseKgが累計の初期値に加算される");
  {
    const state = {
      settings: { ironManualBaseKg: 5000 },
      condition: { logs: {} }
    };
    const s = ironSummary(state, TODAY);
    check("lifetimeKg=5000(手動加算のみ、当日データなし)", s.lifetimeKg === 5000, `got ${s.lifetimeKg}`);
    check("todayKg=0", s.todayKg === 0);
  }

  console.log("[11] renderInstruments: 表示要素(現在ストリーク/自己ベスト/累計回数/ドットカレンダー/IRON LOGサマリ)を含む");
  {
    const state = {
      earlyBird: { logs: logsFor(["2026-08-21", "2026-08-22"]) },
      settings: { ironDailyTarget: 2000 },
      condition: { logs: { [TODAY]: { gym: [{ exercise: "ベンチプレス", weight: 60, reps: 10 }] } } }
    };
    configureInstruments({
      getState: () => state,
      escapeHTML,
      todayISO: () => TODAY,
      addDays,
      renderHeader,
      registerActions: () => {}
    });
    const html = renderInstruments();
    check("EARLY BIRDパネル見出しを含む", html.includes("EARLY BIRD"));
    check("現在ストリーク(2)の大表示を含む", html.includes(">2</strong>"), html);
    check("自己ベスト欄を含む", html.includes("自己ベスト"));
    check("累計回数欄を含む", html.includes("累計"));
    // "instr-dots"(ラッパー)自体も部分一致してしまうため、class="instr-dot(空白かis-checked)"に絞る。
    check("直近4週ドットカレンダー(instr-dot)を28個含む", (html.match(/class="instr-dot[" ]/g) || []).length === 28);
    check("IRON LOGサマリ見出しを含む", html.includes("IRON LOG"));
    check("IRON LOG遷移導線data-action=instruments-open-iron-logを含む", html.includes('data-action="instruments-open-iron-log"'));
    check("旧計器盤の分析グラフ用語(ヒートマップ/相関/ドーナツ)を持ち込んでいない", !/ヒートマップ|相関|ドーナツ/.test(html));
  }

  console.log(failures === 0 ? "\ninstruments-core: 全件成功" : `\ninstruments-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
