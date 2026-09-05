// tests/r1-twelveweek.test.js — 12WYタブ R1a(骨格+CYCLE面のVISION帯/GOALS)+R1b(13 WEEKSバー)。
// 検証範囲(order-r1-cycle.md §C・order-r1b-weeks-bar.md §テスト準拠):
// タブ到達(PCサイドバー・その他)、S2 GLASS変数がcomputedで効く、state非書込(fixture値比較+
// 内容変更を伴うsetItem 0回。VISION保存だけ例外)、VISION帯の保存(settings更新・dataModifiedAt
// bump)と空時の誘導・normalizeStateの新規キー補完はbumpしない契約、GOALS 3件表示・4件目で警告
// 1行・候補の絞り込み(wish除外・サイクル外除外)・トラックチップが既存digest(WBS側
// renderTwyTrackRow)と一致、13 WEEKSバー(13本・W13斜線・目標線位置がスケール式どおり・当週
// ハイライト・平均/参考平均の表示・第13週中の見出し切替)、390px/1280px横スクロールなし・
// pageerror 0・new Date("文字列")なし。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const WEEK_START = "2026-08-29";
const CYCLE_START = "2026-07-11";
// W1〜W13のweekStart(CYCLE_STARTが土曜のため7日刻みでそのまま並ぶ)。
const W = ["2026-07-11", "2026-07-18", "2026-07-25", "2026-08-01", "2026-08-08", "2026-08-15",
  "2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"];
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);
const FIXED_NOW_W13 = new Date(2026, 9, 5, 10, 0, 0); // 2026-10-05: W13(振り返り週)到達

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return {
    id, title: `12WYプロジェクト${id}`, kind: "normal", status: "active", deleted: false,
    twelveWeekStartDate: CYCLE_START,
    createdAt: `2026-07-11T08:00:00`, updatedAt: `2026-07-11T08:00:00`, ...extra
  };
}
function task(id, projectId, extra = {}) {
  return {
    id, projectId, title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function track(id, ownerId, extra = {}) {
  return {
    id, ownerId, kind: "numeric", status: "active", name: "テキスト", unit: "章",
    baselineValue: 0, goalValue: 27, valueStep: 1,
    startDate: CYCLE_START, deadline: "2026-10-02", milestones: [], deleted: false,
    createdAt: "2026-07-11T08:00:00", updatedAt: "2026-07-11T08:00:00", ...extra
  };
}
function weekMeta(weekStart, extra = {}) {
  return {
    id: `wcw_${weekStart}`, recordType: "week", weekStart, deleted: false,
    committedVia: "auto", selectedBlockIds: [], committedAt: "2026-08-29T08:00:00",
    cycleStartDate: CYCLE_START, createdAt: "2026-08-29T08:00:00", updatedAt: "2026-08-29T08:00:00", ...extra
  };
}
function item(id, taskId, weekStart, extra = {}) {
  return {
    id, recordType: "item", weekStart, taskId, blockId: id, lane: "cycle", source: "auto",
    completedAt: "", excused: false, deleted: false,
    createdAt: "2026-08-29T08:00:00", updatedAt: "2026-08-29T08:00:00", ...extra
  };
}
// R1b: 週メタ+n件のconfirmed item(先頭doneCount件だけcompletedAt付き)を1週分作る。
function scoredWeek(weekStart, doneCount, totalCount) {
  const items = [];
  for (let i = 0; i < totalCount; i++) {
    items.push(item(`${weekStart}-i${i}`, "t1", weekStart, { completedAt: i < doneCount ? `${weekStart}T09:00:00` : "" }));
  }
  return [weekMeta(weekStart), ...items];
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
}
async function coreFixtureSnapshot(page) {
  return page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return JSON.stringify({ projects: s.projects, tasks: s.tasks, tracks: s.tracks, weeklyCommitments: s.weeklyCommitments });
  }, STATE_KEY);
}

