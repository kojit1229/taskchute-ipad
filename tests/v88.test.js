// v88 検証: K本日指示の2件。
//  ① ポモドーロ全画面モードで Study With Me ON時、YouTube iframeが画面いっぱいの背景レイヤに
//     なり、タイマー(円形プログレス+残り時間)HUDが前面に半透明で重なって両方観られること。
//     HUDはpointer-events制御で動画へのタップを妨げず、ボタン類は引き続き押せること。
//  ② 全画面表示中も v84 の差分パッチ(updatePomodoroTick)が効き、500ms tickで背景iframeの
//     DOMノードが再生成(=動画の再読込)されないこと。
//  ③ 全画面終了(✕)・トグルOFFで背景iframeが破棄されること。
//  ④ ホームの「未完了タスク」パネルが当日〜+3日のタスクのみ既定表示すること。
//  ⑤ +4日以降のタスクは「＋4日以降 N件」の既定closed折りたたみ(details、開閉記憶あり)に
//     格納され、完全非表示にはならないこと(件数も正しいこと)。
//  ⑥ v86の自動取り込みタスク(dueDate=当日)が既定の表示範囲内に入ること。
//
// 方針: 既存スイート(v63等)と同じく、app.js は type="module" のため内部関数は window に
// 露出しない。ブラウザ操作 + localStorage 状態の直接注入で観測する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4223;
const KEY = "taskchute-journal-pwa-state-v1";
const HOME_FOLD_KEY = "taskchute-journal-home-fold-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  function addDaysISO(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return isoDate(dt);
  }

  function testTask(id, title, dueDate) {
    return {
      id, projectId: "", parentTaskId: "", title, category: "", status: "todo",
      dueDate, description: "", leverageType: "", aiWork: false, aiWorkBrief: "",
      targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
      realized: false, realizedDate: "", nextRoutineId: "",
      createdAt: `${TODAY}T09:00`, updatedAt: `${TODAY}T09:00`, deleted: false
    };
  }

  try {
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [①] 全画面 + Study With Me ON: 背景iframe + タイマーHUDが両方観られる
    // ============================================================
    console.log("[①] 全画面でStudy With Me背景 + タイマーHUDが両方表示される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "pomodoro";
      s.pomodoro.fullscreen = true;
      s.pomodoro.studyWithMeOn = true;
      s.pomodoro.tab = "manual";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    check("全画面ルートに has-swm-bg クラスが付与される", await page.locator(".pomo-fullscreen.has-swm-bg").count() === 1);
    check("背景iframe(.pomo-fs-bg-iframe)が1つ生成される", await page.locator(".pomo-fs-bg-iframe").count() === 1);
    const bgSrc = await page.locator(".pomo-fs-bg-iframe").getAttribute("src");
    check(
      "背景iframeのsrcがyoutube-nocookie.com/embed形式(設定の既定動画)",
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]+\?start=\d+$/.test(bgSrc || ""),
      bgSrc
    );
    check("mp4背景(.pomo-bg-video)はStudy With Me中は表示されない", await page.locator(".pomo-bg-video").count() === 0);
    check("円形プログレス(.pomo-progress-circle)がHUDとして重なって表示される", await page.locator(".pomo-progress-circle").count() === 1);
    check("残り時間テキスト(.pomo-time-overlay)がHUDとして重なって表示される", await page.locator(".pomo-time-overlay").count() === 1);

    console.log("[①-2] HUDはpointer-events制御で動画タップを妨げず、ボタンは押せる");
    const contentPE = await page.locator(".pomo-fullscreen-content").evaluate((el) => getComputedStyle(el).pointerEvents);
    check("HUDコンテナ自体はpointer-events:noneで動画へのタップを通す", contentPE === "none", contentPE);
    const closeBtnPE = await page.locator(".pomo-fullscreen-close").evaluate((el) => getComputedStyle(el).pointerEvents);
    check("✕(全画面解除)ボタンはpointer-events:autoのまま押せる", closeBtnPE === "auto", closeBtnPE);
    const tabBtnPE = await page.locator('.pomo-fs-tabs button[data-tab="manual"]').evaluate((el) => getComputedStyle(el).pointerEvents);
    check("タブ切替ボタンもpointer-events:autoのまま押せる", tabBtnPE === "auto", tabBtnPE);

    // ============================================================
    // [②] 全画面中もtickでiframeのDOMノードが再生成されない(v84差分パッチの継承)
    // ============================================================
    console.log("[②] 全画面中の500ms tickで背景iframeが再読込されない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.pomodoro.tab = "passive";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("(準備)passiveタブでも背景iframeが表示されている", await page.locator(".pomo-fs-bg-iframe").count() === 1);
    await page.evaluate(() => {
      document.querySelector(".pomo-fs-bg-iframe").__v88Marker = "same-node-" + Date.now();
    });
    const markerBefore = await page.evaluate(() => document.querySelector(".pomo-fs-bg-iframe")?.__v88Marker);
    const timeTextBefore = await page.locator(".pomo-time-overlay").textContent();
    await page.waitForTimeout(1300); // tickは500ms毎 → 2〜3回発火するはず
    const markerAfter = await page.evaluate(() => document.querySelector(".pomo-fs-bg-iframe")?.__v88Marker);
    check(
      "1.3秒後も背景iframeが同一DOMノードのまま(tickで再生成されていない)",
      markerAfter === markerBefore && !!markerAfter,
      JSON.stringify({ markerBefore, markerAfter })
    );
    const timeTextAfter = await page.locator(".pomo-time-overlay").textContent();
    check(
      "その間、HUDのカウントダウン表示は差分更新で変化している(表示自体は生きている)",
      timeTextAfter !== timeTextBefore,
      JSON.stringify({ timeTextBefore, timeTextAfter })
    );

    // ============================================================
    // [③] 全画面終了・トグルOFFで背景iframeが破棄される
    // ============================================================
    console.log("[③] 全画面終了・トグルOFFで背景iframeが破棄される");
    // 全画面内蔵のStudy With Meトグルボタンでまずbg iframeのみOFFにする
    check("全画面内にStudy With Meトグルボタンがある", await page.locator(".pomo-fullscreen-swm-toggle").count() === 1);
    await page.click(".pomo-fullscreen-swm-toggle");
    await page.waitForTimeout(200);
    check("全画面内トグルOFFで背景iframeが破棄される", await page.locator(".pomo-fs-bg-iframe").count() === 0);
    check("OFF後はmp4背景に戻る", await page.locator(".pomo-bg-video").count() === 1);
    check("has-swm-bgクラスも外れる", await page.locator(".pomo-fullscreen.has-swm-bg").count() === 0);

    // 再度ONにしてから、✕(全画面解除)で破棄されることを確認
    await page.click(".pomo-fullscreen-swm-toggle");
    await page.waitForTimeout(200);
    check("(準備)再度ONで背景iframeが表示される", await page.locator(".pomo-fs-bg-iframe").count() === 1);
    await page.click(".pomo-fullscreen-close");
    await page.waitForTimeout(200);
    check("全画面解除(✕)で背景iframeが破棄される", await page.locator(".pomo-fs-bg-iframe").count() === 0);
    const stateAfterClose = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro, KEY);
    check("全画面フラグはOFFになっている", stateAfterClose.fullscreen === false);
    check("Study With Meトグル状態自体は(ONのまま)stateに残る", stateAfterClose.studyWithMeOn === true);

    // ============================================================
    // [④⑤⑥] ホームの「未完了タスク」パネル: 当日+3日既定表示 / +4日以降は折りたたみ / 自動取込タスク
    // ============================================================
    console.log("[④⑤⑥] 未完了タスクの当日+3日絞り込み・+4日以降の折りたたみ・自動取込タスクの表示範囲");
    const overdueTask = testTask("t-overdue", "期限切れタスク", addDaysISO(TODAY, -1));
    const todayTask = testTask("t-today-auto", "v86ライク自動取込タスク", TODAY);       // ⑥ dueDate=当日を模す
    const plus1Task = testTask("t-plus1", "あす締切タスク", addDaysISO(TODAY, 1));
    const plus3Task = testTask("t-plus3", "3日後締切タスク(境界)", addDaysISO(TODAY, 3));
    const plus4Task = testTask("t-plus4", "4日後締切タスク(境界)", addDaysISO(TODAY, 4));
    const plus6Task = testTask("t-plus6", "6日後締切タスク", addDaysISO(TODAY, 6));
    const plus8Task = testTask("t-plus8", "8日後締切タスク(既存7日上限の外)", addDaysISO(TODAY, 8));

    await page.evaluate(({ KEY, HOME_FOLD_KEY, tasks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks.push(...tasks);
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
      // zone3(未完了タスクパネルの親フォールド)を開いた状態にして可視化する
      localStorage.setItem(HOME_FOLD_KEY, JSON.stringify({ zone3: true }));
    }, { KEY, HOME_FOLD_KEY, tasks: [overdueTask, todayTask, plus1Task, plus3Task, plus4Task, plus6Task, plus8Task] });
    await page.reload();
    await page.waitForTimeout(400);

    // 注意: <details>が閉じていても中身はDOMに残る(非表示はブラウザ既定のレンダリングのみ)。
    // よって「既定表示(near)」と「折りたたみの中(far)」を正しく区別するため、DOM構造を
    // :scope > で直接の親子関係のまま辿って集計する(近接行はpanelの直接の子、
    // far行はdetails[data-fold-id]の中、という実装どおりの構造を頼りに検証する)。
    const backlog = await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll("section.panel")).find((p) => {
        const label = p.querySelector(":scope > .home-plabel.blue");
        return label && label.textContent.includes("未完了タスク");
      });
      if (!panel) return null;
      const headerCount = panel.querySelector(":scope > .home-plabel.blue .home-count")?.textContent || "";
      const fold = panel.querySelector(':scope > details[data-fold-id="home-backlog-far"]');
      const nearNames = Array.from(panel.querySelectorAll(":scope > .home-due .home-due-name")).map((el) => el.textContent);
      const farNames = fold ? Array.from(fold.querySelectorAll(".home-due .home-due-name")).map((el) => el.textContent) : [];
      const farSummary = fold ? fold.querySelector("summary").textContent : "";
      const farOpen = fold ? fold.open : null;
      return { headerCount, nearNames, farNames, farSummary, farOpen, hasFold: !!fold };
    });
    console.log("  (観測) 既定表示(near):", JSON.stringify(backlog?.nearNames));
    console.log("  (観測) 折りたたみ内(far):", JSON.stringify(backlog?.farNames));

    check("[④] 期限切れタスクは既定表示される", backlog.nearNames.includes("期限切れタスク"));
    check("[⑥] 自動取込タスク(dueDate=当日)は既定表示範囲内", backlog.nearNames.includes("v86ライク自動取込タスク"));
    check("[④] あす締切タスクは既定表示される", backlog.nearNames.includes("あす締切タスク"));
    check("[④] 3日後(境界)は既定表示される", backlog.nearNames.includes("3日後締切タスク(境界)"));
    check("[⑤] 4日後(境界)は既定表示(near)には出ない", !backlog.nearNames.includes("4日後締切タスク(境界)"));
    check("[⑤] 6日後は既定表示(near)には出ない", !backlog.nearNames.includes("6日後締切タスク"));
    check("[既存仕様維持] 8日後(旧7日上限の外)はnear/far どちらにも出ない(取得対象外)",
      !backlog.nearNames.includes("8日後締切タスク(既存7日上限の外)") && !backlog.farNames.includes("8日後締切タスク(既存7日上限の外)"));

    check("[⑤] +4日以降の折りたたみ(details)が存在する", backlog.hasFold);
    check("[⑤] 折りたたみは既定closed(open属性なし)", backlog.farOpen === false);
    check("[⑤] 折りたたみの中に4日後・6日後タスクが両方入っている(完全非表示ではない)",
      backlog.farNames.includes("4日後締切タスク(境界)") && backlog.farNames.includes("6日後締切タスク"),
      JSON.stringify(backlog.farNames));
    check("[⑤] 折りたたみの見出し件数が中身の件数と一致する",
      new RegExp(`＋4日以降\\s*${backlog.farNames.length}件`).test(backlog.farSummary || ""), backlog.farSummary);
    check("[④⑤] ヘッダー件数はnear+farの合計と一致する(絞り込みで取りこぼしていない)",
      backlog.headerCount.trim() === `${backlog.nearNames.length + backlog.farNames.length}件`,
      JSON.stringify(backlog));

    // 折りたたみを開くと開閉状態が記憶される(既存home-fold機構の再利用確認)
    const farFold = page.locator('details[data-fold-id="home-backlog-far"]');
    await farFold.locator("summary").click();
    await page.waitForTimeout(150);
    check("[⑤] クリックで折りたたみが開く", await farFold.evaluate((el) => el.open));
    const foldMapAfterOpen = await page.evaluate((HOME_FOLD_KEY) => JSON.parse(localStorage.getItem(HOME_FOLD_KEY) || "{}"), HOME_FOLD_KEY);
    check("[⑤] 開閉状態がlocalStorageに記憶される", foldMapAfterOpen["home-backlog-far"] === true, JSON.stringify(foldMapAfterOpen));

    console.log(failures === 0 ? "\n✅ v88 ALL PASS" : `\n❌ v88: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
