// sw-self-heal.test.js — v273の破壊範囲・fail-close・誤発動防止・SW再登録までを検証する。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort
} = require("./helpers");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PORT = randomPort();
const HOST = `http://localhost:${PORT}`;
const MOUNT = "/taskchute-ipad";
const ORIGIN = `${HOST}${MOUNT}`;
const APP_SCOPE = `${ORIGIN}/`;
const OTHER_SCOPE = `${HOST}/tests/fixtures/other-app/`;
const FLAG = "tcj-sw-self-heal-attempted-v1";
const CACHE_PREFIX = "taskchute-journal-pwa-";
const OTHER_CACHE = "other-pwa-cache-v9";
const BROKEN_MERGE = "export function mergeById() { return []; }";
const swSource = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const EXPECTED_CACHE = (swSource.match(/CACHE_NAME\s*=\s*"([^"]+)"/) || [])[1];
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const bootstrapSource = (indexSource.match(/<!-- v273:[\s\S]*?<script>\s*([\s\S]*?)<\/script>\s*<script type="module"[^>]+id="appEntry"/) || [])[1];

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

async function observedContext(browser, { blockUntilGuard = false } = {}) {
  const logs = { deleted: [], unregistered: [], registered: [], errors: [], events: [] };
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.exposeBinding("__tcjObserve", (_source, event) => {
    logs[event.type].push(event.value);
    logs.events.push({ type: event.type, value: event.value });
  });
  await ctx.addInitScript(({ flag, block }) => {
    window.addEventListener("error", (event) => window.__tcjObserve({
      type: "errors",
      value: {
        message: event.message || "",
        errorName: event.error ? event.error.name : "",
        errorTag: event.error ? Object.prototype.toString.call(event.error) : "",
        filename: event.filename || "",
        targetId: event.target && event.target.id || ""
      }
    }), true);
    if (!navigator.serviceWorker || !window.caches) return;
    const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    window.__tcjTestNativeRegister = (...args) => nativeRegister(...args);
    navigator.serviceWorker.register = (...args) => {
      let guarded = false;
      try { guarded = sessionStorage.getItem(flag) === "1"; } catch (e) {}
      if (block && !guarded) return Promise.reject(new Error("test blocks app SW registration before repair"));
      window.__tcjObserve({ type: "registered", value: String(args[0]) });
      return nativeRegister(...args);
    };
    const nativeDelete = caches.delete.bind(caches);
    caches.delete = async (name) => {
      const result = await nativeDelete(name);
      await window.__tcjObserve({ type: "deleted", value: { name, result } });
      return result;
    };
    const nativeUnregister = ServiceWorkerRegistration.prototype.unregister;
    ServiceWorkerRegistration.prototype.unregister = async function () {
      const scope = this.scope;
      const result = await nativeUnregister.call(this);
      await window.__tcjObserve({ type: "unregistered", value: { scope, result } });
      return result;
    };
  }, { flag: FLAG, block: blockUntilGuard });
  return { ctx, logs };
}

async function installScenario(browser, pageCount = 1) {
  const observed = await observedContext(browser, { blockUntilGuard: true });
  const { ctx, logs } = observed;
  const pages = [];
  const setupPage = await ctx.newPage();
  await blockGithubApiByDefault(setupPage);
  await setupPage.goto(`${ORIGIN}/`);
  await passGithubGate(setupPage);
  await setupPage.waitForSelector('[data-action="nav"]');
  await setupPage.evaluate(async ({ otherScope }) => {
    const own = await window.__tcjTestNativeRegister("./sw.js");
    const other = await window.__tcjTestNativeRegister("/tests/fixtures/dummy-sw.js", { scope: otherScope });
    await Promise.all([own, other].map((registration) => {
      if (registration.active) return Promise.resolve();
      const worker = registration.installing || registration.waiting;
      if (!worker) return Promise.resolve();
      return new Promise((resolve) => worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
      }));
    }));
  }, { otherScope: OTHER_SCOPE });
  await setupPage.waitForFunction(() => !!navigator.serviceWorker.controller);
  for (let i = 0; i < pageCount; i++) {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await blockGithubApiByDefault(page);
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector('[data-action="nav"]');
    pages.push(page);
  }
  await setupPage.evaluate(async ({ broken, expected, otherCache }) => {
    const cache = await caches.open(expected);
    await cache.put(
      new Request(new URL("./src/core/merge.js", location.href)),
      new Response(broken, { headers: { "Content-Type": "text/javascript" } })
    );
    await caches.open(otherCache);
    localStorage.setItem("tcj-self-heal-sentinel", "preserved");
  }, { broken: BROKEN_MERGE, expected: EXPECTED_CACHE, otherCache: OTHER_CACHE });
  await Promise.all(pages.map((page) => page.evaluate((flag) => sessionStorage.removeItem(flag), FLAG)));
  await setupPage.close();
  logs.deleted.length = 0;
  logs.unregistered.length = 0;
  logs.registered.length = 0;
  logs.events.length = 0;
  return { ctx, pages, logs };
}