async function writeSeedOnce(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    const { settings, ...rest } = values;
    Object.assign(current, rest);
    // settingsは浅いマージ(passGithubGateが入れたgithub認証設定を消さない)。
    if (settings) Object.assign(current.settings, settings);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

// v357テスト安定化: 前回reload由来のsyncFromGitHubOnStartup()(全reloadで発火する非同期処理)が
// このreload直後まで残っていると、書き込んだ直後のfixtureを古い(seed前の)in-memory stateで
// 上書きしてしまうことがある(reload連打特有の競合。アプリ本体のバグではなく、テスト側が短時間に
// 大量reloadする負荷でだけ顕在化する)。normalizeState()がWish/その他等の既定エンティティを
// 自動追加するため完全一致比較はできず、「id付き配列は指定idが部分集合として残っているか」
// (containment)・プリミティブ値は一致、だけを検証し、欠けていれば最大2回まで再試行する
// (本体のsaveState/mergeロジックには一切触れない)。
async function seed(page, values) {
  const { settings, ...rest } = values;
  for (let attempt = 0; attempt < 3; attempt++) {
    await writeSeedOnce(page, values);
    const ok = await page.evaluate(({ key, rest, settings }) => {
      const current = JSON.parse(localStorage.getItem(key));
      const containsAll = (obj, expected) => Object.keys(expected).every((k) => {
        const exp = expected[k], act = obj ? obj[k] : undefined;
        if (Array.isArray(exp)) {
          if (!Array.isArray(act)) return false;
          const actIds = new Set(act.map((x) => x?.id));
          return exp.every((x) => (x?.id ? actIds.has(x.id) : true));
        }
        return (typeof exp !== "object" || exp === null) ? act === exp : true;
      });
      return containsAll(current, rest) && (!settings || containsAll(current.settings, settings));
    }, { key: STATE_KEY, rest, settings });
    if (ok) return;
  }
  throw new Error("seed()の値が3回試行しても反映されなかった(reload競合の再試行上限超過)");
}

(async () => {
  // R1aの新規コードにnew Date("文字列")が無いことを静的に確認する(taskchute-journal Skill)。
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
    await page.clock.setFixedTime(FIXED_NOW);
    await blockGithubApiByDefault(page);
    // v148と同じ確立済み回避策: 既定404のままだとsyncFromGitHubOnStartup()(全reloadで発火)が
    // 例外側の副作用を毎回起こし、reloadごとの再描画タイミングに揺らぎを生む(seed()直後の
    // fixtureが反映される前に読んでしまう不安定要因になっていた)。dataModifiedAtを大昔にした
    // 成功モックで即終了させ、状態上書きも起こさない。
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => {
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "today", selectedDate: "2000-01-01", projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-r1-mock", content, encoding: "base64" }) });
      });
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const p1 = project("p1");
    // MEDIUM-5: GOALS候補の絞り込みnegative case用に、wish種別と旧サイクルのProjectも同時に混ぜる
    // (どちらもGOALSへ出てはいけない=twyGoalCandidatesのkind==="normal"/isProjectInCurrentCycle条件)。
    const wishProject = project("pw", { id: "pw", kind: "wish", title: "12WYではないWishプロジェクト" });
    const oldCycleProject = project("po", { id: "po", title: "旧サイクルのプロジェクト", twelveWeekStartDate: "2026-01-01" });
    // W1〜W7の13WEEKSバー用fixture(W8は既存t1/t2のweeklyCommitmentsを流用)。
    // W2は週メタ無し(uncommitted)・W3は全免除(na)にして描き分けを固定する。
    const weeksFixture = [
      ...scoredWeek(W[0], 1, 2), // W1: 50%
      weekMeta(W[2]), item("w3a", "t1", W[2], { excused: true }), item("w3b", "t1", W[2], { excused: true }), // W3: na
      ...scoredWeek(W[3], 2, 2), // W4: 100%
      ...scoredWeek(W[4], 1, 1), // W5: 100%
      ...scoredWeek(W[5], 0, 1), // W6: 0%
      ...scoredWeek(W[6], 2, 2)  // W7: 100%
      // W2は意図的に週メタを作らない(uncommitted)
    ];
    await seed(page, {
      selectedDate: TODAY,
      settings: { twelveWeekStartDate: CYCLE_START },
      projects: [p1, wishProject, oldCycleProject],
      tasks: [
        task("t1", "p1", { status: "doing", title: "検定の勉強をする", twyPlan: { perWeek: 5, fromWeek: 1, toWeek: 12, keystone: true } }),
        task("t2", "p1", { status: "todo", title: "過去問を解く" })
      ],
      tracks: [track("tr1", "p1")],
      weeklyCommitments: [
        weekMeta(WEEK_START),
        item("wci1", "t1", WEEK_START, { completedAt: "2026-08-30T09:00:00" }),
        item("wci2", "t1", WEEK_START),
        item("wci3", "t2", WEEK_START),
        ...weeksFixture
      ],
      currentView: "twelveweek"
    });

    // ============================================================
    // [1] タブ到達(PCサイドバー・その他)
    // ============================================================
    console.log("[1] タブ到達: PCサイドバー直接クリック・モバイル「その他」経由");
    check("PCサイドバーに「12WY」ナビ項目がある",
      await page.locator('#sidebar [data-action="nav"][data-view="twelveweek"]').count() === 1);
    check("直接navでCYCLE面が描画される",
      await page.locator('#app[data-view="twelveweek"] .twy-tower').count() === 1);
    // MEDIUM-2: PCサイドバーは存在チェックだけでなく実際にクリックして到達させる。
    await seed(page, { currentView: "today" });
    await page.click('#sidebar [data-action="nav"][data-view="twelveweek"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "twelveweek");
    check("PCサイドバーのクリックで12WYタブへ到達する",
      await page.evaluate(() => document.querySelector("#app").dataset.view) === "twelveweek");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => window.innerWidth === w, 390);
    await seed(page, { currentView: "more" });
    check("モバイル「その他」グリッドに「12WY」項目がある",
      await page.locator('.more-tower-item[data-view="twelveweek"]').count() === 1);
    await page.click('.more-tower-item[data-view="twelveweek"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "twelveweek");
    check("「その他」経由で12WYタブへ到達する",
      await page.evaluate(() => document.querySelector("#app").dataset.view) === "twelveweek");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => window.innerWidth === w, 1280);
    await seed(page, { currentView: "twelveweek" });

    // LOW-1: 面チップはCYCLEだけactive・他3つはdisabled(design §A)。
    check("面チップ: activeは1件(CYCLE)", await page.locator(".twy-face-segmented button.active").count() === 1);
    check("面チップ: disabledは3件(PLAN/WEEK/REVIEW)", await page.locator(".twy-face-segmented button:disabled").count() === 3);

    // ============================================================
    // [2] S2 GLASSがcomputedで効く
    // ============================================================
    console.log("[2] S2 GLASS変数がcomputedで効く(todayタブと同じ--tower-bg/backdrop-filter)");
    const glassVars = await page.evaluate(() => {
      const el = document.querySelector('#app[data-view="twelveweek"] .twy-tower');
      const cs = getComputedStyle(el);
      const panel = document.querySelector('#app[data-view="twelveweek"] .twy-vision-panel');
      const panelCs = panel ? getComputedStyle(panel) : null;
      return {
        towerBg: cs.getPropertyValue("--tower-bg").trim(),
        panelRadius: panelCs ? panelCs.borderRadius : "",
        panelBlur: panelCs ? (panelCs.backdropFilter || panelCs.webkitBackdropFilter || "") : ""
      };
    });
    check("--tower-bgがS2 GLASSの値(#0b0d1c)になっている", glassVars.towerBg === "#0b0d1c", glassVars.towerBg);
    check("VISIONパネルにGLASSの角丸(18px)が効いている", glassVars.panelRadius === "18px", glassVars.panelRadius);
    check("VISIONパネルにbackdrop-filter(blur)が効いている", /blur/.test(glassVars.panelBlur), glassVars.panelBlur);

    // ============================================================
    // [3] state非書込(HIGH-1修正: 描画・nav往復・リサイズを計測対象にする。VISION保存は対象外)
    // ============================================================
    console.log("[3] state非書込: 描画・nav往復・面チップ・390/1280リサイズはfixture値を変えない");
    const fixtureBefore = await coreFixtureSnapshot(page);
    await page.click('#sidebar [data-action="nav"][data-view="wbs"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "wbs");
    // review-r1-claude-a2.md M3: 「描画」自体を計測窓に含めるため、twelveweekへ戻る直前に
    // ログをリセットし、戻り先レンダー(renderTwelveWeek()の呼び出しそのもの)の書き込みを
    // 実測する。ただしcurrentView切替は既存契約で1回だけ永続化される(NEVER対象外)ため、
    // ここでは「1回ちょうど(currentViewの永続化)」であって、12WYタブ固有の余計な書き込みが
    // 上乗せされていないことを確認する(page.reload()は全viewで走るsyncFromGitHubOnStartup()
    // が非同期に追加writeを起こすため使わない。id:v357テスト安定化コメント参照)。
    await resetSetItemLog(page);
    await page.click('#sidebar [data-action="nav"][data-view="twelveweek"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "twelveweek");
    const writesOnNavRender = await contentChangingWrites(page, STATE_KEY);
    check("12WYタブへ戻る描画の書き込みはcurrentView永続化の1回だけ(12WY固有の余計な書き込みが無い)",
      writesOnNavRender === 1, writesOnNavRender);
    // ここから先(準備中チップのクリック・13 WEEKSバーのhover/tap・幅跨ぎリサイズ)は
    // currentViewも含めて一切書き込まないはずの経路なので、resetSetItemLog後に
    // 「0回書き込み」を厳密に検証する(旧実装はforce+.catchの空クリックだけで自明に0回
    // だったため、実際にhover/クリックを当てるバー操作を追加した)。
    await resetSetItemLog(page);
    await page.click('.twy-face-segmented button:disabled', { force: true }).catch(() => {});
    const firstWeekBar = page.locator(".twy-week").first();
    if (await firstWeekBar.count()) {
      await firstWeekBar.hover();
      await firstWeekBar.click({ force: true }).catch(() => {});
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => window.innerWidth === w, 390);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => window.innerWidth === w, 1280);
    const writesDuringReadOnly = await contentChangingWrites(page, STATE_KEY);
    const fixtureAfter = await coreFixtureSnapshot(page);
    check("準備中チップのクリック・バーhover/tap・リサイズはstateへ内容変更を伴う書き込みをしない(0回)", writesDuringReadOnly === 0, writesDuringReadOnly);
    check("WBS往復・戻り描画・チップ・バーhover/tap・リサイズを通してtasks/projects/tracks/weeklyCommitmentsが変化しない(fixture値比較)",
      fixtureAfter === fixtureBefore);

    // ============================================================
    // [4] VISION帯: 空時の誘導→保存→反映(settings更新・dataModifiedAt bump)。normalizeStateの
    // 新規キー補完はdataModifiedAtを進めない契約(MEDIUM-4)もあわせて確認する。
    // ============================================================
    console.log("[4] VISION帯: 空時の誘導、保存でsettings更新+dataModifiedAt bump");
    check("VISION未設定時は誘導1行を出す(催促文言なし)",
      (await page.locator(".twy-vision-guide").textContent()).includes("タップして"));
    // A-M1: 未設定時でもタップ標的は44px下限を割らない。
    const bandBox = await page.locator('[data-action="twy-vision-open"]').boundingBox();
    check("VISION帯(未設定時)のタップ標的は44px以上", bandBox && bandBox.height >= 44, JSON.stringify(bandBox));

    // MEDIUM-4: normalizeStateの新規キー(twelveWeekReviewWeekMinItems)補完だけではdataModifiedAtを
    // 進めない契約。旧state(新キー無し)をseedしてreloadし、bumpされないことを確認する。
    const beforeMigration = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.twelveWeekReviewWeekMinItems;
      localStorage.setItem(KEY, JSON.stringify(s));
      return s.dataModifiedAt;
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    const afterMigration = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
    check("settings.twelveWeekReviewWeekMinItemsが既定値3で補完される", afterMigration.settings.twelveWeekReviewWeekMinItems === 3);
    check("新規キーの既定値補完だけではdataModifiedAtを進めない",
      afterMigration.dataModifiedAt === beforeMigration, `${afterMigration.dataModifiedAt} / ${beforeMigration}`);

    const beforeModified = afterMigration.dataModifiedAt;
    await page.click('[data-action="twy-vision-open"]');
    await page.waitForSelector('[data-twy-vision-field="twelveWeekVision"]');
    check("VISION編集シートが開く(2項目)",
      await page.locator('[data-twy-vision-field="twelveWeekVision"]').count() === 1
      && await page.locator('[data-twy-vision-field="twelveWeekFocus"]').count() === 1);
    await page.fill('[data-twy-vision-field="twelveWeekVision"]', "3年後は資格と投資の両輪で立つ");
    await page.fill('[data-twy-vision-field="twelveWeekFocus"]', "今期はウイスキー検定に寄せる");
    // dataModifiedAtのbump判定は秒未満の粒度が無いため、固定時刻を1分進めてから保存する
    // (r0-twyplan.testでも既知の「同一秒で失敗しうる」問題の同種回避)。
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 60000));
    await page.click('[data-action="twy-vision-save"]');
    await page.waitForSelector('[data-twy-vision-field="twelveWeekVision"]', { state: "detached" });
    const afterState = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
    check("settings.twelveWeekVisionが保存される", afterState.settings.twelveWeekVision === "3年後は資格と投資の両輪で立つ");
    check("settings.twelveWeekFocusが保存される", afterState.settings.twelveWeekFocus === "今期はウイスキー検定に寄せる");
    check("dataModifiedAtがbumpされる", afterState.dataModifiedAt !== beforeModified);
    check("保存後は誘導行が消え本文が表示される",
      await page.locator(".twy-vision-guide").count() === 0
      && (await page.locator(".twy-vision-row p").first().textContent()).includes("資格と投資"));

    // ============================================================
    // [5] GOALS: 3件表示・絞り込みnegative case・トラックチップが既存digestと一致
    // ============================================================
    console.log("[5] GOALS: 1件描画(wish/旧サイクルは除外)・トラックチップがWBS側renderTwyTrackRowと一致");
    check("GOALSカードが1件描画される(p1のみ。wish/旧サイクルは除外)", await page.locator(".twy-goal").count() === 1);
    check("MEDIUM-5: wishプロジェクトはGOALSに出ない",
      !(await page.locator(".twy-goal-title").allTextContents()).some((t) => t.includes("Wishプロジェクト")));
    check("MEDIUM-5: 旧サイクルのプロジェクトはGOALSに出ない",
      !(await page.locator(".twy-goal-title").allTextContents()).some((t) => t.includes("旧サイクル")));
    check("見出しの件数表示が1/最大3", (await page.locator(".twy-goals-panel h2").textContent()).includes("1 / 最大3"));
    check("★Keystoneの行動タスク名が出る", (await page.locator(".twy-goal-act").textContent()).includes("★") && (await page.locator(".twy-goal-act").textContent()).includes("検定の勉強をする"));
    check("今週コマ数が3(プロジェクト配下t1×2+t2×1の合計)", (await page.locator(".twy-goal-count b").textContent()).trim() === "3");
    // A-M3: GOALSカードは読み取り専用(更新ボタン・エディタを出さない)。
    check("A-M3: GOALSカードに更新ボタン(twy-open-editor)が無い",
      await page.locator(".twy-goal [data-action=\"twy-open-editor\"]").count() === 0);
    // B-M6レビュー対応: 「今週を確定」導線(既存openTwyCommitSheet、WBS側と文言統一)がGOALSに1つある。
    check("GOALSパネルに「今週を確定」導線(twy-open-commit)が1つある",
      await page.locator('.twy-goals-panel [data-action="twy-open-commit"]').count() === 1);
    await page.click('.twy-goals-panel [data-action="twy-open-commit"]');
    await page.waitForSelector('.twy-commit-sheet');
    check("「今週を確定」導線が既存WEEKLY COMMITシートを開く", await page.locator(".twy-commit-sheet").count() === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector('.twy-commit-sheet', { state: "detached" });
    const twyChipText = await page.locator(".twy-goal .twy-row .t-state").first().textContent();

    // HIGH-2/MEDIUM-1修正: 実在するaction(wbs-select-project)でp1を明示的に選択し、
    // escape hatch無しでWBS側チップの取得成功を先に確認してから一致を検証する。
    await page.click('#sidebar [data-action="nav"][data-view="wbs"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "wbs");
    await page.click('[data-action="wbs-select-project"][data-id="p1"]');
    await page.waitForSelector('[data-wbs-detail-id="p1"]');
    const wbsChipText = await page.locator('[data-wbs-detail-id="p1"] .twy-row .t-state').first().textContent();
    check("WBS側チップが取得できている", wbsChipText !== "", wbsChipText);
    check("トラック状態チップがWBS側の既存digestと一致する(新しい判定を作らない)",
      wbsChipText === twyChipText, `${twyChipText} / ${wbsChipText}`);
    await seed(page, { currentView: "twelveweek" });

    // ============================================================
    // [6] GOALS: 4件目で警告1行(最大3は警告のみ・保存は止めない)
    // ============================================================
    console.log("[6] GOALS: 4件目で警告1行(最大3は警告のみ)");
    await seed(page, {
      projects: [project("p1"), project("p2"), project("p3"), project("p4")],
      currentView: "twelveweek"
    });
    check("4件中3件だけ表示される", await page.locator(".twy-goal").count() === 3);
    check("超過警告が1行出る(LOW-3: 明示的に1件)",
      await page.locator(".twy-goal-warn").count() === 1
      && (await page.locator(".twy-goal-warn").textContent()).includes("3件を超えています"));
    await seed(page, { projects: [p1, wishProject, oldCycleProject], currentView: "twelveweek" });

    // ============================================================
    // [7] R1b: 13 WEEKSバー(当週=W8。W13はまだ未到達=future)
    // ============================================================
    console.log("[7] 13 WEEKSバー: 13本・状態の描き分け・目標線のスケール式・当週ハイライト");
    check("バーが13本描画される", await page.locator(".twy-week").count() === 13);
    check("W1はscored", await page.locator(".twy-week").nth(0).getAttribute("data-status") === "scored");
    check("W2(週メタ無し)はuncommitted", await page.locator(".twy-week").nth(1).getAttribute("data-status") === "uncommitted");
    check("W3(全免除)はna", await page.locator(".twy-week").nth(2).getAttribute("data-status") === "na");
    check("当週(W8)だけdata-current=1", await page.locator(".twy-week[data-current=\"1\"]").count() === 1
      && await page.locator(".twy-week").nth(7).getAttribute("data-current") === "1");
    check("W9〜W12はfuture", (await Promise.all([8, 9, 10, 11].map((i) => page.locator(".twy-week").nth(i).getAttribute("data-status"))))
      .every((s) => s === "future"));
    check("W13はisReviewWeek(data-review=1)を持つ", await page.locator(".twy-week").nth(12).getAttribute("data-review") === "1");
    check("W13はまだ未到達なのでfuture", await page.locator(".twy-week").nth(12).getAttribute("data-status") === "future");

    // MEDIUM-2レビュー対応: 目標線・バー高の検算をinline style文字列比較(実装定数の写経)から
    // computed height/boundingBoxへ置き換える。review-r1-claude-a2.md H1: 「グラフ高」を
    // .twy-week(バー1本分のグリッド行)のcomputed heightそのままにすると、その中に常時居る
    // .twy-week-pct(実行率ラベル)の分だけ実装(TWY_WEEKS_BAR_H=行高−ラベル高)とズレて
    // 高実行率週の頭打ちを検出できなくなる。usableは実装定数を写経せず、実マークアップから
    // 「.twy-weekの高さ − .twy-week-pctの実高(height+margin-bottom)」として算出する。
    const usable = await page.evaluate(() => {
      const weekEl = document.querySelector(".twy-week");
      const pctEl = weekEl.querySelector(".twy-week-pct");
      const weekH = parseFloat(getComputedStyle(weekEl).height);
      const pctCs = getComputedStyle(pctEl);
      const pctH = pctEl.getBoundingClientRect().height + parseFloat(pctCs.marginBottom || "0");
      return weekH - pctH;
    });
    const expectedTargetPx = Math.round(85 / 100 * usable);
    const lineBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".twy-weeks-line")).bottom));
    check(`目標線の位置がスケール式どおり(computed bottom≈${expectedTargetPx}px)`, Math.abs(lineBottom - expectedTargetPx) <= 1, lineBottom);
    const expectedW1Px = Math.round(50 / 100 * usable);
    const w1ColHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".twy-week .twy-week-col")).height));
    check(`W1(50%)のバー高がスケール式どおり(computed height≈${expectedW1Px}px)`, Math.abs(w1ColHeight - expectedW1Px) <= 1, w1ColHeight);

    // A-H1レビュー対応: 「85%バーの上端yと85%目標線のyが一致(±1px)」をboundingBox実測で
    // 直接検証する(上記のcomputed高さ検算とは独立に、目標線とバーが同じ基準線を共有する
    // ことそのものを確かめる)。専用の85%固定週を1本だけ用意する。
    await seed(page, {
      weeklyCommitments: scoredWeek(W[0], 17, 20), // 17/20=85%
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelector(".twy-week")?.getAttribute("data-status") === "scored");
    const barBoxH1 = await page.locator(".twy-week").nth(0).locator(".twy-week-col").boundingBox();
    const lineBoxH1 = await page.locator(".twy-weeks-line").boundingBox();
    check("A-H1: 85%バーの上端yと85%目標線のyが一致(±1px、boundingBox実測)",
      barBoxH1 && lineBoxH1 && Math.abs(barBoxH1.y - lineBoxH1.y) <= 1, JSON.stringify({ barBoxH1, lineBoxH1 }));

    // A-H2レビュー対応: .twy-weeks-wrapが縦クリップしない(scrollHeight<=clientHeight)・
    // W1〜W13のラベルが全部容器内(boundingBoxが可視)であることを、実行率の高い週を
    // 混ぜたfixtureで固定する(review-r1-claude-a.mdの実測条件=100%週を複数含む)。
    // totalCount=20(=review-r1-claude-a.mdの実測条件と同種の高実行率週の描き分けを再現するのに
    // 十分な粒度)。totalCount=100だと13週分で1300itemになりseed()のreload検証が不安定になった。
    const highScoreWeeks = W.flatMap((weekStart, i) =>
      scoredWeek(weekStart, Math.round([50, 0, 100, 85, 33, 100, 60, 100, 20, 75, 90, 100, 40][i] / 5), 20));
    // selectedDateはtodayISO()(実クロック)に追随して補正される契約なので、seed()前に
    // クロックを先に進めておく(section[8]と同じ順序)。
    await page.clock.setFixedTime(FIXED_NOW_W13);
    await seed(page, {
      weeklyCommitments: highScoreWeeks,
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      selectedDate: "2026-10-05",
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelectorAll(".twy-week").length === 13
      && document.querySelectorAll(".twy-week")[12]?.getAttribute("data-status") === "scored");
    const clipMetrics = await page.evaluate(() => {
      const wrap = document.querySelector(".twy-weeks-wrap");
      return { scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight };
    });
    check("A-H2: .twy-weeks-wrapは縦クリップしない(scrollHeight<=clientHeight)",
      clipMetrics.scrollHeight <= clipMetrics.clientHeight, JSON.stringify(clipMetrics));
    const wrapBox = await page.locator(".twy-weeks-wrap").boundingBox();
    const labelBoxes = await page.locator(".twy-week-lab").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    check("A-H2: W1〜W13のラベルが全部.twy-weeks-wrap内に収まる(可視)",
      labelBoxes.length === 13 && labelBoxes.every((b) => b.top >= wrapBox.y - 1 && b.bottom <= wrapBox.y + wrapBox.height + 1),
      JSON.stringify({ wrapBox, labelBoxes }));

    // review-r1-claude-a2.md H1: 同じhighScoreWeeksフィクスチャ(index2=100%/index10=90%/
    // index3=85%)で、86%以上のバーがflex-shrinkで頭打ちにならず単調増加すること・100%週の
    // バー上端が85%目標線より明確に(10px超)上にあることを実測で固定する。
    const barHeights100_90_85 = await page.evaluate(() => [2, 10, 3].map((i) =>
      parseFloat(getComputedStyle(document.querySelectorAll(".twy-week")[i].querySelector(".twy-week-col")).height)));
    check("H1: 100%/90%/85%のバー高は頭打ちせず単調増加する(100%>90%>85%)",
      barHeights100_90_85[0] > barHeights100_90_85[1] && barHeights100_90_85[1] > barHeights100_90_85[2],
      JSON.stringify(barHeights100_90_85));
    const bar100Box = await page.locator(".twy-week").nth(2).locator(".twy-week-col").boundingBox();
    const line85Box = await page.locator(".twy-weeks-line").boundingBox();
    check("H1: 100%週のバー上端が85%目標線より明確に上(10px超)",
      bar100Box && line85Box && (line85Box.y - bar100Box.y) > 10,
      JSON.stringify({ bar100Box, line85Box }));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 元のfixtureに戻す(当週=W8・W13未到達)。
    await seed(page, {
      selectedDate: TODAY,
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      weeklyCommitments: [
        weekMeta(WEEK_START), item("wci1", "t1", WEEK_START, { completedAt: "2026-08-30T09:00:00" }),
        item("wci2", "t1", WEEK_START), item("wci3", "t2", WEEK_START),
        ...weeksFixture
      ],
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelector(".twy-week")?.getAttribute("data-status") === "scored");

    // 12週平均: scored週(W1=50,W4=100,W5=100,W6=0,W7=100,W8=33)の平均=64%。W13未到達なので参考平均は出ない。
    const footTexts = await page.locator(".twy-weeks-foot span").allTextContents();
    check("12週平均が64%と表示される", footTexts.some((t) => t.includes("64%")), JSON.stringify(footTexts));
    check("W13未到達・データ無しは「確定0件(参考算入なし)」表示", footTexts.some((t) => t.includes("確定0件") && t.includes("参考算入なし")), JSON.stringify(footTexts));
    // MEDIUM-6レビュー対応: 見出し要素(.eyebrow)を特定し、旧文言の消失もあわせて固定する
    // (第13週到達後の[8]で「サイクル総括」に切り替わることの反対=まだ未到達である証拠)。
    const headlineText7 = await page.locator(".twy-tower .view-header .eyebrow").textContent();
    check("見出しは「12週間実行サイクル」(第13週に未到達)", headlineText7 === "12週間実行サイクル", headlineText7);
    check("「サイクル総括」はまだ出ない", !headlineText7.includes("サイクル総括"));

    // MEDIUM-7レビュー対応: cycleStartDate未設定(12WYサイクル未設定)はバーを出さず誘導1行のみ。
    await seed(page, { settings: { twelveWeekStartDate: "" }, currentView: "twelveweek" });
    check("MEDIUM-7: cycleStartDate未設定はバーを出さない(.twy-week 0件)", await page.locator(".twy-week").count() === 0);
    check("MEDIUM-7: cycleStartDate未設定は13 WEEKSパネル自体を出さない", await page.locator(".twy-weeks-panel").count() === 0);
    check("MEDIUM-7: GOALSは誘導1行のみ", (await page.locator(".twy-goal-empty").textContent()).includes("12WYサイクルが未設定"));
    await seed(page, {
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      currentView: "twelveweek"
    });

    // ============================================================
    // [8] R1b: W13(振り返り週)到達時 — 見出し切替・参考平均・達成トラック数
    // ============================================================
    console.log("[8] W13到達: 見出し「サイクル総括」・参考平均・達成トラック数");
    await page.clock.setFixedTime(FIXED_NOW_W13);
    await seed(page, {
      selectedDate: "2026-10-05",
      trackMeasurements: [{ id: "tm1", trackId: "tr1", value: 27, observedAt: "2026-10-01T09:00:00", deleted: false,
        createdAt: "2026-10-01T09:00:00", updatedAt: "2026-10-01T09:00:00" }],
      weeklyCommitments: [
        weekMeta(WEEK_START), item("wci1", "t1", WEEK_START, { completedAt: "2026-08-30T09:00:00" }),
        item("wci2", "t1", WEEK_START), item("wci3", "t2", WEEK_START),
        ...weeksFixture,
        ...scoredWeek(W[12], 3, 3) // W13: 確定3件・完了3件(閾値ちょうど→eligible)
      ],
      currentView: "twelveweek"
    });
    await page.waitForFunction(() =>
      document.querySelectorAll(".twy-week")[12]?.getAttribute("data-status") === "scored");
    check("W13到達で当週ハイライトがW13へ移る", await page.locator(".twy-week").nth(12).getAttribute("data-current") === "1");
    // MEDIUM-6レビュー対応: 見出し要素(.eyebrow)を特定し、旧文言(12週間実行サイクル)の
    // 消失もあわせて固定する(全体textContentへのincludesは上位集合を含み無意味なOR判定だった)。
    const headlineText8 = await page.locator(".twy-tower .view-header .eyebrow").textContent();
    check("見出しが「サイクル総括」に切り替わる", headlineText8 === "サイクル総括", headlineText8);
    check("旧見出し(12週間実行サイクル)は消える", !headlineText8.includes("12週間実行サイクル"));
    const footTexts2 = await page.locator(".twy-weeks-foot span").allTextContents();
    // avgWithReview = round((383+100)/7) = 69%
    check("W13到達・閾値以上で参考平均69%が出る", footTexts2.some((t) => t.includes("参考") && t.includes("69%")), JSON.stringify(footTexts2));

    // MEDIUM-5レビュー対応: W13斜線・当週ハイライトがdata属性だけでなくcomputed styleでも
    // 実際に効いていることを確認する(styles.cssのセレクタが外れても緑のままにならないように)。
    const reviewBg = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.twy-week[data-review="1"] .twy-week-col')).backgroundImage);
    check("MEDIUM-5: W13斜線がcomputedで効いている(repeating-linear-gradient)", /repeating-linear-gradient/.test(reviewBg), reviewBg);
    const currentOutline = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.twy-week[data-current="1"] .twy-week-col')).outlineStyle);
    check("MEDIUM-5: 当週ハイライトのoutlineがcomputedで効いている", currentOutline === "solid", currentOutline);

    // HIGH-1レビュー対応: 「達成トラック数」の分子・分母を別々に厳密検証する。旧assertは
    // includes("1")&&includes("/ 1")で、done=0でも"達成トラック 0 / 1"の後半一致で
    // 必ずPASSしていた(構造的に空振り)。ここでは完全一致+未達トラックのnegative caseを足す。
    check("トラック到達(達成トラック=1/1・goalValue到達で完了)",
      (await page.locator(".twy-goal-review").textContent()).trim() === "達成トラック 1 / 1",
      await page.locator(".twy-goal-review").textContent());

    // negative case: 未達トラックを持つ2件目のプロジェクトを混ぜると「1 / 2」になる
    // (分子=1が変わらないこと自体を、分母だけ変える形で固定する)。
    const p2 = project("p2", { id: "p2", title: "未達プロジェクト" });
    await seed(page, {
      projects: [p1, p2, wishProject, oldCycleProject],
      tasks: [
        task("t1", "p1", { status: "doing", title: "検定の勉強をする", twyPlan: { perWeek: 5, fromWeek: 1, toWeek: 12, keystone: true } }),
        task("t2", "p1", { status: "todo", title: "過去問を解く" }),
        task("t3", "p2", { status: "doing", title: "未達タスク" })
      ],
      tracks: [track("tr1", "p1"), track("tr2", "p2", { id: "tr2", ownerId: "p2", goalValue: 27, baselineValue: 0 })],
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelector(".twy-goal-review"));
    check("HIGH-1: 未達トラックを混ぜると分母だけ増えて1 / 2になる(分子=1は変わらない)",
      (await page.locator(".twy-goal-review").textContent()).trim() === "達成トラック 1 / 2",
      await page.locator(".twy-goal-review").textContent());

    // ============================================================
    // [9] A-M2: 非土曜開始でも週番号は経過日数基準/ A-M1: サイクル終了後はハイライト消滅
    // ============================================================
    console.log("[9] A-M2非土曜開始の当週ハイライト・A-M1サイクル終了後の見出し「(終了)」");
    const CYCLE_START_WED = "2026-07-15"; // 水曜(非土曜)開始
    await page.clock.setFixedTime(new Date(2026, 6, 25, 10, 0, 0)); // elapsed=10日→2週目のはず
    await seed(page, {
      settings: { twelveWeekStartDate: CYCLE_START_WED, twelveWeekScoreTarget: 85 },
      weeklyCommitments: [],
      selectedDate: "2026-07-25",
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelectorAll(".twy-week").length === 13);
    check("A-M2: 非土曜開始でも当週ハイライトは経過日数÷7+1(cycleWeekForDateと同じ式)でW2になる",
      await page.locator(".twy-week[data-current=\"1\"]").count() === 1
      && await page.locator(".twy-week").nth(1).getAttribute("data-current") === "1");

    // A-M1: today > cycleStartDate+90日(サイクル終了後)はisCurrentが1件も無く、
    // 見出しは「サイクル総括(終了)」になる。
    await page.clock.setFixedTime(new Date(2027, 2, 1, 10, 0, 0));
    await seed(page, {
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      weeklyCommitments: [
        weekMeta(WEEK_START), item("wci1", "t1", WEEK_START, { completedAt: "2026-08-30T09:00:00" }),
        item("wci2", "t1", WEEK_START), item("wci3", "t2", WEEK_START),
        ...weeksFixture, ...scoredWeek(W[12], 3, 3)
      ],
      selectedDate: "2027-03-01",
      currentView: "twelveweek"
    });
    await page.waitForFunction(() => document.querySelectorAll(".twy-week").length === 13);
    check("A-M1: サイクル終了後は当週ハイライトが1件も無い", await page.locator('.twy-week[data-current="1"]').count() === 0);
    const headlineEnded = await page.locator(".twy-tower .view-header .eyebrow").textContent();
    check("A-M1: サイクル終了後の見出しは「サイクル総括(終了)」", headlineEnded === "サイクル総括(終了)", headlineEnded);
    await page.clock.setFixedTime(FIXED_NOW);
    await seed(page, {
      settings: { twelveWeekStartDate: CYCLE_START, twelveWeekScoreTarget: 85 },
      selectedDate: TODAY,
      weeklyCommitments: [
        weekMeta(WEEK_START), item("wci1", "t1", WEEK_START, { completedAt: "2026-08-30T09:00:00" }),
        item("wci2", "t1", WEEK_START), item("wci3", "t2", WEEK_START),
        ...weeksFixture
      ],
      currentView: "twelveweek"
    });

    // ============================================================
    // [10] 390px/1280px横スクロールなし・pageerror 0(最終確認)
    // ============================================================
    console.log("[10] 390px/1280px横スクロールなし・pageerror 0(最終確認)");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((w) => window.innerWidth === w, width);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientW = await page.evaluate(() => document.documentElement.clientWidth);
      check(`${width}pxで横スクロールが発生しない`, scrollW <= clientW + 1, `${scrollW} vs ${clientW}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    check("一連の操作でpageerrorが発生しない(最終確認)", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
