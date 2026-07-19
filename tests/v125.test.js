// v125 回帰テスト: ビジョンボードPDFを別タブに飛ばさず同一画面内で表示する(CHANGES_v125.md参照)。
// PDFの<object>/<iframe>インライン埋め込み(v85→v101で撤去)には戻さず、事前にページ画像(JPEG)
// 化したものをpersonal-dataリポジトリ taskchute/content/vision-pages/ から取得して<img>で
// 縦スクロール表示する。manifest.json(ページ数・ファイル一覧)を軽量fetchしてから、
// 「読み込む」明示クリックでのみページ画像本体をfetchする(v101の自動fetch禁止・多重fetch防止を踏襲)。
//
// [A] manifest取得 → 「読み込む」クリック → <img>がページ数分表示される(80歳版は5枚、
//     1ページ目から順に差し込まれる=全ページ完了を待たせない)
// [B] manifest.json取得失敗時、従来のPDF別タブ方式(v101)へフォールバック表示される
// [C] ボードタブ切替で選択ボードの画像に切り替わる(ボードごとに独立したキャッシュ・多重fetch防止)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const MANIFEST = {
  "now_vision.pdf": { pages: 1, files: ["now_vision-p01.jpg"], w: 1400, h: 1980 },
  "45_vision.pdf": { pages: 1, files: ["45_vision-p01.jpg"], w: 1400, h: 1980 },
  "80_vision.pdf": {
    pages: 5,
    files: ["80_vision-p01.jpg", "80_vision-p02.jpg", "80_vision-p03.jpg", "80_vision-p04.jpg", "80_vision-p05.jpg"],
    w: 1400, h: 1980
  }
};