function countNavigations(page) {
  let count = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) count++; });
  return () => count;
}

async function pageState(page) {
  return page.evaluate(async ({ flag, expected, otherCache, appScope, otherScope }) => {
    const mergeResponse = await caches.match(new URL("./src/core/merge.js", location.href));
    const mergeSource = mergeResponse ? await mergeResponse.text() : "";
    const scopes = (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope);
    return {
      flag: sessionStorage.getItem(flag),
      cacheNames: await caches.keys(),
      scopes,
      hasController: !!navigator.serviceWorker.controller,
      ownHealthy: scopes.includes(appScope) && (!mergeResponse || mergeSource.includes("mergeByIdPreferNewer")),
      otherAlive: scopes.includes(otherScope) && (await caches.keys()).includes(otherCache),
      sentinel: localStorage.getItem("tcj-self-heal-sentinel"),
      expected
    };
  }, { flag: FLAG, expected: EXPECTED_CACHE, otherCache: OTHER_CACHE, appScope: APP_SCOPE, otherScope: OTHER_SCOPE });
}

async function waitHealthy(page) {
  await page.waitForFunction(async ({ expected, scope }) => {
    const scopes = (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope);
    const names = await caches.keys();
    const merge = await caches.match(new URL("./src/core/merge.js", location.href));
    const mergeSource = merge ? await merge.text() : "";
    return !!navigator.serviceWorker.controller && scopes.includes(scope) && names.includes(expected)
      && mergeSource.includes("mergeByIdPreferNewer") && !!document.querySelector('[data-action="nav"]');
  }, { expected: EXPECTED_CACHE, scope: APP_SCOPE }, { timeout: 15000 });
}

async function waitForPostCleanupRegistration(logs, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lastUnregister = logs.events.map((item) => item.type).lastIndexOf("unregistered");
    const lastRegister = logs.events.map((item) => item.type).lastIndexOf("registered");
    if (lastUnregister >= 0 && lastRegister > lastUnregister) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`修復cleanup後のSW再登録がありません: ${JSON.stringify(logs.events)}`);
}

async function waitForNavigationCount(readCount, minimum, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (readCount() >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`navigationが${minimum}回へ到達しません: ${readCount()}`);
}

