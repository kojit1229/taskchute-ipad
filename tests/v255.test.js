// v255: 設定画面から設計思想図解を開くリンクと、オフライン同梱契約を検証する。
const fs = require("fs");
const path = require("path");
const {
  chromium,
  launchOptions,
  startServer,
  blockGithubApiByDefault,
  passGithubGate,
  randomPort,
  STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const ROOT = path.join(__dirname, "..");
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const appShellMatch = swSource.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
  const appShellEntries = appShellMatch
    ? [...appShellMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    : [];

  console.log("[1] concept.htmlをAPP_SHELLへ登録し、SWキャッシュを現行v257へ更新");
  check("concept.htmlがリポジトリ直下に存在する", fs.existsSync(path.join(ROOT, "concept.html")));
  check("APP_SHELLに./concept.htmlが含まれる", appShellEntries.includes("./concept.html"), JSON.stringify(appShellEntries));
  check("CACHE_NAMEが現行v257", /^const CACHE_NAME = "taskchute-journal-pwa-v257";/m.test(swSource));

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = "settings";
      localStorage.setItem(key, JSON.stringify(state));
    }, STATE_KEY);
    await page.reload();

    console.log("[2] 設定画面に設計思想リンクを正しい属性で描画");
    const link = page.locator('.settings-grid a:has-text("設計思想(CONCEPT)")');
    await link.waitFor({ state: "attached" });
    check("設計思想(CONCEPT)リンクが1件描画される", await link.count() === 1, String(await link.count()));
    check("hrefが./concept.html", await link.getAttribute("href") === "./concept.html", String(await link.getAttribute("href")));
    check("targetが_blank", await link.getAttribute("target") === "_blank", String(await link.getAttribute("target")));
    check("relがnoopener", await link.getAttribute("rel") === "noopener", String(await link.getAttribute("rel")));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv255: 全件成功" : `\nv255: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
