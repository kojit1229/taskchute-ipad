// v127 検証: apple-design全体ポリッシュ(角丸+2層シャドウ/ヘッダのマテリアル化/
// 余白のリズム/ボタン階層/見出しの磨き)。CHANGES_v127.md参照。
//
// (a) 静的検査: .view-header がマテリアル化(背景+backdrop-filter+境目シャドウ)されており、
//     prefers-reduced-transparency/prefers-contrast/@supports not backdrop-filter の
//     フォールバックが .view-header にも定義されている
//     (注: position:stickyは実機検証の結果、当アプリの.app-shell(高さautoのCSS Grid)では
//      #mainが実際にはスクロールしないため無効と判明し不採用。CHANGES_v127.md参照)
// (b) --radius変更後もinput/select/textareaのcomputed font-sizeが16px以上のまま(回帰確認)
// (c) ブラウザ検証: アプリ起動+主要タブ(ホーム/WBS/タイムライン/ジャーナル)の描画確認
//     (コンソールエラーなし、.view-headerが表示される)
// (d) .timeline-cardの配置プロパティ(position:absolute等)が無変更であることのcomputed style検証
//     (不可侵領域。タイムライン絶対配置のドリフト再発防止)
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

// v124のtests/v124.test.jsから踏襲: @media/@supportsの中身(複数の通常ルールを含む)を
// 対応する閉じ括弧まで正しく取り出すブレースカウンタ。単純な `\{[^}]*\}` では
// 1階層しか拾えない(このブロックは.bottom-nav{...} .view-header{...}のように
// 複数ルールをネストしている)ため使う。
function extractBlockBody(css, headerRe) {
  const m = headerRe.exec(css);
  if (!m) return "";
  let i = css.indexOf("{", m.index + m[0].length - 1);
  if (i === -1) return "";
  let depth = 0;
  let start = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  return "";
}

