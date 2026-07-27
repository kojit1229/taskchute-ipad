// v148 検証: UI改善計画Phase3(導線の再編)。CHANGES_v148.md参照。
//
// (1) 「その他」12項目 → 目的別4群(計画/思考/振り返り/ツール)。ルーティンは実行系(タスクシュート)
//     の上部リンクへ昇格し、その他グリッドからは除外される
// (2) その他配下のビュー(例: 0秒思考)を開いたとき、ヘッダに「その他 › 群名」の現在地表示が出る
// (3) 設定13パネル → 4群アコーディオン(既定全閉。「データと同期」は同期停止アラート発生時だけ初期open)
// (4) 計器盤 → 常時表示(ヒント+着手率+睡眠1行要約)+詳細details(既定閉、既存チャートは全部残る)
// (5) ジャーナル当日パネル → 朝/夜/本文の3details。現在時刻(〜14時=朝/14時〜=夜)で自動open。
//     本文は常時open
// (6) タイムラインのエネルギー/バッテリー切替トグル。選択状態はstate.settings.timelineEnergyGraphMode
//     に保存され、reload後も維持される(既定"energy")
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);
  // v72以降と同じく、AIプラン/AIフィードバック/週次レビューの実ファイルfetchは常に404隔離する
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  async function seed({ view = "home", selectedDate, settings = {}, fixedTime } = {}) {
    if (fixedTime) await page.clock.setFixedTime(fixedTime);
    await page.evaluate(({ KEY, view, selectedDate, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      if (selectedDate) s.selectedDate = selectedDate;
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, view, selectedDate, settings });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    const now0 = new Date();
    now0.setHours(10, 0, 0, 0);  // 朝(〜14時)固定の基準時刻
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);
    // v148レビュー対応: passGithubGate後はpersonalDataReady()がtrueになり、起動のたびに
    // syncFromGitHubOnStartup()がapp-state.jsonのGETを試みる。blockGithubApiByDefault()の
    // 既定404は、このGETをdownloadGitHubStateText()内でgitHubErrorMessage()経由の例外にし、
    // 副作用としてsetPersonalDataAuthError()が毎回発火してしまう(意図せず「データと同期」群の
    // dynamicOpen条件を汚染し、[3]系のテストが常にtrueになる問題があった)。dataModifiedAtを
    // 意図的に大昔にした200応答を返す成功モックを登録し、この副作用を止める(remoteが常に
    // ローカルより古い扱いになるため、実際の状態上書きは起きない=他セクションへの影響もない)。
    // [3e]だけは401専用の後発route登録で明示的に上書きし、認証エラーを検証する。
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => {
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "home", selectedDate: "2000-01-01", blocks: [], projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-startup-mock", content, encoding: "base64" }) });
      });

    // ============================================================
    // (1) 「その他」の目的別4群 + ルーティンの昇格
    // ============================================================
    console.log("[1] 「その他」12項目 → 目的別4群。ルーティンは除外され、タスクシュート上部リンクへ昇格");
    await seed({ view: "more" });
    const groupTitles = await page.locator(".more-group-title").allTextContents();
    check("4群の見出しが揃っている(計画/思考/振り返り/ツール)",
      JSON.stringify(groupTitles) === JSON.stringify(["計画", "思考", "振り返り", "ツール"]), JSON.stringify(groupTitles));
    const moreNavButtons = await page.locator('.more-group [data-action="nav"]').evaluateAll(
      (els) => els.map((el) => el.dataset.view)
    );
    check("その他グリッドは11項目(ルーティンを除く12項目中)",
      moreNavButtons.length === 11, JSON.stringify(moreNavButtons));
    check("ルーティンはその他グリッドに含まれない", !moreNavButtons.includes("routine"), JSON.stringify(moreNavButtons));
    check("計画群の直後に思考群が続く(グループ単位でまとまっている)",
      moreNavButtons.slice(0, 4).join(",") === "wbs,wish,avoid,vision", JSON.stringify(moreNavButtons));
    // 頭文字1字アイコン(W/R/A等)ではなく絵文字になっていることを確認(codex-ui-review N4対応)
    const badgeTexts = await page.locator('.more-group [data-action="nav"] .badge').allTextContents();
    check("バッジが1文字のアルファベットではない(絵文字化)",
      badgeTexts.every((t) => !/^[A-Za-z]$/.test(t.trim())), JSON.stringify(badgeTexts));

    console.log("[1b] タスクシュート上部にルーティンへのリンクがあり、遷移できる");
    await seed({ view: "tasks" });
    const routineLink = page.locator('#main [data-action="nav"][data-view="routine"]');
    check("タスクシュート画面にルーティンへのリンクがある", await routineLink.count() === 1);
    await routineLink.click();
    await page.waitForTimeout(300);
    const viewAfterRoutineLink = (await stateNow()).currentView;
    check("クリックでルーティン画面へ遷移する", viewAfterRoutineLink === "routine", viewAfterRoutineLink);

    console.log("[1c] ルーティン画面ではbottom-navの「実行」がactiveになる(「その他」ではない、Codex指摘)");
    // 現在state.currentView==="routine"のまま(renderBottomNavはビューポート幅に関係なく
    // #bottomNav.innerHTMLを描画するため、デスクトップ幅のままでもclass判定は検証できる)。
    const tasksNavActive = await page.locator('#bottomNav [data-action="nav"][data-view="tasks"]').evaluate((el) => el.classList.contains("active"));
    const moreNavActive = await page.locator('#bottomNav [data-action="nav"][data-view="more"]').evaluate((el) => el.classList.contains("active"));
    check("ルーティン画面でbottom-navの「実行」がactiveになる", tasksNavActive === true, String(tasksNavActive));
    check("ルーティン画面でbottom-navの「その他」はactiveにならない", moreNavActive === false, String(moreNavActive));

    // ============================================================
    // (2) その他配下ビューの現在地表示(その他 › 群名)
    // ============================================================
    console.log("[2] その他配下のビュー(0秒思考)を開くとヘッダに「その他 › 思考」が出る");
    await seed({ view: "zero" });
    const breadcrumbText = await page.locator(".view-breadcrumb").first().textContent();
    check("0秒思考のヘッダに「その他 › 思考」が出る", (breadcrumbText || "").includes("その他") && (breadcrumbText || "").includes("思考"), breadcrumbText);
    console.log("[2b] home/tasks/timeline/journal/routineには現在地表示が出ない(その他配下ではないため)");
    for (const v of ["home", "tasks", "timeline", "journal", "routine"]) {
      await seed({ view: v });
      const bc = await page.locator(".view-breadcrumb").count();
      check(`${v}にはview-breadcrumbが出ない`, bc === 0, String(bc));
    }

    // ============================================================
    // (3) 設定の4群アコーディオン(既定全閉。同期停止時のみ「データと同期」が初期open)
    // ============================================================
    console.log("[3] 設定は4群(通常3群+データと同期1群)のdetailsで、既定は全群閉");
    await seed({ view: "settings" });
    // 「データと同期」群だけdata-fold-id属性を意図的に持たない(グローバルのtoggleリスナーが
    // data-fold-idを見て拾ってしまい、動的openが誤って永続化されるのを避けるため。
    // app.js renderSettingsSyncGroupのコメント参照)。マーカーはdata-settings-sync。
    const foldGroups = page.locator('.settings-grid > details[data-fold-id^="settings-"]');
    const syncGroupLoc = page.locator('.settings-grid > details[data-settings-sync]');
    check("設定は4群のdetailsで構成される(通常3群+データと同期1群)",
      await foldGroups.count() === 3 && await syncGroupLoc.count() === 1,
      `fold=${await foldGroups.count()} sync=${await syncGroupLoc.count()}`);
    const openFlags = await foldGroups.evaluateAll((els) => els.map((el) => el.open));
    const syncOpenInitial = await syncGroupLoc.evaluate((el) => el.open);
    check("同期異常が無い状態では4群とも既定closed",
      openFlags.every((o) => o === false) && syncOpenInitial === false,
      JSON.stringify({ openFlags, syncOpenInitial }));
    // パネルは各群のdetails内に格納されているだけで、消えてはいない(格納するだけの原則)
    check("エネルギーバッテリー欄はDOM上に存在する(閉じているだけ)",
      await page.locator('[data-setting-battery-field="max"]').count() === 1);
    check("Study With Me欄はDOM上に存在する(閉じているだけ)",
      await page.locator('[data-swm-field="videoId"]').count() === 1);

    console.log("[3b] 同期停止アラートが出る状態では「データと同期」群だけ既定openになる");
    // syncAlertMessage()はpersonalDataReady(github token/owner/repo)+「この端末が最後に
    // pullへ成功した時刻」(taskchute-journal-last-sync-pull-atという別のlocalStorageキー、
    // state本体とは別管理)が24時間(SYNC_PULL_ALERT_HOURS)以上前だと発火する。
    const staleDt = new Date(now0.getTime() - 48 * 60 * 60 * 1000);
    const fmtLocalDt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
    const staleAt = fmtLocalDt(staleDt);
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github = {
        ...s.settings.github,
        dataOwner: "kojit1229", dataRepo: "personal-data", branch: "main", path: "app-state.json",
        token: "ghp_test_v148"
      };
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    // reload直後はsyncFromGitHubOnStartup()(冒頭の成功モック route)がrecordSyncPullSuccess()を
    // 呼び「この端末の最終pull成功時刻」を現在時刻で上書きする。staleな値はreload完了後に
    // 書き込み、reloadを挟まないnavクリックで再renderだけ発火させる(でないと次のreloadで
    // 起動時syncが再びstale値を上書きしてしまい、異常状態を作れない)。
    await page.evaluate(({ staleAt }) => {
      localStorage.setItem("taskchute-journal-last-sync-pull-at", staleAt);
    }, { staleAt });
    await page.click('[data-action="nav"][data-view="settings"]');
