// v74 検証: 読書複利化(reading-compound)をアプリ機能として統合。CHANGES_v74.md参照。
//
// (a) 日次1ハイライト提示: 個人データリポジトリ taskchute/reading/highlights.json から
//     今日の1冊・1ハイライトをホームカードに表示する(書籍が引けなければカード自体を出さない)
// (b) 1行言語化: カード上のテキスト欄+保存ボタンで taskchute/reading/reflections.json へ
//     read-merge-write でpushする。他日のエントリを消さず、同じ日は上書きする
// (c) 永続性: 保存後にリロードしても、reflections.json 経由で言語化がプリフィルされる
// (d) 月次要約: 廃止(2026-08-22)。週次レビュータブ自体が仕様削除済み
//     (slim-spec.md §1-1)で表示先が無く、readingMonthlySummarySectionHTML()も
//     呼び出し元を失っている(app.js側の整理漏れの可能性。詳細は別途報告)
// (e) highlights.json が404/0冊でもホームがクラッシュしない
// (f) normalizeState 後方互換: 読書機能は永続state項目を追加していないため、
//     読書関連キーが一切無い旧stateでもクラッシュせず起動できる
//
// 方針: 既存スイートと同じく、app.js は type="module" のため内部関数は window に露出しない。
// ブラウザ操作 + page.route(api.github.com の偽装)で観測する。
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
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const MONTH = TODAY.slice(0, 7);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const OTHER_DAY = addDaysStr(TODAY, -3);

  // 単一の書籍・単一のハイライトにしておく(dateHashSeed mod 1 は常に0なので、
  // アプリ側の選定ロジックの実装詳細に依存せず「必ずこれが選ばれる」ことを保証できる)
  const HIGHLIGHTS_FIXTURE = {
    generatedAt: "2026-07-10T00:00:00Z",
    books: [{
      id: "b1",
      title: "テスト書籍タイトル_v74",
      author: "テスト著者_v74",
      count: 1,
      highlights: [{ ref: "ref-1", text: "テストハイライト本文_v74", location: 42 }]
    }]
  };

  // 可変フィクスチャ(既定は全て404/空)
  const fixtures = {
    highlightsStatus: 200,
    reflections: null,          // null=404、そうでなければ {entries:[...]} をそのまま返す
    reflectionsGetStatus: null, // 非null時はGETをこのstatus(例: 500)で強制応答する(read失敗のシミュレート用)
    summaryMd: null,             // null=404
    puts: []                    // { url, method, entries(decoded) } の記録
  };

  function decodePutBody(body) {
    try {
      const payload = JSON.parse(body);
      const text = Buffer.from(payload.content, "base64").toString("utf-8");
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  await blockGithubApiByDefault(page);
  await page.route((url) => url.hostname === API_HOST, (route) => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    const p = decodeURIComponent(u.pathname);

    if (p.endsWith("/contents/taskchute/reading/highlights.json")) {
      if (fixtures.highlightsStatus !== 200) return route.fulfill({ status: fixtures.highlightsStatus, body: "not found" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HIGHLIGHTS_FIXTURE) });
    }
    if (p.endsWith("/contents/taskchute/reading/reflections.json")) {
      if (method === "PUT") {
        const decoded = decodePutBody(route.request().postData());
        fixtures.puts.push({ url: u.toString(), method, entries: decoded ? decoded.entries : null });
        // 直後のGETで反映を確認できるよう、書き込み内容をフィクスチャへ反映する
        fixtures.reflections = decoded;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-test" } }) });
      }
      if (fixtures.reflectionsGetStatus !== null) {
        return route.fulfill({ status: fixtures.reflectionsGetStatus, contentType: "application/json", body: JSON.stringify({ message: "Internal Server Error" }) });
      }
      if (fixtures.reflections === null) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtures.reflections) });
    }
    if (/\/contents\/taskchute\/reading\/summary_.*\.md$/.test(p)) {
      if (fixtures.summaryMd === null) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: fixtures.summaryMd });
    }
    // Vision/Affirmation/AIフィードバック/AIプラン/週次レビュー/AI作業結果/app-state.json 等
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a) 日次1ハイライト提示
    // ============================================================
    // v230: home完全撤去に伴い読書カード/言語化入力も描画導線ごと削除。
    console.log("[1-8] v230: 旧読書UIの不存在と旧state起動互換");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      s.readingReflections = { "2026-07-27": "既存の言語化" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    check("旧読書カード・入力・保存導線は描画されない",
      await page.locator('[data-fold-id="home-reading"], [data-reading-reflection], [data-action="save-reading-reflection"]').count() === 0);
    check("旧home viewはtodayへフォールバックする", await page.locator('#app[data-view="today"]').count() === 1);
    check("旧stateでも現行ナビとTOWERが起動する",
      await page.locator(".nav-button").count() > 0 && await page.locator(".sec-atis").count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
