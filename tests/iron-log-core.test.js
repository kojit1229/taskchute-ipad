// iron-log-core.test.js — IRON LOG専用画面(レーンB)のcharacterization test。
// ブラウザ不要・自己完結。tests/avoid-core.test.js / tests/wish-core.test.js と同じ
// 「check/failuresカウンタ + dynamic import + process.exit」形式(p4-interface.md §5)。
// 単独実行: node tests/iron-log-core.test.js
//
// 既知の注意点(notes.mdに詳細): p4-interface.md §3 / slim-spec.md §3の凍結書式例
// 「総重量 1,840kg(ベンチプレス 60kg×10×2、ショルダープレス 30kg×8)」は、示されている2グループ
// (60kg×10×2=1,200kg + 30kg×8=240kg)の実際の合計(1,440kg)と数値が一致しない(ドキュメント側の
// 数値ミスと判断)。本テストは書式パターン(桁区切り・kg表記・全角読点・同combo×N圧縮)を完全再現し、
// 合計値は実際の入力から正しく計算された値(1,440kg)で一致させる。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = __dirname;
const MODULE_PATH = path.join(ROOT, "..", "src", "features", "iron-log.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// app.js:18153のescapeHTMLと同一ロジック(avoid-core.test.js等と同じスタブ)。
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

// 実行時の現在年月を文字列パースなしで求める(currentYearMonth()と同じ手法をテスト側でも使う。
// runIronImport等と違いこちらはテストの期待値構築用)。
function currentYM() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1 };
}
function prevYM({ y, m }) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}
function ymStr({ y, m }) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

async function loadModule() {
  return import(pathToFileURL(MODULE_PATH).href);
}