(async () => {
  // ============================================================
  // (a) 静的検査: styles.css(ブラウザ起動不要)
  // ============================================================
  console.log("[0] 静的検査: .view-headerのマテリアル化+フォールバック");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

  const viewHeaderBase = (css.match(/\.view-header\s*\{[^}]*\}/) || [""])[0];
  check(".view-headerにbackdrop-filter(blur)が効いている", /backdrop-filter:\s*blur/.test(viewHeaderBase), viewHeaderBase);
  check(".view-headerが--chrome-bg(半透明背景)を使っている", /background:\s*var\(--chrome-bg\)/.test(viewHeaderBase), viewHeaderBase);
  check(".view-headerが--chrome-edge-down(境目のソフトシャドウ)を使っている", /box-shadow:\s*var\(--chrome-edge-down\)/.test(viewHeaderBase), viewHeaderBase);

  const supportsBlock = extractBlockBody(css, /@supports not \(\(backdrop-filter[^{]*\)\s*/);
  check("@supports not (backdrop-filter) フォールバックに.view-headerが含まれる",
    /\.view-header\s*\{/.test(supportsBlock), supportsBlock);
  const reducedTransparencyBlock = extractBlockBody(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*/);
  check("prefers-reduced-transparencyフォールバックに.view-headerが含まれる(backdrop-filter: none)",
    /\.view-header\s*\{[^}]*backdrop-filter:\s*none/.test(reducedTransparencyBlock), reducedTransparencyBlock);
  const contrastBlock = extractBlockBody(css, /@media\s*\(prefers-contrast:\s*more\)\s*/);
  check("prefers-contrastフォールバックに.view-headerが含まれる(border-bottom明確化)",
    /\.view-header\s*\{[^}]*border-bottom:\s*1px solid var\(--text\)/.test(contrastBlock), contrastBlock);

  // --radius / 2層シャドウ
  check("--radiusが12pxに更新されている", /--radius:\s*12px/.test(css));
  check("--shadow(ライト)が2層(近接+拡散)のソフトシャドウになっている",
    /--shadow:\s*0 1px 2px rgba\([^)]*\),\s*0 [\d.]+px [\d.]+px -[\d.]+px rgba\(/.test(css));

  // 既存のinput/select/textarea 16px指定(iOSズーム防止)は残っている(v123から継続の回帰確認)
  check("既存のinput/select/textarea 16px指定(iOSズーム防止)は残っている",
    /\.input,\s*\n\s*\.select,\s*\n\s*\.textarea\s*\{\s*\n\s*font-size:\s*16px/.test(css));

  // .timeline-card / .draft-block(絶対配置の主体そのもの)は不可侵。
  // v124の既存パターンを踏襲し、選択子が「.timeline-card」「.draft-block」そのもの
  // (子孫の.draft-block-time等や、無関係な既存装飾の.draft-resize等は対象外)である
  // 規則にtransformが付いていないかを見る(margin/positionの実際の値はブラウザの
  // computed style検証[4]で直接確認するため、ここではtransformの静的検査に絞る)。
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let timelineViolation = null;
  while ((m = ruleRe.exec(css))) {
    const selector = m[1].trim();
    const body = m[2];
    if (!/(^|,|\s)\.timeline-card(\.[\w-]+)*(:[\w-]+)?(\s*\{)?(,|\s|$)/.test(selector + " ") &&
        !/(^|,|\s)\.draft-block(\.[\w-]+)*(:[\w-]+)?(,|\s|$)/.test(selector + " ")) continue;
    if (/transform\s*:/.test(body)) {
      timelineViolation = `${selector} { ${body.trim()} }`;
      break;
    }
  }
  check(".timeline-card/.draft-block にtransformを付ける規則が新設されていない(不可侵領域)",
    timelineViolation === null, timelineViolation || "");

  // ============================================================
  // ブラウザ検証
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
    // (c) 主要タブの描画確認
    // ============================================================
    console.log("[1] 主要タブ(ホーム/WBS/タイムライン/ジャーナル)の描画確認");
    for (const view of ["home", "wbs", "timeline", "journal"]) {
      await page.evaluate((args) => {
        const [KEY, view] = args;
        const s = JSON.parse(localStorage.getItem(KEY));
        s.currentView = view;
        localStorage.setItem(KEY, JSON.stringify(s));
      }, [KEY, view]);
      await page.reload();
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => {
        const header = document.querySelector(".view-header");
        const cs = header ? getComputedStyle(header) : null;
        return {
          appExists: !!document.querySelector("#app"),
          headerExists: !!header,
          headerVisible: cs ? (cs.display !== "none" && parseFloat(cs.opacity) > 0) : false,
          headerBackdrop: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || "") : "",
        };
      });
      check(`[${view}] アプリ本体が描画される`, state.appExists, JSON.stringify(state));
      check(`[${view}] .view-headerが表示される`, state.headerExists && state.headerVisible, JSON.stringify(state));
      check(`[${view}] .view-headerにbackdrop-filterが効いている(computed)`, /blur/.test(state.headerBackdrop), JSON.stringify(state));
    }

    // ============================================================
    // (a) ヘッダーマテリアルのcomputed style(ホーム画面で確認)
    // ============================================================
    console.log("[2] .view-headerのマテリアル(computed style)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    const headerStyle = await page.evaluate(() => {
      const el = document.querySelector(".view-header");
      const cs = getComputedStyle(el);
      return {
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "",
        backgroundColor: cs.backgroundColor,
      };
    });
    check("backdrop-filterにblurが効いている(computed)", /blur/.test(headerStyle.backdropFilter), JSON.stringify(headerStyle));
    const alphaMatch = headerStyle.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
    const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
    check("背景が半透明(alpha < 1)", alpha < 1, headerStyle.backgroundColor);

    // ============================================================
    // (b) input/select/textarea のfont-size回帰(iOSズーム防止、--radius変更後も維持)
    // ============================================================
    console.log("[3] input/select/textareaのfont-size回帰(iOSズーム防止)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "wish";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    const wishTitleFont = await page.locator("#wishTitle").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("#wishTitle(input)のfont-sizeは16px以上", wishTitleFont >= 16, `fontSize=${wishTitleFont}`);
    const wishFilterFont = await page.locator("#wishFilterArea").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("#wishFilterArea(select)のfont-sizeは16px以上", wishFilterFont >= 16, `fontSize=${wishFilterFont}`);

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    const journalTextareaFont = await page.locator("textarea[data-journal-date]").first()
