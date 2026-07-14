// v74 検証: 読書複利化(reading-compound)をアプリ機能として統合。CHANGES_v74.md参照。
//
// (a) 日次1ハイライト提示: 個人データリポジトリ taskchute/reading/highlights.json から
//     今日の1冊・1ハイライトをホームカードに表示する(書籍が引けなければカード自体を出さない)
// (b) 1行言語化: カード上のテキスト欄+保存ボタンで taskchute/reading/reflections.json へ
//     read-merge-write でpushする。他日のエントリを消さず、同じ日は上書きする
// (c) 永続性: 保存後にリロードしても、reflections.json 経由で言語化がプリフィルされる
// (d) 月次要約: taskchute/reading/summary_YYYY-MM.md があれば週次レビュータブに折りたたみ表示、
//     404ならフェイルソフト(非表示)
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
    console.log("[1] ホームに「今日の1冊から」カードが表示され、書籍・著者・ハイライト本文が出る");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    const homeText = await page.locator("main").textContent();
    check("カード見出し「今日の1冊から」が表示される", homeText.includes("今日の1冊から"), homeText.slice(0, 300));
    check("書籍タイトルが表示される(閉じたdetails内でもDOM上には存在する)", homeText.includes("テスト書籍タイトル_v74"));
    check("著者名が表示される(閉じたdetails内でもDOM上には存在する)", homeText.includes("テスト著者_v74"));
    check("ハイライト本文が表示される(閉じたdetails内でもDOM上には存在する)", homeText.includes("テストハイライト本文_v74"));
    check("言語化欄は保存前は空", await page.locator("[data-reading-reflection-input]").inputValue() === "");
    check("保存ボタンがある", await page.locator('[data-action="reading-save"]').count() === 1);

    // v82(UX監査B3・K承認): 読書カードは常時フル表示だとホームの一等地を占有するため、
    // 既定closedの折りたたみ(homeFoldSection, data-fold-id="home-reading")に縮小した
    // (CHANGES_v82.md参照)。以降の入力操作(fill/click)は要素の可視性を要求するため、
    // ここで一度サマリーをタップして開く(開閉状態はlocalStorageに記憶され、以降のreloadでも開いたまま)。
    console.log("[1b] v82: 読書カードは既定closedの折りたたみ。タップで開くと入力欄が操作できる");
    const readingFold = page.locator('details[data-fold-id="home-reading"]');
    check("既定で閉じている(open属性が無い)", !(await readingFold.evaluate((el) => el.open)));
    await readingFold.locator("summary").click();
    await page.waitForTimeout(150);
    check("タップで開く(open属性が付く)", await readingFold.evaluate((el) => el.open));

    // ============================================================
    // (b) 1行言語化の保存(read-merge-write。他日のエントリを消さない)
    // ============================================================
    console.log("[2] 既存の他日エントリがある状態で、今日の言語化を入力→保存すると、reflections.jsonへマージpushされる");
    fixtures.reflections = {
      entries: [{
        date: OTHER_DAY, bookId: "b0", bookTitle: "別の日の本", author: "別の著者",
        highlightRef: "ref-old", highlightText: "別の日のハイライト", reflection: "前に書いた感想",
        savedAt: `${OTHER_DAY}T08:00:00`
      }]
    };
    fixtures.puts.length = 0;
    await page.fill("[data-reading-reflection-input]", "これは自分の言葉での言語化_v74");
    await page.click('[data-action="reading-save"]');
    await page.waitForTimeout(500);
    const put1 = fixtures.puts.find((p) => p.url.endsWith("/contents/taskchute/reading/reflections.json"));
    check("reflections.jsonがPUTされる", !!put1, JSON.stringify(fixtures.puts.map((p) => p.url)));
    const entries1 = put1 && put1.entries;
    check("PUT内容が配列entriesを持つ", Array.isArray(entries1), JSON.stringify(entries1));
    check("他日(OTHER_DAY)のエントリが保持されている(消えていない)",
      !!entries1 && entries1.some((e) => e.date === OTHER_DAY && e.reflection === "前に書いた感想"),
      JSON.stringify(entries1));
    const todayEntry1 = entries1 && entries1.find((e) => e.date === TODAY);
    check("今日のエントリが追加されている", !!todayEntry1, JSON.stringify(entries1));
    check("今日のエントリのreflectionが入力内容と一致する",
      !!todayEntry1 && todayEntry1.reflection === "これは自分の言葉での言語化_v74", JSON.stringify(todayEntry1));
    check("今日のエントリにbookTitle/highlightTextが記録される",
      !!todayEntry1 && todayEntry1.bookTitle === "テスト書籍タイトル_v74" && todayEntry1.highlightText === "テストハイライト本文_v74",
      JSON.stringify(todayEntry1));
    check("エントリは今日について1件のみ(重複していない)",
      !!entries1 && entries1.filter((e) => e.date === TODAY).length === 1, JSON.stringify(entries1));

    console.log("[3] 保存後、同じ日にもう一度保存すると新規追加ではなく上書きされる(重複しない)");
    fixtures.puts.length = 0;
    await page.fill("[data-reading-reflection-input]", "書き直した言語化_v74");
    await page.click('[data-action="reading-save"]');
    await page.waitForTimeout(500);
    const put2 = fixtures.puts.find((p) => p.url.endsWith("/contents/taskchute/reading/reflections.json"));
    const entries2 = put2 && put2.entries;
    check("上書き後も今日のエントリは1件のみ", !!entries2 && entries2.filter((e) => e.date === TODAY).length === 1, JSON.stringify(entries2));
    check("上書き後のreflectionが最新入力になっている",
      !!entries2 && entries2.find((e) => e.date === TODAY)?.reflection === "書き直した言語化_v74", JSON.stringify(entries2));
    check("他日のエントリは2回目の保存後も保持されている",
      !!entries2 && entries2.some((e) => e.date === OTHER_DAY), JSON.stringify(entries2));

    // ============================================================
    // (b') should-fix: 既存データの読み込みが非404で失敗した場合は保存を中断する
    //      (404と区別できずに空配列から始めてしまうと、reflections.jsonが「今日の1件だけ」に
    //      上書きされ過去の全言語化が消失しうるため)
    // ============================================================
    console.log("[3b] 既存データの読み込みが500で失敗 → 保存を中断し、PUTは送信されない(データ消失を防ぐ)");
    fixtures.puts.length = 0;
    fixtures.reflectionsGetStatus = 500;
    await page.fill("[data-reading-reflection-input]", "読み失敗中に書いた言語化_v74");
    await page.click('[data-action="reading-save"]');
    await page.waitForTimeout(500);
    const putsDuringFailure = fixtures.puts.filter((p) => p.url.endsWith("/contents/taskchute/reading/reflections.json"));
    check("読み込み失敗時はreflections.jsonへのPUTが送信されない", putsDuringFailure.length === 0, JSON.stringify(putsDuringFailure));
    const toastText = await page.locator("#toast").textContent();
    check("保存中止のエラーがトーストで表示される", /保存失敗|保存を中止/.test(toastText || ""), toastText);
    fixtures.reflectionsGetStatus = null;
    const afterFailureText = await page.evaluate(async () => {
      const res = await fetch("https://api.github.com/repos/kojit1229/personal-data/contents/taskchute/reading/reflections.json?ref=main", {
        headers: { "Accept": "application/vnd.github.raw+json" }
      });
      return res.text();
    });
    const afterFailureEntries = JSON.parse(afterFailureText).entries;
    check("read失敗を挟んでも既存の2エントリ(今日+他日)が両方とも保持されている(消失していない)",
      afterFailureEntries.length === 2
        && afterFailureEntries.some((e) => e.date === TODAY && e.reflection === "書き直した言語化_v74")
        && afterFailureEntries.some((e) => e.date === OTHER_DAY),
      JSON.stringify(afterFailureEntries));

    // ============================================================
    // (c) 永続性: リロード後もプリフィルされる
    // ============================================================
    console.log("[4] リロード後、保存済みの言語化がテキスト欄にプリフィルされる");
    await page.reload();
    await page.waitForTimeout(700);
    const reflVal = await page.locator("[data-reading-reflection-input]").inputValue();
    check("リロード後、保存済みの言語化がプリフィルされる", reflVal === "書き直した言語化_v74", reflVal);

    // ============================================================
    // (d) 月次要約: 404フェイルソフト → 表示ありの切り替え
    // ============================================================
    console.log("[5] summary_YYYY-MM.md が404の間は週次レビューに要約セクションが出ない");
    fixtures.summaryMd = null;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "weekly";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    let weeklyText = await page.locator("main").textContent();
    check("要約が無い間は「今月の読書ふりかえり」セクションが出ない", !weeklyText.includes("今月の読書ふりかえり"));

    console.log("[6] summary_YYYY-MM.md がある場合、週次レビューに折りたたみセクションとして中身が出る");
    fixtures.summaryMd = `# ${MONTH}の読書の変化\n\n今月は言語化の習慣が定着してきた_v74マーカー`;
    await page.reload();
    await page.waitForTimeout(700);
    weeklyText = await page.locator("main").textContent();
    check("要約セクションの見出しが表示される", weeklyText.includes("今月の読書ふりかえり"), weeklyText.slice(0, 400));
    check("要約本文(マーカー)が表示される(detailsが閉じていてもDOM上には存在する)",
      weeklyText.includes("今月は言語化の習慣が定着してきた_v74マーカー"));

    // ============================================================
    // (e) highlights.json 404/0冊のフェイルソフト
    // ============================================================
    console.log("[7] highlights.jsonが404の間はホームに読書カードが出ない(クラッシュしない)");
    fixtures.highlightsStatus = 404;
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    const homeText2 = await page.locator("main").textContent();
    check("読書カードの見出しが出ない", !homeText2.includes("今日の1冊から"));
    check("それでもホームの他の要素は表示される(クラッシュしていない)", homeText2.includes("いま、これ"), homeText2.slice(0, 200));

    // ============================================================
    // (f) normalizeState 後方互換
    // ============================================================
    console.log("[8] 読書関連キーが一切無い旧stateでもクラッシュせず起動できる");
    fixtures.highlightsStatus = 200;
    await page.evaluate((KEY) => {
      const legacy = {
        settings: { github: {} },
        pomodoro: { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" },
        projects: [], tasks: [], blocks: [], journals: {}, journalMeta: {},
        feedback: {}, reports: {}, feedbackFiles: [], zeroThinking: { themes: [], entries: [] },
        questions: [], experiments: [], weeklyReviews: {}, cycleReviews: {},
        aiScheduleHistory: [], aiPlanSkippedLog: [], migrationRitualLog: [],
        aiLinkFreshness: {}, aiWorkProcessedIds: [],
        selectedDate: "", currentView: "home", dataModifiedAt: ""
      };
      localStorage.setItem(KEY, JSON.stringify(legacy));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await passGithubGate(page);
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(700);
    check("旧stateでもホームタブが表示される(pageerrorなし)", await page.locator(".nav-button").count() > 0);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
