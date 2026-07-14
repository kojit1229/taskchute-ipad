// v49 検証: 世代バックアップ / 横断検索
//
// v60メモ: 本スイートはもともと「AIレビュー直接統合(日報 → Anthropic API → フィードバック)」
// も検証していたが、v60でアプリ内からのClaude API直接呼び出しを全廃したため、AIレビュー実行・
// APIキー入力・モデル選択に関する検証は削除した(機能自体が削除されたため。詳細は
// CHANGES_v60.md 参照)。世代バックアップ・横断検索は無関係の機能なのでそのまま残す。
const { chromium, ROOT, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);

  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  // ---- 起動 ----
  console.log("[1] 起動");
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  check("バックアップ復元ボタンがある", await page.locator('[data-action="open-backup-list"]').count() === 1);

  // ---- エクスポートに github token が含まれない ----
  console.log("[2] エクスポートのサニタイズ");
  const exported = await page.evaluate(() => new Promise((resolve) => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blob.text().then((t) => resolve(t)); return "blob:fake"; };
    document.querySelector('[data-action="download-data"]').click();
    setTimeout(() => resolve(""), 2000);
  }));
  const expObj = JSON.parse(exported || "{}");
  check("エクスポートJSONに github token が含まれない", expObj.settings?.github?.token === "");

  // ---- 横断検索 ----
  console.log("[3] 横断検索");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    s.journals["2026-07-01"] = "今日はギターの練習を30分やった。";
    s.questions = s.questions || [];
    s.questions.push({ id: "q-test-1", text: "ギターで何を弾けるようになりたいか?", origin: "manual", status: "open", settledNote: "", settledAt: null, lastTouchedAt: null, linkedProjectId: null, linkedTaskId: null, createdAt: "2026-07-02T10:00", updatedAt: "2026-07-02T10:00", deleted: false });
    s.zeroThinking = s.zeroThinking || { themes: [], entries: [] };
    s.zeroThinking.entries.push({ id: "e-test-1", date: "2026-07-03", theme: "ギター上達", body: "毎日15分でいいから触る", createdAt: "2026-07-03T21:00" });
    localStorage.setItem("taskchute-journal-pwa-state-v1", JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(600);
  // 日付バー(検索ボタンを含む)があるビューへ移動(設定画面には日付バーが無い)
  await page.click('[data-action="nav"][data-view="journal"]');
  await page.waitForTimeout(300);
  check("日付バーに 🔍 ボタン", await page.locator('[data-action="open-search"]').count() >= 1);
  await page.locator('[data-action="open-search"]').first().click();
  await page.waitForTimeout(300);
  check("検索モーダルが開く", await page.locator("#cross-search-input").count() === 1);
  await page.fill("#cross-search-input", "ギター");
  await page.waitForTimeout(400);
  const hitKinds = await page.evaluate(() => [...document.querySelectorAll(".search-hit .search-kind")].map((el) => el.textContent));
  check("ジャーナル・問い・0秒思考の3種がヒット", hitKinds.includes("ジャーナル") && hitKinds.includes("問い") && hitKinds.includes("0秒思考"), `got: ${hitKinds.join(",")}`);
  check("マッチ強調 <mark>", await page.locator(".search-hit mark").count() >= 3);
  // ジャーナルヒットをクリック → journal ビュー + 該当日付へ
  await page.locator('.search-hit[data-view="journal"]').first().click();
  await page.waitForTimeout(400);
  const jumped = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    return { view: s.currentView, date: s.selectedDate };
  });
  check("ヒットクリックで journal + 2026-07-01 へ", jumped.view === "journal" && jumped.date === "2026-07-01", JSON.stringify(jumped));
  // 1文字では検索しない
  await page.locator('[data-action="open-search"]').first().click();
  await page.waitForTimeout(200);
  await page.fill("#cross-search-input", "ギ");
  await page.waitForTimeout(400);
  check("1文字はガイダンス表示", (await page.locator("#cross-search-results").textContent()).includes("2文字以上"));
  await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
  await page.waitForTimeout(200);

  // ---- 世代バックアップ(fetch モック) ----
  console.log("[4] 世代バックアップ");
  await page.evaluate(() => {
    // GitHub 設定を投入
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    s.settings.github = { ...s.settings.github, owner: "kojit1229", repo: "taskchute-ipad", branch: "main", path: "app-state.json", token: "ghp_test" };
    localStorage.setItem("taskchute-journal-pwa-state-v1", JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.removeItem("taskchute-backup-last-date");
    localStorage.setItem("taskchute-journal-last-synced-sha", "sha-main-1");
    window.__ghCalls = [];
    window.fetch = (url, opts = {}) => {
      const u = String(url); const method = opts.method || "GET";
      window.__ghCalls.push({ url: u, method });
      // メインファイル SHA / 本文(v72: 個人データリポジトリの taskchute/ 配下)
      if (u.includes("/contents/taskchute/app-state.json") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ sha: "sha-main-1", content: btoa(unescape(encodeURIComponent(JSON.stringify({ dataModifiedAt: "" })))), encoding: "base64" }), { status: 200 }));
      }
      if (u.includes("/contents/taskchute/app-state.json") && method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-main-2" } }), { status: 200 }));
      }
      // backups: 今日のファイルはまだ無い(v72: taskchute/backups/配下)
      if (u.includes("/contents/taskchute/backups/app-state-") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      if (u.includes("/contents/taskchute/backups/app-state-") && method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-bk-1" } }), { status: 200 }));
      }
      // backups ディレクトリ一覧(古いものを1つ混ぜる)
      if (u.match(/\/contents\/taskchute\/backups\?/) && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify([
          { name: "app-state-2026-05-01.json", sha: "sha-old" },
          { name: "app-state-2026-07-06.json", sha: "sha-recent" }
        ]), { status: 200 }));
      }
      if (u.includes("/contents/taskchute/backups/app-state-2026-05-01.json") && method === "DELETE") {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
  });
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="save-github"]');
  await page.waitForTimeout(1200);
  const ghCalls = await page.evaluate(() => window.__ghCalls);
  const snapPut = ghCalls.find((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/app-state-"));
  const pruneDel = ghCalls.find((c) => c.method === "DELETE" && c.url.includes("app-state-2026-05-01.json"));
  check("保存成功後にスナップショット PUT", !!snapPut, JSON.stringify(ghCalls.map((c) => `${c.method} ${c.url.split("repos/")[1] || c.url}`)));
  check("14日より古い世代を DELETE(プルーニング)", !!pruneDel);
  check("1日1回ガードが記録される", await page.evaluate(() => !!localStorage.getItem("taskchute-backup-last-date")));
  // 2回目の保存ではスナップショットを書かない
  await page.evaluate(() => { window.__ghCalls = []; });
  await page.click('[data-action="save-github"]');
  await page.waitForTimeout(800);
  const ghCalls2 = await page.evaluate(() => window.__ghCalls);
  check("同日2回目はスナップショットをスキップ", !ghCalls2.some((c) => c.method === "PUT" && c.url.includes("/contents/taskchute/backups/")));

  // 復元フロー
  await page.evaluate(() => {
    window.fetch = (url, opts = {}) => {
      const u = String(url); const method = opts.method || "GET";
      if (u.match(/\/contents\/taskchute\/backups\?/) && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify([{ name: "app-state-2026-07-06.json", sha: "sha-recent" }]), { status: 200 }));
      }
      if (u.includes("/contents/taskchute/backups/app-state-2026-07-06.json") && method === "GET") {
        const snap = { dataModifiedAt: "2026-07-06T20:00", journals: { "2026-07-06": "スナップショットのジャーナル" }, settings: {} };
        return Promise.resolve(new Response(JSON.stringify({ sha: "sha-recent", encoding: "base64", content: btoa(unescape(encodeURIComponent(JSON.stringify(snap)))) }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    window.confirm = () => true;
  });
  await page.click('[data-action="open-backup-list"]');
  await page.waitForTimeout(500);
  check("バックアップ一覧モーダル", await page.locator(".backup-row").count() === 1);
  await page.click('[data-action="restore-backup"]');
  await page.waitForTimeout(800);
  const restored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    return { j: s.journals["2026-07-06"], token: s.settings.github.token, t: s.dataModifiedAt };
  });
  check("復元でスナップショット内容が反映", restored.j === "スナップショットのジャーナル");
  check("復元後も token を引き継ぐ", restored.token === "ghp_test");
  check("復元は最新変更として dataModifiedAt 更新", restored.t > "2026-07-06T20:00");

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
