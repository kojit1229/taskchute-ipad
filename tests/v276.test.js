// v276: 時刻入力の5分整列 + GATEルーティンのワンタップ完了を押下実時刻で記録する。
// 発注のテスト網羅条項(a)〜(d)を、文字列丸め単体・モーダル表示/保存・完了経路・日報/表示で固定する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, dismissBodyScanIfOpen } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const APP_PATH = path.join(ROOT, "app.js");
const TOWER_PATH = path.join(ROOT, "src", "features", "today-tower.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const TODAY = "2026-08-27";

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function functionSource(name) {
  const start = APP_SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} source marker not found`);
  const brace = APP_SOURCE.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < APP_SOURCE.length; index++) {
    if (APP_SOURCE[index] === "{") depth++;
    if (APP_SOURCE[index] === "}") depth--;
    if (depth === 0) return APP_SOURCE.slice(start, index + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

console.log("[1] roundDateTimeTo5Min: Date文字列パースなしの最近傍5分丸め");
const roundSource = functionSource("roundDateTimeTo5Min");
const roundSandbox = { String, Number, Math, pad2: (value) => String(value).padStart(2, "0") };
vm.createContext(roundSandbox);
vm.runInContext(roundSource, roundSandbox);
const roundCases = [
  ["切り捨て", "2026-08-27T10:02", "2026-08-27T10:00"],
  ["切り上げ", "2026-08-27T10:03", "2026-08-27T10:05"],
  ["時跨ぎ", "2026-08-27T10:58", "2026-08-27T11:00"],
  ["23:58は同日末尾へクランプ", "2026-08-27T23:58", "2026-08-27T23:55"],
  ["30日月の月末クランプ", "2026-04-30T23:58", "2026-04-30T23:55"],
  ["月末クランプ", "2026-08-31T23:58", "2026-08-31T23:55"],
  ["年末クランプ", "2026-12-31T23:58", "2026-12-31T23:55"],
  ["うるう日クランプ", "2028-02-29T23:58", "2028-02-29T23:55"],
  ["秒付きは秒を落とす", "2026-08-27T10:07:59", "2026-08-27T10:05"],
  ["既に5分境界", "2026-08-27T10:25:45", "2026-08-27T10:25"]
];
for (const [name, input, expected] of roundCases) {
  const actual = roundSandbox.roundDateTimeTo5Min(input);
  check(name, actual === expected, `${input} -> ${actual}, expected=${expected}`);
}
check("不正日時は空文字へfail-close", roundSandbox.roundDateTimeTo5Min("2026-02-30T10:00") === "");
check("丸めヘルパーにnew Dateが混入しない", !/new\s+Date\s*\(/.test(roundSource));

(async () => {
  const towerModule = await import(pathToFileURL(TOWER_PATH).href);
  console.log("[2] GATE母集団の共有条件: category=ルーティンかつoneTap/deleted除外");
  check("通常ルーティンはGATE対象", towerModule.isRoutineGateBlock({ category: "ルーティン" }));
  check("非ルーティンoneTapは混入しない", !towerModule.isRoutineGateBlock({ category: "仕事", oneTap: true }));
  check("oneTapルーティンは現行GATE対象外", !towerModule.isRoutineGateBlock({ category: "ルーティン", oneTap: true }));
  check("削除済みルーティンは対象外", !towerModule.isRoutineGateBlock({ category: "ルーティン", deleted: true }));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    serviceWorkers: "block", viewport: { width: 1024, height: 1200 }, timezoneId: "Asia/Tokyo"
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const fixedMorning = new Date(Date.UTC(2026, 7, 27, 1, 2, 45));
  await page.clock.setFixedTime(fixedMorning);

  function block(id, extra = {}) {
    return {
      id, taskId: "", date: TODAY, title: id, category: "", oneTap: false,
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      carryCount: 0, isMIT: false, source: "", estimateMin: null, leverageType: "",
      createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false,
      ...extra
    };
  }

  async function seed(blocks, view = "timeline") {
    await page.evaluate(({ KEY, blocks, view, TODAY }) => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.blocks = blocks;
      state.tasks = [];
      state.projects = [];
      state.recurrences = [];
      state.reports = {};
      state.selectedDate = TODAY;
      state.currentView = view;
      state.timelineMode = "planned";
      localStorage.setItem(KEY, JSON.stringify(state));
    }, { KEY, blocks, view, TODAY });
    await page.reload();
    await page.waitForFunction(({ KEY, view }) => {
      const stored = JSON.parse(localStorage.getItem(KEY));
      return stored.currentView === view && document.querySelector("#app")?.dataset.view === view;
    }, { KEY, view });
  }

  async function dispatch(action, id = "", data = {}) {
    await page.evaluate(({ action, id, data }) => {
      const button = document.createElement("button");
      button.dataset.action = action;
      if (id) button.dataset.id = id;
      Object.assign(button.dataset, data);
      document.body.appendChild(button);
      button.click();
      button.remove();
    }, { action, id, data });
  }

  async function storedBlock(id) {
    return page.evaluate(({ KEY, id }) => JSON.parse(localStorage.getItem(KEY)).blocks.find((entry) => entry.id === id), { KEY, id });
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[3] 実績登録モーダル: 既定値を5分境界へ表示しsaveState経由で永続化");
    await seed([block("actual-modal", {
      plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
      actualStartAt: `${TODAY}T10:12:59`, actualEndAt: `${TODAY}T10:44:34`
    })]);
    await dispatch("complete-block-with-actual", "actual-modal");
    await page.locator('.modal-title:has-text("実績を登録")').waitFor();
    const actualDefaults = await page.locator('[data-modal-field="actualStartAt"], [data-modal-field="actualEndAt"]').evaluateAll(
      (inputs) => inputs.map((input) => input.value));
    check("既存実績開始が予定より優先され10:10", actualDefaults[0] === `${TODAY}T10:10`, JSON.stringify(actualDefaults));
    check("既存実績終了が予定より優先され10:45", actualDefaults[1] === `${TODAY}T10:45`, JSON.stringify(actualDefaults));
    await page.locator('[data-action="modal-save"]').click();
    // v293追随: 新規完了(actual-modalはexisting.completed=false→true)のため、実績登録
    // モーダルはcloseModal()直後にopenBodyScanModal()で身体スキャンモーダルへ置き換わる
    // (どちらも.modal-cardを持つため、素の"detached"待ちは成立しない)。先に片付ける。
    await dismissBodyScanIfOpen(page);
    await page.locator(".modal-card").waitFor({ state: "detached" });
    let saved = await storedBlock("actual-modal");
    check("丸め後の既存実績値がlocalStorageへ保存", saved.actualStartAt === `${TODAY}T10:10:00`
      && saved.actualEndAt === `${TODAY}T10:45:00`, JSON.stringify(saved));

    console.log("[4] Block編集: 秒付き既存4値を表示時に整列し、未操作保存でも内容を保持");
    await seed([
      block("seconds-existing", {
        title: "秒付き既存実績", plannedStartAt: `${TODAY}T09:57:44`, plannedEndAt: `${TODAY}T10:32:18`,
        actualStartAt: `${TODAY}T10:02:59`, actualEndAt: `${TODAY}T10:28:01`, completed: true
      }),
      block("untouched-seconds", {
        plannedStartAt: `${TODAY}T07:01:02`, plannedEndAt: `${TODAY}T07:31:32`,
        actualStartAt: `${TODAY}T07:06:07`, actualEndAt: `${TODAY}T07:26:27`, completed: true
      })
    ]);
    await dispatch("edit-block", "seconds-existing");
    await page.locator('.modal-title:has-text("Block を編集")').waitFor();
    const fieldValues = await page.locator('[data-modal-field="plannedStartAt"], [data-modal-field="plannedEndAt"], [data-modal-field="actualStartAt"], [data-modal-field="actualEndAt"]').evaluateAll(
      (inputs) => inputs.map((input) => input.value));
    check("Block editing: actual then planned, all four values rounded to five minutes", JSON.stringify(fieldValues) === JSON.stringify([
      `${TODAY}T10:00`, `${TODAY}T10:30`, `${TODAY}T09:55`, `${TODAY}T10:30`
    ]), JSON.stringify(fieldValues));
    await page.locator('[data-action="modal-save"]').click();
    await page.locator(".modal-card").waitFor({ state: "detached" });
    saved = await storedBlock("seconds-existing");
    check("秒付き既存データは編集保存後もBlock内容を保持", saved.title === "秒付き既存実績" && saved.completed === true);
    check("未操作保存で丸めた4値を正確に永続化", JSON.stringify([
      saved.plannedStartAt, saved.plannedEndAt, saved.actualStartAt, saved.actualEndAt
    ]) === JSON.stringify([
      `${TODAY}T09:55:00`, `${TODAY}T10:30:00`, `${TODAY}T10:00:00`, `${TODAY}T10:30:00`
    ]), JSON.stringify(saved));
    const untouched = await storedBlock("untouched-seconds");
    check("Block A保存でBlock Bの秒付き全時刻はバイト不変", JSON.stringify([
      untouched.plannedStartAt, untouched.plannedEndAt, untouched.actualStartAt, untouched.actualEndAt
    ]) === JSON.stringify([
      `${TODAY}T07:01:02`, `${TODAY}T07:31:32`, `${TODAY}T07:06:07`, `${TODAY}T07:26:27`
    ]), JSON.stringify(untouched));

    console.log("[5] toggle-blockの通常ルーティン: 描画後の押下時刻でstart=end、日報は予定へフォールバック");
    await seed([
      block("routine-tap", { category: "ルーティン", plannedStartAt: `${TODAY}T06:00:00`, plannedEndAt: `${TODAY}T07:00:00` }),
      block("foreign-onetap", { category: "仕事", oneTap: true, plannedStartAt: "", plannedEndAt: "" }),
      block("unplanned-zero", {
        category: "予定なし", plannedStartAt: "", plannedEndAt: "", completed: true,
        actualStartAt: `${TODAY}T10:03:45`, actualEndAt: `${TODAY}T10:03:45`
      })
    ], "today");
    await page.locator('.tower-gate[data-id="routine-tap"]').waitFor();
    check("非ルーティンoneTapはGATE DOMへ混入しない", await page.locator('.tower-gate[data-id="foreign-onetap"]').count() === 0);
    // D-1裁定(2026-09-14): 旧ルーティンGATE入口(toggle-block)も✓と同じ「実績なしの予定完了」に
    // 統一された。0分実績で埋めなくなったため、FLIGHT LOGには出ない。日報の時間実行は
    // reportDurationMinutesがcompletedかつ実績空でも予定所要へ落ちるため1h/1hのまま維持される。
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 7, 27, 1, 3, 45)));
    await dispatch("toggle-block", "routine-tap");
    await page.waitForFunction(({ KEY }) => JSON.parse(localStorage.getItem(KEY)).blocks.find((entry) => entry.id === "routine-tap")?.completed, { KEY });
    saved = await storedBlock("routine-tap");
    check("未開始ルーティンは実績なしの予定完了(actualStart/Endは空)", saved.completed === true && saved.actualStartAt === "" && saved.actualEndAt === "", JSON.stringify(saved));
    check("完了はsaveState経由で永続化", saved.updatedAt >= `${TODAY}T10:03:45`, JSON.stringify(saved));
    check("FLIGHT LOGには出ない(実績が無いため)", await page.locator('.tower-log-row[data-id="routine-tap"]').count() === 0);
    // foreign-onetapは未完了のまま残るため、日報生成前に理由チップをスキップする。
    await dispatch("generate-report");
    await page.locator('.modal-title', { hasText: "できなかった理由" }).waitFor().catch(() => {});
    while (await page.locator('[data-action="incomplete-reason-skip"]').count() > 0) {
      await page.click('[data-action="incomplete-reason-skip"]');
    }
    await page.waitForFunction(({ KEY, TODAY }) => Boolean(JSON.parse(localStorage.getItem(KEY)).reports[TODAY]), { KEY, TODAY });
    const report = await page.evaluate(({ KEY, TODAY }) => JSON.parse(localStorage.getItem(KEY)).reports[TODAY], { KEY, TODAY });
    check("0分実績の日報時間実行は予定へフォールバック", /\| 時間実行 \| 1h \/ 1h \(100%\) \|/.test(report) && !/NaN|Infinity/.test(report), report);
    check("予定なし0分Blockは0分のまま", /- 予定なし: 0h/.test(report), report);
    await dispatch("nav", "", { view: "instruments" });
    await page.locator(".instr-view").waitFor();
    check("0分実績を含むstateでもINSTRUMENTSが描画", await page.locator(".instr-view").count() === 1);

    // D-1裁定(2026-09-14)により、toggle-block/now-conveyor-completeの「押下時刻で0分実績を
    // 補完する」旧挙動そのものが撤去された(全カテゴリ共通で実績なしの予定完了になる)。
    // [6]〜[9]は旧挙動のカテゴリ別差分・境界値を検査していたため、対象が消えたことを
    // 確認する検査へ差し替える(Test-Reduction: 旧断言は新契約と食い違うため削除)。
    console.log("[6] 母集団: oneTap/deletedルーティンも実績を補完しない(旧差分は消えた)");
    await seed([
      block("routine-onetap", { category: "ルーティン", oneTap: true }),
      block("routine-deleted", { category: "ルーティン", deleted: true })
    ], "today");
    await dispatch("toggle-block", "routine-onetap");
    await dispatch("toggle-block", "routine-deleted");
    const oneTapSaved = await storedBlock("routine-onetap");
    const deletedSaved = await storedBlock("routine-deleted");
    check("oneTapルーティンは完了するが実績は補完されない", oneTapSaved.completed === true
      && oneTapSaved.actualStartAt === "" && oneTapSaved.actualEndAt === "", JSON.stringify(oneTapSaved));
    check("削除済みルーティンはtoggle-blockの対象にならない(未完了・実績も空のまま)", deletedSaved.completed === false
      && deletedSaved.actualStartAt === "" && deletedSaved.actualEndAt === "", JSON.stringify(deletedSaved));

    console.log("[7] 非ルーティンNOW HUD・開始済みルーティンも同様に実績を補完しない");
    await seed([block("ordinary", { plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00` })], "timeline");
    await dispatch("now-conveyor-complete", "ordinary");
    saved = await storedBlock("ordinary");
    check("非ルーティン即完了も実績なしの予定完了", saved.completed === true
      && saved.actualStartAt === "" && saved.actualEndAt === "", JSON.stringify(saved));

    // 実行中(actualStartAtあり・actualEndAtなし)のルーティンは設計03の「実行中なら終了確認へ
    // 進める」に沿って先に終了報告モーダルを開く(v331と同じ契約)。
    await seed([block("routine-started", { category: "ルーティン", actualStartAt: `${TODAY}T08:15:30` })], "today");
    await dispatch("now-conveyor-complete", "routine-started");
    await page.locator("#modalRoot .modal-title", { hasText: "終了報告" }).waitFor();
    await page.click('[data-action="report-skip"]');
    await dismissBodyScanIfOpen(page);
    saved = await storedBlock("routine-started");
    check("now-start済みルーティンは終了確認を経て完了し、actualStartAtは維持される", saved.completed === true
      && saved.actualStartAt === `${TODAY}T08:15:30` && Boolean(saved.actualEndAt), JSON.stringify(saved));

    console.log("[8] plannedStartAtなし / actualEndAt既存値ありでも実績は補完されない");
    await seed([block("routine-unplanned", {
      category: "ルーティン", plannedStartAt: "", plannedEndAt: ""
    })], "today");
    await dispatch("now-conveyor-complete", "routine-unplanned");
    saved = await storedBlock("routine-unplanned");
    check("予定なしルーティンも実績を補完せず完了する", saved.completed === true
      && saved.actualStartAt === "" && saved.actualEndAt === "", JSON.stringify(saved));

    await seed([block("routine-ended", {
      category: "ルーティン", actualEndAt: `${TODAY}T09:59:11`
    })], "today");
    await dispatch("now-conveyor-complete", "routine-ended");
    saved = await storedBlock("routine-ended");
    check("既存actualEndAtは変わらず、actualStartAtも補完されない", saved.completed === true
      && saved.actualStartAt === "" && saved.actualEndAt === `${TODAY}T09:59:11`, JSON.stringify(saved));
    console.log("[9] 23:58:45の境界でも実績なしで完了し、日付を維持する");
    await seed([block("routine-boundary", { category: "ルーティン" })], "today");
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 7, 27, 14, 58, 45)));
    await dispatch("now-conveyor-complete", "routine-boundary");
    saved = await storedBlock("routine-boundary");
    check("23:58:45でも完了する", saved.completed === true, JSON.stringify(saved));
    check("23:58:45でも実績は空のまま", saved.actualStartAt === "" && saved.actualEndAt === "", JSON.stringify(saved));
    check("23:58:45でもdateは変わらない", saved.date === TODAY, JSON.stringify(saved));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\n❌ v276: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ v276: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
