// v77 検証: タイムライン下書きスケジュールの現実化 + AIフィードバックの自動表示 + FB内0秒思考テーマ抽出。
// CHANGES_v77.md参照。
//
// K指示の原因調査結果(詳細はCHANGES_v77.md):
//   詰め込みの犯人はアプリ内の決定論エンジン(fallbackMorningPlan/aiScheduleCandidates)。
//   (a) aiScheduleCandidatesがdueDate(期限)を一切見ておらず、翌日以降が期限のWBSタスクも
//       候補に含めていた。(b) fallbackMorningPlanが空き時間を安全余地なく全部埋めていた。
//   (c) ブロック長を15分刻みに丸めており、見積(estimateMin)と表示がズレていた。
//
// ①未来期限タスクが下書きに入らない
// ②空き全部を埋めない(安全枠=空き時間の65%上限。超過分は「配置しない」)
// ③ブロック長=見積時間(15分丸め廃止)
// ④visibilitychange復帰時にAIフィードバック等が再fetchされ、再起動なしで新着が自動表示される
// ⑤既存draft機構(繰越→下書き→確定→migratedTo付与)の回帰
// ⑥AIフィードバック_*.md内「## 0秒思考テーマ」見出しからの抽出 → 既存zeroSecThemes選定UIへの
//   合流(AIプラン由来との重複排除)・後方互換(見出しが無い旧形式FBでもクラッシュしない)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4215;
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const now0 = new Date();
  // computeFreeGaps が「現在時刻〜23:00」を空き枠として扱うため、日中(10:00)に固定する(v59〜同じ理由)
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YEST = addDaysStr(TODAY, -1);
  const TOMORROW = addDaysStr(TODAY, 1);

  // ---- AIフィードバック_*.md / AIプラン_*.json のfixture(route経由で応答) ----
  let feedbackFixture = {};   // { 'YYYY-MM-DD': mdText }
  let aiPlanFixture = null;   // JSON文字列 or null(404)
  const feedbackApiRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const fbMatch = p.match(/\/contents\/taskchute\/AIフィードバック_(.+)\.md$/);
    if (fbMatch) {
      feedbackApiRequests.push(p);
      const body = feedbackFixture[fbMatch[1]];
      if (!body) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body });
    }
    if (p.endsWith(`/contents/taskchute/AIプラン_${TODAY}.json`)) {
      if (aiPlanFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      return route.fulfill({ status: 200, contentType: "application/json", body: aiPlanFixture });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  function planBlock({ id, date, title, startMin, endMin, taskId = "" }) {
    return {
      id, taskId, date, title, category: "",
      plannedStartAt: `${date}T${hhmm(startMin)}`, plannedEndAt: `${date}T${hhmm(endMin)}`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }
  function wbsTask(id, title, { dueDate = "", estimateMin = null, createdAt = `${TODAY}T00:00` } = {}) {
    return {
      id, projectId: "test-proj", parentTaskId: "", title, category: "", status: "todo", dueDate,
      estimateMin, description: "", createdAt, updatedAt: createdAt, deleted: false
    };
  }
  const testProject = () => ({
    id: "test-proj", kind: "normal", title: "テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });

  async function seed({ blocks = [], tasks = [], projects = [testProject()], view = "tasks", zeroSecThemeLog = [], zeroThinkingThemes = [] } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, zeroSecThemeLog, zeroThinkingThemes }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.feedback = {};
      s.zeroSecThemeLog = zeroSecThemeLog;
      s.zeroThinking = { themes: zeroThinkingThemes, entries: [] };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, zeroSecThemeLog, zeroThinkingThemes });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function runMorningPlan() {
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="ai-morning-plan"]');
    await page.waitForTimeout(700);
  }

  async function draftBlocks() {
    const els = await page.locator(".draft-block-time").allTextContents();
    const titles = await page.locator(".draft-block-title").allTextContents();
    return els.map((t, i) => {
      const m = t.match(/(\d{2}):(\d{2})〜(\d{2}):(\d{2})\((\d+)分\)/);
      if (!m) return null;
      return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]), minutes: Number(m[5]), title: (titles[i] || "").trim() };
    }).filter(Boolean);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] 未来期限タスクが下書きに入らない
    // ============================================================
    console.log("[1] dueDateが翌日以降のタスクは朝プラン下書きの候補から除外される");
    await seed({
      tasks: [
        wbsTask("task-tomorrow", "翌日期限タスク_v77", { dueDate: TOMORROW, createdAt: `${TODAY}T01:00` }),
        wbsTask("task-today", "当日期限タスク_v77", { dueDate: TODAY, createdAt: `${TODAY}T02:00` }),
        wbsTask("task-nodue", "期限なしタスク_v77", { dueDate: "", createdAt: `${TODAY}T03:00` })
      ]
    });
    await runMorningPlan();
    const drafts1 = await draftBlocks();
    const titles1 = drafts1.map((d) => d.title);
    check("翌日期限タスクは下書きに含まれない", !titles1.some((t) => t.includes("翌日期限タスク_v77")), JSON.stringify(titles1));
    check("当日期限タスクは下書きに含まれる", titles1.some((t) => t.includes("当日期限タスク_v77")), JSON.stringify(titles1));
    check("期限なしタスクも下書きに含まれる(除外しない)", titles1.some((t) => t.includes("期限なしタスク_v77")), JSON.stringify(titles1));

    // ============================================================
    // [2] 空き全部を埋めない(安全枠=空き時間合計の65%上限)+ ブロック間バッファ
    // ============================================================
    console.log("[2] 空き時間を全部埋めない(安全枠超過分は配置せず「見送り」に回る)");
    // 10:00〜23:00 = 780分の空き。65%上限 = 507分。60分タスクを6件(合計360分…に収まらない量)投入して検証する
    const bigTasks = Array.from({ length: 6 }, (_, i) =>
      wbsTask(`big-${i}`, `安全枠検証タスク${i}_v77`, { estimateMin: 100, createdAt: `${TODAY}T0${i + 1}:00` }));
    await seed({ tasks: bigTasks });
    await runMorningPlan();
    const drafts2 = await draftBlocks();
    const totalPlaced2 = drafts2.reduce((s, d) => s + d.minutes, 0);
    check("配置された件数が候補数(6件)より少ない(全部は詰め込まない)", drafts2.length < 6, JSON.stringify(drafts2));
    check("配置された合計時間が空き時間合計(780分)の70%(546分)を超えない(安全枠が効いている)",
      totalPlaced2 <= 546, `total=${totalPlaced2}`);
    const skippedText2 = await page.locator(".draft-bar + div").first().textContent().catch(() => "");
    check("安全枠超過で見送りになった候補が表示される", (skippedText2 || "").includes("安全枠"), skippedText2);
    if (drafts2.length >= 2) {
      const sorted2 = [...drafts2].sort((a, b) => a.start - b.start);
      const gapBetween = sorted2[1].start - sorted2[0].end;
      check("連続する下書きブロック間に10分のバッファがある(隙間なく詰め込まない)", gapBetween === 10, JSON.stringify(sorted2.slice(0, 2)));
    }

    // ============================================================
    // [3] ブロック長 = 見積時間(estimateMin)。15分丸めをしない
    // ============================================================
    console.log("[3] 配置ブロックの長さが見積時間(estimateMin)そのまま(15分刻みに丸めない)");
    await seed({
      tasks: [
        wbsTask("task-est20", "見積20分タスク_v77", { estimateMin: 20, createdAt: `${TODAY}T01:00` }),
        wbsTask("task-noest", "見積なしタスク_v77", { estimateMin: null, createdAt: `${TODAY}T02:00` })
      ]
    });
    await runMorningPlan();
    const drafts3 = await draftBlocks();
    const est20 = drafts3.find((d) => d.title.includes("見積20分タスク_v77"));
    const noEst = drafts3.find((d) => d.title.includes("見積なしタスク_v77"));
    check("見積20分のタスクは20分のブロックとして配置される(15分/30分に丸められない)", !!est20 && est20.minutes === 20, JSON.stringify(est20));
    check("見積なしタスクは既定30分のまま(既存の慣習を維持)", !!noEst && noEst.minutes === 30, JSON.stringify(noEst));

    // ============================================================
    // [4] visibilitychange復帰時にAIフィードバック等が再fetchされ、再起動なしで新着が自動表示される
    // ============================================================
    console.log("[4] visibilitychange(フォアグラウンド復帰)で前日フィードバックの新着が自動再fetch・再表示される");
    delete feedbackFixture[YEST];  // 起動時点ではまだバッチ未生成(404)
    await seed({ tasks: [], view: "home" });
    const beforeCount4 = await page.locator(".home-ai-feedback-read").count();
    check("起動直後は前日フィードバックがまだ無い(フェイルソフトでdetails非表示)", beforeCount4 === 0);

    // 5分経過させる(多重発火防止の最短間隔=60秒ガードを超えさせる)。その間にバッチが新規pushしたと想定。
    await page.clock.setFixedTime(new Date(now0.getTime() + 5 * 60 * 1000));
    feedbackFixture[YEST] = "# AIフィードバック本文_v77\n\n## 明日への提案\n\n- [ ] 新着提案_v77\n";
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(700);
    const afterCount4 = await page.locator(".home-ai-feedback-read").count();
    const afterText4 = await page.locator("main").textContent();
    check("visibilitychange復帰で前日分が再fetchされ、アプリ再起動なしに自動表示される",
      afterCount4 === 1 && afterText4.includes("新着提案_v77"), afterText4.slice(0, 300));
    check("api.github.comへ前日分の再fetchが実際に飛んでいる(裏取り)",
      feedbackApiRequests.filter((p) => p.endsWith(`AIフィードバック_${YEST}.md`)).length >= 2, JSON.stringify(feedbackApiRequests));

    // ============================================================
    // [5] 既存draft機構の回帰: 繰越候補のdraft搭載 → 確定でmigratedTo付与
    // ============================================================
    console.log("[5] 既存draft機構(繰越→下書き→確定→migratedTo付与)の回帰");
    await page.clock.setFixedTime(now0);  // 以降のテストは基準時刻に戻す
    const CARRY_TITLE = "昨日やり残したレポート作成_v77";
    await seed({
      blocks: [planBlock({ id: "carry-1-v77", date: YEST, title: CARRY_TITLE, startMin: 14 * 60, endMin: 14 * 60 + 30 })]
    });
    await runMorningPlan();
    const carryDraftTitle = await page.locator(".draft-block-title").first().textContent().catch(() => "");
    check("昨日未完了(繰越候補)がdraftのタイトルとして表示される", (carryDraftTitle || "").includes(CARRY_TITLE), carryDraftTitle);
    await page.click('[data-action="draft-confirm"]');
    await page.waitForTimeout(400);
    const afterConfirm = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    const srcBlock = (afterConfirm.blocks || []).find((b) => b.id === "carry-1-v77");
    const newBlock = (afterConfirm.blocks || []).find((b) => b.date === TODAY && b.title === CARRY_TITLE);
    check("元Block(昨日)にmigratedToが設定される", !!srcBlock && !!srcBlock.migratedTo, JSON.stringify(srcBlock));
    check("今日に新しいBlockとして登録される", !!newBlock, JSON.stringify(newBlock));
    check("migratedToの参照先は今日の新Blockと一致する(二重繰越防止)",
      !!srcBlock && !!newBlock && srcBlock.migratedTo === newBlock.id);

    // ============================================================
    // [6] AIフィードバック_*.md内「## 0秒思考テーマ」見出しからの抽出・選定UI合流・後方互換
    // ============================================================
    console.log("[6a] AIプランjsonが無く(404)、FBの「## 0秒思考テーマ」見出しだけがある場合の抽出・選定・採否記録");
    aiPlanFixture = null;
    feedbackFixture = {
      [TODAY]: "# AIフィードバック本文TODAY_v77\n\n## 0秒思考テーマ\n\n- [ ] テーマFB1_v77: 理由FB1_v77\n- [ ] テーマFB2_v77: 理由FB2_v77\n\n## 明日への提案\n\n- [ ] 提案1_v77\n"
    };
    await seed({ tasks: [] });
    await runMorningPlan();
    const zst6aText = await page.locator("main").textContent();
    check("FB由来の0秒思考テーマ2件がカードとして表示される",
      zst6aText.includes("テーマFB1_v77") && zst6aText.includes("理由FB1_v77") &&
      zst6aText.includes("テーマFB2_v77") && zst6aText.includes("理由FB2_v77"), zst6aText.slice(0, 500));
    await page.click('[data-action="zerosec-theme-add"][data-idx="0"]');
    await page.waitForTimeout(300);
    const s6a = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
    check("「追加」でzeroThinking.themesに入る", (s6a.zeroThinking?.themes || []).some((t) => t.text === "テーマFB1_v77"), JSON.stringify(s6a.zeroThinking));
    check("zeroSecThemeLogにoutcome='added'で記録される(FB由来も既存の採否ログに乗る)",
      (s6a.zeroSecThemeLog || []).some((l) => l.theme === "テーマFB1_v77" && l.outcome === "added" && l.date === TODAY),
      JSON.stringify(s6a.zeroSecThemeLog));

    console.log("[6b] AIプラン由来とFB由来のテーマが同一文字列で重複する場合、1件に統合される(プラン側の理由を残す)");
    aiPlanFixture = JSON.stringify({
      date: TODAY, generatedAt: `${TODAY}T05:00`, plan: [], skipped: [],
      zeroSecThemes: [
        { theme: "テーマ重複_v77", reason: "プラン側理由_v77" },
        { theme: "テーマプラン限定_v77", reason: "プラン限定理由_v77" }
      ]
    });
    feedbackFixture = {
      [TODAY]: "# AIフィードバック本文_v77\n\n## 0秒思考テーマ\n\n- [ ] テーマ重複_v77: FB側理由_v77(表示されないはず)\n- [ ] テーマFB限定_v77: FB限定理由_v77\n"
    };
    await seed({ tasks: [] });
    await runMorningPlan();
    const zst6bRowsCount = await page.locator(".home-ck").count();
    const zst6bText = await page.locator("main").textContent();
    check("重複テーマは1件に統合され、合計3件(重複1+プラン限定1+FB限定1)になる", zst6bRowsCount === 3, `count=${zst6bRowsCount}`);
    check("重複テーマの理由はプラン側が残る", zst6bText.includes("プラン側理由_v77"), zst6bText.slice(0, 500));
    check("重複テーマのFB側の理由は表示されない(統合されて消える)", !zst6bText.includes("FB側理由_v77"), zst6bText.slice(0, 500));
    check("プラン限定テーマも表示される", zst6bText.includes("テーマプラン限定_v77"), zst6bText.slice(0, 500));
    check("FB限定テーマも表示される", zst6bText.includes("テーマFB限定_v77"), zst6bText.slice(0, 500));

    console.log("[6c] 「## 0秒思考テーマ」見出しが無い旧形式のFB(かつAIプランも無い)でもクラッシュせず、カードが出ない");
    aiPlanFixture = null;
    feedbackFixture = {
      [TODAY]: "# AIフィードバック本文_v77(旧形式)\n\n## 明日への提案\n\n- [ ] 提案1_v77\n\n## 明日への問い\n\n問い_v77\n"
    };
    await seed({ tasks: [] });
    await runMorningPlan();
    const zst6cCount = await page.locator(".home-ck").count();
    check("0秒思考テーマ見出しが無い旧形式FBでもクラッシュしない(pageerror無し。ここまで到達していれば正常)", true);
    check("0秒思考テーマのカードは出ない(候補0件)", zst6cCount === 0, `count=${zst6cCount}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
