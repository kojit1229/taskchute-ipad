// v138 検証: AIレポート履歴一覧の索引JSON化(review.md:31、K承認済み)。CHANGES_v138.md参照。
//
// アプリのAIレポートビューアは従来、personal-data/taskchute/直下をGitHub Contents APIで
// 1回の一覧取得していたが、公式上限(1ディレクトリ1000件)に日報等の蓄積で近づくリスクが
// あった。loop側の決定論バッチ(report-index-build.py)が生成する taskchute/report-index.json
// (契約はFORMAT_CONTRACT.md参照)を、アプリ側で「まずindexをfetch→無ければ従来のContents API
// ディレクトリ一覧へフォールバック」の2段構成にした(fetchReportIndex/triggerAiReportDirLoad)。
//
// [1] report-index.jsonが存在する環境: それだけで履歴一覧が構築され、ディレクトリ一覧API
//     (/contents/taskchute への直接GET)は一切飛ばない
// [2] report-index.jsonが存在しない(404)環境: 従来どおりディレクトリ一覧APIへフォールバックし、
//     v92までと同じ挙動で履歴一覧が構築される(後方互換)
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// v140(Codexレビュー High-1 (ii)): report-index.jsonのgeneratedAtが現在から48時間を超えて
// 古い場合は不採用にする検証をfetchReportIndexへ追加した。本ファイルは元々generatedAtを
// 固定の日付文字列("2026-07-22T00:00:00Z"等)でハードコードしていたが、実行時の実時刻から
// 48時間以上離れると本テスト自体が(意図せず)鮮度切れで失敗するようになるため、実行時刻を
// 基準に動的に生成する(Node.js側のテストコードなのでtoISOString()の利用はapp.js側の
// 「new Date(string)禁止」ルール=iOS Safari対策の対象外)。
const toUtcIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const freshGeneratedAt = () => toUtcIso(new Date());

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  // report-index.json fixture(null = 404扱い)。従来のディレクトリ一覧(DIR_LIST)・本文(BODIES)も
  // v92と同じ形で用意し、2つの経路がそれぞれ独立に正しく機能することを確認する。
  let reportIndexFixture = null;
  const DIR_LIST = [
    { name: "コンテンツ総括_2026-07-14.md", path: "taskchute/コンテンツ総括_2026-07-14.md", type: "file" },
    { name: "コンテンツ総括_2026-04-01.md", path: "taskchute/コンテンツ総括_2026-04-01.md", type: "file" },
    { name: "自己分析_2026-07.md", path: "taskchute/自己分析_2026-07.md", type: "file" },
    { name: "content", path: "taskchute/content", type: "dir" }
  ];
  const BODIES = {
    "コンテンツ総括_2026-07-14.md": "# コンテンツ総括 2026-07-14\n\n最新の総括本文(index経由)。",
    "コンテンツ総括_2026-04-01.md": "# コンテンツ総括 2026-04-01\n\n古い方の総括本文。"
  };

  let dirListRequests = 0;
  let reportIndexRequests = 0;
  const bodyRequests = [];
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    reportIndexRequests++;
    if (reportIndexFixture === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndexFixture) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute$/.test(url.pathname), (route) => {
    dirListRequests++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DIR_LIST) });
  });
  await page.route((url) => url.hostname === "api.github.com" && /\/contents\/taskchute\/[^/]+$/.test(decodeURIComponent(url.pathname)) && !/report-index\.json$/.test(decodeURIComponent(url.pathname)), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const name = p.split("/").pop();
    bodyRequests.push(name);
    if (BODIES[name] !== undefined) {
      route.fulfill({ status: 200, contentType: "application/json", body: BODIES[name] });
    } else {
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  async function gotoAiReports() {
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = "content";  // 前のシナリオでタブを切り替えていても既定タブへ揃える
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(600);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] report-index.jsonが存在する環境: indexだけで履歴一覧が構築される
    // ============================================================
    console.log("[1] report-index.jsonが存在する場合、それだけで履歴一覧が構築され、ディレクトリ一覧APIは飛ばない");
    reportIndexFixture = {
      generatedAt: freshGeneratedAt(),
      files: [
        { name: "コンテンツ総括_2026-07-14.md", date: "2026-07-14", kind: "content" },
        { name: "コンテンツ総括_2026-04-01.md", date: "2026-04-01", kind: "content" },
        { name: "自己分析_2026-07.md", date: "2026-07", kind: "self" },
        { name: "AIフィードバック_2026-07-21.md", date: "2026-07-21", kind: "feedback" }
      ]
    };
    await gotoAiReports();

    check("report-index.jsonへのfetchが通知hydrate分を含め3回飛んだ", reportIndexRequests === 3, `(実際: ${reportIndexRequests})`);
    check("ディレクトリ一覧API(/contents/taskchute)は1回も飛んでいない", dirListRequests === 0, `(実際: ${dirListRequests})`);

    let options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("コンテンツ総括の履歴がindex由来で新しい順に2件並ぶ(AIフィードバックは別prefixなので混ざらない)",
      JSON.stringify(options) === JSON.stringify(["2026-07-14", "2026-04-01"]), `(実際: ${JSON.stringify(options)})`);

    let mdText = await page.textContent("#main .md-render");
    check("既定選択(最新)の本文がindex経由で表示される", mdText.includes("最新の総括本文(index経由)"), `(実際: ${mdText.slice(0, 80)})`);

    await page.click('[data-action="ai-report-type"][data-type="self"]');
    await page.waitForTimeout(300);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("自己分析タブもindex由来で1件表示される(月次=YYYY-MM形式)", JSON.stringify(options) === JSON.stringify(["2026-07"]), `(実際: ${JSON.stringify(options)})`);

    // ============================================================
    // [2] report-index.jsonが存在しない(404)環境: 従来のContents APIへフォールバック
    // ============================================================
    console.log("[2] report-index.jsonが存在しない(404)場合、従来のディレクトリ一覧APIへフォールバックする");
    reportIndexFixture = null;
    dirListRequests = 0;
    reportIndexRequests = 0;
    bodyRequests.length = 0;
    await gotoAiReports();

    check("report-index.jsonへのfetchが通知hydrate分を含め2回試みられる(404)", reportIndexRequests === 2, `(実際: ${reportIndexRequests})`);
    check("indexが無いためディレクトリ一覧APIへフォールバックする", dirListRequests === 1, `(実際: ${dirListRequests})`);

    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("フォールバック経路でも従来どおり履歴一覧が構築される(コンテンツ総括2件)",
      JSON.stringify(options) === JSON.stringify(["2026-07-14", "2026-04-01"]), `(実際: ${JSON.stringify(options)})`);

    mdText = await page.textContent("#main .md-render");
    check("フォールバック経路でも本文が正しく表示される", mdText.includes("最新の総括本文(index経由)"), `(実際: ${mdText.slice(0, 80)})`);
    check("フォールバック経路の本文取得はContents API経由(通常のGET)", bodyRequests.includes("コンテンツ総括_2026-07-14.md"), `(実際: ${JSON.stringify(bodyRequests)})`);

    // ============================================================
    // [3] 「一覧を更新」ボタンでも2段フォールバックが毎回正しく機能する(index復活を検知)。
    //     v140(Codexレビュー High-1 (iii)): 手動更新は必ずContents API listingも取得し
    //     indexとname単位でunionするようになったため、期待値を更新した(仕様変更に伴う
    //     テスト追随。挙動が実際に変わったことの反映であり弱体化ではない)。
    // ============================================================
    console.log("[3] 「一覧を更新」後にindexが復活していれば再度indexが試みられ、Contents APIとunionされる");
    reportIndexFixture = {
      generatedAt: freshGeneratedAt(),
      files: [{ name: "コンテンツ総括_2026-07-14.md", date: "2026-07-14", kind: "content" }]
    };
    reportIndexRequests = 0;
    dirListRequests = 0;
    await page.click('[data-action="ai-report-refresh"]');
    await page.waitForTimeout(600);
    check("更新後、indexが復活していれば再度indexが試みられる", reportIndexRequests === 1, `(実際: ${reportIndexRequests})`);
    check("v140: 手動更新は必ずContents APIも取得する(union対象)", dirListRequests === 1, `(実際: ${dirListRequests})`);
    options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("v140: indexの1件とContents APIの2件がname単位でunionされる(重複する2026-07-14は1件のまま)",
      JSON.stringify(options) === JSON.stringify(["2026-07-14", "2026-04-01"]), `(実際: ${JSON.stringify(options)})`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv138: 全件成功" : `\nv138: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
