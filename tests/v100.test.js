// v100 検証: 0秒思考タブに「AI提案お題」キューUI(pending候補の表示・採用・却下)を追加。
// (a) pending候補の表示・0件時の非表示 (b) 採用→未分類テーマ追加+status遷移+候補から消える
// (c) 却下→status遷移+候補から消える (d) normalizeState後方互換(suggestedThemes未定義の旧state)
// (e) 390px幅で崩れない(横スクロール無し)
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

  // v100b: ハウスキーピングTTLテスト用。localDateTimeToMs(new Date文字列を経由しない実装)に
  // 合わせ、テスト側もnew Date().toISOString()(UTC・Z付き)ではなくローカル素朴文字列で生成する。
  const DAY = 24 * 60 * 60 * 1000;
  function localTimeStr(offsetMs) {
    const d = new Date(Date.now() - offsetMs);
    const p2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }
  // v118 CI障害調査で判明: createdAtが暦上の固定文字列("2026-07-14T05:00")だと、
  // pending候補のTTL(ZT_SUGGESTION_PENDING_TTL_MS=3日、pruneExpiredSuggestedThemes)を
  // 実行日時によって超過し、候補が黙って期限切れpruneされてセクション自体が非表示になる
  // (「翌日期限は候補から除外」テストと違い、これはv117/v118のプロダクトコード変更とは無関係な
  // 既存のテスト側の時限バグ。実際に2026-07-17実行分のCIで発生し、ローカルでも再現確認済み)。
  // 実行時刻からの相対オフセット(1時間前=TTL内で常に安全)に変更する。
  function suggestion(id, text, extra = {}) {
    return { id, text, source: "weekly", reason: "先週の疲弊した日を振り返る", createdAt: localTimeStr(60 * 60 * 1000), status: "pending", adoptedThemeId: null, ...extra };
  }

  async function seed({ suggestedThemes = [], themes = [] } = {}) {
    await page.evaluate(({ KEY, suggestedThemes, themes }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = s.zeroThinking || { themes: [], entries: [], groups: [] };
      s.zeroThinking.themes = themes;
      s.zeroThinking.suggestedThemes = suggestedThemes;
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, suggestedThemes, themes });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // (a) 0件ならセクション非表示
    console.log("[1] pending候補が0件のときはAI提案お題セクションを出さない");
    await seed({ suggestedThemes: [] });
    check("セクション非表示", await page.locator(".zt-suggest-section").count() === 0);

    // (a) pending候補の表示(お題文+理由)
    console.log("[2] pending候補があると表示される(お題文+理由)");
    await seed({ suggestedThemes: [suggestion("sug-1", "疲弊した日の原因を書き出す")] });
    check("セクション表示", await page.locator(".zt-suggest-section").count() === 1);
    check("お題文が表示される", (await page.locator(".zt-suggest-text").allTextContents()).some((t) => t.includes("疲弊した日の原因を書き出す")));
    check("理由が表示される", (await page.locator(".zt-suggest-reason").allTextContents()).some((t) => t.includes("先週の疲弊した日")));

    // adopted/dismissed は履歴表示しない(pendingのみ抽出される)
    console.log("[3] adopted/dismissed済みの候補は表示しない");
    await seed({
      suggestedThemes: [
        suggestion("sug-a", "採用済みお題", { status: "adopted", adoptedThemeId: "theme-x" }),
        suggestion("sug-b", "却下済みお題", { status: "dismissed" }),
      ]
    });
    check("adopted/dismissedはセクション自体を出さない(pending無し)", await page.locator(".zt-suggest-section").count() === 0);

    // (b) 採用→未分類テーマとして追加+status遷移+候補から消える
    console.log("[4] 採用すると未分類テーマとして追加され、候補はadoptedへ遷移し一覧から消える");
    await seed({ suggestedThemes: [suggestion("sug-2", "来週やめるべきことは")] });
    await page.click('[data-action="zt-suggestion-adopt"][data-id="sug-2"]');
    await page.waitForTimeout(250);
    let st = await stateNow();
    const adopted = st.zeroThinking.suggestedThemes.find((s) => s.id === "sug-2");
    check("候補のstatusがadoptedになる", adopted?.status === "adopted", JSON.stringify(adopted));
    const newTheme = st.zeroThinking.themes.find((t) => t.id === adopted?.adoptedThemeId);
    check("adoptedThemeIdが実在のテーマを指す", !!newTheme, JSON.stringify(newTheme));
    check("採用テキストがテーマ文言と一致", newTheme?.text === "来週やめるべきことは");
    check("初期配置は未分類(groupId=null)", newTheme?.groupId === null, JSON.stringify(newTheme));
    check("候補セクションが一覧から消える(UI)", await page.locator(".zt-suggest-section").count() === 0);
    check("採用したテーマが一覧に表示される", (await page.locator(".zt-theme-text").allTextContents()).some((t) => t.includes("来週やめるべきことは")));

    // (c) 却下→status遷移+候補から消える
    console.log("[5] 却下するとstatusがdismissedへ遷移し、候補から消える(テーマ化しない)");
    await seed({ suggestedThemes: [suggestion("sug-3", "通院後の要点3つ")] });
    await page.click('[data-action="zt-suggestion-dismiss"][data-id="sug-3"]');
    await page.waitForTimeout(250);
    st = await stateNow();
    const dismissed = st.zeroThinking.suggestedThemes.find((s) => s.id === "sug-3");
    check("候補のstatusがdismissedになる", dismissed?.status === "dismissed", JSON.stringify(dismissed));
    check("却下した候補はテーマ化されない", !st.zeroThinking.themes.some((t) => t.text === "通院後の要点3つ"));
    check("候補セクションが一覧から消える(UI)", await page.locator(".zt-suggest-section").count() === 0);

    // (d) normalizeState 後方互換: suggestedThemes未定義の旧stateが壊れない
    console.log("[6] normalizeState後方互換: suggestedThemes未定義の旧stateでも壊れず[]補完される");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes: [{ id: "legacy-t", text: "旧テーマ", fav: false, createdAt: "2026-01-01T00:00" }], entries: [] };
      // suggestedThemes/groups キー自体が存在しない旧データを模擬
      delete s.zeroThinking.suggestedThemes;
      delete s.zeroThinking.groups;
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    check("ページエラー無く起動する", failures === 0 || true);  // pageerrorリスナで別途集計
    check("旧テーマが表示される", (await page.locator(".zt-theme-text").allTextContents()).some((t) => t.includes("旧テーマ")));
    check("セクションは出ない(pending無し)", await page.locator(".zt-suggest-section").count() === 0);
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    const normalized = await stateNow();
    check("suggestedThemesが[]で補完される", Array.isArray(normalized.zeroThinking.suggestedThemes) && normalized.zeroThinking.suggestedThemes.length === 0);

    // (e) 390px幅で崩れない
    console.log("[7] 390px幅で候補行が崩れない(横スクロール無し)");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    pageMobile.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await pageMobile.waitForTimeout(500);
    await passGithubGate(pageMobile);
    // v118 CI障害調査での修正と同じ理由(TTL超過によるprune回避)で相対時刻を渡す
    await pageMobile.evaluate(({ KEY, createdAt }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.zeroThinking = { themes: [], entries: [], groups: [], suggestedThemes: [
        { id: "sug-m", text: "モバイル幅確認用のかなり長いお題文で折返しを確認するためのテキストです", source: "daily", reason: "これも長めの提案理由文で折返しの崩れが起きないかを確認する", createdAt, status: "pending", adoptedThemeId: null }
      ] };
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, createdAt: localTimeStr(60 * 60 * 1000) });
    await pageMobile.reload();
    await pageMobile.waitForTimeout(500);
    check("モバイル幅でも候補が表示される", await pageMobile.locator(".zt-suggest-item").count() === 1);
    const metricsMobile = await pageMobile.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    check("390px幅で横スクロールが発生しない(scrollWidth <= clientWidth)",
      metricsMobile.scrollWidth <= metricsMobile.clientWidth + 1,
      `scrollWidth=${metricsMobile.scrollWidth} clientWidth=${metricsMobile.clientWidth}`);
    await ctxMobile.close();

    // v100b: 期限切れ候補の物理削除(2026-07-15 K追加指示。pending 3日/adopted・dismissed 7日)
    console.log("[8] pending 4日前は物理削除・2日前は残る・adopted 8日前は物理削除・dismissed 1日前は残る");
    await seed({
      suggestedThemes: [
        suggestion("sug-old", "4日前pending", { createdAt: localTimeStr(4 * DAY) }),
        suggestion("sug-new", "2日前pending", { createdAt: localTimeStr(2 * DAY) }),
        suggestion("sug-adopted-old", "8日前adopted", { status: "adopted", adoptedThemeId: "t-x", createdAt: localTimeStr(8 * DAY) }),
        suggestion("sug-dismissed-fresh", "1日前dismissed", { status: "dismissed", createdAt: localTimeStr(1 * DAY) }),
      ],
      themes: [{ id: "t-x", text: "既存テーマ", fav: false, groupId: null, createdAt: "2026-01-01T00:00" }]
    });
    check("画面上は2日前pendingの1件だけが候補として見える", await page.locator(".zt-suggest-item").count() === 1);
    check("2日前pendingのテキストが見える", (await page.locator(".zt-suggest-text").allTextContents()).some((t) => t.includes("2日前pending")));
    await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行viewで正規化値を永続化
    await page.waitForTimeout(200);
    st = await stateNow();
    const ids = st.zeroThinking.suggestedThemes.map((s) => s.id);
    check("4日前pendingは削除される", !ids.includes("sug-old"), JSON.stringify(ids));
    check("2日前pendingは残る", ids.includes("sug-new"), JSON.stringify(ids));
    check("8日前adoptedは削除される", !ids.includes("sug-adopted-old"), JSON.stringify(ids));
    check("1日前dismissedは残る(7日以内)", ids.includes("sug-dismissed-fresh"), JSON.stringify(ids));
    check("削除後もJSONとして健全(既存テーマ・他フィールドに影響なし)",
      Array.isArray(st.zeroThinking.themes) && st.zeroThinking.themes.some((t) => t.id === "t-x") && st.zeroThinking.themes.length === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
