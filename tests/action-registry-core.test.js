// tests/action-registry-core.test.js
// v172: app.js分割・段階5-1(event dispatcherのレジストリ基盤導入)のcharacterization test。
// prep-stage5-dispatcher.md §6-1の方式どおり2部構成:
//   [1] src/ui/actions.jsの単体挙動(registerActions/dispatchAction、
//       registerModalHandler/dispatchModalSave/dispatchModalDelete、重複登録ガード、
//       未登録時のfalseフォールバック)。
//   [2] app.jsのclick dispatcher("event:click"、data-action分岐)から`action === "..."`を
//       静的抽出し、v171時点で確定させた225件のゴールデンリストと完全一致するかを検証する。
//       段階5-2以降でactionをレジストリへ移行する際は、この分岐がif連鎖から消えて
//       レジストリ側に現れることを機械的に確認する土台になる(分岐の総数・名前一覧が
//       意図せず変わったら赤になる)。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const ACTIONS_MODULE_PATH = path.join(ROOT, "src", "ui", "actions.js");

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

  console.log("[3] click dispatcherの全data-action分岐名を静的抽出し、v171時点のゴールデンリストと完全一致するか");
  const extracted = extractClickActions();
  check(`抽出件数はゴールデンリストと同じ${GOLDEN_CLICK_ACTIONS.length}件`,
    extracted.length === GOLDEN_CLICK_ACTIONS.length,
    `実際: ${extracted.length}件`);
  check("抽出したaction名一覧はゴールデンリストと完全一致(順序含む)",
    JSON.stringify(extracted) === JSON.stringify(GOLDEN_CLICK_ACTIONS),
    `差分: 追加=${JSON.stringify(extracted.filter((a) => !GOLDEN_CLICK_ACTIONS.includes(a)))} `
    + `消失=${JSON.stringify(GOLDEN_CLICK_ACTIONS.filter((a) => !extracted.includes(a)))}`);
  check("抽出したaction名に重複がない(現状のif連鎖はunique重複0という設計書の前提の再確認)",
    new Set(extracted).size === extracted.length);

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
