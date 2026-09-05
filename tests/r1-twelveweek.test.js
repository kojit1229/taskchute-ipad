// tests/r1-twelveweek.test.js — 12WYタブ R1a(骨格+CYCLE面のVISION帯/GOALS)。
// 検証範囲(order-r1-cycle.md §C準拠):
// タブ到達(PCサイドバー・その他)、S2 GLASS変数がcomputedで効く、state非書込(fixture値比較+
// 内容変更を伴うsetItem 0回。VISION保存だけ例外)、VISION帯の保存(settings更新・dataModifiedAt
// bump)と空時の誘導・normalizeStateの新規キー補完はbumpしない契約、GOALS 3件表示・4件目で警告
// 1行・候補の絞り込み(wish除外・サイクル外除外)・トラックチップが既存digest(WBS側
// renderTwyTrackRow)と一致・「今週を確定」導線、390px/1280px横スクロールなし・
// pageerror 0・new Date("文字列")なし。13 WEEKSバーはR1bで追加する。
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
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

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

// v356テスト安定化: 前回reload由来のsyncFromGitHubOnStartup()(全reloadで発火する非同期処理)が
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
        item("wci3", "t2", WEEK_START)
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
    // WBSへの往復はcurrentView切替を伴う(=永続化する既存契約。NEVER対象外)ため、
    // 「0回書き込み」の計測対象には含めず、fixture値(tasks/projects/tracks/weeklyCommitments)
    // が変化しないことだけを確認する。
    await page.click('#sidebar [data-action="nav"][data-view="wbs"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "wbs");
    await page.click('#sidebar [data-action="nav"][data-view="twelveweek"]');
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.view === "twelveweek");
    // ここから先(準備中チップのクリック・リサイズ)はcurrentViewも含めて一切書き込まないはずの
    // 経路なので、resetSetItemLog後に「0回書き込み」を厳密に検証する。
    await resetSetItemLog(page);
    await page.click('.twy-face-segmented button:disabled', { force: true }).catch(() => {});
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => window.innerWidth === w, 390);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => window.innerWidth === w, 1280);
    const writesDuringReadOnly = await contentChangingWrites(page, STATE_KEY);
    const fixtureAfter = await coreFixtureSnapshot(page);
    check("準備中チップのクリック・リサイズはstateへ内容変更を伴う書き込みをしない(0回)", writesDuringReadOnly === 0, writesDuringReadOnly);
    check("WBS往復・チップ・リサイズを通してtasks/projects/tracks/weeklyCommitmentsが変化しない(fixture値比較)",
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

    // MEDIUM-4: normalizeStateの新規キー(twelveWeekVision)補完だけではdataModifiedAtを
    // 進めない契約。旧state(新キー無し)をseedしてreloadし、bumpされないことを確認する。
    const beforeMigration = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.twelveWeekVision;
      delete s.settings.twelveWeekFocus;
      localStorage.setItem(KEY, JSON.stringify(s));
      return s.dataModifiedAt;
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    const afterMigration = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY);
    check("settings.twelveWeekVision/Focusが既定値\"\"で補完される",
      afterMigration.settings.twelveWeekVision === "" && afterMigration.settings.twelveWeekFocus === "");
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
    // [5] GOALS: 3件表示・絞り込みnegative case・トラックチップが既存digestと一致・確定導線
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
    // [7] 390px/1280px横スクロールなし・pageerror 0(最終確認)
    // ============================================================
    console.log("[7] 390px/1280px横スクロールなし・pageerror 0(最終確認)");
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
