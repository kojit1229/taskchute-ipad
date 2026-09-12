// 共通表示・操作通知・保存結果の純粋契約。架空の全kind、不正入力、I/O失敗注入を検査する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const acorn = require("acorn");
const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, "src/ui/daily-parts/contract.js");
const source = fs.readFileSync(modulePath, "utf8");
const kinds = ["block", "schedule", "actual", "task", "project"];
const actions = [
  // R3-A/3回-03(監督者の契約追随 2026-09-11): 0秒思考の下書き保存・完了・離脱の登録行3件(実物 contract.js と同じ先頭位置)。design/CHANGELOG.md
  // S-B2b/3段-10(監督者の契約追随 2026-09-12 20:35): 上部3ボタンの「読む」の公開操作1件(実物 contract.js と同じ先頭位置)。記録の保存は設定 dailyReadingRecordEnabled(既定false)で無効。design/CHANGELOG.md
  "daily-reading-open",
  "zero-draft-save", "zero-complete", "zero-leave",
  "daily-plan-times-save", "daily-plan-times-cancel", "daily-plan-complete",
  "daily-block-start", "daily-block-end", "daily-block-duplicate", "daily-duplicate-undo",
  "edit-block", "daily-schedule-edit", "daily-actual-edit", "daily-task-complete",
  // v387 契約追随(監督者決定 2026-09-11、束B7 単位38): 単発予定の登録・完了・削除の登録行3件(画面公開は D01 まで保留)
  "daily-schedule-add", "daily-schedule-complete", "daily-schedule-delete",
  // B8/41 order explicitly adds the two placement registry paths to the fixed contract.
  "daily-gap-place", "daily-gap-create",
  "daily-search-change", "daily-search-clear", "modal-save", "modal-close", "modal-delete",
  "edit-task", "edit-project",
  "daily-report-refresh" // v386 契約追随(監督者決定 2026-09-11、fixB6): 33 の日報再生成の登録行
];
const statuses = ["saved", "unchanged", "invalid", "storage-failed", "conflict", "cancelled"];
const syncStatuses = [null, "pending", "syncing", "synced", "failed"];
const display = (kind = "block") => ({ key: `${kind}:fake-1`, kind, id: "fake-1",
  dateLabel: "架空の日", title: "練習", subtitle: "", statusLabel: "未完了", busy: false, error: "", actions: {} });
const notification = (kind = "block", action = "daily-plan-times-save") => ({ action, kind, id: "fake-1",
  draftId: "draft-1", requestId: "request-1", baseFingerprint: "fingerprint-1", values: {} });