(async () => {
  const mod = await loadModule();
  const {
    configureIronLog, renderIronLog, gymSetsForDate, ironDailyTotal, ironTotals,
    linkedGymBlock, gymCommentSummary, parseIronComment, runIronImport
  } = mod;

  console.log("[1] gymSetsForDate / ironDailyTotal(空日・複数セット)");
  {
    const empty = { condition: { logs: {} } };
    check("空日はgymSetsForDateが空配列", Array.isArray(gymSetsForDate(empty, "2026-08-22")) && gymSetsForDate(empty, "2026-08-22").length === 0);
    check("空日のironDailyTotalは0", ironDailyTotal(empty, "2026-08-22") === 0);

    const state = {
      condition: { logs: { "2026-08-22": { gym: [
        { exercise: "ベンチプレス", weight: 10, reps: 5, at: "2026-08-22T09:00", blockId: "b1" },
        { exercise: "スクワット", weight: 20, reps: 3, at: "2026-08-22T09:10" }
      ] } } }
    };
    const sets = gymSetsForDate(state, "2026-08-22");
    check("2件のセットを返す", sets.length === 2, sets.length);
    check("kgが計算される(10x5=50)", sets[0].kg === 50, sets[0].kg);
    check("kgが計算される(20x3=60)", sets[1].kg === 60, sets[1].kg);
    check("blockId等の元フィールドは保持される", sets[0].blockId === "b1");
    check("ironDailyTotalは合計110", ironDailyTotal(state, "2026-08-22") === 110, ironDailyTotal(state, "2026-08-22"));
  }

  console.log("[2] ironTotals(月跨ぎ・自己ベスト・manualBase・importedTotalKg)");
  {
    const cur = currentYM();
    const prev = prevYM(cur);
    const dateCur = `${ymStr(cur)}-05`;
    const datePrev = `${ymStr(prev)}-20`;
    const state = {
      settings: { ironManualBaseKg: 100 },
      ironImport: { done: true, importedTotalKg: 50, importedDays: 1 },
      condition: {
        logs: {
          [datePrev]: { gym: [{ exercise: "ベンチプレス", weight: 50, reps: 10 }] }, // 500kg(先月)
          [dateCur]: { gym: [
            { exercise: "スクワット", weight: 80, reps: 10 },
            { exercise: "スクワット", weight: 80, reps: 10 }
          ] } // 1,600kg(今月・自己ベスト)
        }
      }
    };
    const totals = ironTotals(state);
    check("lifetimeKg = 構造化(500+1600)+manualBase100+imported50 = 2250", totals.lifetimeKg === 2250, totals.lifetimeKg);
    check("monthKg = 今月分のみ(1600、先月分500は含まない)", totals.monthKg === 1600, totals.monthKg);
    check("bestDayは今月の日(1600kg)", totals.bestDay.date === dateCur && totals.bestDay.kg === 1600, JSON.stringify(totals.bestDay));

    const emptyTotals = ironTotals({ condition: { logs: {} } });
    check("データが無い場合lifetimeKg=0", emptyTotals.lifetimeKg === 0);
    check("データが無い場合bestDayはdate=\"\" kg=0", emptyTotals.bestDay.date === "" && emptyTotals.bestDay.kg === 0);
  }

  console.log("[3] gymCommentSummary(書式凍結・×2圧縮・単一セット・空配列)");
  {
    const sets = [
      { exercise: "ベンチプレス", weight: 60, reps: 10 },
      { exercise: "ベンチプレス", weight: 60, reps: 10 },
      { exercise: "ショルダープレス", weight: 30, reps: 8 }
    ];
    const summary = gymCommentSummary(sets);
    check(
      "書式互換(同combo×2圧縮・合計は実際の入力から正しく計算): 総重量 1,440kg(ベンチプレス 60kg×10×2、ショルダープレス 30kg×8)",
      summary === "総重量 1,440kg(ベンチプレス 60kg×10×2、ショルダープレス 30kg×8)",
      summary
    );

    const single = gymCommentSummary([{ exercise: "デッドリフト", weight: 100, reps: 5 }]);
    check("単一セットは×N無し: 総重量 500kg(デッドリフト 100kg×5)", single === "総重量 500kg(デッドリフト 100kg×5)", single);

    const ordered = gymCommentSummary([
      { exercise: "C種目", weight: 1, reps: 1 },
      { exercise: "A種目", weight: 2, reps: 2 },
      { exercise: "B種目", weight: 3, reps: 3 }
    ]);
    check(
      "複数種目は出現順を維持(C→A→B)",
      ordered === "総重量 14kg(C種目 1kg×1、A種目 2kg×2、B種目 3kg×3)",
      ordered
    );

    check("空配列は空文字", gymCommentSummary([]) === "");
  }

  console.log("[4] parseIronComment(正常・カンマ入り・不能)");
  {
    check("カンマ入り: 1,840kgをパース", parseIronComment("総重量 1,840kg(ベンチプレス 60kg×10×2)") === 1840);
    check("カンマ無し: 500kgをパース", parseIronComment("総重量 500kg(デッドリフト 100kg×5)") === 500);
    check("パース不能な文字列はnull", parseIronComment("今日は胸トレ、調子良かった") === null);
    check("空文字はnull", parseIronComment("") === null);
    check("undefinedはnull", parseIronComment(undefined) === null);
  }

  console.log("[5] runIronImport(冪等・構造化済み日スキップ・同日2件目スキップ・キーワード不一致除外)");
  {
    const state = {
      settings: { gymBlockKeywords: ["ジム"] },
      blocks: [
        { id: "b1", date: "2026-08-01", category: "ジム", title: "胸トレ", comment: "総重量 1,200kg(ベンチプレス 60kg×10×2)" },
        { id: "b2", date: "2026-08-02", category: "ジム", title: "背中", comment: "パース不能なコメント" },
        { id: "b3", date: "2026-08-03", category: "ジム", title: "脚1", comment: "総重量 2,000kg(スクワット 100kg×10×2)" },
        { id: "b4", date: "2026-08-03", category: "ジム", title: "脚2", comment: "総重量 500kg(デッドリフト 100kg×5)" },
        { id: "b5", date: "2026-08-04", category: "ジム", title: "既に構造化済み", comment: "総重量 999kg" },
        { id: "b6", date: "2026-08-05", category: "読書", title: "本を読む", comment: "総重量 100kg" },
        { id: "b7", date: "2026-08-06", category: "ジム", title: "削除済み", deleted: true, comment: "総重量 100kg" }
      ],
      condition: { logs: { "2026-08-04": { gym: [{ exercise: "既存", weight: 10, reps: 1 }] } } },
      ironImport: { done: false, importedTotalKg: 0, importedDays: 0 }
    };
    runIronImport(state);
    check("importedTotalKg = 1200(08-01) + 2000(08-03の最初のみ) = 3200", state.ironImport.importedTotalKg === 3200, state.ironImport.importedTotalKg);
    check("importedDays = 2", state.ironImport.importedDays === 2, state.ironImport.importedDays);
    check("done = true", state.ironImport.done === true);

    const before = JSON.stringify(state.ironImport);
    const result = runIronImport(state);
    check("2回目呼び出しはno-op(値が変わらない)", JSON.stringify(state.ironImport) === before);
    check("2回目もstateを返す(冪等)", result === state);
  }

  console.log("[6] linkedGymBlock(キーワード一致・実行中判定・非該当)");
  {
    const running = {
      settings: { gymBlockKeywords: ["ジム", "筋トレ"] },
      blocks: [{ id: "r1", category: "ジム", title: "胸トレ", actualStartAt: "2026-08-22T17:00", actualEndAt: "" }]
    };
    const linked = linkedGymBlock(running, 17 * 60 + 49);
    check("キーワード一致+実行中のBlockを検出", !!linked && linked.block.id === "r1");
    check("経過分を計算(49分)", linked && linked.elapsedMinutes === 49, linked && linked.elapsedMinutes);

    const finished = {
      settings: {},
      blocks: [{ id: "x1", category: "ジム", title: "完了済み", actualStartAt: "2026-08-22T10:00", actualEndAt: "2026-08-22T10:30" }]
    };
    check("完了済み(actualEndAtあり)はnull", linkedGymBlock(finished, 700) === null);

    const mismatch = {
      settings: { gymBlockKeywords: ["ジム"] },
      blocks: [{ id: "y1", category: "読書", title: "本を読む", actualStartAt: "2026-08-22T10:00" }]
    };
    check("キーワード不一致はnull", linkedGymBlock(mismatch, 700) === null);

    check("Blockが無ければnull", linkedGymBlock({ settings: {}, blocks: [] }, 700) === null);
  }

  console.log("[7] renderIronLog(主要要素・goal-hit切替)");
  {
    let currentState = null;
    configureIronLog({
      getState: () => currentState,
      escapeHTML,
      todayISO: () => "2026-08-22",
      renderHeader,
      saveAndRender: () => {},
      registerActions: () => {}
    });

    currentState = {
      settings: { ironDailyTarget: 1000 },
      condition: { logs: { "2026-08-22": { gym: [{ exercise: "ベンチプレス", weight: 60, reps: 10 }] } } }, // 600kg < 1000
      blocks: [],
      ironImport: { done: true, importedTotalKg: 0, importedDays: 0 }
    };
    const htmlUnhit = renderIronLog();
    check("renderHeaderが呼ばれる(IRON LOG/筋トレ)", htmlUnhit.includes("IRON LOG") && htmlUnhit.includes("筋トレ"));
    check("LINKED FLIGHTを含む", htmlUnhit.includes("LINKED FLIGHT"));
    check("1行フォーム(LOAD SET+種目/重量/回数/追加ボタン)を含む", htmlUnhit.includes("LOAD SET")
      && htmlUnhit.includes('id="ironFormExercise"') && htmlUnhit.includes('id="ironFormWeight"')
      && htmlUnhit.includes('id="ironFormReps"') && htmlUnhit.includes('data-action="iron-add-set"'));
    check("当日総重量の大数字(600)を含む", htmlUnhit.includes(">600<"), htmlUnhit);
    check("2,000kg等の目標ゲージ行(DAILY TARGET)を含む", htmlUnhit.includes("DAILY TARGET"));
    check("未達成時はgoal-hitクラスが付かない", htmlUnhit.includes('<div class="iron" id="ironRoot">'));
    check("TARGET ACHIEVEDの文言はマークアップに常に含まれる(表示はCSS側のgoal-hit制御)", htmlUnhit.includes("TARGET ACHIEVED"));
    check("TODAY'S SETSを含む", htmlUnhit.includes("TODAY'S SETS"));
    check("TOTALSを含む", htmlUnhit.includes("TOTALS"));

    currentState = {
      settings: { ironDailyTarget: 1000 },
      condition: { logs: { "2026-08-22": { gym: [
        { exercise: "ベンチプレス", weight: 60, reps: 10 },
        { exercise: "ベンチプレス", weight: 60, reps: 10 },
        { exercise: "デッドリフト", weight: 100, reps: 8 }
      ] } } }, // 600+600+800=2000 >= 1000 達成
      blocks: [],
      ironImport: { done: true, importedTotalKg: 0, importedDays: 0 }
    };
    const htmlHit = renderIronLog();
    check("達成時はgoal-hitクラスが付く", htmlHit.includes('<div class="iron goal-hit" id="ironRoot">'));
    check("3セット分のdata-id(0,1,2)を含む(削除用index)", ["0", "1", "2"].every((i) => htmlHit.includes(`data-id="${i}"`)));
    check("セット件数(3 セット)を表示", htmlHit.includes("3 セット"));
  }

  console.log(failures === 0 ? "\niron-log-core: 全件成功" : `\niron-log-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