// 1x1のJPEGとして十分なダミーバイト列(このテストの関心は取得件数・表示件数であり画像の忠実さではない)
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const FAKE_PDF = Buffer.from("%PDF-1.4\n%v125 fallback pdf stand-in\n");

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());

  // ============================================================
  // [A] + [C] manifest取得成功: 画像ベース表示 + ボード切替
  // ============================================================
  {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

    const jpgRequests = [];
    let manifestRequests = 0;

    await blockGithubApiByDefault(page);
    await page.route((url) => url.hostname === API_HOST, async (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/content/vision-pages/manifest.json")) {
        manifestRequests++;
        return route.fulfill({ status: 200, contentType: "application/vnd.github.raw+json", body: JSON.stringify(MANIFEST) });
      }
      const jpgMatch = p.match(/\/contents\/taskchute\/content\/vision-pages\/(.+\.jpg)$/);
      if (jpgMatch) {
        jpgRequests.push(jpgMatch[1]);
        // 実取得を模して各ページ取得に短い遅延を入れる(進捗差し込み表示の検証に使う)
        await new Promise((r) => setTimeout(r, 120));
        return route.fulfill({ status: 200, contentType: "image/jpeg", body: FAKE_JPEG });
      }
      const pdfMatch = p.match(/\/contents\/taskchute\/content\/(.+\.pdf)$/);
      if (pdfMatch) return route.fulfill({ status: 200, contentType: "application/pdf", body: FAKE_PDF });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    try {
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForTimeout(400);
      await passGithubGate(page);

      console.log("[A] manifest取得 → 「読み込む」クリック → 選択ボードのページ数だけ<img>が表示される");
      await page.click('[data-action="nav"][data-view="vision"]');
      await page.click('[data-action="vision-section"][data-section="board"]');
      // manifest.jsonの軽量fetchが完了し、「読み込む」ボタン(画像版)が出るまで待つ
      await page.waitForSelector('[data-action="vision-board-load-images"]', { timeout: 5000 });
      check("manifest.jsonは1回だけfetchされた", manifestRequests === 1, String(manifestRequests));
      check("旧PDF別タブ方式のボタンには落ちていない(画像版の「読み込む」ボタンが出ている)",
        await page.locator('[data-action="vision-board-load-images"][data-file="now_vision.pdf"]').count() === 1);
      check("画像自体はまだfetchされていない(明示クリックまでfetchしない)", jpgRequests.length === 0, JSON.stringify(jpgRequests));

      await page.click('[data-action="vision-board-load-images"][data-file="now_vision.pdf"]');
      await page.waitForFunction(
        () => document.querySelectorAll(".vision-page img").length === 1,
        { timeout: 5000 }
      );
      check("今(33歳)ボードは1枚の<img>が表示される", await page.locator(".vision-page img").count() === 1);
      check("<object>/<iframe>は一切使われていない(v101の教訓どおり)",
        (await page.locator("object, iframe").count()) === 0);

      console.log("[C] 80歳タブへ切替 → まだ未読み込み(今ボードのキャッシュとは独立) → 読み込むと5枚差し込まれる");
      await page.click('[data-action="vision-board-tab"][data-index="2"]');
      await page.waitForTimeout(150);
      check("80歳タブに切替直後は今ボードの画像が引き継がれず、未読み込み状態(読み込むボタン)に戻る",
        await page.locator('[data-action="vision-board-load-images"][data-file="80_vision.pdf"]').count() === 1);
      check("80歳タブへ切替直後はまだ80歳分の画像はfetchされていない",
        !jpgRequests.some((f) => f.startsWith("80_vision")), JSON.stringify(jpgRequests));

      await page.click('[data-action="vision-board-load-images"][data-file="80_vision.pdf"]');
      // 1ページ目から順に差し込まれる: 全5枚が揃う前に1枚以上表示されているタイミングがあるはず
      await page.waitForFunction(
        () => document.querySelectorAll(".vision-page img").length >= 1,
        { timeout: 5000 }
      );
      const midCount = await page.locator(".vision-page img").count();
      check("80歳ボード読み込み中、全ページ完了を待たずに一部だけでも表示され始める(1ページ目から順次差し込み)",
        midCount >= 1 && midCount < 5, `mid=${midCount}`);

      await page.waitForFunction(
        () => document.querySelectorAll(".vision-page img").length === 5,
        { timeout: 5000 }
      );
      check("80歳ボードは最終的に5枚すべて<img>で表示される", await page.locator(".vision-page img").count() === 5);
      check("80歳ボードのページ画像5枚すべてfetchされた",
        ["01", "02", "03", "04", "05"].every((n) => jpgRequests.includes(`80_vision-p${n}.jpg`)), JSON.stringify(jpgRequests));

      console.log("[C-2] 今ボードへ戻ると再fetchせず、キャッシュ済みの1枚がそのまま表示される");
      const jpgCountBeforeReturn = jpgRequests.length;
      await page.click('[data-action="vision-board-tab"][data-index="0"]');
      await page.waitForTimeout(150);
      check("今ボードへ戻ると即座にキャッシュ済みの1枚が表示される(読み込むボタンには戻らない)",
        await page.locator(".vision-page img").count() === 1);
      check("今ボードへ戻っても画像は再fetchされない(1ファイル1回のキャッシュ)",
        jpgRequests.length === jpgCountBeforeReturn, `${jpgCountBeforeReturn} -> ${jpgRequests.length}`);

      console.log("[C-3] 補助導線「原本PDFを別タブで開く」は画像版UIの下に控えめに残っている");
      check("原本PDFへの補助リンク/ボタンが画像版UI内に存在する",
        await page.locator(".vision-pdf-fallback-link").count() === 1);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  // ============================================================
  // [B] manifest.json取得失敗 → 従来のPDF別タブ方式(v101)へフォールバック
  // ============================================================
  {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

    await blockGithubApiByDefault(page);
    await page.route((url) => url.hostname === API_HOST, (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      // manifest.jsonを含め、personal-data配下の全リクエストを404にする(未画像化を模す)
      if (p.endsWith("/contents/taskchute/content/vision-pages/manifest.json")) {
        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      }
      const pdfMatch = p.match(/\/contents\/taskchute\/content\/(.+\.pdf)$/);
      if (pdfMatch) return route.fulfill({ status: 200, contentType: "application/pdf", body: FAKE_PDF });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    try {
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForTimeout(400);
      await passGithubGate(page);

      console.log("[B] manifest.json取得失敗時は従来のPDF別タブ方式(v101)へフォールバック表示される");
      await page.click('[data-action="nav"][data-view="vision"]');
      await page.click('[data-action="vision-section"][data-section="board"]');
      // manifest.json取得の失敗判定(404)を待ってフォールバックUIに切り替わるのを待つ
      await page.waitForSelector('[data-action="vision-board-load"]', { timeout: 5000 });
      check("画像版の「読み込む」ボタンではなく、旧PDF方式の「このPDFを読み込む」ボタンが出る",
        await page.locator('[data-action="vision-board-load"]').count() === 1);
      check("画像版のボタン(vision-board-load-images)は出ていない",
        await page.locator('[data-action="vision-board-load-images"]').count() === 0);

      await page.click('[data-action="vision-board-load"]');
      await page.waitForFunction(
        () => document.querySelector('.vision-actions a[href^="blob:"]') !== null,
        { timeout: 5000 }
      );
      check("フォールバック方式でも「別タブで開く」のBlob URLリンクが表示される(v101と同じ挙動)",
        await page.locator('.vision-actions a[href^="blob:"]').count() === 1);
      check("<object>/<iframe>は使われていない(フォールバック時も同様)",
        (await page.locator("object, iframe").count()) === 0);
      check(".vision-pages(画像版コンテナ)は描画されていない", await page.locator(".vision-pages").count() === 0);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  // ============================================================
  // [D] v125追補(Codex P2対応): 一部ページのfetch失敗 → 「再読み込み」ボタンが出る →
  //     再試行(モックを成功に切替済み)で画像が表示される。全滅時もビューが固まらないことも確認する。
  // ============================================================
  {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

    let nowPageAttempts = 0;  // now_vision-p01.jpg への試行回数(1回目は失敗させ、2回目以降は成功させる)

    await blockGithubApiByDefault(page);
    await page.route((url) => url.hostname === API_HOST, (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p.endsWith("/contents/taskchute/content/vision-pages/manifest.json")) {
        return route.fulfill({ status: 200, contentType: "application/vnd.github.raw+json", body: JSON.stringify(MANIFEST) });
      }
      if (p.endsWith("/contents/taskchute/content/vision-pages/now_vision-p01.jpg")) {
        nowPageAttempts++;
        if (nowPageAttempts === 1) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return route.fulfill({ status: 200, contentType: "image/jpeg", body: FAKE_JPEG });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    try {
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForTimeout(400);
      await passGithubGate(page);

      console.log("[D] ページ画像fetch失敗 → 「再読み込み」ボタン表示 → 再試行で画像が表示される");
      await page.click('[data-action="nav"][data-view="vision"]');
      await page.click('[data-action="vision-section"][data-section="board"]');
      await page.waitForSelector('[data-action="vision-board-load-images"]', { timeout: 5000 });
      await page.click('[data-action="vision-board-load-images"][data-file="now_vision.pdf"]');

      // 今(33歳)ボードは1ページのみ=全ページ失敗のケースを兼ねる。
      // 「読み込み中...」に固定表示されず、再読み込みボタンへ切り替わることを確認する
      // (Codex P2指摘: in-flightフラグのクリア前に最終renderが走り固まっていた問題)。
      await page.waitForSelector('[data-action="vision-board-retry-images"]', { timeout: 5000 });
      check("1回目のfetchが失敗し、1回だけリクエストされた", nowPageAttempts === 1, String(nowPageAttempts));
      check("失敗ページは<img>ではなく再読み込みボタンで表示される",
        await page.locator('[data-action="vision-board-retry-images"][data-file="now_vision.pdf"]').count() === 1);
      check("失敗後は「読み込み中...」表示のまま固まっていない(全ページ失敗でもビューが更新される)",
        await page.locator(".vision-page-placeholder:not(.vision-page-failed)").count() === 0);
      check("失敗した画像の<img>はまだ存在しない", await page.locator(".vision-page img").count() === 0);

      await page.click('[data-action="vision-board-retry-images"][data-file="now_vision.pdf"]');
      await page.waitForFunction(
        () => document.querySelectorAll(".vision-page img").length === 1,
        { timeout: 5000 }
      );
      check("再試行でfetchが再度発生し(計2回)、成功する", nowPageAttempts === 2, String(nowPageAttempts));
      check("再試行成功後は<img>が表示される", await page.locator(".vision-page img").count() === 1);
      check("再試行成功後は再読み込みボタンが消える",
        await page.locator('[data-action="vision-board-retry-images"]').count() === 0);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  await browser.close();
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