const result = (status = "saved", syncStatus = null) => ({ status, entityId: "fake-1", errors: [], syncStatus, undoToken: null });
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
(async () => {
  const mod = await import(pathToFileURL(modulePath).href);
  const { renderSearchFrame } = await import(pathToFileURL(path.join(root, "src/ui/daily-parts/search-frame.js")).href);
  check("検索枠: 許可操作・既存互換名を保持し未知操作を拒否", () => {
    const model = { scope: "wbs", query: "", filters: { status: "", project: "", category: "", due: "" },
      options: { status: [], project: [], category: [], due: [] }, shownCount: 0, totalCount: 0,
      composing: false, emptyMessage: "架空の空結果", resultRegionId: "fixture-results" };
    const options = { escapeHTML: String, resultsHTML: "" };
    assert.ok(renderSearchFrame(model, options).includes('data-action="daily-search-clear"'));
    for (const clearAction of [...mod.DAILY_ACTIONS, "work-list-clear"]) {
      assert.ok(renderSearchFrame(model, { ...options, clearAction }).includes(`data-action="${clearAction}"`));
    }
    for (const clearAction of ["not-a-daily-action", "https://example.invalid", "javascript:alert(1)",
      "toString", "__proto__", "", null, false, 1, {}, ["daily-search-clear"]]) {
      let formatterCalls = 0;
      assert.throws(() => renderSearchFrame(model, { ...options, clearAction,
        escapeHTML: value => { formatterCalls++; return String(value); } }), TypeError);
      assert.equal(formatterCalls, 0, "不正な操作名はHTML生成前に拒否");
    }
  });
  const validate = mod.validateDailyContract;
  const valid = (type, value) => assert.deepEqual(validate(type, value), { valid: true, errors: [] });
  const invalid = (type, value) => {
    const answer = validate(type, value);
    assert.equal(answer.valid, false);
    assert.ok(answer.errors.length > 0);
  };
  check("固定の種類・操作・結果・同期状態を公開", () => {
    for (const [name, expected] of [["DAILY_KINDS", kinds], ["DAILY_ACTIONS", actions],
      ["DAILY_RESULT_STATUSES", statuses], ["DAILY_SYNC_STATUSES", syncStatuses]]) {
      assert.deepEqual(mod[name], expected);
      assert.ok(Object.isFrozen(mod[name]));
    }
  });
  for (const kind of kinds) check(`架空kind=${kind}の表示と全通知`, () => {
    valid("display", { ...display(kind), actions: Object.fromEntries(actions.map((action) => [action, false])) });
    for (const action of actions) valid("notification", notification(kind, action));
  });
  for (const status of statuses) check(`結果=${status}と全同期状態は独立`, () => {
    for (const sync of syncStatuses) valid("result", result(status, sync));
  });
  check("失敗・競合の説明と再試行用の識別子を保持", () => {
    for (const status of ["invalid", "storage-failed", "conflict"]) {
      valid("result", { ...result(status, "failed"), errors: ["架空の失敗"], entityId: null });
      valid("result", { ...result(status), errors: { start: "入力を確認" } });
    }
    valid("notification", { ...notification(), id: null, draftId: null, requestId: null, baseFingerprint: null });
    valid("result", { ...result(), undoToken: "undo-1" });
  });
  for (const [type, factory] of [["display", display], ["notification", notification], ["result", result]]) {
    check(`${type}: 必須項目の欠落と未知項目を拒否`, () => {
      for (const key of Object.keys(factory())) { const data = factory(); delete data[key]; invalid(type, data); }
      for (const key of ["html", "render", "url", "state", "unknown"]) invalid(type, { ...factory(), [key]: "bad" });
    });
    check(`${type}: 非オブジェクト・関数・循環などを拒否`, () => {
      for (const value of [null, undefined, false, 1, "", [], () => {}, new Map()]) invalid(type, value);
      const cyclic = factory(); cyclic.loop = cyclic; invalid(type, cyclic);
      invalid(type, { ...factory(), extra: NaN });
      invalid(type, { ...factory(), [Symbol("hidden")]: "bad" });
      invalid(type, Object.assign(Object.create({ injected: true }), factory()));
    });
    check(`${type}: 凍結入力に副作用なし・結果は毎回独立`, () => {
      const data = freeze(factory()); const before = JSON.stringify(data);
      valid(type, data); validate(type, data).errors.push("changed"); valid(type, data);
      assert.equal(JSON.stringify(data), before);
    });
  }
  check("表示の型・識別子・キーの衝突を検査", () => {
    for (const [key, bad] of [["kind", "unknown"], ["kind", {}], ["kind", Object.create(null)],
      ["id", null], ["id", 1], ["id", {}], ["id", " "], ["key", "task:fake-1"], ["busy", "false"],
      ["title", 1], ["subtitle", null], ["dateLabel", []], ["statusLabel", true], ["error", {}]]) {
      invalid("display", { ...display(), [key]: bad });
    }
    assert.equal(new Set(kinds.map((kind) => display(kind).key)).size, kinds.length);
    valid("display", { ...display(), title: "A & B、1 < 2", actions: { "edit-block": true } });
  });
  check("未知操作・URL・コードを非表示指定でも拒否", () => {
    for (const action of ["unknown", "https://example.invalid", "javascript:alert(1)", "toString", "__proto__"]) {
      invalid("notification", notification("block", action));
      invalid("display", { ...display(), actions: { [action]: false } });
    }
    for (const actions of [[], null, { "edit-block": "yes" }, { "edit-block": () => {} }]) {
      invalid("display", { ...display(), actions });
    }
  });
  check("通知の型とHTML・実行可能値を深い位置でも拒否", () => {
    for (const key of ["id", "draftId", "requestId", "baseFingerprint"]) {
      invalid("notification", { ...notification(), [key]: 1 });
      invalid("notification", { ...notification(), [key]: "" });
    }
    for (const values of [null, [], { title: "<img src=x onerror=alert(1)>" },
      { nested: { innerHTML: "text" } }, { nested: [() => {}] }, { value: Infinity },
      JSON.parse('{"__proto__":{"polluted":true}}'), { value: undefined }]) {
      invalid("notification", { ...notification(), values });
    }
    invalid("display", { ...display(), title: "<b>任意HTML</b>" });
    invalid("result", { ...result("invalid"), errors: ["<script>alert(1)</script>"] });
    valid("notification", { ...notification(), values: { desiredCompleted: true, start: "09:00",
      nested: [{ value: 15, empty: null }], comment: "架空の値" } });
  });
  check("結果は同期成功だけでsavedと判定しない", () => {
    for (const [key, bad] of [["status", "synced"], ["status", true], ["entityId", 123],
      ["syncStatus", "saved"], ["syncStatus", undefined], ["undoToken", {}], ["errors", "bad"], ["errors", [1]]]) {
      invalid("result", { ...result(), [key]: bad });
    }
    invalid("result", { ...result(), entityId: null });
    invalid("result", { ...result(), errors: ["保存失敗"] });
    valid("result", { ...result("storage-failed", "synced"), errors: ["端末保存に失敗"] });
  });
  check("getter失敗注入: 不正データを読まずに拒否", () => {
    let calls = 0;
    for (const field of ["title", "actions"]) {
      const data = display(); Object.defineProperty(data, field, { get() { calls++; throw Error("getter"); } });
      invalid("display", data);
    }
    const values = { nested: {} };
    Object.defineProperty(values.nested, "value", { get() { calls++; throw Error("nested getter"); } });
    invalid("notification", { ...notification(), values });
    invalid({ toString() { calls++; throw Error("type coercion"); } }, display());
    assert.equal(calls, 0);
  });
  check("import・副作用APIへの依存0、失敗する環境でも検査可能", () => {
    const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
    assert.ok(!ast.body.some((node) => node.type === "ImportDeclaration"));
    const sandbox = {}; let calls = 0;
    for (const name of ["state", "localStorage", "sessionStorage", "fetch", "XMLHttpRequest", "document",
      "window", "Date", "setTimeout", "registerActions", "saveState"]) {
      Object.defineProperty(sandbox, name, { get() { calls++; throw Error(`forbidden ${name}`); } });
    }
    vm.createContext(sandbox);
    vm.runInContext(source.replace(/^export /gm, ""), sandbox);
    for (const [type, data] of [["display", display()], ["notification", notification()],
      ["result", { ...result("storage-failed"), errors: ["模擬保存失敗"] }]]) {
      assert.equal(vm.runInContext(`validateDailyContract(${JSON.stringify(type)}, ${JSON.stringify(data)}).valid`, sandbox), true);
    }
    assert.equal(calls, 0);
  });
  check("不明な契約種別を拒否", () => {
    for (const type of ["html", "toString", "__proto__", null, undefined]) invalid(type, display());
  });
  check("新規部品のAPP_SHELL登録は1件", () => {
    const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    assert.equal(sw.split('"./src/ui/daily-parts/contract.js"').length - 1, 1);
  });
  console.log(`daily-parts-contract: ${checks} checks passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
