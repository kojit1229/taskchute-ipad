// xss-sanitizer.test.js — review.md:35。Markdown sanitizer(sanitizeHTML、v37導入)は実装済み
// だがXSS否定テストが無かった指摘への対応。
//
// 実際のレンダリング経路(marked.parse → sanitizeHTML → .md-render要素へのinnerHTML代入)を
// 通して、journal/AIフィードバック等ユーザ・外部AI由来のテキストにXSSペイロードを混入させ、
// (a) 実際にJSが実行されない(dialog/pageerror/windowフラグのいずれも観測されない)、
// (b) サニタイズ後のHTML文字列にも危険なマークアップが残らない、の両方を確認する。
//
// v137調査で判明した事実: <svg><script>...</script></svg> や
// style="background:url(javascript:...)" は、本アプリの挿入経路(ライブ要素へのinnerHTML代入)
// では実行されない(innerHTML経由の<script>はHTML仕様上inert化される/現代ブラウザはCSS url()内の
// javascript:を実行しない)ため実XSSではないが、サニタイザの文字列レベルの契約としては穴だった。
// app.jsのsanitizeHTML()を修正済み(BLOCKED_TAGSの大文字化比較・javascript:検知の対象属性拡大)。
// 本テストはその修正の回帰テストを兼ねる。DOMPurifyの同梱は見送り(review.md参照、要K判断)。
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

  let pageErrors = 0;
  page.on("pageerror", (e) => { pageErrors++; console.log("  ⚠ pageerror:", e.message); });
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const PREV = addDaysStr(TODAY, -1);

  // XSS判定用の副作用フラグを窓に立てるペイロード群(script/onerror/javascript:/SVG payload)。
  // 実行されればwindow.__xssN===trueになる。1つでもtrueならreal XSS。
  const XSS_MARKDOWN = `# 見出し(正常なMarkdownの回帰確認)

**太字** と *斜体*、[正常なリンク](https://example.com/) は壊れないこと。

<script>window.__xss1 = true;</script>

<img src="x" onerror="window.__xss2 = true;">

[javascriptリンク](javascript:window.__xss3=true)

<svg><script>window.__xss4 = true;</script></svg>

<svg onload="window.__xss5 = true;"></svg>

<div style="background:url(javascript:window.__xss6=true)">スタイル経由</div>

<iframe src="javascript:window.__xss7=true"></iframe>
`;

  async function seedJournal(text) {
    await page.evaluate(({ KEY, text, TODAY, PREV }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals = s.journals || {};
      s.journals[PREV] = text;
      s.selectedDate = TODAY;
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, text, TODAY, PREV });
    await page.reload();
    await page.waitForTimeout(500);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    console.log("[1] journalの前日パネル(readonly-md)にXSSペイロード入り本文をseedしても実行されない");
    await seedJournal(XSS_MARKDOWN);

    const flags = await page.evaluate(() => ({
      xss1: window.__xss1 === true,
      xss2: window.__xss2 === true,
      xss3: window.__xss3 === true,
      xss4: window.__xss4 === true,
      xss5: window.__xss5 === true,
      xss6: window.__xss6 === true,
      xss7: window.__xss7 === true
    }));
    check("<script>タグが実行されない", !flags.xss1, JSON.stringify(flags));
    check("onerror属性が実行されない", !flags.xss2, JSON.stringify(flags));
    check("javascript:リンクが実行されない(クリックしていない状態でも副作用が無いこと自体は前提。念のため確認)", !flags.xss3, JSON.stringify(flags));
    check("SVG内<script>が実行されない", !flags.xss4, JSON.stringify(flags));
    check("SVGのonload属性が実行されない", !flags.xss5, JSON.stringify(flags));
    check("style内のurl(javascript:)が実行されない", !flags.xss6, JSON.stringify(flags));
    check("iframeのjavascript:srcが実行されない", !flags.xss7, JSON.stringify(flags));
    check("pageerrorが発生していない", pageErrors === 0, `(件数: ${pageErrors})`);
    check("dialog(alert等)が発生していない", dialogs.length === 0, JSON.stringify(dialogs));

    console.log("[2] サニタイズ後のHTML文字列にも危険なマークアップが残らない(サニタイザ自体の契約)");
    const renderedHTML = await page.locator(".md-render.readonly-md").first().innerHTML();
    const lower = renderedHTML.toLowerCase();
    check("<script が残っていない(SVG名前空間含む)", !lower.includes("<script"), renderedHTML.slice(0, 400));
    check("onerror= が残っていない", !lower.includes("onerror"), renderedHTML.slice(0, 400));
    check("onload= が残っていない", !lower.includes("onload"), renderedHTML.slice(0, 400));
    check("javascript: が残っていない(href/style等いずれの属性経由でも)", !lower.includes("javascript:"), renderedHTML.slice(0, 400));
    check("<iframe が残っていない", !lower.includes("<iframe"), renderedHTML.slice(0, 400));

    console.log("[3] 正常なMarkdownは引き続き問題なく描画される(サニタイザ強化の過剰検知が無いことの回帰確認)");
    check("見出しが描画される", renderedHTML.includes("見出し"));
    check("太字が<strong>等で描画される", /<(strong|b)>/.test(lower));
    check("通常のhttpsリンクは残る(hrefが除去されていない)", renderedHTML.includes('href="https://example.com/"') || renderedHTML.includes("href='https://example.com/'"));
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nxss-sanitizer: 全件成功" : `\nxss-sanitizer: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
