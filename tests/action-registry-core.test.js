// tests/action-registry-core.test.js
// v172: app.js分割・段階5-1(event dispatcherのレジストリ基盤導入)のcharacterization test。
// v173: 段階5-2(抽出済み5feature=avoid/wish/dashboard/journal/routineのaction移行)で
// [3]を拡張した。
// v174: 段階5-3(残ドメイン=settings/sync/core(nav)、20分岐の相乗り移行)で[3]をさらに拡張した。
// この20件はsrc/features/へ未抽出のため、app.js自身がregisterActionsを直接呼ぶ(5featureの
// configureXxxのようにdeps注入で呼び出す関数がない)。app.jsはDOM初期化を伴い素朴にはNode環境で
// importできないため、この20件はダミー実行ではなく静的正規表現抽出(extractAppRegisteredActions、
// §2のextractClickActionsと同じ方式)で検証する。
// prep-stage5-dispatcher.md §6-1の方式どおり構成:
//   [1] src/ui/actions.jsの単体挙動(registerActions/dispatchAction、
//       registerModalHandler/dispatchModalSave/dispatchModalDelete、重複登録ガード、
//       未登録時のfalseフォールバック)。
//   [2] app.jsのclick dispatcher("event:click"、data-action分岐)から`action === "..."`を
//       静的抽出する(v171時点で確定させた225件のゴールデンリストは維持したまま、
//       段階5-2/5-3で移行済みの分だけif連鎖から消えている前提)。
//   [3] 「if連鎖側の残存分岐リスト」(§2で静的抽出)と「レジストリ側の登録済みリスト」
//       (5featureのconfigureXxxを空depsで呼ぶ動的実測 + app.js自身のregisterActions呼び出しの
//       静的抽出)の**和集合が225件のゴールデンリストと完全一致・重複ゼロ**であることを検証する
//       (総数と名前一覧の保存則。段階5以降でさらに分岐を移行する際もこの形式を維持する)。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const ACTIONS_MODULE_PATH = path.join(ROOT, "src", "ui", "actions.js");
const FEATURE_MODULE_PATHS = [
  path.join(ROOT, "src", "features", "avoid.js"),
  path.join(ROOT, "src", "features", "dashboard.js"),
  path.join(ROOT, "src", "features", "wish.js"),
  path.join(ROOT, "src", "features", "journal.js"),
  path.join(ROOT, "src", "features", "routine.js")
];

