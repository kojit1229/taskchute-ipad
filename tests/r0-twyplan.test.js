// r0-twyplan.test.js — R0: task.twyPlan(週次目安)のnormalizeState後方互換+clamp、
// Task編集モーダルの12週プラン区画(12WY配下のみ)、保存反映、モバイル幅回帰を検証する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name}${extra ? ` ${extra}` : ""}`); }
}

const TODAY = "2026-09-04";
const project = (id, extra = {}) => ({
  id, kind: "normal", title: id, status: "active", priority: "中", category: "",
  startDate: "", dueDate: "", description: "", twelveWeekStartDate: "",
  showProgress: false, collapsed: false, createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false, ...extra
});
const task = (id, projectId, extra = {}) => ({
  id, projectId, parentTaskId: "", title: id, category: "", status: "todo", dueDate: "",
  description: "", progressNum: 0, progressDen: 10,
  createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false, ...extra
});

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function seed({ projects = [], tasks = [] } = {}) {
    await page.evaluate(({ key, projects, tasks, today }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.currentView = "wbs";
      s.selectedDate = today;
      s.projects = projects;
      s.tasks = tasks;
      s.blocks = [];
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, projects, tasks, today: TODAY });
    await page.reload();
    await page.waitForSelector("main");
  }

  async function stateNow() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  }

  async function openTaskMenu(taskId) {
    await page.locator(`[data-wbs-row-id="${taskId}"] .wbs-row-menu-toggle`).click();
    await page.locator(`[data-action="edit-task"][data-id="${taskId}"]`).click();
    await page.waitForSelector('[data-action="modal-save"]', { state: "visible" });
  }

  // M3: nowDateTime()は秒精度なので、直前の保存と同一秒内に次の保存が起きると
  // updatedAtが偶然一致しうる。固定sleepで秒境界を跨ぐのではなく、実際にstateが
  // 変化するまでポーリング待機する(タイムアウトすれば「bumpしなかった」という事実として扱う)。
  async function waitForTaskUpdatedAtChange(taskId, prevUpdatedAt, timeout = 3000) {
    try {
      await page.waitForFunction(({ key, taskId, prevUpdatedAt }) => {
        const st = JSON.parse(localStorage.getItem(key) || "null");
        const t = st?.tasks?.find((x) => x.id === taskId);
        return Boolean(t) && t.updatedAt !== prevUpdatedAt;
      }, { key: STATE_KEY, taskId, prevUpdatedAt }, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    // ============================================================
    // A: normalizeState 後方互換(twyPlanなし→既定値・部分欠損・clamp・updatedAt不変)
    // ============================================================
    console.log("[1] normalizeState: twyPlanなし→既定値が補完される");
    await seed({
      projects: [project("p1", { twelveWeekStartDate: TODAY })],
      tasks: [task("legacy-task", "p1")]  // twyPlanフィールドなし(旧データ模擬)
    });
    let s = await stateNow();
    let normalized = s.tasks.find((t) => t.id === "legacy-task");
    check("twyPlanなしTaskに既定値{perWeek:0,fromWeek:1,toWeek:12,keystone:false}が補完される",
      normalized.twyPlan && normalized.twyPlan.perWeek === 0 && normalized.twyPlan.fromWeek === 1
      && normalized.twyPlan.toWeek === 12 && normalized.twyPlan.keystone === false, JSON.stringify(normalized.twyPlan));

    console.log("[2] normalizeState: 部分欠損は欠損分のみ補完・既存値優先");
    await page.evaluate((key) => {
      const st = JSON.parse(localStorage.getItem(key));
      st.tasks = [{
        id: "partial-task", projectId: "p1", parentTaskId: "", title: "部分欠損", category: "", status: "todo",
        dueDate: "", description: "", createdAt: "2026-09-01T00:00:00", updatedAt: "2026-09-01T00:00:00", deleted: false,
        twyPlan: { perWeek: 4, keystone: true }  // fromWeek/toWeek欠損
      }];
      localStorage.setItem(key, JSON.stringify(st));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("main");
    s = await stateNow();
    const partial = s.tasks.find((t) => t.id === "partial-task");
    check("欠損分のみ補完(fromWeek=1,toWeek=12)・既存値(perWeek=4,keystone=true)は保持",
      partial.twyPlan.perWeek === 4 && partial.twyPlan.keystone === true
      && partial.twyPlan.fromWeek === 1 && partial.twyPlan.toWeek === 12, JSON.stringify(partial.twyPlan));

    console.log("[3] normalizeState: clamp(perWeek負数/小数/文字列/NaN、fromWeek/toWeek範囲外・逆転)");
    await page.evaluate((key) => {
      const st = JSON.parse(localStorage.getItem(key));
      st.tasks = [
        { id: "clamp-a", projectId: "p1", parentTaskId: "", title: "clamp-a", category: "", status: "todo",
          dueDate: "", description: "", createdAt: "2026-09-01T00:00:00", updatedAt: "2026-09-01T00:00:00", deleted: false,
          twyPlan: { perWeek: -1, fromWeek: 0, toWeek: 13 } },
        { id: "clamp-b", projectId: "p1", parentTaskId: "", title: "clamp-b", category: "", status: "todo",
          dueDate: "", description: "", createdAt: "2026-09-01T00:00:00", updatedAt: "2026-09-01T00:00:00", deleted: false,
          twyPlan: { perWeek: 2.7, fromWeek: 8, toWeek: 3 } }
      ];
      localStorage.setItem(key, JSON.stringify(st));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("main");
    s = await stateNow();
    const clampA = s.tasks.find((t) => t.id === "clamp-a");
    const clampB = s.tasks.find((t) => t.id === "clamp-b");
    check("perWeek -1→0、fromWeek 0→1、toWeek 13→12", clampA.twyPlan.perWeek === 0
      && clampA.twyPlan.fromWeek === 1 && clampA.twyPlan.toWeek === 12, JSON.stringify(clampA.twyPlan));
    check("perWeek 2.7→切り捨て2、fromWeek>toWeek逆転はtoWeek=fromWeek(8)",
      clampB.twyPlan.perWeek === 2 && clampB.twyPlan.fromWeek === 8 && clampB.twyPlan.toWeek === 8, JSON.stringify(clampB.twyPlan));

    console.log("[4] normalizeState: 補完でtask.updatedAtが進まない");
    await page.evaluate((key) => {
      const st = JSON.parse(localStorage.getItem(key));
      st.tasks = [{
        id: "unchanged-task", projectId: "p1", parentTaskId: "", title: "不変確認", category: "", status: "todo",
        dueDate: "", description: "", createdAt: "2026-09-01T00:00:00", updatedAt: "2026-09-01T09:09:09", deleted: false
        // twyPlanなし
      }];
      localStorage.setItem(key, JSON.stringify(st));
    }, STATE_KEY);
    await page.reload();
    await page.waitForSelector("main");
    s = await stateNow();
    const unchanged = s.tasks.find((t) => t.id === "unchanged-task");
    check("twyPlan補完だけではupdatedAtが進まない", unchanged.updatedAt === "2026-09-01T09:09:09", unchanged.updatedAt);

    // ============================================================
    // C: Task編集モーダル(12WY配下のみ3項目・非12WYはDOMに無い)
    // ============================================================
    console.log("[5] Task編集モーダル: 12WY配下Taskは12週プラン区画が出る");
    await seed({
      projects: [project("p-12wy", { twelveWeekStartDate: TODAY }), project("p-normal")],
      tasks: [task("t-12wy", "p-12wy"), task("t-normal", "p-normal")]
    });
    await openTaskMenu("t-12wy");
    check("週次目安の入力欄がある", await page.locator('[data-modal-field="twyPerWeek"]').count() === 1);
    check("対象週(開始)のselectがある", await page.locator('[data-modal-field="twyFromWeek"]').count() === 1);
    check("対象週(終了)のselectがある", await page.locator('[data-modal-field="twyToWeek"]').count() === 1);
    check("★要となる行動のcheckboxがある", await page.locator('[data-modal-field="twyKeystone"]').count() === 1);
    check("週次目安欄はfont-size16px以上", await page.locator('[data-modal-field="twyPerWeek"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
    check("対象週(開始)selectはfont-size16px以上", await page.locator('[data-modal-field="twyFromWeek"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
    check("対象週(終了)selectはfont-size16px以上(L1)", await page.locator('[data-modal-field="twyToWeek"]').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16));
    // v336: keystoneはcheckbox(iOSの自動ズーム対象はtext/number/select等のフォーカス可能な
    // テキスト系入力であり、checkboxはズームしないため16px要件の対象外。.checkbox-lineは
    // アプリ全体で14pxで統一済みでR0固有の退行ではない(L-3)。ここでは要素がある事実だけを確認する。
    check("keystoneチェックボックスは存在する(font-size要件はcheckbox非対象)",
      await page.locator('[data-modal-field="twyKeystone"]').count() === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });

    console.log("[6] Task編集モーダル: 非12WY配下Taskは区画がDOMに無い");
    await openTaskMenu("t-normal");
    check("週次目安の入力欄がDOMに無い", await page.locator('[data-modal-field="twyPerWeek"]').count() === 0);
    check("対象週selectがDOMに無い", await page.locator('[data-modal-field="twyFromWeek"]').count() === 0
      && await page.locator('[data-modal-field="twyToWeek"]').count() === 0);
    check("keystoneチェックボックスがDOMに無い", await page.locator('[data-modal-field="twyKeystone"]').count() === 0);
    await page.click('[data-action="modal-close"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });

    // ============================================================
    // C: 保存が state に反映(updatedAt/dataModifiedAt bump)
    // ============================================================
    console.log("[7] 保存でtwyPlanがstateへ反映(updatedAt/dataModifiedAtがbump)");
    const before = await stateNow();
    const beforeTask = before.tasks.find((t) => t.id === "t-12wy");
    const beforeDataModifiedAt = before.dataModifiedAt;
    await page.waitForTimeout(1100);  // nowDateTime()の秒精度で確実にbumpを検出するための待機(固定時間そのものが検証対象=許容する唯一の例外。M3)
    await openTaskMenu("t-12wy");
    await page.fill('[data-modal-field="twyPerWeek"]', "5");
    await page.selectOption('[data-modal-field="twyFromWeek"]', "3");
    await page.selectOption('[data-modal-field="twyToWeek"]', "9");
    await page.check('[data-modal-field="twyKeystone"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const after = await stateNow();
    const afterTask = after.tasks.find((t) => t.id === "t-12wy");
    check("perWeekが保存される", afterTask.twyPlan.perWeek === 5, JSON.stringify(afterTask.twyPlan));
    check("fromWeekが保存される", afterTask.twyPlan.fromWeek === 3, JSON.stringify(afterTask.twyPlan));
    check("toWeekが保存される", afterTask.twyPlan.toWeek === 9, JSON.stringify(afterTask.twyPlan));
    check("keystoneが保存される", afterTask.twyPlan.keystone === true, JSON.stringify(afterTask.twyPlan));
    check("task.updatedAtがbumpされる", afterTask.updatedAt !== beforeTask.updatedAt, `${beforeTask.updatedAt} -> ${afterTask.updatedAt}`);
    check("state.dataModifiedAtがbumpされる", after.dataModifiedAt !== beforeDataModifiedAt, `${beforeDataModifiedAt} -> ${after.dataModifiedAt}`);

    console.log("[8] リロード後も保存値が保持される");
    await page.reload();
    await page.waitForSelector("main");
    const reloaded = await stateNow();
    const reloadedTask = reloaded.tasks.find((t) => t.id === "t-12wy");
    check("リロード後もperWeek/fromWeek/toWeek/keystoneが保持",
      reloadedTask.twyPlan.perWeek === 5 && reloadedTask.twyPlan.fromWeek === 3
      && reloadedTask.twyPlan.toWeek === 9 && reloadedTask.twyPlan.keystone === true, JSON.stringify(reloadedTask.twyPlan));

    // ============================================================
    // C: 12WY配下Taskを無変更で再保存したときの実挙動を固定する(B-H2)。
    // 発注§Cは「変更があったときだけbump。既存が『常に bump』ならそれに従い報告」と定めており、
    // 実装(app.js:saveTaskFromModal のtask更新分岐)は他フィールド同様スプレッド+
    // `updatedAt: changedAt` の無条件bumpで、twyPlanだけ特別扱いしていない。
    // このテストは「値は変わらないがtask.updatedAt/state.dataModifiedAtは常にbumpされる」
    // という既存の常時bump慣行そのものを固定する(将来「変更なしなら不変」の実装が
    // 紛れ込んでも退行として検知できるようにする)。
    // ============================================================
    console.log("[9] Task編集モーダル: 12WYタスクの無変更再保存はtwyPlanの値を変えないがupdatedAt/dataModifiedAtは常にbumpされる(既存の常時bump慣行、B-H2)");
    const beforeUnchanged = await stateNow();
    const beforeUnchangedTask = beforeUnchanged.tasks.find((t) => t.id === "t-12wy");
    const beforeUnchangedDataModifiedAt = beforeUnchanged.dataModifiedAt;
    await openTaskMenu("t-12wy");
    // フィールドは一切変更せずそのまま保存する
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const bumpedOnUnchangedSave = await waitForTaskUpdatedAtChange("t-12wy", beforeUnchangedTask.updatedAt);
    const afterUnchanged = await stateNow();
    const afterUnchangedTask = afterUnchanged.tasks.find((t) => t.id === "t-12wy");
    check("無変更再保存でもtwyPlanの値そのものは変わらない",
      afterUnchangedTask.twyPlan.perWeek === beforeUnchangedTask.twyPlan.perWeek
      && afterUnchangedTask.twyPlan.fromWeek === beforeUnchangedTask.twyPlan.fromWeek
      && afterUnchangedTask.twyPlan.toWeek === beforeUnchangedTask.twyPlan.toWeek
      && afterUnchangedTask.twyPlan.keystone === beforeUnchangedTask.twyPlan.keystone,
      JSON.stringify({ before: beforeUnchangedTask.twyPlan, after: afterUnchangedTask.twyPlan }));
    check("無変更再保存でもtask.updatedAtは常にbumpされる(既存慣行)", bumpedOnUnchangedSave,
      `${beforeUnchangedTask.updatedAt} -> ${afterUnchangedTask.updatedAt}`);
    check("無変更再保存でもstate.dataModifiedAtは常にbumpされる(既存慣行)",
      afterUnchanged.dataModifiedAt !== beforeUnchangedDataModifiedAt,
      `${beforeUnchangedDataModifiedAt} -> ${afterUnchanged.dataModifiedAt}`);

    // ============================================================
    // C: UI経由の正規化(M4)。フォームで逆転値・空欄・負数を入れて保存しても
    // A(normalizeTwyPlan)の規則どおりclampされることを確認する。
    // ============================================================
    console.log("[9b] Task編集モーダル: UI経由の逆転値(fromWeek>toWeek)はtoWeek=fromWeekへ補正される(M4)");
    await openTaskMenu("t-12wy");
    await page.selectOption('[data-modal-field="twyFromWeek"]', "9");
    await page.selectOption('[data-modal-field="twyToWeek"]', "3");
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const afterReversed = (await stateNow()).tasks.find((t) => t.id === "t-12wy");
    check("fromWeek=9・toWeek=3選択→保存後はtoWeek=fromWeek(9)へ補正", afterReversed.twyPlan.fromWeek === 9
      && afterReversed.twyPlan.toWeek === 9, JSON.stringify(afterReversed.twyPlan));

    console.log("[9c] Task編集モーダル: UI経由で週次目安を空欄にすると保存後は0になる(M4)");
    await openTaskMenu("t-12wy");
    await page.fill('[data-modal-field="twyPerWeek"]', "");
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const afterEmpty = (await stateNow()).tasks.find((t) => t.id === "t-12wy");
    check("週次目安を空欄にして保存→perWeek=0", afterEmpty.twyPlan.perWeek === 0, JSON.stringify(afterEmpty.twyPlan));

    console.log("[9d] Task編集モーダル: UI経由で週次目安に負数を入れても保存後は0になる(M4)");
    await openTaskMenu("t-12wy");
    await page.fill('[data-modal-field="twyPerWeek"]', "-4");
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const afterNegative = (await stateNow()).tasks.find((t) => t.id === "t-12wy");
    check("週次目安に負数を入れて保存→perWeek=0", afterNegative.twyPlan.perWeek === 0, JSON.stringify(afterNegative.twyPlan));

    // ============================================================
    // C: 変更なしで再保存すると区画の値はそのまま維持される(non-12WYで区画を経由しない保存も無影響)
    // ============================================================
    console.log("[9e] 非12WY Taskの保存はtwyPlanを既定値のまま維持する(区画を経由しないため上書きしない)");
    const beforeNormal = (await stateNow()).tasks.find((t) => t.id === "t-normal");
    await openTaskMenu("t-normal");
    await page.click('[data-action="modal-save"]');
    await page.waitForSelector('[data-action="modal-save"]', { state: "detached" });
    const afterNormal = (await stateNow()).tasks.find((t) => t.id === "t-normal");
    check("非12WY Taskのtwyplanは既定値のまま(区画が無いため書き換わらない)",
      afterNormal.twyPlan.perWeek === beforeNormal.twyPlan.perWeek
      && afterNormal.twyPlan.fromWeek === beforeNormal.twyPlan.fromWeek
      && afterNormal.twyPlan.toWeek === beforeNormal.twyPlan.toWeek
      && afterNormal.twyPlan.keystone === beforeNormal.twyPlan.keystone, JSON.stringify({ before: beforeNormal.twyPlan, after: afterNormal.twyPlan }));

    // ============================================================
    // 390px幅で横スクロールが発生しない・pageerror 0
    // ============================================================
    console.log("[10] 390px幅のTask編集モーダル(12週プラン区画込み)で横スクロールが発生しない");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror(mobile):", error.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ key, today }) => {
      const st = JSON.parse(localStorage.getItem(key));
      st.currentView = "wbs";
      st.selectedDate = today;
      st.projects = [{
        id: "p-mobile", kind: "normal", title: "モバイル確認案件", status: "active", priority: "中", category: "",
        startDate: "", dueDate: "", description: "", twelveWeekStartDate: today,
        showProgress: false, collapsed: false, createdAt: `${today}T00:00:00`, updatedAt: `${today}T00:00:00`, deleted: false
      }];
      st.tasks = [{
        id: "t-mobile", projectId: "p-mobile", parentTaskId: "", title: "モバイル確認タスク(長めのタイトルで折返し確認)",
        category: "", status: "todo", dueDate: "", description: "", progressNum: 0, progressDen: 10,
        createdAt: `${today}T00:00:00`, updatedAt: `${today}T00:00:00`, deleted: false
      }];
      st.blocks = [];
      localStorage.setItem(key, JSON.stringify(st));
    }, { key: STATE_KEY, today: TODAY });
    await pageMobile.reload();
    await pageMobile.waitForSelector("main");
    await pageMobile.locator('[data-wbs-row-id="t-mobile"] .wbs-row-menu-toggle').click();
    await pageMobile.locator('[data-action="edit-task"][data-id="t-mobile"]').click();
    await pageMobile.waitForSelector('[data-action="modal-save"]', { state: "visible" });
    check("モバイルでも12週プラン区画が出る", await pageMobile.locator('[data-modal-field="twyPerWeek"]').count() === 1);
    const metrics = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metrics.scrollWidth <= metrics.clientWidth + 1, `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`);
    await ctxMobile.close();
    // pageerror は page.on("pageerror", ...) リスナーで発生の都度 failures へ計上済み(0件が既定)。
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
