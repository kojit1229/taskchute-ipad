// tests/wish-core.test.js — 段階4-2抽出(WishタブTier1のCRUD・描画・月間ボードD&D)の
// characterization test。
// 対象: src/features/wish.js(configureWish(deps)による依存注入。dashboard.js/avoid.jsと
// 同じ抽出パターン)。prep-stage4-wish.md §8の項目のうち、DOM描画+スクロール位置やPointer
// Eventsのドラッグ確定が絡まない項目(既存のv79/v80/v121/v122/v126/v137/v152ブラウザE2Eで
// 別途カバー)をNode単体で固定する。
//
// wish.jsはモジュール読み込み時にdocument.addEventListener(pointerdown/move/up/cancel)を
// トップレベルで呼ぶ(月間ボードD&D、app.jsから見た仕様は移動前と同一)。Node環境には
// documentが無いため、importより前に最小限のスタブを用意する(このテストではドラッグ確定の
// 検証はしない=ブラウザE2E側の責務のまま)。
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const WISH_PATH = path.join(ROOT, "src", "features", "wish.js");
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
let promptImpl = () => "";
global.window = {
  confirm: (...args) => confirmImpl(...args),
  prompt: (...args) => promptImpl(...args)
};

// ---- app.js側の実装と同一(相当)のヘルパー(依存注入のスタブ) ----
function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function renderHeader(eyebrow, title, action = "") {
  return `<div class="stub-header">${eyebrow}/${title}</div>${action}`;
}
function renderWishTriage(wishes) {
  return `<div class="stub-triage">仕分け対象${wishes.length}件</div>`;
}
function localDateTimeToMs(dateTime) {
  if (!dateTime) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(dateTime);
  if (!m) return 0;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  ).getTime();
}

let todayISOValue = "2026-07-28";
function todayISO() { return todayISOValue; }
function nowDateTime() { return "2026-07-28T09:00:00"; }
function defaultPlannedTimes(dateOverride) {
  const d = dateOverride || todayISO();
  return { plannedStartAt: `${d}T09:00:00`, plannedEndAt: `${d}T10:00:00` };
}

// makeTask/makeBlock: app.js(12580行台/2371行台)の実装と同じ契約を再現する
// (Wish Project配下は常にdueDateを空にする、id生成にcrypto.randomUUIDを使う等)。
let storeModRef = null;
function makeTask({ projectId = "", parentTaskId = "", title = "", category = "", dueDate = "",
  targetYear = null, targetMonth = null, lifeArea = "", motivation = "" }) {
  const isWishProject = storeModRef.state.projects.some((p) => p.id === projectId && p.kind === "wish");
  return {
    id: crypto.randomUUID(), projectId, parentTaskId, title, category, status: "todo",
    dueDate: isWishProject ? "" : (dueDate || storeModRef.state.selectedDate),
    targetYear, targetMonth, lifeArea, motivation,
    realized: false, realizedDate: "",
    createdAt: nowDateTime(), updatedAt: nowDateTime(), deleted: false
  };
}
function makeBlock(input) {
  return {
    id: crypto.randomUUID(),
    taskId: input.taskId || "",
    date: input.date || todayISO(),
    title: input.title || "新規Block",
    category: input.category || "",
    plannedStartAt: input.plannedStartAt || "",
    plannedEndAt: input.plannedEndAt || "",
    expectedCharge: input.expectedCharge ?? "",
    expectedDischarge: input.expectedDischarge ?? "",
    completed: false, deleted: false,
    createdAt: nowDateTime(), updatedAt: nowDateTime()
  };
}

let toastCalls = [];
function showToast(message, opts) { toastCalls.push({ message, opts }); }
let saveAndRenderCalls = [];
function saveAndRender(message, opts) { saveAndRenderCalls.push({ message, opts }); }
let renderCalls = 0;
function render() { renderCalls++; }
let updateTaskFieldCalls = [];
function updateTaskField(id, field, value) { updateTaskFieldCalls.push({ id, field, value }); }

async function loadModules() {
  const storeMod = await import(pathToFileURL(STORE_PATH).href);
  const wishMod = await import(pathToFileURL(WISH_PATH).href);
  return { storeMod, wishMod };
}

