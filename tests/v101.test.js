// v101 回帰テスト: K報告「PCブラウザでビジョンタブを開くと毎回固まる」の修正確認。
// 原因(CHANGES_v101.md参照): タブ切替のたびに自動fetch+<object>への無条件インライン埋め込み。
// 修正: 「読み込む」ボタンの明示クリックでのみfetchし、取得後は<object>ではなく実アンカー
// (<a target="_blank">)で別タブに開かせる(重いPDF描画をSPA本体のタブから完全に分離)。
//
// [1] タブを開いただけでは自動fetchされない(オンデマンド化の確認)
// [2] 「読み込む」ボタンをクリックすると1回だけfetchされ、blob URLの<a href>に切り替わる
// [3] 同じファイルを再度開いても再fetchしない(1ファイル1回のキャッシュ維持)
// [4] 未クリックの他タブは一切fetchされない(3ファイル同時取得なし)
// [5] 18MB相当の大容量PDFが絡む一連の操作(タブ切替→読み込む→別タブ表示待ち)がN秒以内に応答する
// [6] 「別タブで開く」の実アンカーをクリックすると実際に新しいタブ(popup)が開く(<object>を使わない)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const API_HOST = "api.github.com";
const RESPONSE_BUDGET_MS = 5000;  // N秒以内に応答することの基準値(スタブ環境なので余裕を持たせる)

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// 実データの80_vision.pdf(約18MB)相当のダミーPDF。中身は単純パターンで埋めるだけで十分
// (このテストの関心はfetch回数・応答性であり、PDFの中身の忠実な再現ではない)。
function buildLargePdf(sizeBytes) {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n%v101 large vision pdf stand-in\n"),
    Buffer.alloc(sizeBytes, 0x41)
  ]);
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const SMALL_PDF = buildLargePdf(3.5 * 1024 * 1024);   // now_vision.pdf / 45_vision.pdf 相当
  const LARGE_PDF = buildLargePdf(18 * 1024 * 1024);    // 80_vision.pdf 実測相当(約18MB)
  const pdfRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const m = p.match(/\/contents\/taskchute\/content\/(.+\.pdf)$/);
    if (m) {
      pdfRequests.push(m[1]);
      const body = m[1] === "80_vision.pdf" ? LARGE_PDF : SMALL_PDF;
      return route.fulfill({ status: 200, contentType: "application/pdf", body });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);

    console.log("[1] ビジョンボードタブを開いただけでは自動fetchされない(オンデマンド化)");
    const tNavStart = Date.now();
    await page.click('[data-action="nav"][data-view="vision"]');
    await page.click('[data-action="vision-section"][data-section="board"]');
    await page.waitForTimeout(300);
    check("タブを開いただけではPDFのfetchが発生しない", pdfRequests.length === 0, JSON.stringify(pdfRequests));
    check("<object>タグは使わなくなっている(インライン埋め込みを撤去)", await page.locator("object.vision-pdf-frame").count() === 0);
    const loadBtn = page.locator('[data-action="vision-board-load"]');
    check("代わりに「読み込む」ボタンが出る", await loadBtn.count() === 1);
    check("タブを開いてからここまでN秒以内に応答", Date.now() - tNavStart < RESPONSE_BUDGET_MS, `${Date.now() - tNavStart}ms`);

    console.log("[2] 「読み込む」ボタンをクリックすると1回だけfetchされ、別タブで開くリンクに切り替わる");
    const tClick0 = Date.now();
    await loadBtn.click();
    await page.waitForSelector('.vision-actions a[data-action]:not([data-action]), .vision-actions a[href^="blob:"]', { timeout: RESPONSE_BUDGET_MS }).catch(() => {});
    // ボタン→リンク切替をポーリング確認(N秒以内)
    await page.waitForFunction(
      () => document.querySelector('.vision-actions a[href^="blob:"]') !== null,
      { timeout: RESPONSE_BUDGET_MS }
    );
    const tReady = Date.now();
    check(`読み込みクリックから別タブリンク表示までN秒(${RESPONSE_BUDGET_MS}ms)以内に応答`, tReady - tClick0 < RESPONSE_BUDGET_MS, `${tReady - tClick0}ms`);
    check("now_vision.pdf(index0、既定タブ)が1回だけfetchされた", pdfRequests.filter((f) => f === "now_vision.pdf").length === 1, JSON.stringify(pdfRequests));
    const href = await page.locator('.vision-actions a[href^="blob:"]').getAttribute("href");
    check("別タブで開くリンクがblob URLになっている", !!href && href.startsWith("blob:"), String(href));

    console.log("[3] 同じファイルを再度開いても再fetchしない(1ファイル1回のキャッシュ)");
    await page.click('[data-action="vision-section"][data-section="vision"]');
    await page.waitForTimeout(150);
    await page.click('[data-action="vision-section"][data-section="board"]');
    await page.waitForTimeout(300);
    check("再度ビジョンボードを開いてもnow_vision.pdfは再fetchされない(依然1回のまま)",
      pdfRequests.filter((f) => f === "now_vision.pdf").length === 1, JSON.stringify(pdfRequests));
    check("再訪時は最初から「別タブで開く」リンクが表示される(キャッシュ再利用)",
      await page.locator('.vision-actions a[href^="blob:"]').count() === 1);

    console.log("[4] 未クリックの他タブ(45歳/80歳)は一切fetchされない(3ファイル同時取得なし)");
    check("45_vision.pdfは未fetch", !pdfRequests.includes("45_vision.pdf"), JSON.stringify(pdfRequests));
    check("80_vision.pdf(18MB相当)は未fetch", !pdfRequests.includes("80_vision.pdf"), JSON.stringify(pdfRequests));

    console.log("[5] 18MB相当の80歳タブへ切替→読み込む→別タブリンク表示までN秒以内に応答する");
    await page.click('[data-action="vision-board-tab"][data-index="2"]');
    await page.waitForTimeout(100);
    check("80歳タブに切替直後は未読み込み状態(読み込むボタン)", await page.locator('[data-action="vision-board-load"][data-file="80_vision.pdf"]').count() === 1);
    const t80Click = Date.now();
    await page.click('[data-action="vision-board-load"][data-file="80_vision.pdf"]');
    await page.waitForFunction(
      () => document.querySelector('.vision-actions a[href^="blob:"]') !== null,
      { timeout: RESPONSE_BUDGET_MS }
    );
    const t80Ready = Date.now();
    check(`18MB相当PDF読み込み→別タブリンク表示までN秒(${RESPONSE_BUDGET_MS}ms)以内`, t80Ready - t80Click < RESPONSE_BUDGET_MS, `${t80Ready - t80Click}ms`);
    check("80_vision.pdfが1回だけfetchされた", pdfRequests.filter((f) => f === "80_vision.pdf").length === 1, JSON.stringify(pdfRequests));
    // 操作応答性の直接確認: 読み込み完了後、他のUI操作(タブ切替)が即座に反映される
    const tSwitchBack = Date.now();
    await page.click('[data-action="vision-board-tab"][data-index="0"]');
    await page.waitForSelector('[data-action="vision-board-tab"][data-index="0"].active', { timeout: 2000 });
    check("読み込み完了後もUI操作(タブ切替)が即座に反映される(固まっていない)", Date.now() - tSwitchBack < 2000, `${Date.now() - tSwitchBack}ms`);

    console.log("[6] 「別タブで開く」の実アンカーをクリックすると実際に新しいタブが開く(<object>不使用)");
    await page.click('[data-action="vision-board-tab"][data-index="2"]');
    await page.waitForTimeout(150);
    check("<object>タグはページ内のどこにも存在しない(インライン埋め込み完全撤去)", await page.locator("object").count() === 0);
    const [popup] = await Promise.all([
      ctx.waitForEvent("page", { timeout: RESPONSE_BUDGET_MS }),
      page.click('.vision-actions a[href^="blob:"]')
    ]);
    check("別タブで開くリンクのクリックで実際に新しいタブが開く", !!popup);
    if (popup) {
      const popupUrl = popup.url();
      check("開いた新しいタブのURLがblob:である(公開URLへのフォールバックではない)", popupUrl.startsWith("blob:"), popupUrl);
      await popup.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
