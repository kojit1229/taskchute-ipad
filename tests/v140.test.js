// v140 検証: 2系統レビュー(Claude reviewer=PASS軽微、Codexレビュー=High1+Med3+Low2)対応。
// CHANGES_v140.md参照。本ファイルはHigh-1(report-indexの鮮度・破損・手動更新)とMed-3
// (compositionend欠落時の永久延期フェイルセーフ)を検証する。Med-2はtests/v137.test.jsの
// 既存IMEシナリオを仕様精緻化に合わせて更新済み。Low-5/Low-6はtests/xss-sanitizer.test.js
// に追加済み。Med-4(並行run間のポート帯衝突回避)はrun-all.js単体の帯計算を手元で確認
// (帯選択が20000〜38000の1000刻み19通りから一様に選ばれること、TEST_PORT_BASE経由でスイート
// 側のrandomPort()が正しく基底を反映することを確認済み。ブラウザテストの対象ではないため
// 自動テストファイルには含めない)。
//
// [1] 破損index(files配列の要素が全てstring型nameを持たない)→ Contents APIへフォールバック
// [2] 古いindex(generatedAtが48時間超過)→ Contents APIへフォールバック
// [3] 手動「一覧を更新」時はindexとContents API listingの両方を取得し、name単位でunionする
//
// Med-3(compositionend欠落時のフェイルセーフ)は後続コミットで同ファイルへ追記する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  // テストコード(Node.js側)でのfixture組み立てのみに使う。V8はnew Date(string)の解釈に
  // iOS Safariのような曖昧さが無いため、ここでのtoISOString()利用はapp.js側の
  // 「new Date(string)禁止」ルール(iOS Safari対策)の対象外(ブラウザ実行コードではない)。
  const toUtcIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const freshGeneratedAt = toUtcIso(new Date(now0.getTime() - 1 * 60 * 60 * 1000));   // 1時間前(鮮度OK)
  const staleGeneratedAt = toUtcIso(new Date(now0.getTime() - 50 * 60 * 60 * 1000));  // 50時間前(48h超過)

  let reportIndexFixture = null;  // null=404
  let dirListFixture = [];
  const bodyRequests = [];
  let dirListRequests = 0;
  let reportIndexRequests = 0;

  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    reportIndexRequests++;
    if (reportIndexFixture === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndexFixture) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    dirListRequests++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dirListFixture) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/[^/]+$/.test(decodeURIComponent(url.pathname)) && !/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const name = p.split("/").pop();
    bodyRequests.push(name);
    route.fulfill({ status: 200, contentType: "application/json", body: `# ${name}\n\n本文(${name})。` });
  });

  async function gotoAiReports() {
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "content";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] High-1(i): 破損index(files配列の要素がstring型nameを持たない)→ フォールバック
    // ============================================================
    console.log("[1] files配列が壊れているindex(有効な要素0件)は不採用にし、Contents APIへフォールバックする");
    reportIndexFixture = { generatedAt: freshGeneratedAt, files: [{ notName: "x" }, { name: 123 }, {}] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-10.md", path: "taskchute/コンテンツ総括_2026-07-10.md", type: "file" }];
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("report-index.jsonへのfetchが試みられる", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("有効な要素が無いためContents APIへフォールバックする", dirListRequests === 1, `(実際: ${dirListRequests})`);
    let options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("フォールバック経由でContents APIの内容が表示される", JSON.stringify(options) === JSON.stringify(["2026-07-10"]), JSON.stringify(options));

    // ============================================================
    // [2] High-1(ii): 古いindex(generatedAtが48時間超過)→ フォールバック
    // ============================================================
    console.log("[2] generatedAtが現在から48時間超過しているindexは不採用にし、Contents APIへフォールバックする");
    reportIndexFixture = { generatedAt: staleGeneratedAt, files: [{ name: "コンテンツ総括_2026-07-01.md", date: "2026-07-01", kind: "content" }] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-15.md", path: "taskchute/コンテンツ総括_2026-07-15.md", type: "file" }];
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("report-index.jsonへのfetchが試みられる", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("48時間超過のためContents APIへフォールバックする", dirListRequests === 1, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("古いindexの内容(2026-07-01)ではなくContents APIの内容(2026-07-15)が表示される",
      JSON.stringify(options) === JSON.stringify(["2026-07-15"]), JSON.stringify(options));

    // ============================================================
    // [3] High-1(iii): 手動「一覧を更新」はindexとContents APIをunionする
    // ============================================================
    console.log("[3] 通常表示はindexのみだが、「一覧を更新」ではContents APIも取得しname単位でunionする");
    reportIndexFixture = { generatedAt: freshGeneratedAt, files: [{ name: "コンテンツ総括_2026-07-20.md", date: "2026-07-20", kind: "content" }] };
    dirListFixture = [{ name: "コンテンツ総括_2026-07-19.md", path: "taskchute/コンテンツ総括_2026-07-19.md", type: "file" }];  // indexには無い当日追加分を想定
    reportIndexRequests = 0; dirListRequests = 0;
    await gotoAiReports();
    check("通常表示はindexのみで構築される(Contents APIは飛ばない)", dirListRequests === 0, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("通常表示はindexの1件のみ", JSON.stringify(options) === JSON.stringify(["2026-07-20"]), JSON.stringify(options));

    reportIndexRequests = 0; dirListRequests = 0;
    await page.click('[data-action="ai-report-refresh"]');
    await page.waitForTimeout(700);
    check("「一覧を更新」ではreport-index.jsonも再取得される", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("「一覧を更新」ではContents APIも取得される(union対象)", dirListRequests === 1, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("index(07-20)とContents API(07-19)がunionされ新しい順に2件並ぶ",
      JSON.stringify(options) === JSON.stringify(["2026-07-20", "2026-07-19"]), JSON.stringify(options));
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv140: 全件成功" : `\nv140: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
