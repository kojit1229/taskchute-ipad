// v151 検証: ダークモード既定化(K指示2026-07-27)。CHANGES_v151.md参照。
//
// (A) 既定dark適用: 初回起動(localStorage空)でstate.settings.theme==="dark"に補完され、
//     <html data-theme="dark">が付く。meta[name=theme-color]もダーク値になる。
// (B) 設定「表示・タイマー」群のテーマselectでlight/autoに切替でき、選択はlocalStorageへ
//     永続化される(reload後も維持)。
// (C) auto選択時はOSのprefers-color-scheme(page.emulateMedia)に追従し、data-theme/
//     meta[theme-color]がOS設定変化に応じて切り替わる。
// (D) マイグレーション後方互換: 旧state(settings.themeキーが無い)はnormalizeStateで"dark"に
//     補完される。既に有効な値("light")を持つ既存stateはそのまま尊重される。不正値は"dark"に補正。
// (E) 2系統レビュー対応(必須1): 0秒思考「AI提案」タグは「問い」タグと同じ.zt-theme-qtagクラス
//     だけを持ち(独自style属性・背景paint無し)、実際に描画された文字色×実効背景色のコントラストが
//     ダーク既定で4.5:1以上になる。
// (F) 2系統レビュー対応(必須4/8): app.jsをroute.abort()で完全に遮断しても、index.htmlの
//     起動時同期スクリプト単独でdata-theme="dark"+meta[theme-color]="#111216"になる
//     (フラッシュ防止経路がapp.js非依存であることの独立検証)。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  async function themeInfo() {
    return page.evaluate((KEY) => {
      const cs = getComputedStyle(document.documentElement);
      let stateTheme = null;
      try { stateTheme = JSON.parse(localStorage.getItem(KEY)).settings.theme; } catch { /* noop */ }
      return {
        dataTheme: document.documentElement.getAttribute("data-theme"),
        bg: cs.getPropertyValue("--bg").trim(),
        metaThemeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "",
        stateTheme
      };
    }, KEY);
  }

  try {
    // ============================================================
    // (A) 既定dark適用(初回起動、localStorage空)
    // ============================================================
    console.log("[A] 初回起動は既定でダーク(state.settings.theme==='dark'、<html data-theme=dark>)");
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    let info = await themeInfo();
    check("state.settings.themeが既定'dark'に補完される", info.stateTheme === "dark", JSON.stringify(info));
    check("<html data-theme='dark'>が付いている", info.dataTheme === "dark", JSON.stringify(info));
    check("--bgがダーク背景値(#111216)になっている", info.bg.toLowerCase() === "#111216", JSON.stringify(info));
    check("meta[theme-color]がダーク値になっている", info.metaThemeColor.toLowerCase() === "#111216", JSON.stringify(info));

    await passGithubGate(page);
    await page.route((url) => url.hostname === "api.github.com" && url.pathname.includes("/contents/taskchute/app-state.json"),
      (route) => {
        const body = JSON.stringify({ dataModifiedAt: "2000-01-01T00:00:00", currentView: "home", selectedDate: "2000-01-01", blocks: [], projects: [], tasks: [], settings: {} });
        const content = Buffer.from(body, "utf-8").toString("base64");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-startup-mock", content, encoding: "base64" }) });
      });

    // ============================================================
    // (B) 設定画面のテーマselect(light/dark/auto)+永続化
    // ============================================================
    console.log("[B] 設定「表示・タイマー」群のテーマselectでlight/darkを切り替えられ、reload後も維持される");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    await openSettingsGroup(page, "settings-display");

    const themeSelect = page.locator('select[data-setting-field="theme"]');
    check("テーマselectが1個描画されている", await themeSelect.count() === 1);
    check("初期選択値が'dark'", await themeSelect.inputValue() === "dark", await themeSelect.inputValue());

    await themeSelect.selectOption("light");
    await page.waitForTimeout(200);
    info = await themeInfo();
    check("light選択後、<html data-theme='light'>になる", info.dataTheme === "light", JSON.stringify(info));
    check("light選択後、--bgがライト背景値(#f7f7fa)になる", info.bg.toLowerCase() === "#f7f7fa", JSON.stringify(info));
    check("light選択後、meta[theme-color]がライト値になる", info.metaThemeColor.toLowerCase() === "#f7f7fa", JSON.stringify(info));
    check("light選択がlocalStorageへ永続化される", info.stateTheme === "light", JSON.stringify(info));

    await page.reload();
    await page.waitForTimeout(500);
    info = await themeInfo();
    check("reload後もlight選択が維持される(data-theme)", info.dataTheme === "light", JSON.stringify(info));
    check("reload後もlight選択が維持される(state.settings.theme)", info.stateTheme === "light", JSON.stringify(info));
    await openSettingsGroup(page, "settings-display");
    check("reload後、テーマselectの表示値も'light'のまま",
      await page.locator('select[data-setting-field="theme"]').inputValue() === "light",
      await page.locator('select[data-setting-field="theme"]').inputValue());

    // ============================================================
    // (C) auto選択時はOSのprefers-color-schemeに追従する
    // ============================================================
    console.log("[C] auto選択時、OSのprefers-color-scheme変化に追従する(page.emulateMedia)");
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator('select[data-setting-field="theme"]').selectOption("auto");
    await page.waitForTimeout(200);
    info = await themeInfo();
    check("auto選択直後、OS=lightならdata-theme='light'", info.dataTheme === "light", JSON.stringify(info));
    check("auto選択はstate.settings.themeに'auto'として保存される(実解決値'light'は書き込まない)",
      info.stateTheme === "auto", JSON.stringify(info));

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    info = await themeInfo();
    check("OSをdarkへ切り替えると(reload無し)data-theme='dark'に追従する", info.dataTheme === "dark", JSON.stringify(info));
    check("追従後もmeta[theme-color]がダーク値に更新される", info.metaThemeColor.toLowerCase() === "#111216", JSON.stringify(info));

    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(300);
    info = await themeInfo();
    check("OSをlightへ戻すとdata-theme='light'に追従し戻る", info.dataTheme === "light", JSON.stringify(info));

    // dark選択に戻す(以降のケースに影響させないため)
    await page.locator('select[data-setting-field="theme"]').selectOption("dark");
    await page.waitForTimeout(200);
    await page.emulateMedia({ colorScheme: null });

    // ============================================================
    // (D) マイグレーション後方互換
    // ============================================================
    console.log("[D] normalizeStateのマイグレーション: 旧stateはtheme未設定→'dark'補完。既存の有効値('light')は尊重。不正値は'dark'に補正");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.settings.theme;  // v151以前の旧state相当(themeキー自体が無い)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    info = await themeInfo();
    check("theme未設定の旧stateはnormalizeStateで'dark'へ補完される", info.stateTheme === "dark", JSON.stringify(info));

    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.theme = "light";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    info = await themeInfo();
    check("既存の有効な値('light')はnormalizeStateで上書きされず尊重される", info.stateTheme === "light", JSON.stringify(info));

    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.theme = "sepia";  // 不正値(将来ゴミデータ・手動編集ミス等を想定)
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    info = await themeInfo();
    check("不正な値は'dark'へ補正される", info.stateTheme === "dark", JSON.stringify(info));

    // ============================================================
    // (E) 2系統レビュー対応(必須1): 0秒思考「AI提案」タグのAA適合
    // ============================================================
    console.log("[E] 0秒思考「AI提案」タグが「問い」タグと同じ.zt-theme-qtagのみ(独自style無し)で、ダーク既定で4.5:1以上");
    // この時点でstate.settings.themeは前段(D)で'dark'。0秒思考タブへ、AI提案由来のテーマ1件+
    // 問い紐づき1件を仕込む。
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "zero";
      s.settings.zeroTab = "theme";
      s.zeroThinking = s.zeroThinking || { themes: [], entries: [], groups: [], suggestedThemes: [] };
      s.zeroThinking.themes = [
        { id: "v151-zt-ai", text: "AI提案タグのAAテスト", fav: false, questionId: null, createdAt: "2026-07-27T09:00", source: "ai-feedback" },
        { id: "v151-zt-q", text: "問いタグのAAテスト", fav: false, questionId: "v151-q1", createdAt: "2026-07-27T09:00", source: null }
      ];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);

    const aiTagLocator = page.locator(".zt-theme-item").filter({ hasText: "AI提案タグのAAテスト" }).locator(".zt-theme-qtag");
    check("AI提案タグが描画されている", await aiTagLocator.count() === 1);
    const aiTagOuterHTML = await aiTagLocator.evaluate((el) => el.outerHTML);
    check("AI提案タグは独自style属性を持たない(背景paint廃止)", !/style\s*=/.test(aiTagOuterHTML), aiTagOuterHTML);
    const aiTagClass = await aiTagLocator.evaluate((el) => el.className);
    check("AI提案タグのclassNameが'zt-theme-qtag'ちょうど", aiTagClass === "zt-theme-qtag", aiTagClass);

    const qTagLocator = page.locator(".zt-theme-item").filter({ hasText: "問いタグのAAテスト" }).locator(".zt-theme-qtag");
    check("比較対象の「問い」タグも描画されている", await qTagLocator.count() === 1);

    async function effectiveContrastRatio(locator) {
      return locator.evaluate((el) => {
        function relLuminanceFromRgb(r, g, b) {
          const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        }
        function parseRgb(str) {
          const m = /rgba?\(([^)]+)\)/.exec(str || "");
          if (!m) return null;
          const parts = m[1].split(",").map((s) => parseFloat(s));
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length === 4 ? parts[3] : 1 };
        }
        const fg = parseRgb(getComputedStyle(el).color);
        let node = el, bg = null;
        while (node) {
          const c = parseRgb(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0.98) { bg = c; break; }
          node = node.parentElement;
        }
        if (!bg) bg = { r: 255, g: 255, b: 255 };  // 最終フォールバック(通常到達しない)
        const L1 = relLuminanceFromRgb(fg.r, fg.g, fg.b);
        const L2 = relLuminanceFromRgb(bg.r, bg.g, bg.b);
        const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
        return (lighter + 0.05) / (darker + 0.05);
      });
    }
    const aiTagContrast = await effectiveContrastRatio(aiTagLocator);
    check(`AI提案タグの実効コントラストが4.5:1以上(実測${aiTagContrast.toFixed(2)}:1、ダーク既定)`,
      aiTagContrast >= 4.5, `${aiTagContrast.toFixed(2)}:1`);
    const qTagContrast = await effectiveContrastRatio(qTagLocator);
    check("AI提案タグと「問い」タグのコントラストが一致する(同一スタイルであることの裏付け)",
      Math.abs(aiTagContrast - qTagContrast) < 0.01, `AI提案=${aiTagContrast.toFixed(2)} 問い=${qTagContrast.toFixed(2)}`);

    // ============================================================
    // (F) 2系統レビュー対応(必須4/8): app.js非依存のフラッシュ防止経路
    // ============================================================
    console.log("[F] app.jsをroute.abort()で遮断しても、index.htmlの同期スクリプト単独でdata-theme='dark'+meta更新が効く");
    const ctx2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
    const page2 = await ctx2.newPage();
    const appJsRequests = [];
    await page2.route((url) => url.pathname.endsWith("/app.js"), (route) => {
      appJsRequests.push(route.request().url());
      route.abort();
    });
    await page2.goto(`http://localhost:${PORT}/`);
    await page2.waitForTimeout(400);
    const info2 = await page2.evaluate(() => ({
      dataTheme: document.documentElement.getAttribute("data-theme"),
      metaThemeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "",
      appJsExecuted: typeof window.state !== "undefined"  // app.jsが実行されていればグローバルstateが存在する
    }));
    check("app.jsへのリクエストが実際に遮断された(前提確認)", appJsRequests.length >= 1, JSON.stringify(appJsRequests));
    check("app.js遮断下でもdata-theme='dark'(初回・localStorage空の既定)", info2.dataTheme === "dark", JSON.stringify(info2));
    check("app.js遮断下でもmeta[theme-color]がダーク値'#111216'に更新される", info2.metaThemeColor === "#111216", JSON.stringify(info2));
    check("app.js自体は本当に実行されていない(前提確認、windowにstateが無い)", info2.appJsExecuted === false, JSON.stringify(info2));
    await ctx2.close();

  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures === 0) console.log("\n✅ v151 ALL PASS");
  else { console.log(`\n❌ v151 FAILED (${failures})`); process.exit(1); }
})();
