// 回帰テスト(コード変更なし・調査結果の裏取り): K報告「ビジョンPDFが参照できない」の
// 仮説原因(GitHub Contents APIの1MB制限)をapp.jsの実装で検証する。
//
// 現物調査の結論: fetchGitHubRawBlob(app.js:9710、v85)/fetchGitHubRawResult(app.js:9681、
// kind="blob")は Accept: application/vnd.github.raw+json を使っており、このメディアタイプは
// 1〜100MBのファイルでもraw bytesをそのまま返す(サイズによる分岐が不要な設計、v85で導入済み)。
// tests/v85.test.jsは小さなfixture PDFで一般ケースを検証済みだが、「1MB超でも同じ経路で
// 問題なく取得できる」ことを明示する回帰テストが無かったため、これを追加する
// (see also: tests/github-state-blob-fallback.test.js = app-state.json側の1MB超フォールバック)。
//
// [1] ビジョンPDF(1MB超の実サイズを模したバイナリ)がraw+json経由でBlob URL化して表示できる。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
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

  // 1.5MB のダミーPDF(実ファイルの45_vision.pdf/80_vision.pdf相当のサイズ感を模す)
  const FAKE_LARGE_PDF = Buffer.concat([
    Buffer.from("%PDF-1.4\n%fake large vision pdf for v93 fallback test\n"),
    Buffer.alloc(1.5 * 1024 * 1024, 0x41)  // 'A' で埋めた1.5MB
  ]);
  const pdfRequests = [];

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const pdfMatch = p.match(/\/contents\/taskchute\/content\/(.+\.pdf)$/);
    if (pdfMatch) {
      pdfRequests.push(p);
      return route.fulfill({ status: 200, contentType: "application/pdf", body: FAKE_LARGE_PDF });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(400);
    await passGithubGate(page);  // token/dataOwner/dataRepo投入 + reload

    console.log("[1] 1MB超のビジョンPDFがpersonal-data Contents API(raw+json)経由でBlob化して表示される");
    await page.click('[data-action="nav"][data-view="vision"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="vision-section"][data-section="board"]');
    await page.waitForTimeout(800);  // 1.5MBのBlob取得+再renderを待つ

    check("personal-data Contents APIへ1.5MB相当のPDFのリクエストが飛んでいる", pdfRequests.length > 0, JSON.stringify(pdfRequests));
    const frameData = await page.locator(".vision-pdf-frame").getAttribute("data").catch(() => null);
    check("1.5MB相当のPDFでもBlob URL化されて<object>のsrcに反映される(公開URL './xxx.pdf' ではない)",
      !!frameData && frameData.startsWith("blob:"), String(frameData));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
