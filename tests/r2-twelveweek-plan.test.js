// tests/r2-twelveweek-plan.test.js — 12WYタブ R2: PLAN面(LINK連動図5ノード+12-WEEK PLANグリッド+
// 「目安なし」一覧、読み取り専用)。検証範囲(order-r2-plan.md §テスト準拠):
// PLANチップで面が切り替わる(非永続)、LINK5ノードと導線、グリッドの行(Projectグループ・
// 目安>0のみ)・列12・各statusのセル色/文言がfixtureどおり(過去met/missed-1-2/missed-3+、
// 今週、未来planned/short/unplanned)、右端の累計と残り、「目安なし」一覧と目安を設定で
// モーダルが開く、0件誘導、390pxでページ横スクロールなし(グリッド内のみ)・1280px、
// pageerror 0、state非書込、new Date("文字列")なし。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const CYCLE_START = "2026-07-11"; // 土曜
const TODAY = "2026-07-25"; // W3(index2)が当週になる
const FIXED_NOW = new Date(2026, 6, 25, 10, 0, 0);
// W1〜W12のweekStart(CYCLE_STARTが土曜のため7日刻みでそのまま並ぶ)。
const W = ["2026-07-11", "2026-07-18", "2026-07-25", "2026-08-01", "2026-08-08", "2026-08-15",
  "2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"];

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return {
    id, title: `12WYプロジェクト${id}`, kind: "normal", status: "active", deleted: false,
    twelveWeekStartDate: CYCLE_START,
    createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function task(id, projectId, extra = {}) {
  return {
    id, projectId, title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function weekMeta(weekStart, extra = {}) {
  return {
    id: `wcw_${weekStart}`, recordType: "week", weekStart, deleted: false,
    committedVia: "auto", selectedBlockIds: [], committedAt: "2026-07-11T08:00:00",
    cycleStartDate: CYCLE_START, createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function item(id, taskId, weekStart, extra = {}) {
  return {
    id, recordType: "item", weekStart, taskId, blockId: id, lane: "cycle", source: "auto",
    completedAt: "", excused: false, deleted: false,
    createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function confirmedItems(weekStart, taskId, prefix, doneCount, totalCount) {
  const items = [];
  for (let i = 0; i < totalCount; i++) {
    items.push(item(`${prefix}${i}`, taskId, weekStart, { completedAt: i < doneCount ? `${weekStart}T09:00:00` : "" }));
  }
  return items;
}

async function memoryState(page) {
  return page.evaluate(async () => JSON.stringify((await import("/src/state/store.js")).state));
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
}

async function writeSeedOnce(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    const { settings, ...rest } = values;
    Object.assign(current, rest);
    if (settings) Object.assign(current.settings, settings);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}
// v357由来の既知回避策(r1-twelveweek.test.jsと同じ): reload連打時のsyncFromGitHubOnStartup()
// 競合対策として最大3回まで再試行する。
async function seed(page, values) {
  const { settings, ...rest } = values;
  for (let attempt = 0; attempt < 3; attempt++) {
    await writeSeedOnce(page, values);
    const ok = await page.evaluate(async ({ key, rest, settings }) => {
      const current = JSON.parse(localStorage.getItem(key));
      const containsAll = (obj, expected) => Object.keys(expected).every((k) => {
        const exp = expected[k], act = obj ? obj[k] : undefined;
        if (Array.isArray(exp)) {
          if (!Array.isArray(act)) return false;
          // Empty commitment fixtures must be empty, not a vacuous subset match.
          if (k === "weeklyCommitments" && act.length !== exp.length) return false;
          const actIds = new Set(act.map((x) => x?.id));
          return exp.every((x) => (x?.id ? actIds.has(x.id) : true));
        }
        return (typeof exp !== "object" || exp === null) ? act === exp : true;
      });
      const live = (await import("/src/state/store.js")).state;
      return [current, live].every((value) => containsAll(value, rest)
        && (!settings || containsAll(value.settings, settings)));
    }, { key: STATE_KEY, rest, settings });
    if (ok) return;
  }
  throw new Error("seed()の値が3回試行しても反映されなかった(reload競合の再試行上限超過)");
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "features", "twelve-week.js"), "utf8");
  check("twelve-week.jsにnew Date(が無い", !/new Date\(/.test(src));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__setItemChanges = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        const prev = this.getItem(key);
        if (prev !== value) window.__setItemChanges.push(key);
      } catch (_e) { /* noop */ }
      return orig.call(this, key, value);
    };
  });

  try {
    await page.clock.setFixedTime(new Date(2026, 6, 15, 10, 0, 0));
    await blockGithubApiByDefault(page);
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => {
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "today", selectedDate: "2000-01-01", projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-r2-mock", content, encoding: "base64" }) });
      });
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    const initial = JSON.parse(await memoryState(page));
    check("seedState: Wednesday settings start rounds to Saturday", initial.settings.twelveWeekStartDate === "2026-07-11");
    const initialProjects = initial.projects.filter((p) => p.kind === "normal" && p.twelveWeekStartDate);
    check("seedState: sample Project start rounds to Saturday", initialProjects.length > 0
      && initialProjects.every((p) => p.twelveWeekStartDate === "2026-07-11"));
    await page.clock.setFixedTime(FIXED_NOW);

    const p1 = project("p1");
    const t1 = task("t1", "p1", {
      status: "doing", title: "検定の勉強をする",
      twyPlan: { perWeek: 2, fromWeek: 1, toWeek: 12, keystone: true }
    });
    const t2 = task("t2", "p1", {
      status: "todo", title: "模試を受ける",
      twyPlan: { perWeek: 1, fromWeek: 8, toWeek: 8, keystone: false } // 未来の単発
    });
    const t3 = task("t3", "p1", {
      status: "todo", title: "過去問を解く",
      twyPlan: { perWeek: 3, fromWeek: 1, toWeek: 1, keystone: false } // 過去の単発(missed-3+用)
    });
    const t4 = task("t4", "p1", { status: "todo", title: "目安未設定タスク" }); // twyPlanなし=目安0
    const weeklyCommitments = [
      weekMeta(W[0]), ...confirmedItems(W[0], "t1", "w1t1-", 2, 2), // t1 W1: met(2/2)
      weekMeta(W[1]), ...confirmedItems(W[1], "t1", "w2t1-", 1, 3), // t1 W2: missed-1-2(確定3・完了1・missed=2)
      weekMeta(W[2]), ...confirmedItems(W[2], "t1", "w3t1-", 1, 1), // t1 W3(当週): 1/1
      weekMeta(W[3]), ...confirmedItems(W[3], "t1", "w4t1-", 0, 2), // t1 W4: planned(確定2=目安2)
      weekMeta(W[4]), ...confirmedItems(W[4], "t1", "w5t1-", 0, 1)  // t1 W5: short(確定1<目安2)
      // W6,W7,W9-W12はt1の週メタ無し=confirmed0(unplanned・複数回なので「2(確定0)」)
      // t2(W8単発)・t3(W1単発)はitemを作らずconfirmed0のまま
    ];
    await seed(page, {
      selectedDate: TODAY,
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      projects: [p1],
      tasks: [t1, t2, t3, t4],
      weeklyCommitments,
      currentView: "twelveweek"
    });

    // ============================================================
    // [0] H2(review-r2-claude-a): 設定画面の12WY開始日入力も保存時に直前の土曜へ丸める
    // ============================================================
    await seed(page, { settings: { twelveWeekStartDate: "2026-07-04" } });
    console.log("[0] H2: 設定画面から非土曜を保存すると直前の土曜へ丸められる(3経路目=汎用setting-fieldハンドラ)");
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForSelector('[data-settings-row="profile"]');
    await page.click('summary[data-row="profile"]');
    await page.waitForSelector('input[data-setting-field="twelveWeekStartDate"]');
    await page.fill('input[data-setting-field="twelveWeekStartDate"]', "2026-07-15"); // 水曜
    await page.locator('input[data-setting-field="twelveWeekStartDate"]').dispatchEvent("change");
    await page.waitForFunction((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).settings.twelveWeekStartDate === "2026-07-11", STATE_KEY);
    const roundedSaved = await page.evaluate((KEY) =>
      JSON.parse(localStorage.getItem(KEY)).settings.twelveWeekStartDate, STATE_KEY);
    check("H2: 設定画面から非土曜(2026-07-15水曜)を保存すると直前の土曜(2026-07-11)へ丸められる",
      roundedSaved === "2026-07-11", roundedSaved);
    check("Settings input displays rounded Saturday after saving", await page.locator('input[data-setting-field="twelveWeekStartDate"]').inputValue() === "2026-07-11");

    // fix2: assert the actual persistence/render contract.
    await page.clock.setFixedTime(new Date(2026, 6, 15, 10, 0, 0));
    for (const [label, settingStart, projectStart, expected] of [
      ["new cycle", "", "", "2026-07-11"],
      ["preserve settings", "2026-07-15", "", "2026-07-15"],
      ["preserve project", "", "2026-07-15", "2026-07-15"]
    ]) {
      await seed(page, { settings: { twelveWeekStartDate: settingStart },
        projects: [project("save-project", { twelveWeekStartDate: projectStart })], tasks: [], tracks: [], currentView: "wbs" });
      await page.click('[data-action="edit-project"][data-id="save-project"]');
      await page.waitForSelector('[data-modal-field="is12WY"]');
      await page.check('[data-modal-field="is12WY"]');
      await page.click('[data-action="modal-save"]');
      await page.waitForSelector('[data-modal-field="is12WY"]', { state: "detached" });
      const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      check(`Project save: ${label} settings`, saved.settings.twelveWeekStartDate === expected);
      check(`Project save: ${label} Project`, saved.projects.find((p) => p.id === "save-project").twelveWeekStartDate === expected);
    }
    await page.clock.setFixedTime(FIXED_NOW);
    await seed(page, { projects: [p1], tasks: [t1, t2, t3, t4], weeklyCommitments });
    await seed(page, { settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 }, currentView: "twelveweek" });

    // ============================================================
    // [1] PLANチップで面が切り替わる(非永続)
    // ============================================================
    console.log("[1] PLANチップで面が切り替わる(非永続)");
    check("初期表示はCYCLE面(data-twy-face=cycle)", await page.locator('.twy-tower[data-twy-face="cycle"]').count() === 1);
    check("PLANチップはdisabledではない", await page.locator('.twy-face-segmented button[data-face="plan"]').isDisabled() === false);
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-link-panel");
    check("PLANチップクリックでPLAN面へ切り替わる(data-twy-face=plan)", await page.locator('.twy-tower[data-twy-face="plan"]').count() === 1);
    check("PLANチップがactiveになる", await page.locator('.twy-face-segmented button[data-face="plan"].active').count() === 1);
    check("CYCLE専用のVISIONパネルはPLAN面に無い", await page.locator(".twy-vision-panel").count() === 0);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    check("非永続: reloadするとCYCLE面に戻る", await page.locator('.twy-tower[data-twy-face="cycle"]').count() === 1);
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-link-panel");

    // ============================================================
    // [2] LINK: 5ノードと導線
    // ============================================================
    console.log("[2] LINK: 5ノードと編集する画面への導線");
    check("LINKに5ノードある", await page.locator(".twy-plan-link-node").count() === 5);
    const linkLabels = await page.locator(".twy-plan-link-label").allTextContents();
    check("5ノードの見出しがdesign通り", JSON.stringify(linkLabels) === JSON.stringify(
      ["12WYプロジェクト", "WBSタスク(戦術)", "Block(コマ)", "週次コミット", "weeklyScore"]), JSON.stringify(linkLabels));
    check("1つ目のノードはWBSへのnav導線", await page.locator('.twy-plan-link-node').nth(0)
      .locator('[data-action="nav"][data-view="wbs"]').count() === 1);
    check("3つ目のノードはタイムラインへのnav導線", await page.locator('.twy-plan-link-node').nth(2)
      .locator('[data-action="nav"][data-view="timeline"]').count() === 1);
    check("4つ目のノードは今週を確定(twy-open-commit)", await page.locator('.twy-plan-link-node').nth(3)
      .locator('[data-action="twy-open-commit"]').count() === 1);
    await page.click('.twy-plan-link-node >> nth=3 >> [data-action="twy-open-commit"]');
    await page.waitForSelector(".twy-commit-sheet");
    check("週次コミットの導線が既存WEEKLY COMMITシートを開く", await page.locator(".twy-commit-sheet").count() === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector(".twy-commit-sheet", { state: "detached" });
    check("5つ目のノードはCYCLE面へ戻る導線(twy-face-select)", await page.locator('.twy-plan-link-node').nth(4)
      .locator('[data-action="twy-face-select"][data-face="cycle"]').count() === 1);

    // ============================================================
    // [3] グリッド: 行(Projectグループ・目安>0のみ)・列12・各statusのセル色/文言
    // ============================================================
    console.log("[3] グリッド: 行・列12・各statusのセル文言(met/missed-1-2/missed-3+/current/planned/short/unplanned/未作成/none)");
    check("Projectヘッダが1件出る", (await page.locator(".twy-plan-project-head").textContent()).includes("12WYプロジェクトp1"));
    check("目安>0のタスク行が3件(t1/t2/t3。t4は目安0で除外)", await page.locator(".twy-plan-task-row").count() === 3);
    check("列は12(W1〜W12)", await page.locator(".twy-plan-grid thead th[data-current]").count() === 12);
    check("当週(W3)のth列がdata-current=1", await page.locator(".twy-plan-grid thead th").nth(3).getAttribute("data-current") === "1");

    const t1Row = page.locator('.twy-plan-task-row[data-task-id="t1"]');
    check("t1行に★(keystone)が付く", (await t1Row.locator(".twy-plan-task-name").textContent()).startsWith("★"));
    const t1Cells = await t1Row.locator(".twy-plan-cell").allTextContents();
    const t1Status = await t1Row.locator(".twy-plan-cell").evaluateAll((els) => els.map((el) => el.dataset.status));
    check("t1 W1: met・2/2", t1Status[0] === "met" && t1Cells[0] === "2/2", JSON.stringify({ s: t1Status[0], c: t1Cells[0] }));
    check("t1 W2: missed-1-2・1/3", t1Status[1] === "missed-1-2" && t1Cells[1] === "1/3", JSON.stringify({ s: t1Status[1], c: t1Cells[1] }));
    check("t1 W3(当週): current・1/1", t1Status[2] === "current" && t1Cells[2] === "1/1", JSON.stringify({ s: t1Status[2], c: t1Cells[2] }));
    check("t1 W4: planned・2", t1Status[3] === "planned" && t1Cells[3] === "2", JSON.stringify({ s: t1Status[3], c: t1Cells[3] }));
    check("t1 W5: short・2(確定1)", t1Status[4] === "short" && t1Cells[4] === "2(確定1)", JSON.stringify({ s: t1Status[4], c: t1Cells[4] }));
    check("t1 W6: unplanned(複数回)・2(確定0)", t1Status[5] === "unplanned" && t1Cells[5] === "2(確定0)", JSON.stringify({ s: t1Status[5], c: t1Cells[5] }));
    const t1Total = await t1Row.locator(".twy-plan-total-km").textContent();
    const t1Remaining = await t1Row.locator(".twy-plan-remaining").textContent();
    // review-r2-claude-a M1: 累計の分母は過去週+当週(W1〜W3)のみ(未来週W4の確定2は含めない)。
    // done=2+1+1=4, confirmed=2+3+1=6。
    check("t1累計=完了4/確定6(過去+当週のみ、未来週の確定は含めない)", t1Total.trim() === "4/6", t1Total);
    check("t1残りコマ数=18(W4〜W12=9週×目安2)", t1Remaining.trim() === "残18", t1Remaining);

    // review-r2-claude-a M1: セルのcomputed color/border-styleも検証する(data-status属性一致だけでは
    // CSSの取り違え・欠落を検出できない)。
    const t1CellEls = await t1Row.locator(".twy-plan-cell").elementHandles();
    const expectedColors = await page.locator(".twy-tower").evaluate((el) => {
      const probe = document.createElement("span");
      el.append(probe);
      const colors = {};
      for (const token of ["green", "amber", "red"]) {
        probe.style.color = `var(--tower-${token})`;
        colors[token] = getComputedStyle(probe).color;
      }
      probe.remove();
      return colors;
    });
    const metStyle = await t1CellEls[0].evaluate((el) => getComputedStyle(el).color);
    const missedStyle = await t1CellEls[1].evaluate((el) => getComputedStyle(el).color);
    const currentOutline = await t1CellEls[2].evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, color: s.outlineColor, width: s.outlineWidth };
    });
    const redStyle = await page.locator('.twy-plan-task-row[data-task-id="t3"] .twy-plan-cell').first().evaluate((el) => getComputedStyle(el).color);
    const plannedOpacity = await t1CellEls[3].evaluate((el) => getComputedStyle(el).opacity);
    const shortBorder = await t1CellEls[4].evaluate((el) => getComputedStyle(el).borderTopStyle);
    check("met: tower-green computed color", metStyle === expectedColors.green, metStyle);
    check("warn: tower-amber computed color", missedStyle === expectedColors.amber, missedStyle);
    check("missed-3+: tower-red computed color", redStyle === expectedColors.red, redStyle);
    check("current: white 2px solid outline", currentOutline.style === "solid" && currentOutline.color === "rgb(255, 255, 255)" && currentOutline.width === "2px", JSON.stringify(currentOutline));
    check("planned: computedでopacityが薄い(<1)", Number(plannedOpacity) < 1, plannedOpacity);
    check("short: computedでborder-styleがdashed", shortBorder === "dashed", shortBorder);

    const t2Row = page.locator('.twy-plan-task-row[data-task-id="t2"]');
    const t2Status = await t2Row.locator(".twy-plan-cell").evaluateAll((els) => els.map((el) => el.dataset.status));
    const t2Cells = await t2Row.locator(".twy-plan-cell").allTextContents();
    check("t2 W8(未来の単発): unplanned・1 (未作成)", t2Status[7] === "unplanned" && t2Cells[7] === "1 (未作成)", JSON.stringify({ s: t2Status[7], c: t2Cells[7] }));
    check("t2 W1(対象週外): none・空", t2Status[0] === "none" && t2Cells[0] === "", JSON.stringify({ s: t2Status[0], c: t2Cells[0] }));

    const t3Row = page.locator('.twy-plan-task-row[data-task-id="t3"]');
    const t3Status = await t3Row.locator(".twy-plan-cell").evaluateAll((els) => els.map((el) => el.dataset.status));
    const t3Cells = await t3Row.locator(".twy-plan-cell").allTextContents();
    check("t3 W1(過去の単発・未確定): missed-3+・0/0", t3Status[0] === "missed-3+" && t3Cells[0] === "0/0", JSON.stringify({ s: t3Status[0], c: t3Cells[0] }));
    check("t3 W2(対象週外): none", t3Status[1] === "none");

    // ============================================================
    // [4] 「目安なし」一覧と目安を設定でモーダルが開く
    // ============================================================
    console.log("[4] 「目安なし」一覧: t4のみ表示・目安を設定でTask編集モーダルが開く");
    check("目安なし一覧にt4が1件出る", await page.locator(".twy-plan-none-list li").count() === 1
      && (await page.locator(".twy-plan-none-list li span").first().textContent()) === "目安未設定タスク");
    await page.click('.twy-plan-none-list [data-action="edit-task"][data-id="t4"]');
    await page.waitForSelector('[data-modal-field="title"]');
    check("「目安を設定」でTask編集モーダルが開く(タイトル一致)",
      await page.locator('[data-modal-field="title"]').inputValue() === "目安未設定タスク");
    check("12WY配下なので12週プラン区画(週次目安)が出る", await page.locator('[data-modal-field="twyPerWeek"]').count() === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector('[data-modal-field="title"]', { state: "detached" });

    // ============================================================
    // [5] 0件誘導(12WYプロジェクトが無い)
    // ============================================================
    console.log("[5] 0件誘導: 対象の12WYプロジェクトが無い場合の誘導1行");
    await seed(page, { projects: [], tasks: [], currentView: "twelveweek" });
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-link-panel");
    check("0件誘導が出る(LINKは出したまま)", (await page.locator(".twy-plan-grid-panel .twy-plan-guide").textContent()).includes("対象の12WYプロジェクトがありません"));
    check("グリッドは無い(タスク行0)", await page.locator(".twy-plan-task-row").count() === 0);

    // cycleStartDate未設定時はPLAN面自体が誘導のみ(design §2.1b・R1のMEDIUM-7と同じ扱い)。
    await seed(page, { settings: { twelveWeekStartDate: "" }, currentView: "twelveweek" });
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForFunction(() => document.querySelector(".twy-plan-link-panel"));
    check("cycleStartDate未設定はPLAN面も誘導1行のみ(LINKグリッドなし)",
      await page.locator(".twy-plan-grid-panel").count() === 0
      && (await page.locator(".twy-plan-link-panel .twy-plan-guide").textContent()).includes("12WYサイクルが未設定"));
    await seed(page, {
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      projects: [p1], tasks: [t1, t2, t3, t4], weeklyCommitments,
      currentView: "twelveweek"
    });
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-task-row");

    // ============================================================
    // [6] state非書込
    // ============================================================
    console.log("[6] state非書込: 初回描画・面切替・LINK導線・モーダル開閉・グリッドのhover/clickはstateへ書き込まない");
    // review-r2-claude-b M3: 計測窓が面切替往復+hover/clickのみで、PLAN面の初回描画・LINK導線
    // (週次コミットシート開閉)・「目安を設定」モーダル開閉が計測外だった。reload直後にログを
    // リセットしてから初めてPLAN面を開き、それらの操作もすべて同じ計測窓に含める。
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await resetSetItemLog(page);
    const beforePlan = await memoryState(page);
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-task-row");
    await page.click('.twy-plan-link-node >> nth=3 >> [data-action="twy-open-commit"]');
    await page.waitForSelector(".twy-commit-sheet");
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector(".twy-commit-sheet", { state: "detached" });
    await page.click('.twy-plan-none-list [data-action="edit-task"][data-id="t4"]');
    await page.waitForSelector('[data-modal-field="title"]');
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector('[data-modal-field="title"]', { state: "detached" });
    await page.click('.twy-face-segmented button[data-face="cycle"]');
    await page.waitForSelector(".twy-vision-panel");
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-task-row");
    const firstCell = page.locator(".twy-plan-cell").first();
    await firstCell.hover();
    await firstCell.click({ force: true }).catch(() => {});
    check("Read-only PLAN round trip preserves complete memory state", await memoryState(page) === beforePlan);
    const writesReadOnly = await contentChangingWrites(page, STATE_KEY);
    check("PLAN面の初回描画・LINK導線(週次コミットシート開閉)・目安を設定モーダル開閉・面切替往復・"
      + "グリッドhover/clickはstateへ内容変更を伴う書き込みをしない(0回)", writesReadOnly === 0, writesReadOnly);

    console.log("[fix2] Before start, start day, and future W1 data");
    for (const [label, day, commitments, current, total, remaining, status] of [
      ["before start", 10, [], false, "0/0", "\u6b8b24", "unplanned"],
      ["start day", 11, [weekMeta(W[0]), ...confirmedItems(W[0], "t1", "start-", 1, 2)], true, "1/2", "\u6b8b22", "current"],
      ["before start with W1 data", 10, [weekMeta(W[0]), ...confirmedItems(W[0], "t1", "future-", 1, 2)], false, "0/0", "\u6b8b24", "planned"]
    ]) {
      await page.clock.setFixedTime(new Date(2026, 6, day, 10, 0, 0));
      await seed(page, { settings: { twelveWeekStartDate: CYCLE_START }, projects: [p1], tasks: [t1], weeklyCommitments: commitments, currentView: "twelveweek" });
      await page.click('.twy-face-segmented button[data-face="plan"]');
      const row = page.locator('.twy-plan-task-row[data-task-id="t1"]');
      check(`${label}: current header`, await page.locator('.twy-plan-grid th[data-current="1"]').count() === (current ? 1 : 0));
      check(`${label}: W1header`, await page.locator('.twy-plan-grid th[data-current]').first().getAttribute("data-current") === (current ? "1" : "0"));
      const actualStatus = await row.locator('.twy-plan-cell').first().getAttribute("data-status");
      check(`${label}: W1 status`, actualStatus === status, JSON.stringify({ expected: status, actual: actualStatus,
        cells: await row.locator('.twy-plan-cell').allTextContents() }));
      check(`${label}: cumulative`, (await row.locator('.twy-plan-total-km').textContent()).trim() === total);
      check(`${label}: remaining`, (await row.locator('.twy-plan-remaining').textContent()).trim() === remaining);
    }
    await page.clock.setFixedTime(FIXED_NOW);

    console.log("[fix3] Rounded W12/W13 boundary and missing plan render");
    for (const cycleStart of [CYCLE_START, "2026-07-15"]) {
      await seed(page, { settings: { twelveWeekStartDate: cycleStart },
        projects: [project("w12", { twelveWeekStartDate: "2026-10-02" }), project("w13", { twelveWeekStartDate: "2026-10-03" }), project("w13sun", { twelveWeekStartDate: "2026-10-04" })],
        tasks: [task("w12-task", "w12", { twyPlan: { perWeek: 2 } }), task("w13-task", "w13", { twyPlan: { perWeek: 2 } }), task("w13sun-task", "w13sun", { twyPlan: { perWeek: 2 } }), task("missing-plan", "w12")],
        weeklyCommitments: [], currentView: "twelveweek" });
      // fix2: assert the actual persistence/render contract.
      await page.evaluate(async () => { delete (await import("/src/state/store.js")).state.tasks.find((t) => t.id === "missing-plan").twyPlan; });
      const beforeEdge = await memoryState(page);
      await resetSetItemLog(page);
      await page.click('.twy-face-segmented button[data-face="plan"]');
      check(`${cycleStart}: W12 Friday 10-02 rounds to 09-26 (+77) and is included`, await page.locator('.twy-plan-task-row[data-task-id="w12-task"]').count() === 1);
      check(`${cycleStart}: W13 first day 10-03 (+84) is excluded`, await page.locator('.twy-plan-task-row[data-task-id="w13-task"]').count() === 0);
      check(`${cycleStart}: W13 Sunday 10-04 rounds to +84 and is excluded`, await page.locator('.twy-plan-task-row[data-task-id="w13sun-task"]').count() === 0);
      check("Missing twyPlan appears in no-target list", await page.locator('.twy-plan-none-list [data-id="missing-plan"]').count() === 1);
      check("Non-Saturday and missing-plan render preserves complete memory state", await memoryState(page) === beforeEdge);
      check("Non-Saturday and missing-plan render has zero persistent writes", await contentChangingWrites(page, STATE_KEY) === 0);
    }
    await seed(page, { settings: { twelveWeekStartDate: CYCLE_START }, projects: [p1], tasks: [t1, t2, t3, t4], weeklyCommitments, currentView: "twelveweek" });

    // ============================================================
    // [8] H1(review-r2-claude-a): W13(振り返り週)中もPLANグリッドのW1〜W12を過去週として評価する
    // ============================================================
    console.log("[8] H1: W13(振り返り週)中はPLANグリッドのW1〜W12が過去週のまま評価される");
    await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 0, 0)); // 2026-10-05: 経過86日→W13(振り返り週)
    await seed(page, { selectedDate: "2026-10-05", currentView: "twelveweek" });
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-task-row");
    const t1RowW13 = page.locator('.twy-plan-task-row[data-task-id="t1"]');
    const t1StatusW13 = await t1RowW13.locator(".twy-plan-cell").evaluateAll((els) => els.map((el) => el.dataset.status));
    check("H1: W13中でもt1 W1はmetのまま(未来判定に化けない)", t1StatusW13[0] === "met", t1StatusW13[0]);
    check("H1: W13中でもt1 W2はmissed-1-2のまま", t1StatusW13[1] === "missed-1-2", t1StatusW13[1]);
    check("H1: W13中はW1〜W12のどのセルもcurrentにならない(13週目は12列グリッドの外)",
      t1StatusW13.every((s) => s !== "current"), JSON.stringify(t1StatusW13));
    check("H1: W13中はどの列見出しにもdata-current=1が無い(グリッドはW1〜W12の12列のみ)",
      await page.locator(".twy-plan-grid thead th[data-current=\"1\"]").count() === 0);
    const t1TotalW13 = (await t1RowW13.locator(".twy-plan-total-km").textContent()).trim();
    const t1RemainingW13 = (await t1RowW13.locator(".twy-plan-remaining").textContent()).trim();
    check("H1: W13中は累計が全12週分(完了4/確定9)になる", t1TotalW13 === "4/9", t1TotalW13);
    check("H1: W13中は残りコマ数が0(未来週が無い)", t1RemainingW13 === "残0", t1RemainingW13);
    await page.clock.setFixedTime(FIXED_NOW);
    await seed(page, { selectedDate: TODAY, currentView: "twelveweek" });
    await page.click('.twy-face-segmented button[data-face="plan"]');
    await page.waitForSelector(".twy-plan-task-row");

    // ============================================================
    // [7] 390px/1280px横スクロールなし(グリッドは内部スクロール)・pageerror 0
    // ============================================================
    console.log("[7] 390px/1280px: ページ横スクロールなし(グリッド容器内のみ)・pageerror 0");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((w) => window.innerWidth === w, width);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientW = await page.evaluate(() => document.documentElement.clientWidth);
      check(`${width}pxでページ横スクロールが発生しない`, scrollW <= clientW + 1, `${scrollW} vs ${clientW}`);
    }
    const gridWrapOverflow = await page.evaluate(() => getComputedStyle(document.querySelector(".twy-plan-grid-wrap")).overflowX);
    check("グリッド容器は内部でoverflow-x:autoを持つ", gridWrapOverflow === "auto", gridWrapOverflow);
    const dimensions = await page.evaluate(() => {
      const wrap = document.querySelector(".twy-plan-grid-wrap");
      wrap.scrollLeft = 0;
      wrap.scrollLeft = wrap.scrollWidth;
      const cells = [...document.querySelectorAll(".twy-plan-cell")];
      const buttons = [...document.querySelectorAll(".twy-tower button:not(:disabled)")];
      return { scroll: wrap.scrollLeft, maxScroll: wrap.scrollWidth - wrap.clientWidth,
        minColumn: Math.min(...cells.map((el) => el.getBoundingClientRect().width)),
        minText: Math.min(...cells.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        controls: buttons.map((el) => { const r = el.getBoundingClientRect(); return { action: el.dataset.action, width: r.width, height: r.height }; }) };
    });
    console.log("390px measurements", JSON.stringify(dimensions));
    check("390px: columns >=44px and text >=11px", dimensions.minColumn >= 44 && dimensions.minText >= 11);
    check("390px: controls >=44px", dimensions.controls.length > 0 && dimensions.controls.every((r) => r.width >= 44 && r.height >= 44), JSON.stringify(dimensions.controls));
    check("390px: actual internal scrolling", dimensions.scroll > 0 && Math.abs(dimensions.scroll - dimensions.maxScroll) <= 1);
    await page.click('.twy-plan-none-list [data-action="edit-task"][data-id="t4"]');
    const inputSizes = await page.locator('[data-modal-field="twyPerWeek"], [data-modal-field="twyFromWeek"], [data-modal-field="twyToWeek"]').evaluateAll((els) => els.map((el) => ({ field: el.dataset.modalField, font: parseFloat(getComputedStyle(el).fontSize) })));
    console.log("390px input measurements", JSON.stringify(inputSizes));
    check("390px: all three 12WY inputs >=16px", inputSizes.length === 3 && inputSizes.every((x) => x.font >= 16));
    await page.click('[data-action="modal-close"]');
    await page.setViewportSize({ width: 1280, height: 900 });
    check("一連の操作でpageerrorが発生しない(最終確認)", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
