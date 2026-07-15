// v85 検証: 2件。CHANGES_v85.md参照。
//
// [A] K報告「ビジョンボードが見れない」の回帰確認。
//   原因(現物調査): renderVisionBoard() が45/80/nowの各PDFを `./now_vision.pdf` という
//   同一オリジン相対パスのまま<object>のsrcに使っていた。しかしv72の個人データ分離移行で
//   これらのPDFはtaskchute-ipadリポジトリ(GitHub Pages配信の同一オリジン)から
//   personal-dataリポジトリ(taskchute/content/配下、private、GitHub Contents API経由)へ
//   移されており、同一オリジンには存在しない = 常に404で見れなくなっていた。
//   Vision.md/Daily_Affirmation.mdは同じv72移行時にfetchGitHubRawText経由へ直っていたが、
//   PDF側だけ旧実装が取り残されていた。
//   修正: fetchGitHubRawBlob(personal-data Contents API、Accept:raw+jsonでバイナリ取得)→
//   Blob URL化して<object data="blob:...">に埋め込む。取得できるまでは埋め込まない
//   (壊れたsrcを一瞬でも出さない)。
//
// [B] 「各タブは基本的に今日を表示」機能追加。
//   (a) 起動時は永続化された selectedDate を無視し、常に todayISO() から始まる。
//   (b) 日をまたいでのフォアグラウンド復帰(runDailyOpenのisNewDay検知)でも今日へリセットする。
//   (c) セッション中にユーザーが日付ピッカー等で意図的に移動した場合は、日をまたがない限り尊重する。
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
  now0.setHours(10, 0, 0, 0);  // 日中固定(深夜跨ぎでTODAY判定がズレるのを防ぐ。他スイートと同じ理由)
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const PAST = addDaysStr(TODAY, -5);
  const TOMORROW = addDaysStr(TODAY, 1);

  // ---- ビジョンボードPDF/Vision.md/Daily_Affirmation.mdのfixture(personal-data Contents API) ----
  const FAKE_PDF = Buffer.from("%PDF-1.4\n%fake vision pdf for v85 test\n");
  const visionApiRequests = [];   // api.github.comへのvision関連contentsリクエスト(パス記録)
  const sameOriginRequests = [];  // 同一オリジン(公開URL)への全リクエスト(否定アサーション用)

  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(`http://localhost:${PORT}`)) sameOriginRequests.push(u);
  });

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    const contentMatch = p.match(/\/contents\/taskchute\/content\/(.+)$/);
    if (contentMatch) {
      visionApiRequests.push(p);
      const name = contentMatch[1];
      if (name === "Vision.md") return route.fulfill({ status: 200, contentType: "text/markdown", body: "# Vision\n\nv85テスト用ビジョン本文" });
      if (name === "Daily_Affirmation.md") return route.fulfill({ status: 200, contentType: "text/markdown", body: "# Affirmation\n\nv85テスト用アファメーション" });
      if (name.endsWith(".pdf")) return route.fulfill({ status: 200, contentType: "application/pdf", body: FAKE_PDF });
      return route.fulfill({ status: 404, body: "not found (test-fixture)" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  function setDatePicker(dateStr) {
    return page.evaluate((d) => {
      const el = document.querySelector("[data-date-picker]");
      el.value = d;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, dateStr);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [A] ビジョンボード: personal-data API経由でPDFが表示される + 公開URLへのfetchが無い
    // ============================================================
    // v101: フリーズ対策で自動fetch+<object>インライン埋め込みを撤去し、「読み込む」ボタンの
    // 明示クリックでのみfetch→取得後は<a href="blob:...">(別タブで開く)に切り替わる形へ変更した
    // (CHANGES_v101.md参照)。以下はその新UXに合わせて検証する。
    console.log("[A1] ビジョンタブ→ビジョンボードで、「読み込む」クリック後にpersonal-data Contents API経由でPDFが読み込まれる");
    await page.click('[data-action="nav"][data-view="vision"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="vision-section"][data-section="board"]');
    await page.waitForTimeout(200);
    check("ボードタブを開いただけではPDFはまだfetchされない(v101オンデマンド化。Vision.md/Daily_Affirmation.mdは無関係の既存挙動なので対象外)",
      !visionApiRequests.some((p) => p.endsWith(".pdf")), JSON.stringify(visionApiRequests));
    await page.click('[data-action="vision-board-load"]');
    await page.waitForTimeout(600);  // Blob取得+再renderを待つ

    const linkHref = await page.locator('.vision-actions a[href^="blob:"]').getAttribute("href").catch(() => null);
    check("ビジョンボードの「別タブで開く」リンクがBlob URL化されている(公開URL './xxx.pdf' ではない)",
      !!linkHref && linkHref.startsWith("blob:"), String(linkHref));
    check("personal-data Contents APIへnow_vision.pdfのリクエストが実際に飛んでいる",
      visionApiRequests.some((p) => p.endsWith("/content/now_vision.pdf")), JSON.stringify(visionApiRequests));

    console.log("[A2] 45歳/80歳タブへ切り替えて「読み込む」をクリックすると、それぞれpersonal-data経由でBlob化される");
    await page.click('[data-action="vision-board-tab"][data-index="1"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="vision-board-load"]');
    await page.waitForTimeout(600);
    const linkHref45 = await page.locator('.vision-actions a[href^="blob:"]').getAttribute("href").catch(() => null);
    check("45歳タブもBlob URL化される", !!linkHref45 && linkHref45.startsWith("blob:"), String(linkHref45));
    check("personal-data Contents APIへ45_vision.pdfのリクエストが飛んでいる",
      visionApiRequests.some((p) => p.endsWith("/content/45_vision.pdf")), JSON.stringify(visionApiRequests));

    console.log("[A3] (否定アサーション) 同一オリジン(公開URL)へビジョン系PDF/mdのfetchが一切発生していない");
    const publicVisionHits = sameOriginRequests.filter((u) =>
      /now_vision\.pdf|45_vision\.pdf|80_vision\.pdf|\/Vision\.md|Daily_Affirmation\.md/.test(u));
    check("公開URL(GitHub Pages相当の同一オリジン)へのvision系リクエストは0件",
      publicVisionHits.length === 0, JSON.stringify(publicVisionHits));

    // ============================================================
    // [B1] 起動時は永続化された過去日を無視し、常に「今日」から始まる
    // ============================================================
    console.log("[B1] 過去日を選択したまま(永続化された)状態でも、再起動(reload)後は今日が選択される");
    await page.evaluate(({ KEY, PAST }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.selectedDate = PAST;  // 「前回セッションで過去日を見たまま離脱した」を模す
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, PAST });
    await page.reload();
    await page.waitForTimeout(500);
    const afterRestart = await stateNow();
    check("再起動後、localStorageのselectedDateは永続値(過去日)ではなく今日に強制されている",
      afterRestart.selectedDate === TODAY, afterRestart.selectedDate);
    // v85注記: ホームのヘッダーには常時表示の「今日へ」ボタンが別にあるため(押せば今日に戻せる導線)、
    // 「今日を見ている間は隠れる」条件付きボタン(renderDateBar側、.datebar内)で確認する
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(150);
    const todayBtnCount = await page.locator('.datebar [data-action="today"]').count();
    check("再起動後の画面も日付バーの『今日へ』ボタンが出ない(=今日を見ている)", todayBtnCount === 0);

    // ============================================================
    // [B2] セッション中にユーザーが意図的に日付移動した場合は、そのまま尊重される
    // ============================================================
    console.log("[B2] セッション中に日付ピッカーで過去日へ移動した場合、タブ切替(再描画)しても維持される");
    await setDatePicker(PAST);
    await page.waitForTimeout(200);
    let picked = await page.locator("[data-date-picker]").inputValue();
    check("日付ピッカー操作直後、selectedDateが過去日になっている", picked === PAST, picked);

    // 別タブへ切り替えて戻ってくる(setViewはselectedDateに触らないことの確認)
    await page.click('[data-action="nav"][data-view="tasks"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(150);
    picked = await page.locator("[data-date-picker]").inputValue();
    check("タブを行き来しても、意図的に選んだ過去日がリセットされずに維持される(セッション中は尊重)",
      picked === PAST, picked);

    // 以降の検証のため今日へ戻す
    await setDatePicker(TODAY);
    await page.waitForTimeout(200);

    // ============================================================
    // [B3] 日をまたいだフォアグラウンド復帰では、閲覧中の日付が今日へリセットされる
    // ============================================================
    console.log("[B3] 日をまたいでのvisibilitychange復帰では、選択中の日付が新しい今日へリセットされる");
    // セッション中の意図的な過去日移動を再現(まだ日はまたいでいない)
    await setDatePicker(PAST);
    await page.waitForTimeout(200);
    picked = await page.locator("[data-date-picker]").inputValue();
    check("日跨ぎ前: 過去日移動がまだ維持されている(前提確認)", picked === PAST, picked);

    // 時刻を翌日の日中へ進めてからフォアグラウンド復帰を発火する
    const tomorrow0 = new Date(now0.getTime() + 24 * 60 * 60 * 1000);
    await page.clock.setFixedTime(tomorrow0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400);
    const afterDayCross = await stateNow();
    check("日をまたいだ復帰後、selectedDateが新しい今日(翌日)へ自動でリセットされている",
      afterDayCross.selectedDate === TOMORROW, afterDayCross.selectedDate);
    const todayBtnAfterCross = await page.locator('.datebar [data-action="today"]').count();
    check("日跨ぎリセット後は日付バーの『今日へ』ボタンが出ない(=新しい今日を見ている)", todayBtnAfterCross === 0);

    await page.clock.setFixedTime(now0);  // 後片付け(念のため基準時刻に戻す)
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
