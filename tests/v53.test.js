// v53 検証: 自動アーカイブ
//
// v60メモ: 本スイートはもともと「朝の体調相関の学習注入」(下書きスケジュールのAIプロンプトへ
// buildScheduleLearningDigest() の集計結果を注入する機能)も検証していたが、v60でアプリ内からの
// Claude API直接呼び出しを全廃したのに伴い、そのプロンプト注入経路(および呼び出し元を失った
// buildScheduleLearningDigest/morningEnergyCorrelation自体)を削除したため、該当セクションは
// 削除した(詳細はCHANGES_v60.md)。自動アーカイブはAI呼び出しと無関係なのでそのまま残す。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}
const b64ToObj = (b64) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(today);
  const daysAgo = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- seed ----
  await page.evaluate(({ TODAY, KEY, daysAgoMap }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.github = { ...s.settings.github, owner: "kojit1229", repo: "taskchute-ipad", branch: "main", path: "app-state.json", token: "ghp_test" };
    s.projects.push({ id: "proj-1", kind: "normal", title: "P", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: TODAY, createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false });
    s.tasks.push({ id: "task-A", projectId: "proj-1", parentTaskId: "", title: "資料作成", category: "", status: "todo", dueDate: TODAY, description: "", createdAt: "2026-01-02T00:00", updatedAt: "2026-01-02T00:00", deleted: false });
    // taskId 付き = taskchuteStartRate(着手率)の分母に乗る
    const mk = (id, date, hh, started, extra = {}) => ({
      id, taskId: "task-A", date, title: `B${id}`, category: "作業",
      plannedStartAt: `${date}T${hh}:00`, plannedEndAt: `${date}T${hh}:30`,
      actualStartAt: started ? `${date}T${hh}:00` : "", actualEndAt: started ? `${date}T${hh}:45` : "",
      completed: started, charge: started ? 2 : 0, discharge: started ? 1 : 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00", deleted: false, ...extra
    });
    // 見積vs実績 + ヒートマップ用: 同じ曜日(7日おき)×2系列、見積30分・実績45分 = 150%
    [7, 14, 21].forEach((n, i) => s.blocks.push(mk(`est-a${i}`, daysAgoMap[n], "10", true, { estimateMin: 30 })));
    [8, 15, 22].forEach((n, i) => s.blocks.push(mk(`est-b${i}`, daysAgoMap[n], "10", true, { estimateMin: 30 })));
    // 相関用: 体調が低い6日(1件着手) / 良い6日(全着手)
    s.settings.morningEnergyLog = s.settings.morningEnergyLog || {};
    [1, 2, 3, 4, 5, 6].forEach((n, i) => {
      s.settings.morningEnergyLog[daysAgoMap[n]] = 3;
      s.blocks.push(mk(`low-${i}`, daysAgoMap[n], "16", i === 0));
    });
    [8, 9, 10, 11, 12, 13].forEach((n, i) => {
      s.settings.morningEnergyLog[daysAgoMap[n]] = 7;
      s.blocks.push(mk(`high-${i}`, daysAgoMap[n], "16", true));
    });
    s.settings.morningEnergyLog[TODAY] = 3;  // 今朝の体調
    // アーカイブ対象: 90日超の日報/フィードバック/ジャーナル、180日超のBlock(前年分も混ぜる)
    s.reports[daysAgoMap[100]] = "# 古い日報100";
    s.reports[daysAgoMap.prevYear] = "# 大昔の日報400";
    s.feedback[daysAgoMap[100]] = "古いフィードバック100";
    s.journals[daysAgoMap[100]] = "古いジャーナル100";
    s.reports[daysAgoMap[10]] = "# 最近の日報10";
    s.blocks.push(mk("old-block", daysAgoMap[200], "09", true));
    s.blocks.push(mk("mid-block", daysAgoMap[100], "09", true));
    s.selectedDate = TODAY;
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem("taskchute-archive-last-date");
  }, { TODAY, KEY, daysAgoMap: { ...Object.fromEntries([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,21,22,100,200].map((n) => [n, daysAgo(n)])), prevYear: `${today.getFullYear() - 1}-01-15` } });
  await page.reload();
  await page.waitForTimeout(600);

  // ---- [2] アーカイブ用のGitHub fetchモックを設置 ----
  await page.evaluate(() => {
    window.__gh = { puts: [], failPut: false, existing2026: null, dirList: null };
    const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    window.fetch = (url, opts = {}) => {
      const u = String(url);
      const m = opts.method || "GET";
      if (u.includes("/contents/taskchute/archive/archive-") && m === "GET") {
        const year = u.match(/archive-(\d{4})/)[1];
        if (year === "2026" && window.__gh.existing2026) {
          return Promise.resolve(new Response(JSON.stringify({ sha: "sha-a26", encoding: "base64", content: enc(window.__gh.existing2026) }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      if (u.includes("/contents/taskchute/archive/archive-") && m === "PUT") {
        if (window.__gh.failPut) return Promise.resolve(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
        window.__gh.puts.push({ url: u, body: JSON.parse(opts.body) });
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-new" } }), { status: 200 }));
      }
      if (u.match(/\/contents\/taskchute\/archive\?/) && m === "GET") {
        if (window.__gh.dirList) return Promise.resolve(new Response(JSON.stringify(window.__gh.dirList), { status: 200 }));
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
  });

  // ---- [3] アーカイブ ----
  console.log("[3] 自動アーカイブ");
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  const settingsText = await page.locator("main").textContent();
  check("設定にアーカイブ節(サイズ表示)", settingsText.includes("アーカイブ(容量対策)") && /端末内データ: \d/.test(settingsText));
  // v148(UI改善計画Phase3-2)以降、run-archiveは「データと同期」群のdetails内にあり既定closed。
  // <summary>を実クリックして開く。
  await openSettingsGroup(page, "settings-sync");
  await page.click('[data-action="run-archive"]');
  await page.waitForTimeout(900);
  const puts = await page.evaluate(() => window.__gh.puts);
  // 対象データの年数(実行日によって 100/200 日前が前年に落ちることがある)
  const expectedYears = new Set([daysAgo(100).slice(0, 4), daysAgo(200).slice(0, 4), String(today.getFullYear() - 1)]).size;
  check(`年ごとにPUTされる(${expectedYears}年分)`, puts.length === expectedYears, `puts=${puts.length}`);
  const allArch = puts.map((p) => b64ToObj(p.body.content));
  const inAny = (fn) => allArch.some(fn);
  check("PUT本文に古い日報・ジャーナル・Blockが入る",
    inAny((a) => Object.values(a.reports || {}).includes("# 古い日報100"))
    && inAny((a) => Object.values(a.journals || {}).includes("古いジャーナル100"))
    && inAny((a) => (a.blocks || []).some((b) => b.id === "old-block")));
  check("前年の日報もPUTされる", inAny((a) => Object.values(a.reports || {}).includes("# 大昔の日報400")));
  const after = await page.evaluate(({ KEY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return {
      reports: Object.values(s.reports || {}),
      journalsOld: Object.values(s.journals || {}).filter((t) => String(t).includes("古いジャーナル100")).length,
      hasOldBlock: s.blocks.some((b) => b.id === "old-block"),
      hasMidBlock: s.blocks.some((b) => b.id === "mid-block"),
      last: s.settings.lastArchivedAt
    };
  }, { KEY });
  check("古い日報が消え、最近の日報は残る", !after.reports.includes("# 古い日報100") && after.reports.includes("# 最近の日報10"));
  check("古いジャーナルが消える", after.journalsOld === 0);
  check("180日超Blockは消え、100日Blockは残る", !after.hasOldBlock && after.hasMidBlock);
  check("lastArchivedAt が記録される", Boolean(after.last));

  // マージ(既存sha)と失敗時の安全性
  await page.evaluate(({ KEY, oldDate }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.reports[oldDate] = "# 追加の古い日報95";
    localStorage.setItem(KEY, JSON.stringify(s));
    window.__gh.puts = [];
    window.__gh.existing2026 = { reports: {}, feedback: {}, journals: { "2026-01-01": "既存アーカイブ分" }, blocks: [] };
  }, { KEY, oldDate: daysAgo(95) });
  await page.reload();
  await page.waitForTimeout(500);
  // reload で fetch モックが消えるため再設置
  await page.evaluate(() => {
    const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    window.__gh = window.__gh || {};
    window.__gh.puts = [];
    window.__gh.failPut = false;
    window.__gh.existing2026 = { reports: {}, feedback: {}, journals: { "2026-01-01": "既存アーカイブ分" }, blocks: [] };
    window.fetch = (url, opts = {}) => {
      const u = String(url);
      const m = opts.method || "GET";
      if (u.includes("/contents/taskchute/archive/archive-") && m === "GET") {
        const year = u.match(/archive-(\d{4})/)[1];
        if (year === "2026" && window.__gh.existing2026) {
          return Promise.resolve(new Response(JSON.stringify({ sha: "sha-a26", encoding: "base64", content: enc(window.__gh.existing2026) }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      if (u.includes("/contents/taskchute/archive/archive-") && m === "PUT") {
        if (window.__gh.failPut) return Promise.resolve(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
        window.__gh.puts.push({ url: u, body: JSON.parse(opts.body) });
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-new" } }), { status: 200 }));
      }
      if (u.match(/\/contents\/taskchute\/archive\?/) && m === "GET") {
        if (window.__gh.dirList) return Promise.resolve(new Response(JSON.stringify(window.__gh.dirList), { status: 200 }));
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
  });
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  await openSettingsGroup(page, "settings-sync");
  await page.click('[data-action="run-archive"]');
  await page.waitForTimeout(900);
  const mergePut = await page.evaluate(() => window.__gh.puts[0] || null);
  const mergedObj = mergePut ? b64ToObj(mergePut.body.content) : null;
  check("既存アーカイブとマージ(sha付きPUT)", mergePut && mergePut.body.sha === "sha-a26"
    && mergedObj.journals["2026-01-01"] === "既存アーカイブ分"
    && Object.values(mergedObj.reports).includes("# 追加の古い日報95"), JSON.stringify(mergePut?.body?.sha));

  // PUT失敗 → 何も消えない
  await page.evaluate(({ KEY, oldDate }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.reports[oldDate] = "# 消えてはいけない日報";
    localStorage.setItem(KEY, JSON.stringify(s));
    window.__gh.failPut = true;
  }, { KEY, oldDate: daysAgo(96) });
  await page.click('[data-action="run-archive"]');
  await page.waitForTimeout(900);
  const failKept = await page.evaluate(({ KEY }) =>
    Object.values(JSON.parse(localStorage.getItem(KEY)).reports || {}).includes("# 消えてはいけない日報"), { KEY });
  check("PUT失敗時はローカルから削除しない", failKept);

  // ---- 検索へのアーカイブ合流 ----
  console.log("[4] 検索のアーカイブ合流");
  await page.evaluate(({ year }) => {
    window.__gh.failPut = false;
    window.__gh.dirList = [{ name: `archive-${year}.json` }];
    window.__gh.existing2026 = { reports: {}, feedback: {}, journals: { "2026-01-05": "アーカイブされた昔のギター日記" }, blocks: [] };
  }, { year: TODAY.slice(0, 4) });
  await page.click('[data-action="nav"][data-view="tasks"]');  // 🔍 は日付バー(設定ビューには無い)
  await page.waitForTimeout(300);
  await page.locator('[data-action="open-search"]').first().click();
  await page.waitForTimeout(300);
  check("検索にアーカイブチェックボックス", await page.locator("#cross-search-archive").count() === 1);
  await page.locator("#cross-search-archive").check();
  await page.waitForTimeout(700);
  await page.fill("#cross-search-input", "ギター");
  await page.waitForTimeout(400);
  const archHit = await page.locator(".search-hit.is-archive").count();
  const archLabel = await page.evaluate(() => [...document.querySelectorAll(".search-hit .search-kind")].map((e) => e.textContent).join(","));
  check("アーカイブのヒットが出る(旧ジャーナル・閲覧のみ)", archHit === 1 && archLabel.includes("旧ジャーナル"), archLabel);
  await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());

  // ---- [5] 後方互換 ----
  console.log("[5] 後方互換");
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    delete s.settings.autoArchive;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('[data-action="nav"][data-view="today"]');  // v230: home撤去後の現行view
  await page.waitForTimeout(300);
  const compat = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { auto: s.settings.autoArchive };
  }, KEY);
  check("旧stateにデフォルトが補完される", compat.auto === true, JSON.stringify(compat));

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