// wish.jsはモジュール読み込み時にdocument.addEventListener(pointerdown/move/up/cancel、月間ボード
// D&D)をトップレベルで呼ぶ(tests/wish-core.test.jsと同じ既知の事情)。Node環境にはdocumentが
// 無いため、5featureをimportする前に最小限のスタブを用意する(ドラッグ確定の検証はしない=
// ブラウザE2E側の責務のまま。actions.js自身はstateもDOMも参照しないため[1][2]には影響しない)。
global.document = { addEventListener: () => {} };

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// §6-1: v171時点(段階5-1着手直前)のclick dispatcher(225分岐)から確定させたゴールデンリスト。
// 増減・リネームがあれば、それが意図した変更(action追加/削除/移行)かどうかを必ず確認すること。
const GOLDEN_CLICK_ACTIONS = [
  "nav", "date-prev", "date-next", "dashboard-date-prev", "dashboard-date-next", "today",
  "set-morning", "set-sleep", "toggle-meds", "set-capacity", "set-evening-mood",
  "add-gym-entry", "delete-gym-entry",
  "store-visit-add", "store-visit-edit", "store-visit-delete", "store-visit-year",
  "add-project", "delete-project", "add-task", "toggle-task", "toggle-criteria-request",
  "task-today", "home-add-today", "home-jump", "delete-task",
  "toggle-project-collapse", "toggle-task-collapse",
  "suspend-project", "resume-project", "suspend-task", "resume-task",
  "toggle-show-suspended", "toggle-wbs-hide-done", "toggle-tasks-show-future",
  "toggle-wbs-edit", "wbs-collapse-all",
  "add-block", "toggle-block", "toggle-task-complete", "now-start", "now-end", "delete-block",
  "bulk-approve-planned", "now-mode-open", "now-mode-close",
  "now-conveyor-complete", "now-conveyor-skip",
  "generate-report", "download-report", "download-data", "save-github", "load-github",
  "gate-continue", "reset-demo",
  "toggle-mit", "mit-candidate-add",
  "routine-mode", "garden-pixel-month", "routine-bulk-check", "routine-fallback",
  "hyperfocus-gate-fallback", "hyperfocus-gate-make-block", "hyperfocus-gate-later",
  "body-scan-fatigue", "body-scan-part", "body-scan-discard",
  "chain-run-open", "chain-step-complete", "chain-run-close", "chain-new", "chain-edit",
  "start-pomodoro", "stop-pomodoro", "interrupt-reason", "interrupt-reason-cancel",
  "complete-pomodoro", "declare-confirm", "declare-skip", "report-outcome", "report-skip",
  "incomplete-reason-chip", "incomplete-reason-skip", "guided-access-dismiss",
  "go-break", "end-break", "continue-focus", "finish-block",
  "edit-project", "edit-task", "edit-block", "modal-close", "modal-save", "modal-delete",
  "lev-judge",
  "vision-section", "open-vision-board", "vision-board-tab", "vision-board-load",
  "vision-board-load-images", "vision-board-retry-images",
  "open-md-in-github", "reload-md", "ai-report-type", "ai-report-refresh",
  "open-future-letter", "ai-work-approve", "ai-work-question",
  "reading-save",
  "experiment-add", "edit-experiment", "experiment-keep", "experiment-drop",
  "experiment-copy-conclusion",
  "pomo-tab", "push-report", "add-task-to-project", "add-subtask",
  "timeline-new-block", "timeline-mode", "complete-block-with-actual",
  "add-category", "delete-category", "add-break-message", "delete-break-message",
  "tl-zoom", "tl-energy-mode",
  "toggle-journal-segment", "toggle-home-reflect-fold", "toggle-settings-sync",
  "toggle-sidebar", "toggle-pomo-fullscreen", "toggle-study-with-me",
  "add-wish", "open-wish", "add-wish-subtask", "toggle-wish-subtask",
  "wish-subtask-to-tasks", "wish-realize", "wish-unrealize", "delete-wish",
  "wish-view-mode", "wish-board-jump-current",
  "triage-choice", "triage-undo", "triage-reason-chip", "triage-reason-skip",
  "add-avoid", "delete-avoid",
  "zt-add-toggle", "zt-add-cancel", "zt-add-submit", "zt-tab", "home-tab",
  "zt-fav-toggle", "zt-importance-toggle", "zt-theme-delete",
  "zt-suggestion-adopt", "zt-suggestion-dismiss",
  "zt-group-add", "zt-group-rename", "zt-group-delete", "zt-group-toggle",
  "zt-write", "zt-save", "zt-discard", "zt-entry-open", "zt-edit-close", "zt-edit-save",
  "zero-tab",
  "question-add", "question-edit", "question-to-theme", "question-settle", "question-reopen",
  "question-bridge", "question-bridge-submit", "question-delete",
  "entry-to-question", "open-questions",
  "open-weekly", "weekly-prev", "weekly-next", "weekly-change-theme",
  "weekly-download", "weekly-push", "weekly-open-question",
  "open-cycle", "cycle-prev", "cycle-next", "cycle-start-new", "cycle-download", "cycle-push",
  "report-copy-ai", "report-share-ai",
  "ai-mit-adopt", "ai-task-adopt", "ai-task-dismiss",
  "weekly-wish-open", "weekly-wish-submit", "weekly-wish-toggle",
  "ai-schedule", "ai-morning-plan",
  "zerosec-theme-add", "zerosec-theme-skip",
  "draft-confirm", "draft-discard", "draft-remove", "draft-undo",
  "draft-remove-reason", "draft-remove-reason-dismiss",
  "weekly-suggest-add",
  "open-backup-list", "restore-backup",
  "stats-range", "run-archive",
  "open-search", "search-jump",
  "carry-over", "migration-ritual-choice", "ideal-retry",
  "energy-open-routine", "energy-open-category",
  "timeline-clear-cat", "routine-clear-day"
];

