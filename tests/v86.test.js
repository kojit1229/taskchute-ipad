// v86 検証: AIフィードバック自動取り込み + 0秒思考テーマのワンタップ削除。CHANGES_v86.md参照。
// v300でタスク候補stateへの書き込みを停止。テーマ側の自動追加はv86のまま無変更。
//
// K指示(2026-07-13):
//   1. 「フィードバックの内容をタスクシュートの未完了タスク、0秒思考のテーマ一覧に
//      自動的に追加してください」→ v75の「選んでから追加」UIをやめ、hydrateStaticMarkdown内の
//      autoIngestFeedbackで確定登録する方式へ転換した。
//   2. 「0秒思考に登録されたテーマで不要なものを削除するようにしてください」→ テーマ一覧に
//      ワンタップ削除ボタンを追加。AI由来テーマ(自動取り込み分)の削除はzeroSecThemeLogへ
//      「不採用(outcome:"skipped")」として記録し、v75由来の学習ループに接続する。
//
// v300: 採用UIが既に無いため、タスク側はstate.tasksにもjournalMeta.aiTaskCandidatesにも書かない。
// ①新着FBでテーマだけ自動取り込み(routeモック) ②冪等(2回hydrateで二重登録なし)
// ③テーマ重複スキップ ④テーマ削除+AI由来の不採用記録 ⑤旧形式FB(セクション無し)で何も起きない
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
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
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YEST = addDaysStr(TODAY, -1);

  // ---- AIフィードバック_*.md のfixture(route経由で応答)。AIプランjsonは常に404(本スイートの対象外)。
  let feedbackFixture = {};   // { 'YYYY-MM-DD': mdText }
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
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  function wbsTask(id, title, { dueDate = "", status = "todo", createdAt = `${TODAY}T00:00` } = {}) {
    return {
      id, projectId: "", parentTaskId: "", title, category: "", status, dueDate,
      description: "", createdAt, updatedAt: createdAt, deleted: false
    };
  }

  async function seed({ tasks = [], view = "home", zeroSecThemeLog = [], zeroThinkingThemes = [], feedbackIngestedDates = [], selectedDate = TODAY, feedbackFiles = [] } = {}) {
    await page.evaluate(({ KEY, tasks, view, zeroSecThemeLog, zeroThinkingThemes, feedbackIngestedDates, selectedDate, feedbackFiles }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.selectedDate = selectedDate;
      s.currentView = view;
      s.feedback = {};
      s.zeroSecThemeLog = zeroSecThemeLog;
      s.zeroThinking = { themes: zeroThinkingThemes, entries: [] };
      s.feedbackIngestedDates = feedbackIngestedDates;
      s.feedbackFiles = feedbackFiles;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, tasks, view, zeroSecThemeLog, zeroThinkingThemes, feedbackIngestedDates, selectedDate, feedbackFiles });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] 新着FBでテーマだけ自動取り込み
    // ============================================================
    console.log("[1] 新着フィードバックから0秒思考テーマだけを自動登録する");
    feedbackFixture = {
      [YEST]: "# AIフィードバック本文_v86\n\n## 0秒思考テーマ\n\n- [ ] 新規テーマ1_v86: 理由1_v86\n\n## 明日への提案\n\n- [ ] 新規タスク1_v86: 理由A_v86\n"
    };
    await seed({ tasks: [] });
    const s1 = await readState();
    const task1 = (s1.tasks || []).find((t) => t.title === "新規タスク1_v86");
    check("「明日への提案」はstate.tasksへ直接登録されない", !task1, JSON.stringify(task1));
    check("「明日への提案」はjournalMeta[前日].aiTaskCandidatesにも登録されない",
      !(s1.journalMeta?.[YEST]?.aiTaskCandidates || []).includes("新規タスク1_v86"), JSON.stringify(s1.journalMeta?.[YEST]));
    const theme1 = (s1.zeroThinking?.themes || []).find((t) => t.text === "新規テーマ1_v86");
    check("「0秒思考テーマ」がzeroThinking.themesへ登録される", !!theme1, JSON.stringify(s1.zeroThinking));
    check("自動登録テーマにはsource:\"ai-feedback\"が付く(手動追加と区別するマーカー)", theme1 && theme1.source === "ai-feedback", JSON.stringify(theme1));
    check("取り込み済みマーカーにフィードバック自身の日付(前日)が記録される", (s1.feedbackIngestedDates || []).includes(YEST), JSON.stringify(s1.feedbackIngestedDates));
    const toastText1 = await page.locator("#toast").textContent().catch(() => "");
    check("テーマ件数だけをトースト通知し、存在しない候補UIへ誘導しない",
      !(toastText1 || "").includes("タスク候補") && (toastText1 || "").includes("テーマ1件"), toastText1);

    // ============================================================
    // [2] 冪等性: 同じ日付のフィードバックは、visibilitychange等で2回hydrateされても二重登録しない
    // ============================================================
    console.log("[2] 同じフィードバック(同じ日付)からの取り込みは1回だけ(2回目のhydrateで二重登録しない)");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(700);
    const s2 = await readState();
    const matchesTask2 = (s2.journalMeta?.[YEST]?.aiTaskCandidates || []).filter((t) => t === "新規タスク1_v86");
    const matchesTheme2 = (s2.zeroThinking?.themes || []).filter((t) => t.text === "新規テーマ1_v86");
    check("2回目のhydrateでもタスク候補は登録されない", matchesTask2.length === 0, JSON.stringify(matchesTask2));
    check("2回目のhydrateでテーマが二重登録されない", matchesTheme2.length === 1, JSON.stringify(matchesTheme2));
    check("api.github.comへは複数回fetchが飛んでいる(裏取り: 冪等ゲートはfetch側でなく登録側)",
      feedbackApiRequests.filter((p) => p.endsWith(`AIフィードバック_${YEST}.md`)).length >= 2, JSON.stringify(feedbackApiRequests));

    // 冪等マーカーを明示的にリセットして、同じ日付・別内容のフィードバックが再登録されないことも確認する
    // (=「日付」で1回だけ、という仕様どおりで、内容が変わっても再登録の対象にならない)
    feedbackFixture = {
      [YEST]: "# AIフィードバック本文_v86(内容変更後)\n\n## 0秒思考テーマ\n\n- [ ] 別のテーマ_v86: 別の理由\n"
    };
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(700);
    const s2b = await readState();
    check("同じ日付なら内容が変わっても再登録されない(冪等マーカーは日付単位)",
      !(s2b.zeroThinking?.themes || []).some((t) => t.text === "別のテーマ_v86"), JSON.stringify(s2b.zeroThinking));

    // ============================================================
    // [3] 既存タスクは維持し、同文テーマがあれば追加しない
    // ============================================================
    console.log("[3] 既存タスクは維持し、同文テーマ(前日から残っているもの含む)は重複登録しない");
    feedbackFixture = {
      [YEST]: "# AIフィードバック本文_v86\n\n## 0秒思考テーマ\n\n- [ ] 既存テーマ_v86: 理由\n\n## 明日への提案\n\n- [ ] 既存タスク_v86: 理由\n"
    };
    await seed({
      tasks: [wbsTask("existing-task-v86", "既存タスク_v86", { dueDate: addDaysStr(TODAY, -3), status: "todo" })],
      zeroThinkingThemes: [{ id: "existing-theme-v86", text: "既存テーマ_v86", fav: false, questionId: null, createdAt: `${TODAY}T00:00`, source: null }]
    });
    const s3 = await readState();
    const taskMatches3 = (s3.tasks || []).filter((t) => t.title === "既存タスク_v86");
    const candidateMatches3 = (s3.journalMeta?.[YEST]?.aiTaskCandidates || []).filter((t) => t === "既存タスク_v86");
    const themeMatches3 = (s3.zeroThinking?.themes || []).filter((t) => t.text === "既存テーマ_v86");
    check("同名の未完了タスクが既にあれば増えない(繰越タスクとの重複防止)", taskMatches3.length === 1, JSON.stringify(taskMatches3));
    check("既存タスクの有無にかかわらず候補stateへ追加しない", candidateMatches3.length === 0, JSON.stringify(candidateMatches3));
    check("同文のテーマが既にあれば増えない", themeMatches3.length === 1, JSON.stringify(themeMatches3));

    // ============================================================
    // [3b] should-fix(レビュー指摘): today枠は state.selectedDate 連動のfetchのため、過去日を
    // 閲覧中にその日のFBがまだキャッシュされていないと todayFb に過去日のフィードバックが入る。
    // これをそのまま自動登録すると「過去日を見ているだけ」で過去FBの提案が実今日のタスクとして
    // 注入されてしまう(dueDateはautoIngestFeedback内部でtodayISO()固定のため)。
    // today===実今日のときだけ取り込む制限が効いていることを確認する。
    // ============================================================
    console.log("[3b] 過去日を閲覧中にその日のFB(today枠)が新規fetchされても、実今日のタスク/テーマとして注入されない");
    // v85により起動(reload)直後は必ずselectedDate=今日に強制されるため、過去日の閲覧は
    // reload後にセッション中の日付ピッカー操作で行う(v57.test.js[1]と同じ手法。setSelectedDateは
    // 日付変更のたびhydrateStaticMarkdownを再実行する既存フックがある)。
    const PASTDATE = addDaysStr(TODAY, -5);
    feedbackFixture = {
      [PASTDATE]: "# AIフィードバック本文_過去日_v86\n\n## 0秒思考テーマ\n\n- [ ] 過去日テーマ_v86: 理由\n\n## 明日への提案\n\n- [ ] 過去日提案_v86: 理由\n"
      // YESTは意図的に設定しない(prev枠から別途拾われて紛れ込むのを避けるため)
    };
    // 過去日のFBを「push済みで存在が判っている」扱いにする(feedbackFilesへ登録)。
    // 未登録だと wantFetch 自体が404防止でfetchせず、本来検証したい「fetchはされたが
    // 実今日として注入されない」という現象の前提が成立しないため。
    await seed({ tasks: [], feedbackFiles: [PASTDATE] });
    feedbackApiRequests.length = 0;  // 起動時hydrateぶんの記録はリセットし、日付移動時のfetchだけを見る
    // v230: home撤去後、日付ピッカーはタスクシュート画面の現行導線を使う。
    await page.click('[data-action="nav"][data-view="exec"]');
    await page.waitForTimeout(150);
    await page.evaluate((PAST) => {
      const el = document.querySelector("[data-date-picker]");
      el.value = PAST;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, PASTDATE);
    await page.waitForTimeout(700);
    const s3b = await readState();
    check("過去日のFBが実際にfetchされている(現象の前提: 404で弾かれたわけではない)",
      feedbackApiRequests.some((p) => p.endsWith(`AIフィードバック_${PASTDATE}.md`)), JSON.stringify(feedbackApiRequests));
    check("過去日FB由来のタスクは実今日のタスクとして注入されない", !(s3b.tasks || []).some((t) => t.title === "過去日提案_v86"), JSON.stringify(s3b.tasks));
    check("過去日FB由来のタスク候補もどこにも登録されない(取り込み自体がtoday===realTodayでブロックされる)",
      !(s3b.journalMeta?.[PASTDATE]?.aiTaskCandidates || []).length, JSON.stringify(s3b.journalMeta?.[PASTDATE]));
    check("過去日FB由来のテーマも注入されない", !(s3b.zeroThinking?.themes || []).some((t) => t.text === "過去日テーマ_v86"), JSON.stringify(s3b.zeroThinking));
    check("過去日は取り込み済みマーカーにも記録されない(今後実際にその日を迎えたときのため取り込みの余地を残す)",
      !(s3b.feedbackIngestedDates || []).includes(PASTDATE), JSON.stringify(s3b.feedbackIngestedDates));

    // ============================================================
    // [4] テーマのワンタップ削除 + AI由来の不採用記録(学習ループ接続)
    // ============================================================
    console.log("[4a] AI由来テーマ(source:\"ai-feedback\")を削除するとzeroSecThemeLogへoutcome:\"skipped\"で記録される");
    await seed({
      tasks: [],
      zeroThinkingThemes: [
        { id: "ai-theme-v86", text: "AI由来テーマ_v86", fav: false, questionId: null, createdAt: `${TODAY}T00:00`, source: "ai-feedback" },
        { id: "manual-theme-v86", text: "手動テーマ_v86", fav: false, questionId: null, createdAt: `${TODAY}T00:00`, source: null }
      ]
    });
    await page.click('[data-action="nav"][data-view="zero"]');
    await page.waitForTimeout(150);
    page.once("dialog", (dialog) => dialog.accept());
    await page.click('[data-action="zt-theme-delete"][data-id="ai-theme-v86"]');
    await page.waitForTimeout(300);
    const s4a = await readState();
    check("AI由来テーマが一覧から削除される", !(s4a.zeroThinking?.themes || []).some((t) => t.id === "ai-theme-v86"), JSON.stringify(s4a.zeroThinking));
    check("削除がzeroSecThemeLogへoutcome:\"skipped\"(不採用)として記録される",
      (s4a.zeroSecThemeLog || []).some((l) => l.theme === "AI由来テーマ_v86" && l.outcome === "skipped"), JSON.stringify(s4a.zeroSecThemeLog));

    console.log("[4b] 手動追加テーマ(source:null)を削除してもzeroSecThemeLogには記録されない(AIの提案ではないため)");
    const logCountBefore4b = (s4a.zeroSecThemeLog || []).length;
    page.once("dialog", (dialog) => dialog.accept());
    await page.click('[data-action="zt-theme-delete"][data-id="manual-theme-v86"]');
    await page.waitForTimeout(300);
    const s4b = await readState();
    check("手動テーマが一覧から削除される", !(s4b.zeroThinking?.themes || []).some((t) => t.id === "manual-theme-v86"), JSON.stringify(s4b.zeroThinking));
    check("手動テーマの削除はzeroSecThemeLogの件数を増やさない", (s4b.zeroSecThemeLog || []).length === logCountBefore4b, JSON.stringify(s4b.zeroSecThemeLog));

    console.log("[4c] 削除確認ダイアログをキャンセルすれば削除されない");
    await seed({
      tasks: [],
      zeroThinkingThemes: [{ id: "cancel-theme-v86", text: "キャンセル対象テーマ_v86", fav: false, questionId: null, createdAt: `${TODAY}T00:00`, source: "ai-feedback" }]
    });
    await page.click('[data-action="nav"][data-view="zero"]');
    await page.waitForTimeout(150);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.click('[data-action="zt-theme-delete"][data-id="cancel-theme-v86"]');
    await page.waitForTimeout(300);
    const s4c = await readState();
    check("確認をキャンセルすればテーマは残る", (s4c.zeroThinking?.themes || []).some((t) => t.id === "cancel-theme-v86"), JSON.stringify(s4c.zeroThinking));

    // ============================================================
    // [5] 旧形式FB(見出しが無い)では何も起きない
    // ============================================================
    console.log("[5] 「## 明日への提案」「## 0秒思考テーマ」見出しが無い旧形式FBでは、タスクもテーマも増えずクラッシュしない");
    feedbackFixture = {
      [YEST]: "# AIフィードバック本文_v86(旧形式)\n\n所感のみで、見出し構造を持たない自由記述の本文です。\n"
    };
    await seed({ tasks: [] });
    const s5 = await readState();
    check("旧形式FBでもクラッシュしない(pageerror無し。ここまで到達していれば正常)", true);
    check("見出しが無いので新規タスクは増えない(単発ブロック受け皿の kind:\"other\" 以外は無い)",
      (s5.tasks || []).every((t) => t.kind === "other"), JSON.stringify(s5.tasks));
    check("見出しが無いので新規テーマは増えない", (s5.zeroThinking?.themes || []).length === 0, JSON.stringify(s5.zeroThinking));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
