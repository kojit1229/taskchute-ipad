// v148 検証: UI改善計画Phase3(導線の再編)。CHANGES_v148.md参照。
//
// (1) 「その他」12項目 → 目的別4群(計画/思考/振り返り/ツール)
// (2) その他配下のビュー(例: 0秒思考)を開いたとき、ヘッダに「その他 › 群名」の現在地表示が出る
// (3) 設定13パネル → 4群アコーディオン(既定全閉。「データと同期」は同期停止アラート発生時だけ初期open)
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

  async function seed({ view = "today", selectedDate, settings = {}, fixedTime } = {}) {
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
    const TODAY = isoDate(now0);
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
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "today", selectedDate: "2000-01-01", blocks: [], projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-startup-mock", content, encoding: "base64" }) });
      });

    // ============================================================
    // (1) 「その他」のフラットTOWERグリッド
    // ============================================================
    console.log("[1] 「その他」は群見出しなしの単一TOWERグリッド");
    await seed({ view: "more" });
    check("群見出しが撤去されている", await page.locator(".more-group-title, .more-group").count() === 0);
    check("単一グリッドが描画される", await page.locator(".more-tower-grid").count() === 1);
    const moreNavButtons = await page.locator('.more-tower-grid [data-action="nav"]').evaluateAll(
      (els) => els.map((el) => el.dataset.view)
    );
    // v279: FUNDを追加し、単一グリッドは9項目になった。
    check("その他グリッドは9項目(homeを除外)",
      moreNavButtons.length === 9, JSON.stringify(moreNavButtons));
    check("フラットな項目順がv279仕様どおり",
      moreNavButtons.join(",") === "wbs,wish,vision,zero,ai-reports,fund,instruments,iron-log,settings", JSON.stringify(moreNavButtons));
    // 頭文字1字アイコン(W/R/A等)ではなく絵文字になっていることを確認(codex-ui-review N4対応)
    const badgeTexts = await page.locator('.more-tower-grid [data-action="nav"] .more-tower-mark').allTextContents();
    check("バッジが1文字のアルファベットではない(絵文字化)",
      badgeTexts.every((t) => !/^[A-Za-z]$/.test(t.trim())), JSON.stringify(badgeTexts));

    // ============================================================
    // (2) その他配下ビューの現在地表示(その他 › 群名)
    // ============================================================
    console.log("[2] その他配下のビュー(0秒思考)を開くとヘッダに「その他 › 思考」が出る");
    await seed({ view: "zero" });
    const breadcrumbText = await page.locator(".view-breadcrumb").first().textContent();
    check("0秒思考のヘッダに「その他 › 思考」が出る", (breadcrumbText || "").includes("その他") && (breadcrumbText || "").includes("思考"), breadcrumbText);
    console.log("[2b] today/tasks/timeline/journalには現在地表示が出ない(その他配下ではないため)");
    for (const v of ["today", "tasks", "timeline", "journal"]) {
      await seed({ view: v });
      const bc = await page.locator(".view-breadcrumb").count();
      check(`${v}にはview-breadcrumbが出ない`, bc === 0, String(bc));
    }

    // ============================================================
    // (3) 設定の4群アコーディオン(既定全閉。同期停止時のみ「データと同期」が初期open)
    // ============================================================
    console.log("[3] v358: 設定は一覧型(接続と保存トップ+群ごとの行)。レガシー2行(battery/theme)"
      + "+「接続の詳細」1件のアコーディオンは既定閉のまま(セレクタは.settings-grid配下の子孫へ緩和)");
    await seed({ view: "settings" });
    // 「接続の詳細」(旧データと同期)はdata-fold-id/data-legacy-foldのどちらも持たない
    // (グローバルのtoggleリスナーがdata-fold-idを見て拾ってしまい、動的openが誤って永続化される
    // のを避けるため。app.js renderSettingsSyncGroupのコメント参照)。マーカーはdata-settings-sync。
    // v358修正(A-H2/B-H1): battery/theme行は後方互換セレクタとして`data-legacy-fold`(旧
    // `data-fold-id`から改名。グローバルtoggleリスナーの対象外にするため)を持つ。renderSettingsConnectPanel
    // や群divの中にネストされ.settings-gridの直下ではなくなったため直下(>)条件を子孫条件へ緩和した
    // (件数は2件=電池/テーマ行のみ)。
    const foldGroups = page.locator('.settings-grid details[data-legacy-fold^="settings-"]');
    const syncGroupLoc = page.locator('.settings-grid details[data-settings-sync]');
    check("設定はレガシー2行(電池/テーマ)+接続の詳細1件で構成される",
      await foldGroups.count() === 2 && await syncGroupLoc.count() === 1,
      `fold=${await foldGroups.count()} sync=${await syncGroupLoc.count()}`);
    const openFlags = await foldGroups.evaluateAll((els) => els.map((el) => el.open));
    const syncOpenInitial = await syncGroupLoc.evaluate((el) => el.open);
    check("同期異常が無い状態では電池/テーマ行・接続の詳細とも既定closed",
      openFlags.every((o) => o === false) && syncOpenInitial === false,
      JSON.stringify({ openFlags, syncOpenInitial }));
    // パネルは各群のdetails内に格納されているだけで、消えてはいない(格納するだけの原則)
    check("エネルギーバッテリー欄はDOM上に存在する(閉じているだけ)",
      await page.locator('[data-setting-battery-field="max"]').count() === 1);
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
    await page.waitForTimeout(200);
    check("「データと同期」群だけ既定openになる(同期停止アラート発生時)",
      await syncGroupLoc.evaluate((el) => el.open) === true);
    check("他の3群は既定closedのまま",
      (await foldGroups.evaluateAll((els) => els.map((el) => el.open))).every((o) => o === false));

    console.log("[3c] 異常解消後は「データと同期」群が再び閉じる(2系統レビュー指摘・動的openは永続化されない)");
    // ジャーナル朝/夜と同じ理由(<details open>の描画だけでtoggleイベントが自動発火する)により、
    // 旧実装ではここで異常解消後も開きっぱなしになる不具合があった。pull成功時刻を新しく更新
    // (異常解消)し、reloadせずに同一ページセッション内でnav再クリックにより再renderだけ発火させる
    // (setView()は同一viewへのnavでも必ずrender()する。reloadすると_settingsSyncOpenOverrideが
    // リセットされ「永続化されていないこと」の確認にならないため、あえてreloadしない)。
    await page.evaluate(() => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const fresh = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
      localStorage.setItem("taskchute-journal-last-sync-pull-at", fresh);
    });
    await page.click('[data-action="nav"][data-view="settings"]');  // 同一viewへのnavでも再renderされる
    await page.waitForTimeout(200);
    check("異常解消後は「データと同期」群が再びclosedになる(自動openが永続化されていない証拠)",
      await syncGroupLoc.evaluate((el) => el.open) === false);

    console.log("[3d] 手動closed履歴があっても、異常時は開く(動的openはstored値より優先)");
    // 異常状態(直前の[3b]/[3c]操作で作った状態は解消済みなので再度staleにする)で自動openされた
    // 群を、ユーザーが本物のクリックで一度手動closeする → その直後に再度異常化しても開くことを確認する。
    await page.evaluate(({ staleAt }) => {
      localStorage.setItem("taskchute-journal-last-sync-pull-at", staleAt);
    }, { staleAt });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    check("(前提)異常状態でまず自動openになっている", await syncGroupLoc.evaluate((el) => el.open) === true);
    await syncGroupLoc.locator("summary").click();  // ユーザーが手動でclose
    await page.waitForTimeout(150);
    check("手動クリックでclosedになる(見た目上の即時反映)", await syncGroupLoc.evaluate((el) => el.open) === false);
    // 異常状態は継続したまま(staleなpull-atは変更していない)、再renderだけ発火させる
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    check("手動closed履歴があっても、異常が続いていれば次の再描画で再びopenになる(動的open優先)",
      await syncGroupLoc.evaluate((el) => el.open) === true);

    // ============================================================
    // (3e) 認証エラーバナー(pd-auth-banner)からの設定遷移でも「データと同期」群を自動openにする
    // ============================================================
    console.log("[3e] 認証エラーバナーからの設定遷移でも「データと同期」群が自動openになる(トークン再入力欄に直行できる)");
    // 同期停止アラート(pull停止)は解消しておき、認証エラー単独の効果を見る。
    await page.evaluate(({ freshAt }) => {
      localStorage.setItem("taskchute-journal-last-sync-pull-at", freshAt);
    }, { freshAt: fmtLocalDt(new Date()) });
    // 401を返すことでsetPersonalDataAuthError()(app.js gitHubErrorMessage経由)を実際に発火させる。
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Bad credentials" }) }));
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForTimeout(200);
    await openSettingsGroup(page, "settings-sync");
    await page.click('[data-action="save-github"]');  // 401 → pd-auth-bannerが立つ
    await page.waitForTimeout(500);
    const bannerText = await page.locator(".pd-auth-banner").textContent().catch(() => "");
    check("認証エラーバナーが表示される(前提)", bannerText.includes("設定へ"), bannerText);
    // ここまでで「データと同期」群は手動クリックで開いた状態。バナー経由の自動openを独立して
    // 確認するため、一度手動でcloseしてからバナーをクリックし直す。
    await syncGroupLoc.locator("summary").click();
    await page.waitForTimeout(150);
    check("(前提)いったん手動でcloseできる", await syncGroupLoc.evaluate((el) => el.open) === false);
    await page.click('[data-action="nav"][data-view="today"]');
    await page.waitForTimeout(200);
    await page.click(".pd-auth-banner");
    await page.waitForTimeout(300);
    check("認証エラーバナーからの遷移で「データと同期」群が自動openになる",
      await syncGroupLoc.evaluate((el) => el.open) === true);

    // ============================================================
    // (5) ジャーナル当日パネル: 朝/夜/本文の3details。現在時刻で自動open。本文は常時open
    // ============================================================
    console.log("[5] ジャーナル当日パネル: 10:00(朝)では朝detailsがopen、夜はclosed。本文は常時open");
    await seed({ view: "journal", fixedTime: now0 });
    const morningOpenAt10 = await page.locator(".journal-segment-morning").evaluate((el) => el.open);
    const eveningOpenAt10 = await page.locator(".journal-segment-evening").evaluate((el) => el.open);
    const bodyOpenAt10 = await page.locator(".journal-segment-body").evaluate((el) => el.open);
    check("10:00: 朝detailsはopen", morningOpenAt10 === true, String(morningOpenAt10));
    check("10:00: 夜detailsはclosed", eveningOpenAt10 === false, String(eveningOpenAt10));
    check("10:00: 本文detailsは常時open", bodyOpenAt10 === true, String(bodyOpenAt10));

    console.log("[5b] 20:00(夜)では夜detailsがopen、朝はclosed");
    const evening0 = new Date(now0);
    evening0.setHours(20, 0, 0, 0);
    await seed({ view: "journal", fixedTime: evening0 });
    const morningOpenAt20 = await page.locator(".journal-segment-morning").evaluate((el) => el.open);
    const eveningOpenAt20 = await page.locator(".journal-segment-evening").evaluate((el) => el.open);
    check("20:00: 朝detailsはclosed", morningOpenAt20 === false, String(morningOpenAt20));
    check("20:00: 夜detailsはopen", eveningOpenAt20 === true, String(eveningOpenAt20));
    check("朝detailsがclosedでも廃止された主観睡眠UIはDOM上に存在しない",
      await page.locator('[data-action="set-sleep"]').count() === 0);

    console.log("[5c] 20:00でも朝detailsを手動展開して操作すれば、その後の再描画でも閉じ直らない"
      + "(時刻ベースの再計算だけに頼ると、閉じている側の欄を開いて入力するたびに再render毎に"
      + "巻き戻ってしまう実害があったための回帰確認)");
    const morningSummary = page.locator(".journal-segment-morning summary");
    await morningSummary.click();  // 20:00時点でclosedな朝detailsを手動展開
    await page.waitForTimeout(150);
    check("手動展開直後は朝detailsがopenになる",
      await page.locator(".journal-segment-morning").evaluate((el) => el.open) === true);
    // 温存対象の服薬ボタンをクリックしてsaveAndRender()経由の全体再描画を誘発する
    const stateBefore5c = await stateNow();
    const medsBefore5c = stateBefore5c.condition.logs[stateBefore5c.selectedDate]?.meds ?? null;
    await page.click('[data-action="toggle-meds"]');
    await page.waitForTimeout(200);
    check("再描画後も朝detailsはopenのまま(時刻基準に巻き戻らない)",
      await page.locator(".journal-segment-morning").evaluate((el) => el.open) === true);
    const stateAfter5c = await stateNow();
    check("再描画後も服薬入力は保存されている(温存対象の操作は機能する)",
      stateAfter5c.condition.logs[stateAfter5c.selectedDate]?.meds !== medsBefore5c,
      JSON.stringify(stateAfter5c.condition.logs[stateAfter5c.selectedDate]));

    // ============================================================
    // (6) タイムラインのエネルギー/バッテリー切替。選択状態はstate.settingsに保存されreload後も維持
    // ============================================================
    console.log("[6] タイムラインのエネルギー/バッテリー切替。既定はエネルギー、切替はstate.settingsに保存される");
    const tlBlock = {
      id: "v148-tl-1", taskId: "", date: TODAY, title: "タイムライン確認Block", category: "作業",
      plannedStartAt: `${TODAY}T08:00`, plannedEndAt: `${TODAY}T08:30`,
      actualStartAt: `${TODAY}T08:00`, actualEndAt: `${TODAY}T08:30`,
      completed: true, charge: 5, discharge: 1, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
    await page.evaluate(({ KEY, block, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [block];
      s.tasks = []; s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "timeline";
      delete s.settings.timelineEnergyGraphMode;  // 既定値の検証のため明示的に未設定へ
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, block: tlBlock, TODAY });
    await page.reload();
    await page.waitForTimeout(500);
    check("既定はエネルギーモード(トグルの「エネルギー」がactive)",
      await page.locator('[data-action="tl-energy-mode"][data-mode="energy"].active').count() === 1);
    check("既定表示ではエネルギー系のpolylineが描画される(実線)",
      await page.locator(".energy-svg polyline").count() >= 1);
    check("既定表示ではbattery-curveは出ない(1グラフ1スケール)",
      await page.locator(".battery-curve").count() === 0);
    const stateBeforeToggle = await stateNow();
    check("normalizeStateで既定'energy'が補完される", stateBeforeToggle.settings.timelineEnergyGraphMode === "energy",
      stateBeforeToggle.settings.timelineEnergyGraphMode);

    await page.click('[data-action="tl-energy-mode"][data-mode="battery"]');
    await page.waitForTimeout(300);
    check("切替後はバッテリーモードがactiveになる",
      await page.locator('[data-action="tl-energy-mode"][data-mode="battery"].active').count() === 1);
    check("切替後はbattery-curveが描画される", await page.locator(".battery-curve").count() === 1);
    check("切替後はエネルギー系polylineが消える(重ね描きしない)",
      await page.locator(".energy-svg polyline:not(.battery-curve)").count() === 0);
    const stateAfterToggle = await stateNow();
    check("選択状態がstate.settings.timelineEnergyGraphModeに保存される",
      stateAfterToggle.settings.timelineEnergyGraphMode === "battery", stateAfterToggle.settings.timelineEnergyGraphMode);

    console.log("[6b] reload後も選択状態(バッテリー)が維持される");
    await page.reload();
    await page.waitForTimeout(500);
    check("reload後もバッテリーモードのまま", await page.locator('[data-action="tl-energy-mode"][data-mode="battery"].active').count() === 1);
    check("reload後もbattery-curveが描画される", await page.locator(".battery-curve").count() === 1);

    console.log("[6c] 過去日ではバッテリーモードのままでもエネルギー系列へ強制フォールバックする"
      + "(Codex指摘: batteryPtsが常に空になる過去日で選択がbatteryのままだと空グラフになり、"
      + "復帰手段が無くなる)");
    // v85仕様: 起動時は必ずselectedDateがtodayISO()へ強制される(セッション内のdate-prev/next操作
    // だけは尊重される)ため、localStorage直接書き換え+reloadでは過去日を再現できない。
    // date-prevボタンで実際に移動する。
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(300);
    check("(前提)date-prevで過去日へ移動している", (await stateNow()).selectedDate !== TODAY);
    check("過去日ではトグル選択はバッテリーのままである(設定自体は変更しない)",
      (await stateNow()).settings.timelineEnergyGraphMode === "battery");
    check("過去日ではbattery-curveを描画しない(フォールバック)", await page.locator(".battery-curve").count() === 0);
    check("過去日ではエネルギー系のpolylineが描画される(空グラフにならない)",
      await page.locator(".energy-svg polyline").count() >= 1);
    // 当日へ戻すと選択済みのバッテリーモードの表示に復帰する(設定を書き換えていないことの確認)
    await page.click('[data-action="today"]');
    await page.waitForTimeout(300);
    check("当日へ戻すとbattery-curveの表示に復帰する(設定を書き換えていない証拠)",
      await page.locator(".battery-curve").count() === 1);

    console.log("[6d] compact表示(タスクシュート画面の右レール)ではバッテリーモード選択中でも"
      + "エネルギー系列へ強制フォールバックする(切替UIが無い場所で復帰手段の無い空グラフを防ぐ)");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    check("(前提)選択はバッテリーのまま", (await stateNow()).settings.timelineEnergyGraphMode === "battery");
    const railEnergyOverlay = page.locator("#timelineRail .energy-graph-overlay");
    check("タスクシュート右レールにエネルギーグラフが表示される(compact)", await railEnergyOverlay.count() === 1);
    check("compact表示では切替トグルを出さない(復帰手段が無いのでフォールバックが必要な理由)",
      await page.locator("#timelineRail [data-action=\"tl-energy-mode\"]").count() === 0);
    check("compact表示ではbattery-curveを描画しない(フォールバック)",
      await railEnergyOverlay.locator(".battery-curve").count() === 0);
    check("compact表示ではエネルギー系のpolylineが描画される(空グラフにならない)",
      await railEnergyOverlay.locator("polyline").count() >= 1);

    console.log(failures === 0 ? "\n✅ v148 ALL PASS" : `\n❌ v148: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