// v173: 段階5-2で以下の5feature(avoid/wish/dashboard/journal/routine)の分岐を
// registerActions経由のレジストリへ移行した(GOLDEN_CLICK_ACTIONSの部分集合、38件)。
// ハンドラ本体はif連鎖からロジック無改変で移しただけで、追加・削除・リネームはしていない。
// triage-*(wish Tier3・未抽出)とbody-scan-*(routineとは別ドメイン・未抽出)は
// 確信が持てないため今回は移行せず、if連鎖に残した(下のEXPECTED_REMAINING_IF_CHAINに含まれる)。
const MIGRATED_TO_REGISTRY_ACTIONS = [
  // src/features/avoid.js(configureAvoid)
  "add-avoid", "delete-avoid",
  // src/features/dashboard.js(configureDashboard)
  "dashboard-date-prev", "dashboard-date-next",
  // src/features/wish.js(configureWish、Tier1のみ)
  "add-wish", "open-wish", "add-wish-subtask", "toggle-wish-subtask",
  "wish-subtask-to-tasks", "wish-realize", "wish-unrealize", "delete-wish",
  "wish-view-mode", "wish-board-jump-current",
  // src/features/journal.js(configureJournal、コンディションOS+運動記録+お店ログ)
  "set-morning", "set-sleep", "toggle-meds", "set-capacity", "set-evening-mood",
  "add-gym-entry", "delete-gym-entry",
  "store-visit-add", "store-visit-edit", "store-visit-delete", "store-visit-year",
  // src/features/routine.js(configureRoutine)
  "routine-mode", "garden-pixel-month", "routine-bulk-check", "routine-fallback",
  "hyperfocus-gate-fallback", "hyperfocus-gate-make-block", "hyperfocus-gate-later",
  "chain-run-open", "chain-step-complete", "chain-run-close", "chain-new", "chain-edit",
  "routine-clear-day"
];

// v174: 段階5-3で以下20件(settings 11 + sync 8 + core/nav 1)を、app.js自身が呼ぶ
// registerActions({...})(app.js内、src/features/への抽出はまだ行っていない)へ移行した。
// ハンドラ本体はif連鎖からロジック無改変で移しただけで、追加・削除・リネームはしていない。
// timeline/journal内の残りドメイン(0秒思考・週次・サイクル・問い・WBS/Project/Task CRUD・
// AIスケジュール下書き・ビジョンボード・実験ログ・検索・世代バックアップの一部・triage-*・
// body-scan-*等)は確信が持てる範囲に絞ったため今回は移行せず、if連鎖に残した
// (下のEXPECTED_REMAINING_IF_CHAINに含まれる。残りは次リリースで扱う)。
const APP_JS_REGISTERED_ACTIONS = [
  "nav",
  "toggle-show-suspended", "toggle-wbs-hide-done", "toggle-tasks-show-future",
  "toggle-wbs-edit", "wbs-collapse-all",
  "add-category", "delete-category", "add-break-message", "delete-break-message",
  "toggle-sidebar", "toggle-settings-sync",
  "save-github", "load-github", "gate-continue", "reset-demo", "push-report",
  "open-backup-list", "restore-backup", "run-archive"
];

const EXPECTED_REMAINING_IF_CHAIN = GOLDEN_CLICK_ACTIONS.filter(
  (a) => !MIGRATED_TO_REGISTRY_ACTIONS.includes(a) && !APP_JS_REGISTERED_ACTIONS.includes(a)
);

function extractClickActions() {
  const startMarker = 'document.addEventListener("click", (event) => {';
  const endMarker = "// v71: ホームの折りたたみカード";
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("click dispatcherの境界マーカーが見つからない(app.js構造が変わった可能性)");
  }
  const body = appSource.slice(start, end);
  return [...body.matchAll(/action === "([^"]+)"/g)].map((m) => m[1]);
}

// v174: app.js自身が呼ぶregisterActions({...})(settings/sync/core、5-3で移行した20件)を
// 静的抽出する。app.jsはDOM初期化を伴うためNode環境でそのままimportできず、5featureの
// configureXxxのような「空depsで呼んで実測する」方式が使えない(§3-bコメント参照)。
// registerActions({...})の呼び出しは行頭が`"key":`の形で並ぶオブジェクトリテラルのため、
// 呼び出し開始位置から次の`let toastTimer = null;`(app.js固有の直後の行)までを切り出し、
// 行頭のクォート付きキーだけを拾う(showToastの引数文字列等、コロンを伴わない`"..."`は
// 拾わない)。
function extractAppRegisteredActions() {
  const startMarker = "registerActions({";
  const endMarker = "let toastTimer = null;";
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("app.js内のregisterActions呼び出しの境界マーカーが見つからない(構造が変わった可能性)");
  }
  const body = appSource.slice(start, end);
  return [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
}

