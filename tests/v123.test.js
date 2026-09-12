// v123 検証: apple-design(HIG)のタイポグラフィ+マテリアル(半透明チローム)をUIへ反映。
// CHANGES_v123.md参照。動き(モーション)はv124スコープのためここでは扱わない。
//
// (a) ボトムナビのcomputed styleにbackdrop-filter(半透明+ぼかし)が効いており、
//     境目が硬い1pxのborder-topでなくbox-shadow(スクロールエッジ表現)になっている
// (b) input/select/textareaのcomputed font-sizeが16px以上のまま(代表数箇所、iOSズーム防止の回帰確認)
// (c) ボトムナビの文字・アイコン(ラベル)が実際に表示されている(視認性の回帰確認)
// (d) 静的検査: styles.cssにprefers-reduced-transparency/prefers-contrastのフォールバックが存在する
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, ROOT } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  // ============================================================
  // (d) 静的検査: styles.cssのフォールバック定義(ブラウザ起動不要)
  // ============================================================
  console.log("[0] 静的検査: prefers-reduced-transparency / prefers-contrast のフォールバック");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  check("prefers-reduced-transparency: reduce のメディアクエリが存在する",
    /@media\s*\(prefers-reduced-transparency:\s*reduce\)/.test(css));
  check("prefers-contrast: more のメディアクエリが存在する",
    /@media\s*\(prefers-contrast:\s*more\)/.test(css));
  const reducedTransparencyBlock = (css.match(/@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{[^}]*\{[^}]*\}/) || [""])[0];
  check("prefers-reduced-transparency ブロックが.bottom-navを不透明化する(backdrop-filter: none)",
    /backdrop-filter:\s*none/.test(reducedTransparencyBlock), reducedTransparencyBlock);
  const contrastBlock = (css.match(/@media\s*\(prefers-contrast:\s*more\)\s*\{[^}]*\{[^}]*\}/) || [""])[0];
  check("prefers-contrast ブロックが明確な境界線(border)を持つ",
    /border-top:\s*1px solid/.test(contrastBlock), contrastBlock);
  check("@supports not (backdrop-filter) の不透明フォールバックが存在する",
    /@supports not \(\(backdrop-filter/.test(css));
  check("既存のinput/select/textarea 16px指定(iOSズーム防止)は残っている",
    /\.input,\s*\n\s*\.select,\s*\n\s*\.textarea\s*\{\s*\n\s*font-size:\s*16px/.test(css));

  // ============================================================
  // ブラウザ検証: iPhone幅(390x844)のコンテキストで確認する
  // ============================================================
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (a)(c) ボトムナビのマテリアル + 視認性
    // ============================================================
    console.log("[1] ボトムナビのマテリアル(半透明+blur)と視認性");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    const bottomNavStyle = await page.evaluate(() => {
      const el = document.querySelector(".bottom-nav");
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "",
        backgroundColor: cs.backgroundColor,
        boxShadow: cs.boxShadow,
        borderTopWidth: cs.borderTopWidth,
        borderTopStyle: cs.borderTopStyle
      };
    });
    check("390px幅でボトムナビが表示される(display: grid)", bottomNavStyle.display === "grid", JSON.stringify(bottomNavStyle));
    check("backdrop-filterにblurが効いている", /blur/.test(bottomNavStyle.backdropFilter), JSON.stringify(bottomNavStyle));
    const alphaMatch = bottomNavStyle.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
    const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
    check("背景が半透明(alpha < 1)", alpha < 1, bottomNavStyle.backgroundColor);
    check("境目が硬い1px border-topでなくbox-shadow表現になっている",
      bottomNavStyle.boxShadow !== "none" && bottomNavStyle.borderTopStyle === "none",
      JSON.stringify(bottomNavStyle));

    const navButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".bottom-nav button")).map((btn) => {
        const cs = getComputedStyle(btn);
        const rect = btn.getBoundingClientRect();
        return {
          id: btn.dataset.view,
          label: Array.from(btn.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim(),
          text: btn.innerText.trim(),
          color: cs.color,
          opacity: parseFloat(cs.opacity),
          visibility: cs.visibility,
          width: rect.width,
          height: rect.height
        };
      });
    });
    // v333の統合仕様: 廃止された時間項目を復活させず、順序・表示名・全遷移を固定する。
    check("下部ナビは今日/実行/作業一覧/その他の4項目がこの順序で重複なく並ぶ",
      JSON.stringify(navButtons.map(b => [b.id, b.label])) === JSON.stringify([
        ["today", "今日"], ["exec", "実行"], ["wbs", "作業一覧"], ["more", "その他"]]), JSON.stringify(navButtons));
    check("すべてのボタンにラベルテキストがある", navButtons.every((b) => b.text.length > 0), JSON.stringify(navButtons));
    check("すべてのボタンが可視(opacity>0・visibility:visible・サイズ>0)",
      navButtons.every((b) => b.opacity > 0 && b.visibility === "visible" && b.width > 0 && b.height > 0),
      JSON.stringify(navButtons));
    check("すべてのボタンの文字色が完全透明でない",
      navButtons.every((b) => !/rgba\([^)]*,\s*0\)/.test(b.color)), JSON.stringify(navButtons));

    const primaryData = () => page.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      return JSON.stringify({ projects: s.projects, tasks: s.tasks, blocks: s.blocks });
    }, KEY);
    const beforeNavigation = await primaryData();
    for (const view of ["exec", "wbs", "more", "today"]) {
      await page.locator(`#bottomNav [data-view="${view}"]`).click();
      await page.waitForSelector(`#app[data-view="${view}"]`);
      check(`${view}: 遷移先・active項目・保存された現在地が一致する`,
        await page.locator("#bottomNav button.active").getAttribute("data-view") === view
        && await page.evaluate(({KEY, view}) => JSON.parse(localStorage.getItem(KEY)).currentView === view, {KEY, view}));
      if (view === "exec") {
        for (const mode of ["actual", "plan"]) {
          await page.locator(`.exec-mode-segmented [data-mode="${mode}"]`).click();
          check(`実行内の${mode}切替でも実行ナビと画面を保持する`,
            await page.locator(`.exec-mode-segmented [data-mode="${mode}"].active`).count() === 1
            && await page.locator('#bottomNav [data-view="exec"].active').count() === 1);
        }
      }
    }
    await page.locator('#bottomNav [data-view="more"]').click();
    await page.locator('.more-tower-grid [data-view="wbs"]').click();
    await page.waitForSelector('#app[data-view="wbs"]');
    check("その他からWBSへ到達しても作業一覧ナビがactiveになる",
      await page.locator('#bottomNav [data-view="wbs"].active').count() === 1);
    check("ナビ全遷移と実行内切替でProject/Task/Blockの保存内容を変えない",
      await primaryData() === beforeNavigation);

    // ============================================================
    // (b) input/select/textarea のfont-sizeが16px以上のまま(代表数箇所)
    // ============================================================
    console.log("[2] input/select/textareaのfont-size回帰(iOSズーム防止)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "wish";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    // v221: locator解決後の再描画で要素がdetachされるとgetComputedStyleが空文字→NaNになる競合が
    // 全体実行時にまれに発生(既知フレーク)。評価時点でquerySelectorし直し、値の成立自体を待つ。
    const fontOf = (sel) => page.waitForFunction((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const v = parseFloat(getComputedStyle(el).fontSize);
      return Number.isFinite(v) ? v : false;
    }, sel, { timeout: 10000 }).then((h) => h.jsonValue());
    const wishTitleFont = await fontOf("#wishTitle");
    check("#wishTitle(input)のfont-sizeは16px以上", wishTitleFont >= 16, `fontSize=${wishTitleFont}`);
    const wishFilterFont = await fontOf("#wishFilterArea");
    check("#wishFilterArea(select)のfont-sizeは16px以上", wishFilterFont >= 16, `fontSize=${wishFilterFont}`);

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    const journalTextareaFont = await fontOf("textarea[data-journal-date]");
    check("ジャーナルtextareaのfont-sizeは16px以上", journalTextareaFont >= 16, `fontSize=${journalTextareaFont}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
