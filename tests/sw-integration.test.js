// sw-integration.test.js — review.md:33。40本のE2Eが全てService Workerをblockしており、
// install/activate/offline/controllerchangeの実挙動を検証していなかった指摘への対応。
// 少数の統合チェックのみ(既存スイートの方針=SW block自体は無変更・触れない)。
//
// [1] install/activate: navigator.serviceWorker.ready が解決し、controllerがセットされる
// [2] CACHE_NAME一致: caches.keys() に sw.js が宣言する CACHE_NAME と同じキャッシュが存在する
// [3] APP_SHELLがキャッシュされている: caches.match('./index.html') 等が応答を返す
// [4] オフライン相当でのキャッシュ配信: context.setOffline(true) の状態でreloadしてもページが表示される
// [5] controllerchange: 初回install+clients.claim()により、既存ページに対してcontrollerchangeが
//     発火しcontrollerがセットされる基本動線を確認する
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  // v137: 既存40本余のスイートは全て serviceWorkers:"block" だが、本スイートだけは
  // SWを実際に動かして検証する(既定は"allow")。
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const swSource = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf-8");
  const expectedCacheName = (swSource.match(/CACHE_NAME\s*=\s*"([^"]+)"/) || [])[1];

  try {
    console.log("[1] install/activate: navigator.serviceWorker.ready が解決し、controllerがセットされる");
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    // registerServiceWorker() は window "load" 後にregisterするため、readyの解決を待つ。
    // 初回installはclients.claim()によりcontrollerchangeが飛び、app.js側のリスナーが
    // 1回だけreloadする(refreshingガード付き)ので、そのreload後の状態まで少し余裕をもって待つ。
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);  // controllerchange経由の自動reload(あれば)が収まるのを待つ

    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return {
        active: !!reg.active,
        activeState: reg.active ? reg.active.state : null,
        hasController: !!navigator.serviceWorker.controller
      };
    });
    check("Service Workerがactive状態になっている", swState.active && swState.activeState === "activated", JSON.stringify(swState));
    check("[5] controllerがセットされている(controllerchangeの基本動線)", swState.hasController, JSON.stringify(swState));

    console.log("[2] CACHE_NAME一致: caches.keys() に sw.js宣言のCACHE_NAMEと同じキャッシュが存在する");
    check("sw.jsからCACHE_NAMEを抽出できた", !!expectedCacheName, expectedCacheName);
    const cacheNames = await page.evaluate(() => caches.keys());
    check("caches.keys()に期待するCACHE_NAMEが含まれる", cacheNames.includes(expectedCacheName), JSON.stringify(cacheNames));

    console.log("[3] APP_SHELLがキャッシュされている");
    const shellCached = await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      return keys.map((r) => new URL(r.url).pathname);
    }, expectedCacheName);
    check("index.htmlまたは./がキャッシュされている", shellCached.some((p) => p.endsWith("/") || p.endsWith("index.html")), JSON.stringify(shellCached));
    check("app.jsがキャッシュされている", shellCached.some((p) => p.endsWith("app.js")), JSON.stringify(shellCached));
    check("styles.cssがキャッシュされている", shellCached.some((p) => p.endsWith("styles.css")), JSON.stringify(shellCached));

    // v164: app.js分割の段階0(SW戦略)。独立レビューBlocker-2 —
    // src/**/*.jsをAPP_SHELLへ列挙し忘れると、新app.js×旧src/*.jsのモジュールグラフ版ズレで
    // iOS PWAが起動不能になる新しい障害クラスが生まれる。sw.jsが宣言するAPP_SHELL上の
    // src/**/*.js が実際にprecache済みであることを機械検知する(静的なAPP_SHELL列挙漏れ検知は
    // scripts/release-gate.jsのapp-shell-precacheが別途担う)。
    console.log("[3b] APP_SHELL上のsrc/**/*.jsが全てprecacheされている(モジュールグラフ版ズレ対策)");
    const appShellMatch = swSource.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
    const appShellEntries = appShellMatch
      ? [...appShellMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
      : [];
    const srcShellEntries = appShellEntries.filter((entry) => entry.replace(/^\.\//, "").startsWith("src/"));
    if (srcShellEntries.length) {
      const missingSrc = srcShellEntries.filter((entry) => {
        const suffix = entry.replace(/^\.\//, "");
        return !shellCached.some((p) => p.endsWith(suffix));
      });
      check(
        "src/**/*.jsが全てprecacheされている",
        missingSrc.length === 0,
        JSON.stringify({ srcShellEntries, missingSrc, shellCached })
      );
    } else {
      check("src/**/*.jsが全てprecacheされている(src未使用のため自明にpass)", true);
    }

    console.log("[4] オフライン相当でのキャッシュ配信: setOffline(true)でreloadしてもページが表示される");
    await ctx.setOffline(true);
    let offlineOk = true;
    try {
      await page.reload({ waitUntil: "load", timeout: 10000 });
    } catch (e) {
      offlineOk = false;
      console.log("  (reload中の例外:", e.message, ")");
    }
    await page.waitForTimeout(500);
    const bodyText = await page.locator("body").textContent().catch(() => "");
    check("オフライン状態でもreloadが成功し、ページ本文が空でない", offlineOk && bodyText.trim().length > 0, `(len=${bodyText.trim().length})`);
    await ctx.setOffline(false);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nsw-integration: 全件成功" : `\nsw-integration: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