(async () => {
  const actionsMod = await import(pathToFileURL(ACTIONS_MODULE_PATH).href);

  console.log("[1] registerActions/dispatchAction: 単体挙動");
  let calledWith = null;
  actionsMod.registerActions({
    "__test-action-a": (ctx) => { calledWith = ctx; }
  });
  const ctx = { event: { type: "click" }, target: { dataset: { id: "x" } }, id: "x" };
  const handled = actionsMod.dispatchAction("__test-action-a", ctx);
  check("登録済みactionはtrueを返しhandlerを呼ぶ", handled === true && calledWith === ctx);
  check("dispatchAction経由でctx(event/target/id)がそのままhandlerへ渡る",
    calledWith.event === ctx.event && calledWith.target === ctx.target && calledWith.id === "x");

  const unhandled = actionsMod.dispatchAction("__test-action-not-registered", ctx);
  check("未登録actionはfalseを返す(呼び出し側の既存if連鎖へフォールバックさせるため)", unhandled === false);

  let duplicateThrew = false;
  try {
    actionsMod.registerActions({ "__test-action-a": () => {} });
  } catch (e) {
    duplicateThrew = true;
  }
  check("同名actionの再登録は例外を投げる(重複登録ガード)", duplicateThrew === true);

  check("__debugActionNames()に登録済みaction名が現れる",
    actionsMod.__debugActionNames().includes("__test-action-a"));

  console.log("[2] registerModalHandler/dispatchModalSave/dispatchModalDelete: 単体挙動");
  let savedWith = null;
  let deletedWith = null;
  actionsMod.registerModalHandler("__test-type", {
    save: (id, fields) => { savedWith = { id, fields }; },
    delete: (id) => { deletedWith = id; }
  });
  const saveHandled = actionsMod.dispatchModalSave("__test-type", "id-1", { a: 1 });
  check("登録済みtypeのsaveはtrueを返しhandlerを呼ぶ",
    saveHandled === true && savedWith.id === "id-1" && savedWith.fields.a === 1);
  const deleteHandled = actionsMod.dispatchModalDelete("__test-type", "id-1");
  check("登録済みtypeのdeleteはtrueを返しhandlerを呼ぶ",
    deleteHandled === true && deletedWith === "id-1");

  const saveUnhandled = actionsMod.dispatchModalSave("__test-type-not-registered", "id-2", {});
  const deleteUnhandled = actionsMod.dispatchModalDelete("__test-type-not-registered", "id-2");
  check("未登録typeのsave/deleteは両方falseを返す", saveUnhandled === false && deleteUnhandled === false);

  let duplicateModalThrew = false;
  try {
    actionsMod.registerModalHandler("__test-type", { save: () => {} });
  } catch (e) {
    duplicateModalThrew = true;
  }
  check("同名typeの再登録は例外を投げる(重複登録ガード)", duplicateModalThrew === true);

  check("__debugModalTypes()に登録済みtypeが現れる",
    actionsMod.__debugModalTypes().includes("__test-type"));

  console.log("[3-a] click dispatcherのif連鎖側に残る分岐名を静的抽出し、移行済み38件を除いた期待値と一致するか");
  const extracted = extractClickActions();
  check(`if連鎖側の残存件数は期待どおり${EXPECTED_REMAINING_IF_CHAIN.length}件`,
    extracted.length === EXPECTED_REMAINING_IF_CHAIN.length,
    `実際: ${extracted.length}件`);
  check("if連鎖側の残存action名一覧はEXPECTED_REMAINING_IF_CHAINと完全一致(順序含む)",
    JSON.stringify(extracted) === JSON.stringify(EXPECTED_REMAINING_IF_CHAIN),
    `差分: 追加=${JSON.stringify(extracted.filter((a) => !EXPECTED_REMAINING_IF_CHAIN.includes(a)))} `
    + `消失=${JSON.stringify(EXPECTED_REMAINING_IF_CHAIN.filter((a) => !extracted.includes(a)))}`);
  check("if連鎖側の残存action名に重複がない",
    new Set(extracted).size === extracted.length);

  console.log("[3-b] 5feature(avoid/wish/dashboard/journal/routine)のconfigureXxxを空depsで呼び、"
    + "registerActionsが実際に登録するaction名がMIGRATED_TO_REGISTRY_ACTIONSと一致するか");
  // configureXxx本体はdestructuring代入+registerActions呼び出しのみで、渡されたdepsの中身は
  // ハンドラのクロージャ内で遅延参照されるだけ(登録時には呼ばれない)ため、空depsで安全に呼べる
  // (src/features/*.js側のconfigureXxx実装を参照。design doc §6-1の重複登録ガード確認も兼ねる)。
  const featureMods = await Promise.all(
    FEATURE_MODULE_PATHS.map((p) => import(pathToFileURL(p).href))
  );
  const [avoidMod, dashboardMod, wishMod, journalMod, routineMod] = featureMods;
  avoidMod.configureAvoid({});
  dashboardMod.configureDashboard({});
  wishMod.configureWish({});
  journalMod.configureJournal({});
  routineMod.configureRoutine({});
  const registered = actionsMod.__debugActionNames().filter((name) => !name.startsWith("__test"));
  check(`レジストリ側の登録件数は期待どおり${MIGRATED_TO_REGISTRY_ACTIONS.length}件`,
    registered.length === MIGRATED_TO_REGISTRY_ACTIONS.length,
    `実際: ${registered.length}件 (${JSON.stringify(registered)})`);
  check("レジストリ側の登録action名一覧はMIGRATED_TO_REGISTRY_ACTIONSと集合として完全一致",
    new Set(registered).size === registered.length
    && registered.length === MIGRATED_TO_REGISTRY_ACTIONS.length
    && MIGRATED_TO_REGISTRY_ACTIONS.every((a) => registered.includes(a)),
    `差分: 追加=${JSON.stringify(registered.filter((a) => !MIGRATED_TO_REGISTRY_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(MIGRATED_TO_REGISTRY_ACTIONS.filter((a) => !registered.includes(a)))}`);

  console.log("[3-b'] app.js自身が呼ぶregisterActions({...})(settings/sync/core、段階5-3)を静的抽出し、"
    + "APP_JS_REGISTERED_ACTIONSと一致するか(app.jsはDOM初期化を伴うためNode importで実測できず、"
    + "extractClickActionsと同じ静的抽出方式を用いる)");
  const appRegistered = extractAppRegisteredActions();
  check(`app.js直接登録の件数は期待どおり${APP_JS_REGISTERED_ACTIONS.length}件`,
    appRegistered.length === APP_JS_REGISTERED_ACTIONS.length,
    `実際: ${appRegistered.length}件 (${JSON.stringify(appRegistered)})`);
  check("app.js直接登録のaction名一覧はAPP_JS_REGISTERED_ACTIONSと集合として完全一致",
    new Set(appRegistered).size === appRegistered.length
    && appRegistered.length === APP_JS_REGISTERED_ACTIONS.length
    && APP_JS_REGISTERED_ACTIONS.every((a) => appRegistered.includes(a)),
    `差分: 追加=${JSON.stringify(appRegistered.filter((a) => !APP_JS_REGISTERED_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(APP_JS_REGISTERED_ACTIONS.filter((a) => !appRegistered.includes(a)))}`);

  console.log("[3-c] 「if連鎖側の残存分岐」+「レジストリ側の登録済み(5feature動的 + app.js直接静的)」の"
    + "和集合が225件のゴールデンリストと完全一致・重複ゼロであること(保存則)");
  const union = [...extracted, ...registered, ...appRegistered];
  check("if連鎖側・5feature側・app.js直接側の間で重複が無い",
    new Set(union).size === extracted.length + registered.length + appRegistered.length,
    `重複: ${JSON.stringify(union.filter((a, i) => union.indexOf(a) !== i))}`);
  check(`和集合の件数はゴールデンリストと同じ${GOLDEN_CLICK_ACTIONS.length}件`,
    union.length === GOLDEN_CLICK_ACTIONS.length,
    `実際: ${union.length}件`);
  check("和集合はゴールデンリストと集合として完全一致",
    new Set(union).size === GOLDEN_CLICK_ACTIONS.length
    && GOLDEN_CLICK_ACTIONS.every((a) => union.includes(a)),
    `差分: 追加=${JSON.stringify(union.filter((a) => !GOLDEN_CLICK_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(GOLDEN_CLICK_ACTIONS.filter((a) => !union.includes(a)))}`);

  console.log("[4] 段階5-1のフック配線がapp.js内に存在すること(dispatch呼び出し箇所の接続契約)");
  check("click dispatcherの先頭にdispatchAction(action, { event, target, id })呼び出しがある",
    /if \(dispatchAction\(action, \{ event, target, id \}\)\) return;/.test(appSource));
  check("submitModalの先頭にdispatchModalSave呼び出しがある",
    /if \(dispatchModalSave\(state\.modal\.type, state\.modal\.id, fields\)\) return;/.test(appSource));
  check("deleteFromModalの先頭にdispatchModalDelete呼び出しがある",
    /if \(dispatchModalDelete\(state\.modal\.type, state\.modal\.id\)\) \{/.test(appSource));

  console.log(failures === 0 ? "\n✅ action-registry-core ALL PASS" : `\n❌ action-registry-core: ${failures} 件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
