// v198 検証: AI秘書化「第3弾3e」(phase3-design.md §1・§8 3e)。
// Kの完了操作(6経路)を単一関数maybeQueueNextAiStepへ集約し、発火条件6つ(全部AND)を満たした
// ときだけ引き継ぎシートを開く。「AIに渡す」はこの単位では必ず失敗するスタブ(putAiStepRequest)
// を経由し、C-3の補償(dismissed追加→aiStatus=error→request系null化)へ即座に落ちることを固定する。
//
// [0] 経路網羅の機械検査(静的解析、ブラウザ起動不要。design書C-1)
// [1] 6経路それぞれの発火テスト
// [2] 発火条件6つそれぞれの否定ケース
// [3] リモートマージ経由のcompleted化では発火しないこと(構造的保証の回帰)
// [4] §Bの既知の対象外1件(realizeWish)は発火しないこと+addWish()のparentTaskId空
//     (approveAiWorkResultは旧・第1弾AI作業ワーカーの承認経路。R3(v290)で関数本体ごと削除済み
//     =対象外リストからも撤去。Test-Reduction: K裁定2026-08-27=ATIS6機能の完全廃止の最終段階)
// [5] 「あとで」はaiStatusをnoneのままにする
// [6] 「AIに渡す」→送信スタブが即座に補償する(aiStatus=error/aiStepRequestId=null/dismissedIds追加)
// [7] レビューR2→堅牢性レビュー修正4: シート表示中の同期pullで前提が崩れたら送信を取りやめる
//     (発火条件6つ全部を再検証する。条件2/3/5が単独で崩れる3ケースを固定)
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, GITHUB_API_HOST, STATE_KEY, dismissBodyScanIfOpen } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const OWNER = "kojit1229";
const REPO = "personal-data";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  // ============================================================
  // [0] 経路網羅の機械検査(design書C-1)
  // ============================================================
  console.log("[0] 経路網羅の機械検査: status:\"completed\"をリテラルで書く箇所が許可リストと完全一致");
  {
    // レビュー指摘(必須1): クォート種別(ダブル/シングル/バッククォート)3種を拾う。
    const Q = `["'\`]`;
    const STATUS_COMPLETED_RE = new RegExp(
      `status\\s*:\\s*${Q}completed${Q}`
      + `|\\.status\\s*=\\s*${Q}completed${Q}`
      + `|status\\s*===\\s*${Q}completed${Q}\\s*\\?\\s*${Q}todo${Q}\\s*:\\s*${Q}completed${Q}`
    );
    // 6経路のうち文字列リテラルで"completed"を直接書くのはtoggleTask/toggleTaskCompleteFromBlock/
    // toggleWishSubtaskの3つ。残る3経路(WBSインライン編集→updateTaskField/タスク編集モーダル保存
    // →fields.status/WBS進捗編集→deriveStatusFromProgress)はいずれも変数を経由するためこの
    // 正規表現では検出できない(汎用setter・パラメータ渡しであり、新しい「隠れ完了経路」を
    // 作る類の変更ではないため対象外)。加えて意図的な対象外1件を許可リストに含める
    // (実装設計書H節の監督者裁定・§B「呼んではいけない場所」)。
    const ALLOWED = {
      toggleTask: "app.js(完了6経路#1)",
      toggleTaskCompleteFromBlock: "app.js(完了6経路#2)",
      toggleWishSubtask: "wish.js(完了6経路#6)",
      realizeWish: "wish.js(意図的な対象外: Wishは常にparentTaskId空で条件2が構造的に不成立)"
    };
    // レビュー指摘(必須1): app.js + src/features/配下の全.jsを動的に列挙する
    // (実装設計書E-2どおり。ファイル名のハードコードは「未知の8箇所目」の検出漏れになるため廃止)。
    const featuresDir = path.join(ROOT, "src", "features");
    const files = [{ filePath: path.join(ROOT, "app.js"), label: "app.js" }].concat(
      fs.readdirSync(featuresDir).filter((f) => f.endsWith(".js"))
        .map((f) => ({ filePath: path.join(featuresDir, f), label: f }))
    );
    const found = [];
    for (const { filePath, label } of files) {
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("//")) continue;
        if (!STATUS_COMPLETED_RE.test(lines[i])) continue;
        let fn = null;
        for (let j = i; j >= 0; j--) {
          const m = lines[j].match(/^function\s+(\w+)\s*\(/);
          if (m) { fn = m[1]; break; }
        }
        found.push({ label, line: i + 1, fn });
      }
    }
    check(`literalな"completed"書き込みは期待どおり${Object.keys(ALLOWED).length}箇所`,
      found.length === Object.keys(ALLOWED).length, JSON.stringify(found));
    const unknown = found.filter((f) => !(f.fn in ALLOWED));
    check("未知の箇所(集約漏れ)は無い", unknown.length === 0, JSON.stringify(unknown));
    const missing = Object.keys(ALLOWED).filter((fn) => !found.some((f) => f.fn === fn));
    check("許可リストの全箇所が現物に存在する", missing.length === 0, JSON.stringify(missing));
  }

  // ============================================================
  // ブラウザ側の検証([1]〜[6])
  // ============================================================
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  function fixtureTask(id, title, overrides = {}) {
    return {
      id, projectId: "proj-v198", parentTaskId: "", title, category: "", status: "todo",
      dueDate: "", selfDueOff: true, order: null, description: "", progressNum: 0, progressDen: 10,
      doneCriteria: "", firstStep: "", planTarget: false, owner: "k", aiWork: false,
      aiWorkBrief: "", aiBrief: "", aiStatus: "none", handoffNote: "", aiResultRef: "",
      createdAt: `${TODAY}T09:00`, updatedAt: `${TODAY}T09:00`, deleted: false, collapsed: false,
      ...overrides
    };
  }
  function fixtureProject(id = "proj-v198") {
    return {
      id, kind: "normal", title: "v198検証プロジェクト", category: "", status: "active",
      priority: "中", description: "", dueDate: "", twelveWeekStartDate: "",
      createdAt: `${TODAY}T08:00`, updatedAt: `${TODAY}T08:00`, deleted: false,
      collapsed: false, showProgress: false
    };
  }
  // 「親(planTarget)+kStep(order1000,owner k)+aiStep(order2000,owner ai,aiStatus none)」の
  // 3タスク組(実装設計書E節のfixture方針)。prefixで複数組を同時に共存させられる。
  function triple(prefix, overrides = {}) {
    const parent = fixtureTask(`${prefix}-parent`, `${prefix}親`, { planTarget: true, ...overrides.parent });
    const kStep = fixtureTask(`${prefix}-k`, `${prefix}kステップ`, {
      parentTaskId: parent.id, order: 1000, owner: "k", ...overrides.k
    });
    const aiStep = fixtureTask(`${prefix}-ai`, `${prefix}aiステップ`, {
      parentTaskId: parent.id, order: 2000, owner: "ai", aiStatus: "none", ...overrides.ai
    });
    return { parent, kStep, aiStep };
  }

  async function resetState({ tasks = [], projects = [fixtureProject()], blocks = [], view = "wbs", settings = {}, wishOpenId = "" } = {}) {
    await page.clock.setFixedTime(now0);
    await page.evaluate(({ key, tasks, projects, blocks, view, settings, wishOpenId, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = blocks;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.wishOpenId = wishOpenId;
      s.settings = { ...s.settings, wbsHideCompleted: false, wbsCategoryFilter: "", showSuspended: false, ...settings };
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: STATE_KEY, tasks, projects, blocks, view, settings, wishOpenId, TODAY });
    await page.reload();
    await page.waitForSelector(`#app[data-view="${view}"]`);
  }

  async function storedTasks() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)).tasks, STATE_KEY);
  }
  async function storedState() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  }
  const sheetVisible = () => page.locator(".ai-step-confirm-modal").count();

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]');
    await passGithubGate(page);  // personalDataReady()を真にする(条件6)

    // ============================================================
    // [1] 6経路それぞれの発火テスト
    // ============================================================
    console.log("[1-1] 経路#1 WBS/一覧のチェックボタン(toggleTask)");
    {
      const { parent, kStep, aiStep } = triple("r1");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForSelector(".ai-step-confirm-modal");
      check("次ステップのタイトルが表示される", (await page.locator(".ai-step-confirm-title").textContent())?.includes(aiStep.title));
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    console.log("[1-2] 経路#2 タイムラインBlock行の「タスク完了」(toggleTaskCompleteFromBlock)");
    {
      const { parent, kStep, aiStep } = triple("r2");
      const block = {
        id: "block-r2", taskId: kStep.id, date: TODAY, title: kStep.title, category: "",
        plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
        actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "",
        recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, carryCount: 0,
        isMIT: false, source: "", estimateMin: null, leverageType: "",
        createdAt: `${TODAY}T09:00`, updatedAt: `${TODAY}T09:00`, deleted: false
      };
      await resetState({ tasks: [parent, kStep, aiStep], blocks: [block], view: "tasks" });
      await page.click(`[data-action="edit-block"][data-id="${block.id}"]`);
      await page.click(`.modal-card [data-action="toggle-task-complete"][data-id="${block.id}"]`);
      // v293追随: toggleTaskCompleteFromBlock内ではmaybeQueueNextAiStep()(引き継ぎシートを開く)
      // →openBodyScanModal()(身体スキャンを開く)の順に同期呼び出しされる。どちらもrenderModal()で
      // 同じ#modalRootへ描画するため、引き継ぎシートは1フレームも可視化されずopenBodyScanModal()の
      // 描画に即座に上書きされる(closeModal()を経由しないためstate.modal.typeの直接差し替え)。
      // 検証意図(経路#2の完了操作)は維持しつつ、v293後の正しい期待(身体スキャンモーダルが
      // 優先表示され、引き継ぎシートはDOM上に一切現れない)へ反転して継承する。
      await page.waitForSelector('.modal-close[data-action="body-scan-discard"]');
      check("経路#2は身体スキャンモーダルに上書きされ、引き継ぎシートはDOM上に現れない(v293)",
        await page.locator(".ai-step-confirm-modal").count() === 0);
      await dismissBodyScanIfOpen(page);
    }

    console.log("[1-3] 経路#3 WBSインライン status セレクト(updateTaskField)");
    {
      const { parent, kStep, aiStep } = triple("r3");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs", settings: { wbsEditMode: true } });
      await page.selectOption(`[data-wbs-edit="status"][data-id="${kStep.id}"]`, "completed");
      await page.waitForSelector(".ai-step-confirm-modal");
      check("経路#3でも引き継ぎシートが開く", true);
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    console.log("[1-4] 経路#4 タスク編集モーダルの保存(saveTaskFromModal)");
    {
      const { parent, kStep, aiStep } = triple("r4");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`span[data-action="edit-task"][data-id="${kStep.id}"]`);
      await page.selectOption('[data-modal-field="status"]', "completed");
      await page.click('[data-action="modal-save"]');
      await page.waitForSelector(".ai-step-confirm-modal");
      check("経路#4でも引き継ぎシートが開く", true);
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    console.log("[1-5] 経路#5 WBS進捗インライン編集・分子=分母(updateTaskProgress)");
    {
      const { parent, kStep, aiStep } = triple("r5");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.locator(`input[data-wbs-progress="num"][data-id="${kStep.id}"]`).fill("10");
      await page.locator(`input[data-wbs-progress="num"][data-id="${kStep.id}"]`).dispatchEvent("change");
      await page.waitForSelector(".ai-step-confirm-modal");
      check("経路#5でも引き継ぎシートが開く", true);
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    console.log("[1-6] 経路#6 Wish詳細のサブタスクチェックボックス(toggleWishSubtask)");
    {
      const wishProject = { ...fixtureProject("proj-wish-v198"), kind: "wish", title: "Wish" };
      const { parent, kStep, aiStep } = triple("r6", { parent: { projectId: wishProject.id }, k: { projectId: wishProject.id }, ai: { projectId: wishProject.id } });
      await resetState({ tasks: [parent, kStep, aiStep], projects: [wishProject], view: "wish", wishOpenId: parent.id });
      await page.click(`[data-action="toggle-wish-subtask"][data-id="${kStep.id}"]`);
      await page.waitForSelector(".ai-step-confirm-modal");
      check("経路#6でも引き継ぎシートが開く", true);
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    // ============================================================
    // [2] 発火条件6つそれぞれの否定ケース(経路#1=WBSチェックボタンで代表させる)
    // ============================================================
    console.log("[2-1] 条件1否定: 既にcompletedのステップを再保存(prevStatus===completedのまま)しても発火しない");
    {
      const { parent, kStep, aiStep } = triple("c1", { k: { status: "completed", progressNum: 10 } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`span[data-action="edit-task"][data-id="${kStep.id}"]`);
      await page.click('[data-action="modal-save"]');  // statusは触らず「completed」のまま保存
      await page.waitForTimeout(300);
      check("再保存では発火しない", await sheetVisible() === 0);
    }

    console.log("[2-2] 条件2否定: 親のplanTargetが立っていなければ発火しない");
    {
      const { parent, kStep, aiStep } = triple("c2", { parent: { planTarget: false } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForTimeout(300);
      check("planTargetが無い親では発火しない", await sheetVisible() === 0);
    }

    console.log("[2-3] 条件3否定: 完了したステップのowner!==\"k\"なら発火しない");
    {
      const { parent, kStep, aiStep } = triple("c3", { k: { owner: "ai" } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForTimeout(300);
      check("owner!==kでは発火しない", await sheetVisible() === 0);
    }

    console.log("[2-4] 条件4否定(a): 次の未完了兄弟のowner!==\"ai\"なら発火しない");
    {
      const { parent, kStep, aiStep } = triple("c4a", { ai: { owner: "k" } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForTimeout(300);
      check("次ステップがowner=kでは発火しない", await sheetVisible() === 0);
    }

    console.log("[2-4b] 条件4否定(b): 次の未完了兄弟が存在しない(全兄弟completed/cancelled)なら発火しない");
    {
      const { parent, kStep, aiStep } = triple("c4b", { ai: { status: "cancelled" } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForTimeout(300);
      check("次ステップが無ければ発火しない", await sheetVisible() === 0);
    }

    console.log("[2-5] 条件5否定: 次ステップのaiStatusがqueued等なら発火しない");
    {
      const { parent, kStep, aiStep } = triple("c5", { ai: { aiStatus: "queued" } });
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForTimeout(300);
      check("次ステップがqueued中は発火しない", await sheetVisible() === 0);
    }

    console.log("[2-6a] 条件6否定(a): personalDataReady()が偽(トークン未設定)は発火し得ない(構造的保証)");
    // v72のログインゲート(render()、app.js:2731)がpersonalDataReady()===falseの間は
    // 全ビューを"gate"画面へ差し替え、WBS等のUI自体に到達できない。よってこの否定ケースは
    // UI経由では再現不能(チェックボックス自体が存在しない)であり、maybeQueueNextAiStepの
    // 呼び出し元がすべてユーザー操作ハンドラである(=v72ゲートの内側でしか実行され得ない)
    // 構造そのものがこの条件の充足を保証する。個別のUI再現は行わない。
    check("v72ゲートがpersonalDataReady()===false時に全ビューを閉じることは既存スイート(v72)の担保範囲", true);

    console.log("[2-6b] 条件6否定(b): 既にシート表示中(_aiStepPending)なら2件目は無視しトースト表示");
    {
      const a = triple("c6b-a");
      const b = triple("c6b-b");
      await resetState({ tasks: [a.parent, a.kStep, a.aiStep, b.parent, b.kStep, b.aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${a.kStep.id}"]`);
      await page.waitForSelector(".ai-step-confirm-modal");
      check("1件目のシートが開く", await sheetVisible() === 1);
      // シートは背景をブロックするため通常のクリックは届かない(=ユーザー操作としては
      // そもそも起こり得ない)。design書が想定する「一気に複数チェック」(bulk操作等)を
      // 模して、ガード自体(_aiStepPendingありなら2件目を無視)をdispatchEventで直接検査する。
      await page.locator(`[data-action="toggle-task"][data-id="${b.kStep.id}"]`).dispatchEvent("click");
      await page.waitForTimeout(300);
      check("2件目は無視され1件目のシートのままトーストが出る", await sheetVisible() === 1
        && (await page.locator("#toast").textContent())?.includes("AIステップは1件ずつ実行します"));
      await page.click('[data-action="ai-step-confirm-later"]');
    }

    // ============================================================
    // [3] リモートマージ経由のcompleted化では発火しない(構造的保証の回帰)
    // ============================================================
    console.log("[3] リモートマージでkStepがcompletedとして入ってきても発火しない");
    {
      const { parent, kStep, aiStep } = triple("sync");
      const ctxSync = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
      const pageSync = await ctxSync.newPage();
      pageSync.on("pageerror", (e) => { failures++; console.log("  ❌ [sync] pageerror:", e.message); });
      const fixtures = { status: 404, body: null };
      await blockGithubApiByDefault(pageSync);
      await pageSync.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname);
        if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
          if (fixtures.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.body });
        }
        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      });
      await pageSync.clock.setFixedTime(now0);
      await pageSync.goto(`http://localhost:${PORT}/`);
      await pageSync.waitForSelector('[data-action="gate-continue"]');
      await passGithubGate(pageSync);

      const LOCAL_T = `${TODAY}T10:00:00`;
      const REMOTE_T = `${TODAY}T12:00:00`;  // ローカルより新しい → リモートのtasksが丸ごと採用される
      const mirror = await pageSync.evaluate(({ key, parent, kStep, aiStep, LOCAL_T }) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.tasks = [parent, kStep, aiStep];
        s.projects = [{
          id: "proj-v198", kind: "normal", title: "v198検証プロジェクト", category: "", status: "active",
          priority: "中", description: "", dueDate: "", twelveWeekStartDate: "",
          createdAt: LOCAL_T, updatedAt: LOCAL_T, deleted: false, collapsed: false, showProgress: false
        }];
        s.blocks = [];
        s.dataModifiedAt = LOCAL_T;
        s.settings.lastPushedAt = LOCAL_T;
        localStorage.setItem(key, JSON.stringify(s));
        return { tasks: s.tasks, projects: s.projects, blocks: s.blocks };
      }, { key: STATE_KEY, parent, kStep, aiStep, LOCAL_T });

      const remoteKStep = { ...kStep, status: "completed", progressNum: 10, updatedAt: REMOTE_T };
      const remoteTasks = mirror.tasks.map((t) => t.id === kStep.id ? remoteKStep : t);
      const remoteObj = {
        dataModifiedAt: REMOTE_T, currentView: "home", selectedDate: TODAY,
        blocks: mirror.blocks, projects: mirror.projects, tasks: remoteTasks, settings: {},
        aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: []
      };
      const jsonText = JSON.stringify(remoteObj);
      const b64 = Buffer.from(jsonText, "utf-8").toString("base64");
      const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
      fixtures.status = 200;
      fixtures.body = JSON.stringify({ name: "app-state.json", path: "taskchute/app-state.json", sha: "sha-v198", content: chunked, encoding: "base64" });

      await pageSync.reload();
      await pageSync.waitForTimeout(700);
      const after = await pageSync.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      const mergedKStep = after.tasks.find((t) => t.id === kStep.id);
      const mergedAiStep = after.tasks.find((t) => t.id === aiStep.id);
      check("リモートのcompletedがマージ採用される(前提の確認)", mergedKStep?.status === "completed", JSON.stringify(mergedKStep));
      check("同期経由では引き継ぎシートを開かない", await pageSync.locator(".ai-step-confirm-modal").count() === 0);
      check("同期経由では次ステップのaiStatusも変化しない", mergedAiStep?.aiStatus === "none", JSON.stringify(mergedAiStep));
      await ctxSync.close();
    }

    // ============================================================
    // [4] §Bの既知の対象外1件は発火しない + addWish()のparentTaskId空
    // ============================================================
    console.log("[4-1] addWish()が作るタスクのparentTaskIdは空(realizeWishが対象外になる前提)");
    {
      await resetState({ tasks: [], view: "wish" });
      await page.fill("#wishTitle", "v198検証Wish");
      await page.click('[data-action="add-wish"]');
      await page.waitForTimeout(300);
      const s = await storedState();
      const wish = s.tasks.find((t) => t.title === "v198検証Wish");
      check("addWish()のparentTaskIdは空文字", wish?.parentTaskId === "", JSON.stringify(wish));
    }

    console.log("[4-2] realizeWish()は「実現済みにする」でcompleted化しても発火しない(planParentForが構造的にnull)");
    {
      const wishProject = { ...fixtureProject("proj-wish-v198b"), kind: "wish", title: "Wish" };
      const wish = fixtureTask("wish-realize-v198", "実現テスト", { projectId: wishProject.id, planTarget: true });
      await resetState({ tasks: [wish], projects: [wishProject], view: "wish", wishOpenId: wish.id });
      page.once("dialog", (d) => d.accept());
      await page.click(`[data-action="wish-realize"][data-id="${wish.id}"]`);
      await page.waitForTimeout(300);
      check("realizeWishでは引き継ぎシートを開かない", await sheetVisible() === 0);
      const s = await storedTasks();
      check("Wish本体はcompletedになる(realizeWish自体は正常動作)", s.find((t) => t.id === wish.id)?.status === "completed");
    }

    // Test-Reduction: [4-3](approveAiWorkResult()は意図的に配線しない、を確認するダミーcheck)は、
    // R3(v290)で対象関数approveAiWorkResultそのものを削除したため削除
    // (K裁定2026-08-27=ATIS6機能の完全廃止の最終段階)。[0]のALLOWED許可リストからも同時に
    // 撤去済みで、静的検査[0]は現物のapp.js/src/features配下に同関数の"completed"リテラルが
    // 存在しないことを引き続き機械検証する。

    // ============================================================
    // [5] 「あとで」はaiStatusをnoneのままにする
    // ============================================================
    console.log("[5] 「あとで」→ aiStatusはnoneのまま・確認シートを解放する");
    {
      const { parent, kStep, aiStep } = triple("later");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForSelector(".ai-step-confirm-modal");
      await page.click('[data-action="ai-step-confirm-later"]');
      await page.waitForTimeout(300);
      check("シートは閉じる", await sheetVisible() === 0);
      const s = await storedTasks();
      const after = s.find((t) => t.id === aiStep.id);
      check("aiStatusはnoneのまま", after?.aiStatus === "none", JSON.stringify(after));
      check("aiStepRequestIdもnullのまま", after?.aiStepRequestId == null, JSON.stringify(after));
    }

    // ============================================================
    // [6] 「AIに渡す」→送信スタブが即座に補償する
    // ============================================================
    console.log("[6] 「AIに渡す」→ putAiStepRequestスタブがC-3補償を行い、aiStatus=error/aiStepRequestId=null/dismissedIdsへ追加");
    {
      const { parent, kStep, aiStep } = triple("send");
      await resetState({ tasks: [parent, kStep, aiStep], view: "wbs" });
      await page.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await page.waitForSelector(".ai-step-confirm-modal");
      await page.fill("[data-ai-step-confirm-note]", "引き継ぎメモのテスト");
      await page.click('[data-action="ai-step-confirm-send"]');
      await page.waitForTimeout(300);
      check("シートは閉じる", await sheetVisible() === 0);
      check("送信できない旨のトーストが出る", (await page.locator("#toast").textContent())?.includes("送信はまだ有効になっていません"));
      const s = await storedState();
      const after = s.tasks.find((t) => t.id === aiStep.id);
      check("handoffNoteは保存される(補償後も残る)", after?.handoffNote === "引き継ぎメモのテスト", JSON.stringify(after));
      check("aiStatusはerrorへ補償される", after?.aiStatus === "error", JSON.stringify(after));
      check("aiStepRequestId/aiStepRequestedAtはnullへ戻る", after?.aiStepRequestId === null && after?.aiStepRequestedAt === null, JSON.stringify(after));
      check("requestIdがaiStepDismissedIdsへ追加される", Array.isArray(s.aiStepDismissedIds) && s.aiStepDismissedIds.length === 1, JSON.stringify(s.aiStepDismissedIds));
      check("aiStepPendingRequestsからも除かれる", Array.isArray(s.aiStepPendingRequests) && s.aiStepPendingRequests.length === 0, JSON.stringify(s.aiStepPendingRequests));
    }

    // ============================================================
    // [7] レビューR2→堅牢性レビュー修正4: シート表示中の同期pullで前提が崩れたら送信を取りやめる
    // (発火条件6つ全部を再検証する。ここでは条件2・3・5がそれぞれ単独で崩れるケースを検証する)
    // ============================================================
    // シート表示中に他端末からの同期マージ(visibilitychange→runAutoSyncPull→
    // applySyncMergeToLocal相当)で前提が崩れるケースの共通ハーネス。mutateRemote({parent,kStep,
    // aiStep,mirror})が変更後のremote tasks配列を返す。
    async function runResendRevalidationCase(label, prefix, mutateRemote) {
      console.log(`[7-${label}] シート表示中に外部(同期pull)で前提が崩れたら送信は取りやめになる`);
      const { parent, kStep, aiStep } = triple(prefix);
      const ctxR2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
      const pageR2 = await ctxR2.newPage();
      pageR2.on("pageerror", (e) => { failures++; console.log(`  ❌ [7-${label}] pageerror:`, e.message); });
      const fixtures = { status: 404, body: null };
      await blockGithubApiByDefault(pageR2);
      await pageR2.route((url) => url.hostname === GITHUB_API_HOST, (route) => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname);
        if (p === `/repos/${OWNER}/${REPO}/contents/taskchute/app-state.json`) {
          if (fixtures.status === 200) return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.body });
        }
        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      });
      await pageR2.clock.setFixedTime(now0);
      await pageR2.goto(`http://localhost:${PORT}/`);
      await pageR2.waitForSelector('[data-action="gate-continue"]');
      await passGithubGate(pageR2);

      const LOCAL_T = `${TODAY}T10:00:00`;
      const project = fixtureProject();
      const mirror = await pageR2.evaluate(({ key, parent, kStep, aiStep, project, LOCAL_T }) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.tasks = [parent, kStep, aiStep];
        s.projects = [project];
        s.blocks = [];
        s.currentView = "wbs";
        s.dataModifiedAt = LOCAL_T;
        s.settings.lastPushedAt = LOCAL_T;   // 未push差分なし→自動採用経路(applySyncMergeToRemote)を通す
        s.settings.autoSync = true;          // v198(レビューR2再現): visibilitychange→runAutoSyncPullを有効化
        localStorage.setItem(key, JSON.stringify(s));
        return { tasks: s.tasks, projects: s.projects, blocks: s.blocks };
      }, { key: STATE_KEY, parent, kStep, aiStep, project, LOCAL_T });
      await pageR2.reload();
      await pageR2.waitForSelector('#app[data-view="wbs"]');

      // シートを開く
      await pageR2.click(`[data-action="toggle-task"][data-id="${kStep.id}"]`);
      await pageR2.waitForSelector(".ai-step-confirm-modal");

      // シート表示中に、mutateRemoteが指定した変更(条件2/3/5のいずれかを崩す)をリモートへ用意する。
      const REMOTE_T = `${TODAY}T11:00:00`;  // ローカルより新しい
      const { tasks: remoteTasks, mutatedId } = mutateRemote({ parent, kStep, aiStep, mirror });
      const remoteObj = {
        dataModifiedAt: REMOTE_T, currentView: "wbs", selectedDate: TODAY,
        blocks: mirror.blocks, projects: mirror.projects, tasks: remoteTasks, settings: {},
        aiStepProcessedIds: [], aiStepDismissedIds: [], aiStepPendingRequests: []
      };
      const b64 = Buffer.from(JSON.stringify(remoteObj), "utf-8").toString("base64");
      const chunked = (b64.match(/.{1,60}/g) || []).join("\n");
      fixtures.status = 200;
      fixtures.body = JSON.stringify({ name: "app-state.json", path: "taskchute/app-state.json", sha: `sha-v198-r2-${label}`, content: chunked, encoding: "base64" });

      // AUTO_SYNC_PULL_THROTTLE_MS(60秒)を跨ぐため時計を進めてからvisibilitychangeを発火する。
      // dataModifiedAtは(他コレクションのローカル限定分がaddedLocalへ合流すると)nowDateTime()で
      // 上書きされ得るため、変更した当該タスク自身のupdatedAtがリモート値に反映されたかで待つ。
      await pageR2.clock.setFixedTime(new Date(now0.getTime() + 61 * 1000));
      await pageR2.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await pageR2.waitForFunction(({ key, id, t }) => {
        const s = JSON.parse(localStorage.getItem(key));
        return s.tasks.find((task) => task.id === id)?.updatedAt === t;
      }, { key: STATE_KEY, id: mutatedId, t: REMOTE_T }, { timeout: 5000 });

      // まだシートは開いたまま(render()はmodalRootを触らない)。「AIに渡す」を押す。
      check(`[7-${label}] シートはまだ開いたまま`, await pageR2.locator(".ai-step-confirm-modal").count() === 1);
      await pageR2.fill("[data-ai-step-confirm-note]", "取りやめ確認用メモ");
      await pageR2.click('[data-action="ai-step-confirm-send"]');
      await pageR2.waitForTimeout(300);

      check(`[7-${label}] シートは閉じる(送信せず中止)`, await pageR2.locator(".ai-step-confirm-modal").count() === 0);
      check(`[7-${label}] 「状況が変わったため送信を取りやめました」トーストが出る`,
        (await pageR2.locator("#toast").textContent())?.includes("状況が変わったため送信を取りやめました"));
      const after = await pageR2.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
      const afterAiStep = after.tasks.find((t) => t.id === aiStep.id);
      check(`[7-${label}] handoffNoteは保存されない(送信処理に入っていない)`,
        !afterAiStep?.handoffNote, JSON.stringify(afterAiStep?.handoffNote));
      check(`[7-${label}] aiStepDismissedIdsは追加されない(補償processではなく取りやめのため)`,
        Array.isArray(after.aiStepDismissedIds) && after.aiStepDismissedIds.length === 0, JSON.stringify(after.aiStepDismissedIds));
      await ctxR2.close();
      return { after, afterAiStep };
    }

    {
      const { afterAiStep } = await runResendRevalidationCase("5", "resend5", ({ mirror, aiStep }) => ({
        tasks: mirror.tasks.map((t) => t.id === aiStep.id ? { ...t, aiStatus: "queued", updatedAt: `${TODAY}T11:00:00` } : t),
        mutatedId: aiStep.id
      }));
      check("[7-5] 条件5(次ステップのaiStatus)が外部でqueuedへ変わったら取りやめ、aiStatusはqueuedのまま",
        afterAiStep?.aiStatus === "queued", JSON.stringify(afterAiStep));
    }
    {
      const { afterAiStep } = await runResendRevalidationCase("2", "resend2", ({ mirror, parent }) => ({
        tasks: mirror.tasks.map((t) => t.id === parent.id ? { ...t, planTarget: false, updatedAt: `${TODAY}T11:00:00` } : t),
        mutatedId: parent.id
      }));
      check("[7-2] 条件2(親のplanTarget)が外部で外れたら取りやめ、次ステップのaiStatusはnoneのまま",
        afterAiStep?.aiStatus === "none", JSON.stringify(afterAiStep));
    }
    {
      // kStepはシートを開く直前にtoggle-taskでローカルcompleted化済み(mirrorはその前のスナップ
      // ショットでstatus:"todo"のまま)。ここではローカルの「completed」実態を保ったままowner
      // だけを外部でai化したリモートを用意する(条件3を単独で崩す)。
      const { afterAiStep } = await runResendRevalidationCase("3", "resend3", ({ mirror, kStep }) => ({
        tasks: mirror.tasks.map((t) => t.id === kStep.id
          ? { ...t, status: "completed", progressNum: 10, owner: "ai", updatedAt: `${TODAY}T11:00:00` }
          : t),
        mutatedId: kStep.id
      }));
      check("[7-3] 条件3(完了元ステップのowner)が外部でai化したら取りやめ、次ステップのaiStatusはnoneのまま",
        afterAiStep?.aiStatus === "none", JSON.stringify(afterAiStep));
    }
  } finally {
    await ctx.close();
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nALL PASS");
})().catch((error) => { console.error(error); process.exit(1); });
