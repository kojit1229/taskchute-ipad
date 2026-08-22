// v160 検証: AI機能第4弾「言い訳ハンター」(K発注仕様
// workbench/out/2026-07-27-taskchute-ai5/spec.md 機能4)。CHANGES_v160.md参照。
//
// v157(今日の敵)/v158(勝手に格言)/v159(未来からの手紙)と異なり、本機能はK発注仕様が
// 「表示は既存フィードバック導線に相乗りのみ(ホーム導線は作らない=淡々と)」と明記して
// いるため、アプリ側の変更は AI_REPORT_TYPES への1エントリ追加のみ(ホームカード・
// hydrateStaticMarkdown直接fetch・union防御等はv159で追加されたものだが、本機能では
// 意図的に作っていない)。そのためテストは既存のAIレポートビューア機構(v138のindex経由
// 一覧・本文表示ロジック)が新しい種類「言い訳レポート」に対しても正しく機能することの
// 確認に絞る。
//
// [1] AIレポート画面の種類タブに「言い訳レポート」が追加される(タブ表示)
// [2] 選択するとreport-index.json経由で言い訳レポート_*.mdの履歴一覧が日付降順(新しい順)で
//     表示され、他kind/他prefixのファイルは混ざらない(一覧・kind判定)
// [3] 既定選択(最新)の本文が表示される(本文)
// [4] 一覧から別の日付を選ぶと、その日付の本文に切り替わる(本文の再フェッチ)
// [5] ホーム画面には本機能専用の新規導線・新規カードは存在しない(K発注仕様「ホーム導線は
//     作らない」の直接検証。v159の`open-future-letter`のような専用data-actionが無いこと)
// [6] 公開Pages側(同一オリジン)への言い訳レポート_*.mdへのfetchは一切発生しない
//     (同一オリジンfetch回帰の防止、v157/v158/v159と同じ観点)
//
// 方針: v138.test.js(AIレポートindex経由の一覧・本文)+ v159.test.jsの[1]相当部分と
// 同じ作法を踏襲する(ホームカード部分〈[2]〜[4]、[6]〉は本機能に無いため対象外)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const API_HOST = "api.github.com";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

const toUtcIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const freshGeneratedAt = () => toUtcIso(new Date());

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
  const OLDER_DATE = "2026-07-14";
  // v157/v158/v159.test.jsと同じ流儀: 実際のバッチ生成物(private/personal-data)の逐語ではなく、
  // 完全に架空・テスト専用の本文にする(公開repoにprivate生成物の文面を置かない原則)。
  const LATEST_BODY = "配線検証用の架空の言い訳レポート本文(最新)_v160テスト。実際のバッチ生成物とは無関係。";
  const OLDER_BODY = "配線検証用の架空の言い訳レポート本文(過去分)_v160テスト。実際のバッチ生成物とは無関係。";

  // [6]用: 公開Pages側(同一オリジン)への言い訳レポート_*.mdへのリクエストを全て記録する
  const sameOriginRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}/`) && /言い訳レポート_/.test(decodeURIComponent(url))) {
      sameOriginRequests.push(url);
    }
  });

  let reportIndexFixture = null;  // null=404、オブジェクト=report-index.jsonの中身
  const bodyFixtures = {};        // { "言い訳レポート_YYYY-MM-DD.md": "本文" }
  const bodyRequests = [];
  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);

    if (/\/contents\/taskchute\/report-index\.json$/.test(p)) {
      if (reportIndexFixture === null) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportIndexFixture) });
    }

    const anyMdMatch = p.match(/\/contents\/taskchute\/([^/]+\.md)$/);
    if (anyMdMatch) {
      bodyRequests.push(anyMdMatch[1]);
      if (Object.prototype.hasOwnProperty.call(bodyFixtures, anyMdMatch[1])) {
        return route.fulfill({ status: 200, contentType: "text/markdown", body: bodyFixtures[anyMdMatch[1]] });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function seedAiReports(typeId = "excuse") {
    await page.evaluate(({ KEY, typeId }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "ai-reports";
      s.settings.aiReportType = typeId;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, typeId });
    await page.reload();
    await page.waitForTimeout(600);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1]〜[3] タブ表示・一覧(kind判定含む)・本文
    // ============================================================
    console.log("[1]〜[3] AIレポート画面の『言い訳レポート』タブでreport-index.json経由の履歴一覧・本文が表示される");
    reportIndexFixture = {
      generatedAt: freshGeneratedAt(),
      files: [
        { name: `言い訳レポート_${TODAY}.md`, date: TODAY, kind: "excuse" },
        { name: `言い訳レポート_${OLDER_DATE}.md`, date: OLDER_DATE, kind: "excuse" },
        // kind判定の混入防止確認用デコイ: 同じ日付帯だが別prefix/別kindのファイル
        { name: `未来からの手紙_2026-07.md`, date: "2026-07", kind: "letter" },
        { name: `コンテンツ総括_${OLDER_DATE}.md`, date: OLDER_DATE, kind: "content" },
        { name: `週次レビュー_${TODAY}.md`, date: TODAY, kind: "weekly" }
      ]
    };
    bodyFixtures[`言い訳レポート_${TODAY}.md`] = LATEST_BODY;
    bodyFixtures[`言い訳レポート_${OLDER_DATE}.md`] = OLDER_BODY;
    await seedAiReports("excuse");

    const tabLabels = await page.$$eval(".segmented button", (els) => els.map((e) => e.textContent.trim()));
    check("種類タブに『言い訳レポート』が存在する", tabLabels.includes("言い訳レポート"), JSON.stringify(tabLabels));

    await page.click(".segmented button:has-text('言い訳レポート')");
    await page.waitForTimeout(300);

    const options = await page.$$eval("[data-ai-report-date] option", (els) => els.map((e) => e.value));
    check("言い訳レポートタブの履歴がindex由来で2件・新しい順に並び、他kind(letter/content/weekly)は混ざらない",
      JSON.stringify(options) === JSON.stringify([TODAY, OLDER_DATE]), `(実際: ${JSON.stringify(options)})`);

    const mdText = await page.textContent("#main .md-render");
    check("既定選択(最新)の本文が表示される", mdText.includes(LATEST_BODY), `(実際: ${mdText.slice(0, 120)})`);

    // ============================================================
    // [4] 一覧から別の日付を選ぶと、その日付の本文に切り替わる
    // ============================================================
    console.log("[4] 一覧から過去分の日付を選ぶと本文が切り替わる");
    await page.selectOption("[data-ai-report-date]", OLDER_DATE);
    await page.waitForTimeout(400);
    const mdTextOlder = await page.textContent("#main .md-render");
    check("過去分選択後、その日付の本文に切り替わる", mdTextOlder.includes(OLDER_BODY), mdTextOlder.slice(0, 120));

    // ============================================================
    // [5] ホーム画面には本機能専用の新規導線・新規カードが無い(K発注仕様「ホーム導線は作らない」)
    // ============================================================
    console.log("[5] ホーム画面に『言い訳』関連の専用導線が無い(ホーム導線を作らない契約の直接検証)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    // v230: home自体が撤去されたため旧viewはtodayへフォールバックする。

    // レビュー対応(推奨修正6): 以前は「0件であること」だけを見ており、ホーム(内省側)タブが
    // そもそも正しく描画されていない場合でも同じく0件になるため判定に実質的な意味が無かった
    // (同語反復)。まず実際に描画されている既存要素(「AIから」カードのラベル)が存在することを
    // 確認し、描画が生きている前提のもとで「言い訳」専用要素が0件であることを確認する構成に
    // 差し替える(陽性側の確認が無いと、陰性側の「0件」は描画崩壊による見せかけの陽性でも
    // 同じ結果になってしまうため)。
    const atisCount = await page.locator(".sec-atis").count();
    check("前提: 現行today/TOWERが実際に描画されている", atisCount === 1, String(atisCount));

    const excuseActionCount = await page.locator('[data-action*="excuse"]').count();
    check("data-action名に'excuse'を含む要素(専用導線)が0件", excuseActionCount === 0, String(excuseActionCount));
    const homeMainHtml = await page.$eval("#main", (el) => el.innerHTML).catch(() => "");
    check("現行todayの描画内容(#main)に『言い訳レポートが届いています』の専用文言が無い",
      !homeMainHtml.includes("言い訳レポートが届いています"), String(homeMainHtml.includes("言い訳レポートが届いています")));

    // ============================================================
    // [6] 公開Pages側(同一オリジン)への言い訳レポート_*.mdのfetchは一切発生しない
    // ============================================================
    console.log("[6] 公開Pages側(同一オリジン)への言い訳レポート_*.mdへのfetchは一度も発生しない");
    check("同一オリジンでの言い訳レポート_*.mdへのリクエストが0件(すべてapi.github.com経由)",
      sameOriginRequests.length === 0, JSON.stringify(sameOriginRequests));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