function runBootstrapVm({ message, errorKind = "SyntaxError", filename = `${ORIGIN}/app.js`, storageThrows = false }) {
  const metrics = { alerts: 0, deleted: [], unregistered: [], reloads: 0 };
  const winListeners = {};
  const docListeners = {};
  const values = new Map();
  const entry = { id: "appEntry" };
  const location = { href: `${ORIGIN}/`, origin: HOST, reload: () => { metrics.reloads++; } };
  const sandbox = {
    URL, location, navigator: {
      onLine: true,
      serviceWorker: { getRegistrations: () => Promise.resolve([
        { scope: APP_SCOPE, unregister: () => { metrics.unregistered.push(APP_SCOPE); return Promise.resolve(true); } },
        { scope: OTHER_SCOPE, unregister: () => { metrics.unregistered.push(OTHER_SCOPE); return Promise.resolve(true); } }
      ]) }
    },
    caches: {
      keys: () => Promise.resolve([EXPECTED_CACHE, OTHER_CACHE]),
      delete: (name) => { metrics.deleted.push(name); return Promise.resolve(true); }
    },
    sessionStorage: {
      getItem: (key) => { if (storageThrows) throw new Error("SecurityError"); return values.get(key) || null; },
      setItem: (key, value) => { if (storageThrows) throw new Error("SecurityError"); values.set(key, value); }
    },
    fetch: () => Promise.resolve({ ok: true, headers: { get: () => "text/javascript" } }),
    document: {
      body: { appendChild: () => {} },
      createElement: () => ({
        style: {}, innerHTML: "",
        setAttribute: (name) => { if (name === "role") metrics.alerts++; }
      }),
      addEventListener: (type, fn) => { docListeners[type] = fn; },
      removeEventListener: (type) => { delete docListeners[type]; }
    },
    window: {
      location,
      addEventListener: (type, fn) => { winListeners[type] = fn; },
      removeEventListener: (type) => { delete winListeners[type]; }
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(bootstrapSource, context);
  const error = errorKind === "none" ? null : vm.runInContext(`new ${errorKind}(${JSON.stringify(message)})`, context);
  winListeners.error({ target: sandbox.window, message, error, filename });
  return { metrics, listeners: { window: winListeners, document: docListeners }, entry };
}

async function settleVm() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const server = startServer(PORT, MOUNT);
  const browser = await chromium.launch(launchOptions());
  try {
    check("bootstrap sourceを抽出できる", !!bootstrapSource);
    check("sw.jsからCACHE_NAMEを抽出できる", !!EXPECTED_CACHE, EXPECTED_CACHE);

    console.log("[1] 自アプリだけを修復し、他アプリを残したまま本番SWを再登録する");
    {
      const { ctx, pages: [page], logs } = await installScenario(browser);
      const navigations = countNavigations(page);
      await page.goto(`${ORIGIN}/?self-heal=1`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await waitForPostCleanupRegistration(logs);
      await waitHealthy(page);
      await waitForNavigationCount(navigations, 3);
      await waitHealthy(page);
      await page.waitForFunction(() => (
        !document.querySelector("[data-tcj-recovery]") && !!document.querySelector('[data-action="nav"]')
      ), null, { timeout: 15000 });
      const state = await pageState(page);
      check("sessionStorageガードを修復前に永続化する", state.flag === "1", JSON.stringify(state));
      check("TaskChute cacheだけを削除する", logs.deleted.length >= 1 && logs.deleted.every((x) => x.name.startsWith(CACHE_PREFIX)), JSON.stringify(logs));
      check("対象cacheの削除APIが成功する", logs.deleted.every((x) => x.result), JSON.stringify(logs.deleted));
      check("TaskChute scopeだけを解除する", logs.unregistered.length >= 1 && logs.unregistered.every((x) => x.scope.startsWith(APP_SCOPE)), JSON.stringify(logs));
      check("他アプリのcacheは生存する", state.cacheNames.includes(OTHER_CACHE) && !logs.deleted.some((x) => x.name === OTHER_CACHE), JSON.stringify(state));
      check("他アプリのregistrationは生存する", state.scopes.includes(OTHER_SCOPE) && !logs.unregistered.some((x) => x.scope === OTHER_SCOPE), JSON.stringify(state));
      check("復旧後に本番SW・controller・v273 cacheが戻る", state.hasController && state.ownHealthy && state.cacheNames.includes(EXPECTED_CACHE), JSON.stringify(state));
      check("reloadは有限回で収束する", navigations() >= 2 && navigations() <= 3, `navigations=${navigations()}`);
      const uiState = {
        recovery: await page.locator("[data-tcj-recovery]").count(),
        nav: await page.locator('[data-action="nav"]').count(),
        navigations: navigations()
      };
      check("復旧後は案内なしでnavを表示する", uiState.recovery === 0 && uiState.nav > 0, JSON.stringify({ uiState, state, events: logs.events }));
      await ctx.close();
    }

    console.log("[2] 2回目も版ズレなら案内だけを表示して収束する");
    {
      const { ctx, pages: [page], logs } = await installScenario(browser);
      await page.route("**/src/core/merge.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: BROKEN_MERGE }));
      const navigations = countNavigations(page);
      await page.goto(`${ORIGIN}/?self-heal=2`, { waitUntil: "domcontentloaded" }).catch(() => {});
      const alert = page.locator('[role="alert"]');
      await alert.waitFor();
      const state = await pageState(page);
      check("再失敗は手動案内へ倒す", (await alert.textContent()).includes("設定 > アプリ > Safari"));
      check("再失敗でも他アプリを残す", state.otherAlive, JSON.stringify(state));
      check("追加の破壊・無限reloadを起こさない", logs.deleted.length <= 1 && logs.unregistered.length <= 1 && navigations() <= 3, JSON.stringify({ logs, navigations: navigations() }));
      check("復旧ボタンはdata-action委譲", await page.locator('[data-action="tcj-heal-retry"]').count() === 1 && !indexSource.includes("tcjHealRetry"));
      await ctx.close();
    }

    console.log("[3] 破損キャッシュ+オフラインは非破壊で案内する");
    {
      const { ctx, pages: [page], logs } = await installScenario(browser);
      await ctx.setOffline(true);
      const navigations = countNavigations(page);
      await page.goto(`${ORIGIN}/?self-heal=3`, { waitUntil: "domcontentloaded" }).catch(() => {});
      const alert = page.locator('[role="alert"]');
      await alert.waitFor();
      const state = await pageState(page);
      check("オフライン案内を表示する", (await alert.textContent()).includes("通信が切れている"));
      check("オフライン時は削除・解除・FLAG設定をしない", logs.deleted.length === 0 && logs.unregistered.length === 0 && state.flag === null, JSON.stringify({ logs, state }));
      check("オフライン時は自動reloadしない", navigations() === 1, `navigations=${navigations()}`);
      await ctx.setOffline(false);
      await ctx.close();
    }

    console.log("[4] sessionStorage SecurityErrorの2連loadはVMでfail-closeする");
    {
      const first = runBootstrapVm({ message: "Importing binding name 'x' is not found.", storageThrows: true });
      const second = runBootstrapVm({ message: "Importing binding name 'x' is not found.", storageThrows: true });
      await settleVm();
      const combined = [first.metrics, second.metrics];
      check("Storage例外2連loadは案内だけ", combined.every((m) => m.alerts === 1 && m.deleted.length === 0 && m.unregistered.length === 0 && m.reloads === 0), JSON.stringify(combined));
    }

    console.log("[5] window error matcherはWebKit正例を拾い、一般例外を拒否し、load後に解除される");
    {
      const webkit = runBootstrapVm({ message: "Importing binding name 'x' is not found." });
      await settleVm();
      const runtime = runBootstrapVm({ message: "The requested module './x.js' does not provide an export named 'y'", errorKind: "Error" });
      const unrelated = runBootstrapVm({ message: "Unexpected token '}'" });
      const foreign = runBootstrapVm({ message: "Importing binding name 'x' is not found.", filename: `${HOST}/other-app/app.js` });
      await settleVm();
      check("WebKit文言は修復を発動する", webkit.metrics.deleted.includes(EXPECTED_CACHE) && webkit.metrics.reloads === 1, JSON.stringify(webkit.metrics));
      check("export風runtime Errorは誤発動しない", runtime.metrics.deleted.length === 0 && runtime.metrics.reloads === 0, JSON.stringify(runtime.metrics));
      check("無関係SyntaxErrorは誤発動しない", unrelated.metrics.deleted.length === 0 && unrelated.metrics.reloads === 0, JSON.stringify(unrelated.metrics));
      check("別app由来SyntaxErrorは誤発動しない", foreign.metrics.deleted.length === 0 && foreign.metrics.reloads === 0, JSON.stringify(foreign.metrics));
      const afterLoad = runBootstrapVm({ message: "Unexpected token '}'" });
      afterLoad.listeners.document.load({ target: afterLoad.entry });
      check("appEntry正常load後はwindow error listenerを解除する", !afterLoad.listeners.window.error);
    }

    console.log("[6] app.jsがcaptive portal応答なら破壊せず案内する");
    {
      const { ctx, logs } = await observedContext(browser, { blockUntilGuard: true });
      const page = await ctx.newPage();
      await blockGithubApiByDefault(page);
      await page.route("**/app.js", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>login</html>" }));
      const navigations = countNavigations(page);
      await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.locator('[role="alert"]').waitFor();
      const flag = await page.evaluate((key) => sessionStorage.getItem(key), FLAG);
      check("到達性確認がJS MIMEでない場合は削除・解除しない", logs.deleted.length === 0 && logs.unregistered.length === 0, JSON.stringify(logs));
      check("取得失敗経路もFLAGで有限化する", flag === "1", JSON.stringify({ flag }));
      check("取得失敗経路は自動reloadせず案内する", navigations() === 1, JSON.stringify({ navigations: navigations() }));
      await ctx.close();
    }

    console.log("[7] app.js再取得が健全ならscript errorから1回だけ修復する");
    {
      const { ctx, logs } = await observedContext(browser, { blockUntilGuard: true });
      const page = await ctx.newPage();
      await blockGithubApiByDefault(page);
      let appRequests = 0;
      await page.route("**/app.js", async (route) => {
        appRequests++;
        if (appRequests === 1) await route.fulfill({ status: 503, contentType: "text/plain", body: "temporary" });
        else await route.continue();
      });
      const navigations = countNavigations(page);
      await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForFunction((flag) => sessionStorage.getItem(flag) === "1", FLAG);
      await page.waitForFunction(() => document.getElementById("appEntry") && !document.querySelector('[role="alert"]'));
      check("健全な再取得確認後だけreloadする", appRequests >= 3 && navigations() === 2, JSON.stringify({ appRequests, navigations: navigations(), logs }));
      await ctx.close();
    }

    console.log("[8] 通常起動と整合キャッシュのオフライン起動はゼロ副作用");
    {
      const { ctx, logs } = await observedContext(browser);
      const page = await ctx.newPage();
      await blockGithubApiByDefault(page);
      const started = Date.now();
      await page.goto(`${ORIGIN}/`);
      await passGithubGate(page);
      await page.waitForSelector('[data-action="nav"]');
      await waitHealthy(page);
      const normalMs = Date.now() - started;
      let state = await pageState(page);
      check("通常起動は削除0・解除0・FLAGなし・案内なし・nav表示", logs.deleted.length === 0 && logs.unregistered.length === 0 && state.flag === null && await page.locator('[role="alert"]').count() === 0 && await page.locator('[data-action="nav"]').count() > 0, JSON.stringify({ logs, state }));
      check("通常起動時間に著しい劣化がない", normalMs < 15000, `${normalMs}ms`);
      await page.evaluate((flag) => sessionStorage.removeItem(flag), FLAG);
      logs.deleted.length = 0;
      logs.unregistered.length = 0;
      await ctx.setOffline(true);
      const offlineStarted = Date.now();
      await page.reload({ waitUntil: "load", timeout: 10000 });
      await page.waitForSelector('[data-action="nav"]');
      const offlineMs = Date.now() - offlineStarted;
      state = await pageState(page);
      check("整合cacheのオフライン起動もゼロ副作用", logs.deleted.length === 0 && logs.unregistered.length === 0 && state.flag === null && await page.locator('[role="alert"]').count() === 0 && await page.locator('[data-action="nav"]').count() > 0, JSON.stringify({ logs, state }));
      check("オフライン起動時間に著しい劣化がない", offlineMs < 10000, `${offlineMs}ms`);
      await ctx.setOffline(false);
      await ctx.close();
    }

    console.log("[9] 2タブ同時版ズレは有限回で収束し、データと他アプリを保つ");
    {
      const { ctx, pages, logs } = await installScenario(browser, 2);
      const counts = pages.map((page) => countNavigations(page));
      await Promise.all(pages.map((page) => page.goto(`${ORIGIN}/?self-heal=two-tabs`, { waitUntil: "domcontentloaded" }).catch(() => {})));
      await waitForPostCleanupRegistration(logs);
      await Promise.all(pages.map((page) => waitHealthy(page)));
      await Promise.all(counts.map((count) => waitForNavigationCount(count, 3)));
      await Promise.all(pages.map((page) => waitHealthy(page)));
      const states = await Promise.all(pages.map((page) => pageState(page)));
      check("両タブが有限回で復旧する", counts.every((count) => count() >= 1 && count() <= 4) && states.every((state) => state.ownHealthy), JSON.stringify({ counts: counts.map((x) => x()), states }));
      check("localStorageデータと他アプリは競合後も無害", states.every((state) => state.sentinel === "preserved" && state.otherAlive), JSON.stringify(states));
      check("同時修復の破壊対象もTaskChute内だけ", logs.deleted.every((x) => x.name.startsWith(CACHE_PREFIX)) && logs.unregistered.every((x) => x.scope.startsWith(APP_SCOPE)), JSON.stringify(logs));
      await ctx.close();
    }
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nsw-self-heal: 全件成功" : `\nsw-self-heal: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