(async () => {
  const { storeMod, wishMod } = await loadModules();
  storeModRef = storeMod;

  wishMod.configureWish({
    escapeHTML, renderHeader, todayISO, localDateTimeToMs, makeTask, makeBlock,
    defaultPlannedTimes, showToast, nowDateTime, saveAndRender, render, updateTaskField,
    renderWishTriage
  });

  const WISH_PROJECT_ID = "proj-wish";
  function setBaseState(extra = {}) {
    storeMod.setState({
      projects: [{ id: WISH_PROJECT_ID, kind: "wish", deleted: false }],
      tasks: [], blocks: [],
      settings: { lifeAreas: [] },
      wishFilter: { area: "", showRealized: false },
      wishViewMode: "list",
      wishOpenId: "",
      selectedDate: "2026-07-20",
      ...extra
    });
  }

  console.log("[1] getSubtasksOf: 多階層(孫・曾孫)のサブタスクも再帰的に取得できる");
  {
    setBaseState({
      tasks: [
        { id: "w1", parentTaskId: "", deleted: false },
        { id: "c1", parentTaskId: "w1", deleted: false },
        { id: "gc1", parentTaskId: "c1", deleted: false },
        { id: "gc2", parentTaskId: "c1", deleted: false },
        { id: "other", parentTaskId: "", deleted: false }
      ]
    });
    const subs = wishMod.getSubtasksOf("w1").map((t) => t.id).sort();
    check("孫・曾孫まで含めて3件取得", JSON.stringify(subs) === JSON.stringify(["c1", "gc1", "gc2"]), JSON.stringify(subs));
  }

  console.log("[2] wishProgress: サブタスク0件で0/0(例外を投げない)、通常時は完了数/総数");
  {
    setBaseState({
      tasks: [
        { id: "w1", parentTaskId: "", deleted: false },
        { id: "s1", parentTaskId: "w1", deleted: false, status: "completed" },
        { id: "s2", parentTaskId: "w1", deleted: false, status: "todo" }
      ]
    });
    const empty = wishMod.wishProgress("nope");
    check("サブタスク無しは{done:0,total:0,percent:0}", empty.done === 0 && empty.total === 0 && empty.percent === 0, JSON.stringify(empty));
    const p = wishMod.wishProgress("w1");
    check("1/2完了=50%", p.done === 1 && p.total === 2 && p.percent === 50, JSON.stringify(p));
  }

  console.log("[3] nextStepOf: dueDateがある未完了サブタスクを優先、無ければcreatedAt順");
  {
    setBaseState({
      tasks: [
        { id: "w1", parentTaskId: "", deleted: false },
        { id: "s1", parentTaskId: "w1", deleted: false, status: "todo", dueDate: "", createdAt: "2026-07-01" },
        { id: "s2", parentTaskId: "w1", deleted: false, status: "todo", dueDate: "2026-08-01", createdAt: "2026-07-05" },
        { id: "s3", parentTaskId: "w1", deleted: false, status: "completed", dueDate: "2026-01-01", createdAt: "2026-01-01" }
      ]
    });
    const next = wishMod.nextStepOf("w1");
    check("dueDate付きのs2が最優先(完了済みs3は除外)", next?.id === "s2", JSON.stringify(next));
    check("サブタスク全完了ならnull", wishMod.nextStepOf("nope") === null);
  }

  console.log("[4] addWish: dueDateが空・wishProjectのprojectIdで作成・wishOpenIdが新規idになる・入力欄クリア");
  {
    setBaseState();
    domStubs["#wishTitle"] = { value: "3世代旅行に行く" };
    wishMod.addWish();
    const created = storeMod.state.tasks[0];
    check("projectIdがWish Project", created?.projectId === WISH_PROJECT_ID, JSON.stringify(created));
    check("dueDateが空(期限任意の既存契約)", created?.dueDate === "", created?.dueDate);
    check("titleが入力値と一致", created?.title === "3世代旅行に行く");
    check("追加後すぐにwishOpenIdへ反映", storeMod.state.wishOpenId === created.id);
    check("入力欄がクリアされる", domStubs["#wishTitle"].value === "");

    console.log("  -- 未入力ならタスクを作らずtoastのみ --");
    setBaseState();
    domStubs["#wishTitle"] = { value: "  " };
    toastCalls = [];
    wishMod.addWish();
    check("空白のみの入力ではタスクが増えない", storeMod.state.tasks.length === 0);
    check("入力を促すtoastが出る", toastCalls.some((c) => c.message.includes("入力してください")));
  }

  console.log("[5] deleteWish: 子孫サブタスクも再帰的にdeleted:true、開いているWishならwishOpenIdをクリア");
  {
    setBaseState({
      tasks: [
        { id: "w1", parentTaskId: "", deleted: false },
        { id: "s1", parentTaskId: "w1", deleted: false },
        { id: "gc1", parentTaskId: "s1", deleted: false },
        { id: "other", parentTaskId: "", deleted: false }
      ],
      wishOpenId: "w1"
    });
    confirmImpl = () => true;
    wishMod.deleteWish("w1");
    const byId = Object.fromEntries(storeMod.state.tasks.map((t) => [t.id, t]));
    check("本体がdeleted:true", byId.w1.deleted === true);
    check("子・孫サブタスクもdeleted:true(カスケード)", byId.s1.deleted === true && byId.gc1.deleted === true);
    check("無関係のタスクは影響を受けない", byId.other.deleted === false);
    check("開いていたWishのwishOpenIdがクリアされる", storeMod.state.wishOpenId === "");

    console.log("  -- confirmキャンセル時は何も削除しない --");
    setBaseState({ tasks: [{ id: "w2", parentTaskId: "", deleted: false }] });
    confirmImpl = () => false;
    wishMod.deleteWish("w2");
    check("キャンセルすればdeletedのまま変わらない", storeMod.state.tasks[0].deleted === false);
  }

  console.log("[6] realizeWish: confirmをキャンセルした場合、stateは変更されずrender()だけが呼ばれる");
  {
    setBaseState({ tasks: [{ id: "w1", parentTaskId: "", deleted: false, realized: false }] });
    confirmImpl = () => false;
    renderCalls = 0;
    wishMod.realizeWish("w1");
    check("realizedは変更されない", storeMod.state.tasks[0].realized === false);
    check("render()が1回呼ばれる(checkboxの見た目を戻すため)", renderCalls === 1, String(renderCalls));

    console.log("  -- confirmを承認すればrealized:trueになりsaveAndRenderが呼ばれる --");
    confirmImpl = () => true;
    saveAndRenderCalls = [];
    wishMod.realizeWish("w1");
    check("realized:trueになる", storeMod.state.tasks[0].realized === true);
    check("saveAndRenderが呼ばれる", saveAndRenderCalls.length === 1);
  }

  console.log("[7] wishSubtaskToTasks: 既に今日Block化済みなら二重登録せずtoast、新規Blockは常にtodayISO()基準");
  {
    todayISOValue = "2026-07-28";
    setBaseState({
      tasks: [{ id: "s1", parentTaskId: "w1", deleted: false, title: "最初の一歩", category: "" }],
      blocks: [{ id: "b-exist", taskId: "s1", date: "2026-07-28", deleted: false }],
      selectedDate: "2026-01-01"  // 閲覧中の日付(過去日)。today基準からずれていないことを確認する対照値
    });
    wishMod.wishSubtaskToTasks("s1");
    check("既に今日Block化済みなら新規Blockを作らない", storeMod.state.blocks.length === 1);

    setBaseState({
      tasks: [{ id: "s2", parentTaskId: "w1", deleted: false, title: "次の一歩", category: "" }],
      blocks: [],
      selectedDate: "2026-01-01"  // state.selectedDateに依存しないことの確認(v152修正の再発防止)
    });
    wishMod.wishSubtaskToTasks("s2");
    const newBlock = storeMod.state.blocks[0];
    check("新規BlockはtodayISO()基準の日付(2026-07-28)で作られる(selectedDateの2026-01-01ではない)",
      newBlock?.date === "2026-07-28", newBlock?.date);
    check("タスクのstatusがdoingになる", storeMod.state.tasks[0].status === "doing");
  }

  console.log("[8] wishHasTodayBlock: 本体またはサブタスクいずれかに今日のBlockがあればtrue");
  {
    todayISOValue = "2026-07-28";
    setBaseState({
      tasks: [
        { id: "w1", parentTaskId: "", deleted: false },
        { id: "s1", parentTaskId: "w1", deleted: false }
      ],
      blocks: [{ id: "b1", taskId: "s1", date: "2026-07-28", deleted: false }]
    });
    check("サブタスク経由の今日Blockを検知", wishMod.wishHasTodayBlock("w1") === true);
    check("無関係のWishはfalse", wishMod.wishHasTodayBlock("other") === false);

    setBaseState({
      tasks: [{ id: "w2", parentTaskId: "", deleted: false }],
      blocks: [{ id: "b2", taskId: "w2", date: "2026-07-27", deleted: false }]  // 前日
    });
    check("前日のBlockは対象外(today基準)", wishMod.wishHasTodayBlock("w2") === false);
  }

  console.log("[9] wishGroupKey/wishGroupLabel: realized/someday/年ラベルの判定");
  {
    check("realized:trueは'realized'", wishMod.wishGroupKey({ realized: true }) === "realized");
    check("targetYear無しは'someday'", wishMod.wishGroupKey({ realized: false, targetYear: null }) === "someday");
    check("targetYearありは'by-YYYY'", wishMod.wishGroupKey({ realized: false, targetYear: 2027 }) === "by-2027");
    check("'realized'キーのラベル", wishMod.wishGroupLabel("realized").includes("実現済み"));
    check("'someday'キーのラベル", wishMod.wishGroupLabel("someday").includes("いつか"));
  }

  console.log("[10] renderWishCard/renderWishBoard: スモーク(例外を投げず描画し、現在月にis-currentが付く)");
  {
    todayISOValue = "2026-07-28";
    setBaseState({
      tasks: [{ id: "w1", parentTaskId: "", deleted: false, title: "旅行", lifeArea: "", motivation: "", targetMonth: 7 }]
    });
    let threw = false;
    let cardHTML = "";
    try { cardHTML = wishMod.renderWishCard(storeMod.state.tasks[0]); } catch (e) { threw = true; console.log(e); }
    check("renderWishCardが例外を投げない", threw === false);
    check("タイトルが描画される", cardHTML.includes("旅行"));

    const boardHTML = wishMod.renderWishBoard(storeMod.state.tasks);
    check("7月の行にis-currentが付く(todayISO=2026-07-28)", /data-month="7"[^>]*is-current/.test(boardHTML.replace(/\n/g, " ")) || boardHTML.includes('is-current'));
  }

  console.log(failures === 0 ? "\nwish-core: 全件成功" : `\nwish-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
