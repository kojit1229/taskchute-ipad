// v274: Today統合画面S2 GLASS意匠と、端末ローカルのぼかし縮退を固定する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.resolve(__dirname, "..");
const PORT = randomPort();
const BLUR_KEY = "taskchute-journal-glass-blur-off";
const stylesSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const towerSource = fs.readFileSync(path.join(ROOT, "src", "features", "today-tower.js"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  console.log("[1] S2 GLASS静的契約");
  const glassRoot = (stylesSource.match(/#app\[data-view="today"\] \.today-tower \{([\s\S]*?)\n\}/) || [])[1] || "";
  const expectedTokens = {
    "--tower-bg": "#0b0d1c", "--tower-panel": "rgba(255, 255, 255, .07)",
    "--tower-line": "rgba(255, 255, 255, .14)", "--tower-text": "#eef0ff",
    "--tower-amber": "#f0c674", "--tower-green": "#6ee7c8",
    "--tower-cyan": "#8ab6ff", "--tower-purple": "#c4b5fd"
  };
  check("Today専用GLASSトークン8件は正本値", Object.entries(expectedTokens)
    .every(([name, value]) => glassRoot.includes(`${name}: ${value};`)), glassRoot);
  check("GLASS上書きに--tower-redを追加せず既存#ff6d7fを1件だけ維持",
    !glassRoot.includes("--tower-red") && (stylesSource.match(/--tower-red:\s*#ff6d7f;/g) || []).length === 1);
  check("オーロラはToday本体内・全面・非操作で3灯", /\.today-tower::before\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*0;[^}]*inset:\s*0;[\s\S]*pointer-events:\s*none;/.test(stylesSource)
    && ((stylesSource.match(/radial-gradient\(/g) || []).length >= 3));
  const panelMatch = stylesSource.match(/(#app\[data-view="today"\] \.today-tower \.tower-glass-panel,[\s\S]*?#app\[data-view="today"\] \.today-tower \.today-panel) \{([\s\S]*?)\n\}/) || [];
  const panelSelectors = panelMatch[1] || "";
  const panelRule = panelMatch[2] || "";
  check("現行全パネルと将来用共通クラスを単一GLASSルールへ集約",
    ["tower-glass-panel", "today-focus-bar", "tower-panel-box", "tower-runway", "tower-gates", "tower-arrivals", "today-panel"]
      .every((name) => panelSelectors.includes(`.today-tower .${name}`))
    && !panelSelectors.includes(".today-tower .tower-header")
    && panelRule.includes("border-radius: 18px;")
    && panelRule.includes("-webkit-backdrop-filter: var(--tower-glass-blur);")
    && panelRule.includes("backdrop-filter: var(--tower-glass-blur);"));
  check("手動縮退helperは専用localStorage読取で属性を切替", towerSource.includes(`getItem("${BLUR_KEY}") === "1"`)
    && towerSource.includes("data-glass-blur=\"off\""));
  // v278: 後続リリースの実行コード変更ではCACHE_NAMEをさらに+1する契約。assertionは維持して最新版へ追従する。
  check("CACHE_NAMEは後続v278へ更新", /^const CACHE_NAME = "taskchute-journal-pwa-v278";/m.test(swSource));

  console.log("[2] 実DOMの主要パネル・非流出・縮退・他タブ非波及");
  const server = startServer(PORT);
  let browser;

  try {
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(new Date(2026, 7, 26, 12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.addInitScript(({ stateKey, blurKey }) => {
      window.__v274StorageEvents = [];
      const originalSetItem = Storage.prototype.setItem;
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && (key === stateKey || key === blurKey)) {
          window.__v274StorageEvents.push({ operation: "set", key });
        }
        return originalSetItem.call(this, key, value);
      };
      Storage.prototype.getItem = function(key) {
        if (this === localStorage && (key === stateKey || key === blurKey)) {
          window.__v274StorageEvents.push({ operation: "get", key });
        }
        return originalGetItem.call(this, key);
      };
    }, { stateKey: STATE_KEY, blurKey: BLUR_KEY });
    await page.evaluate(({ stateKey, blurKey }) => {
      const state = JSON.parse(localStorage.getItem(stateKey));
      state.currentView = "today";
      localStorage.setItem(stateKey, JSON.stringify(state));
      localStorage.removeItem(blurKey);
    }, { stateKey: STATE_KEY, blurKey: BLUR_KEY });
    await page.reload();
    await page.waitForFunction(() => [
      ".life-band", ".clock-box", ".so-row", ".today-focus-bar", ".tower-panel-box", ".tower-runway",
      ".tower-gates", ".tower-arrivals", ".today-panel"
    ].every((selector) => document.querySelector(selector)));

    const visual = await page.evaluate(() => {
      const root = document.querySelector(".today-tower");
      const generic = document.createElement("section");
      generic.className = "tower-glass-panel";
      root.appendChild(generic);
      const rootStyle = getComputedStyle(root);
      const aurora = getComputedStyle(root, "::before");
      const panelStyles = [
        ["LIFE BAND", ".life-band"], ["clock", ".clock-box"], ["STANDING ORDERS", ".so-row"], ["FOCUS", ".today-focus-bar"],
        ["GATE", ".tower-gates"], ["ARRIVALS", ".tower-arrivals"],
        ["CABIN TIMER", ".today-panel"], ["tower-glass-panel", ".tower-glass-panel"]
      ].map(([name, selector]) => {
        const style = getComputedStyle(document.querySelector(selector));
        return {
          name, radius: style.borderRadius, background: style.backgroundColor,
          blur: style.backdropFilter, webkitBlur: style.webkitBackdropFilter,
          line: style.getPropertyValue("--tower-line").trim(), borderWidth: style.borderWidth,
          borderStyle: style.borderStyle, borderColor: style.borderColor,
          boxShadow: style.boxShadow, zIndex: style.zIndex
        };
      });
      const sidebarRect = document.getElementById("sidebar").getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const result = {
        blurAttr: root.getAttribute("data-glass-blur"),
        tokens: ["--tower-bg", "--tower-panel", "--tower-line", "--tower-text", "--tower-amber", "--tower-green", "--tower-cyan", "--tower-purple"]
          .map((name) => rootStyle.getPropertyValue(name).trim()),
        font: rootStyle.fontFamily, isolation: rootStyle.isolation, rootPosition: rootStyle.position,
        webkitBlurSupported: CSS.supports("-webkit-backdrop-filter", "blur(1px)"),
        panels: panelStyles, auroraPosition: aurora.position, auroraZ: aurora.zIndex,
        auroraInset: aurora.inset, auroraPointer: aurora.pointerEvents,
        auroraBackground: aurora.backgroundImage,
        towerStartsAfterSidebar: rootRect.left >= sidebarRect.right
      };
      generic.remove();
      return result;
    });
    const panelsOk = visual.panels.every((panel) => panel.radius === "18px"
      && panel.background === "rgba(255, 255, 255, 0.07)"
      && panel.blur === "blur(16px)" && (!visual.webkitBlurSupported || panel.webkitBlur === "blur(16px)")
      && /rgba\(255,\s*255,\s*255,\s*(?:0?\.14)\)/.test(panel.line)
      && panel.borderWidth === "1px" && panel.borderStyle === "solid"
      && panel.borderColor === "rgba(255, 255, 255, 0.14)"
      && panel.boxShadow.includes("rgba(0, 0, 0, 0.35)")
      && panel.boxShadow.includes("rgba(255, 255, 255, 0.12)")
      && panel.boxShadow.includes("inset") && panel.zIndex === "1");
    check("未設定は主要8種すべてGLASS実効値・両blur・枠・影・z-order", visual.blurAttr === null
      && visual.tokens.join("|") === "#0b0d1c|rgba(255, 255, 255, .07)|rgba(255, 255, 255, .14)|#eef0ff|#f0c674|#6ee7c8|#8ab6ff|#c4b5fd"
      && visual.font.includes("Segoe UI") && visual.isolation === "isolate" && panelsOk,
      JSON.stringify(visual));
    check("オーロラはToday本体の包含矩形に閉じサイドバーへ流出しない", visual.rootPosition === "relative"
      && visual.auroraPosition === "absolute" && visual.auroraZ === "0" && visual.auroraInset === "0px"
      && visual.auroraPointer === "none" && visual.towerStartsAfterSidebar
      && (visual.auroraBackground.match(/radial-gradient/g) || []).length === 3, JSON.stringify(visual));
    const defaultStorage = await page.evaluate((blurKey) => {
      const events = window.__v274StorageEvents;
      const blurRead = events.findIndex((event) => event.operation === "get" && event.key === blurKey);
      return { events, blurRead, writesAfterBlurRead: events.slice(blurRead + 1).filter((event) => event.operation === "set") };
    }, BLUR_KEY);
    check("縮退判定を含む描画後はstate/blurキー保存0回", defaultStorage.blurRead >= 0
      && defaultStorage.writesAfterBlurRead.length === 0, JSON.stringify(defaultStorage));

    const gateFull = await page.locator(".tower-gates").evaluate((gate) => {
      gate.classList.add("is-full");
      const probe = document.createElement("span");
      probe.style.color = "var(--tower-green)";
      gate.appendChild(probe);
      const result = { border: getComputedStyle(gate).borderColor, green: getComputedStyle(probe).color };
      probe.remove();
      return result;
    });
    check("GATE満灯の定常枠は--tower-green実効色", gateFull.border === gateFull.green, JSON.stringify(gateFull));
    await page.emulateMedia({ reducedMotion: "reduce" });
    check("reduced-motionのGATE満灯は影を消す",
      await page.locator(".tower-gates.is-full").evaluate((gate) => getComputedStyle(gate).boxShadow) === "none");

    await page.evaluate((key) => localStorage.setItem(key, "1"), BLUR_KEY);
    await page.reload();
    await page.waitForSelector('.today-tower[data-glass-blur="off"]');
    const off = await page.locator(".tower-runway").evaluate((panel) => ({
      blur: getComputedStyle(panel).backdropFilter,
      webkitBlur: getComputedStyle(panel).webkitBackdropFilter,
      background: getComputedStyle(panel).backgroundColor
    }));
    check("フラグ1はぼかしだけnoneへ縮退し半透明背景を維持", off.blur === "none"
      && (!off.webkitBlur || off.webkitBlur === "none") && off.background === "rgba(255, 255, 255, 0.07)", JSON.stringify(off));
    const offStorage = await page.evaluate((blurKey) => {
      const events = window.__v274StorageEvents;
      const blurRead = events.findIndex((event) => event.operation === "get" && event.key === blurKey);
      return { events, blurRead, writesAfterBlurRead: events.slice(blurRead + 1).filter((event) => event.operation === "set") };
    }, BLUR_KEY);
    check("縮退フラグ反映後の描画もstate/blurキー保存0回", offStorage.blurRead >= 0
      && offStorage.writesAfterBlurRead.length === 0, JSON.stringify(offStorage));

    const otherViews = [
      ["instruments", ".instr-view.today-tower"], ["wish", ".tower-skin.wish-tower"],
      ["journal", ".tower-skin.journal-tower"], ["timeline", ".tower-skin.timeline-tower"],
      ["more", ".tower-skin.more-tower"]
    ];
    const scopeResults = [];
    for (const [view, selector] of otherViews) {
      await page.evaluate(({ stateKey, view }) => {
        const state = JSON.parse(localStorage.getItem(stateKey));
        state.currentView = view;
        localStorage.setItem(stateKey, JSON.stringify(state));
      }, { stateKey: STATE_KEY, view });
      await page.reload();
      await page.waitForSelector(selector);
      scopeResults.push(await page.locator(selector).evaluate((root) => {
        const panel = root.querySelector(".tower-panel-box, .panel, .view-header, .more-tower-item");
        const panelStyle = panel ? getComputedStyle(panel) : null;
        return {
          view: document.getElementById("app").dataset.view,
          bg: getComputedStyle(root).getPropertyValue("--tower-bg").trim(),
          before: getComputedStyle(root, "::before").content,
          blurAttr: root.getAttribute("data-glass-blur"),
          panelFound: Boolean(panel), blur: panelStyle?.backdropFilter || "",
          webkitBlur: panelStyle?.webkitBackdropFilter || "", panelBackground: panelStyle?.backgroundColor || ""
        };
      }));
    }
    check("計器盤再利用系と全.tower-skin系代表へGLASSを波及させない", scopeResults.every((result) =>
      result.bg === "#050a14" && result.before === "none" && result.blurAttr === null && result.panelFound
      && result.blur !== "blur(16px)" && result.webkitBlur !== "blur(16px)"
      && result.panelBackground !== "rgba(255, 255, 255, 0.07)"), JSON.stringify(scopeResults));
  } catch (error) {
    failures++;
    console.error(error);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      server.close();
    }
  }

  console.log(failures === 0 ? "\n✅ v274 ALL PASS" : `\n❌ v274: ${failures} 件失敗`);
  process.exit(failures ? 1 : 0);
})();
