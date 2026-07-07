// v49 検証: AIレビュー直接統合 / 世代バックアップ / 横断検索
const { chromium, ROOT, launchOptions, startServer } = require("./helpers");

const PORT = 4199;

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

  // ---- 起動 & v48相当stateの後方互換(normalizeState) ----
  console.log("[1] 起動 / normalizeState 後方互換");
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  const aiDefaults = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1") || "{}");
    return { hasAi: !!raw.settings?.ai, model: raw.settings?.ai?.model, key: raw.settings?.ai?.apiKey };
  });
  // 初回は state 未保存の可能性 → 画面内 state を直接見る手段がないので、設定画面経由で確認
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(300);
  check("設定に AIレビュー カードが表示される", await page.locator("h2", { hasText: "AIレビュー(Anthropic API)" }).count() === 1);
  check("APIキー入力欄がある", await page.locator('input[data-ai-field="apiKey"]').count() === 1);
  check("モデル select の既定が claude-opus-4-8", await page.locator('select[data-ai-field="model"]').inputValue() === "claude-opus-4-8");
  check("バックアップ復元ボタンがある", await page.locator('[data-action="open-backup-list"]').count() === 1);

  // ---- APIキー入力 → state 反映 & エクスポートに含まれない ----
  console.log("[2] APIキーの保存とサニタイズ");
  await page.fill('input[data-ai-field="apiKey"]', "sk-ant-test-key-123");
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")));
  check("apiKey が localStorage state に入る", st.settings.ai.apiKey === "sk-ant-test-key-123");
  // モデル変更
  await page.selectOption('select[data-ai-field="model"]', "claude-sonnet-5");
  await page.waitForTimeout(200);
  const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")));
  check("model 変更が保存される", st2.settings.ai.model === "claude-sonnet-5");
  await page.selectOption('select[data-ai-field="model"]', "claude-opus-4-8");
  await page.waitForTimeout(200);

  // sanitizedStateForGitHub 相当: JSONエクスポートの中身を検証(download をフック)
  const exported = await page.evaluate(() => new Promise((resolve) => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blob.text().then((t) => resolve(t)); return "blob:fake"; };
    document.querySelector('[data-action="download-data"]').click();
    setTimeout(() => resolve(""), 2000);
  }));
  const expObj = JSON.parse(exported || "{}");
  check("エクスポートJSONに apiKey が含まれない", expObj.settings?.ai?.apiKey === "");
  check("エクスポートJSONに github token が含まれない", expObj.settings?.github?.token === "");

  // ---- AIレビュー実行(fetch モック) ----
  console.log("[3] AIレビュー実行(fetch モック)");
  await page.evaluate(() => {
    window.__aiCalls = [];
    const origFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).includes("api.anthropic.com")) {
        window.__aiCalls.push({ url: String(url), opts: { headers: opts.headers, body: JSON.parse(opts.body) } });
        return Promise.resolve(new Response(JSON.stringify({
          content: [
            { type: "thinking", thinking: "…" },
            { type: "text", text: "## フィードバック\n良い一日でした。\n## 明日の0秒思考テーマ\n- なぜ午後に失速したのか?\n## MIT候補\n- 企画書を仕上げる\n## 問い候補\n- 本当に必要な会議はどれか?" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return origFetch(url, opts);
    };
  });
  // 日報ビューへ → 日報生成 → AIレビュー実行
  await page.click('[data-action="nav"][data-view="reports"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="generate-report"]');
  await page.waitForTimeout(300);
  check("AIレビュー実行ボタンが表示される(キーあり)", await page.locator('[data-action="report-ai-review"]').count() >= 1);
  await page.click('[data-action="report-ai-review"]');
  await page.waitForTimeout(800);
  const aiCall = await page.evaluate(() => window.__aiCalls[0] || null);
  check("Messages API が呼ばれた", !!aiCall);
  if (aiCall) {
    check("x-api-key ヘッダ", aiCall.opts.headers["x-api-key"] === "sk-ant-test-key-123");
    check("CORS オプトインヘッダ", aiCall.opts.headers["anthropic-dangerous-direct-browser-access"] === "true");
    check("model = claude-opus-4-8", aiCall.opts.body.model === "claude-opus-4-8");
    check("adaptive thinking 付与", aiCall.opts.body.thinking?.type === "adaptive");
    check("日報がプロンプトとして送られる", String(aiCall.opts.body.messages[0].content).includes("# 日報"));
  }
  const fb = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    return s.feedback[s.selectedDate] || "";
  });
  check("feedback[date] にレビューが保存される(thinking除外)", fb.startsWith("## フィードバック") && !fb.includes("…"));
  check("取り込みモーダルが自動で開く", await page.locator(".ai-import-row").count() === 3);
  await page.click('[data-action="modal-close"]');
  await page.waitForTimeout(200);

  // Haiku選択時は thinking なし
  await page.click('[data-action="nav"][data-view="settings"]');
  await page.waitForTimeout(200);
  await page.selectOption('select[data-ai-field="model"]', "claude-haiku-4-5");
  await page.waitForTimeout(200);
  await page.click('[data-action="nav"][data-view="reports"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="report-ai-review"]');
  await page.waitForTimeout(600);
  const call2 = await page.evaluate(() => window.__aiCalls[1] || null);
  check("Haiku では thinking を送らない", call2 && call2.opts.body.model === "claude-haiku-4-5" && !("thinking" in call2.opts.body));
  await page.evaluate(() => document.querySelector('[data-action="modal-close"]')?.click());
  await page.waitForTimeout(200);

  // エラー経路(401)
  await page.evaluate(() => {
    window.fetch = (url) => {
      if (String(url).includes("api.anthropic.com")) {
        return Promise.resolve(new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }));
      }
      return Promise.reject(new Error("unexpected"));
    };
  });
  await page.click('[data-action="report-ai-review"]');
  await page.waitForTimeout(600);
  const toast = await page.evaluate(() => document.querySelector(".toast")?.textContent || "");
  check("401 でヒント付きトースト", toast.includes("AIレビュー失敗") && toast.includes("APIキー"), `got: ${toast}`);

  // ---- ジャーナル側のボタン ----
  await page.click('[data-action="nav"][data-view="journal"]');
  await page.waitForTimeout(300);
  check("ジャーナルにも AIレビューボタン", await page.locator('[data-action="report-ai-review"]').count() === 1);

  // ---- 横断検索 ----
  console.log("[4] 横断検索");
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
  console.log("[5] 世代バックアップ");
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
      // メインファイル SHA / 本文
      if (u.includes("/contents/app-state.json") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ sha: "sha-main-1", content: btoa(unescape(encodeURIComponent(JSON.stringify({ dataModifiedAt: "" })))), encoding: "base64" }), { status: 200 }));
      }
      if (u.includes("/contents/app-state.json") && method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-main-2" } }), { status: 200 }));
      }
      // backups: 今日のファイルはまだ無い
      if (u.includes("/contents/backups/app-state-") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
      }
      if (u.includes("/contents/backups/app-state-") && method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: "sha-bk-1" } }), { status: 200 }));
      }
      // backups ディレクトリ一覧(古いものを1つ混ぜる)
      if (u.match(/\/contents\/backups\?/) && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify([
          { name: "app-state-2026-05-01.json", sha: "sha-old" },
          { name: "app-state-2026-07-06.json", sha: "sha-recent" }
        ]), { status: 200 }));
      }
      if (u.includes("/contents/backups/app-state-2026-05-01.json") && method === "DELETE") {
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
  const snapPut = ghCalls.find((c) => c.method === "PUT" && c.url.includes("/contents/backups/app-state-"));
  const pruneDel = ghCalls.find((c) => c.method === "DELETE" && c.url.includes("app-state-2026-05-01.json"));
  check("保存成功後にスナップショット PUT", !!snapPut, JSON.stringify(ghCalls.map((c) => `${c.method} ${c.url.split("repos/")[1] || c.url}`)));
  check("14日より古い世代を DELETE(プルーニング)", !!pruneDel);
  check("1日1回ガードが記録される", await page.evaluate(() => !!localStorage.getItem("taskchute-backup-last-date")));
  // 2回目の保存ではスナップショットを書かない
  await page.evaluate(() => { window.__ghCalls = []; });
  await page.click('[data-action="save-github"]');
  await page.waitForTimeout(800);
  const ghCalls2 = await page.evaluate(() => window.__ghCalls);
  check("同日2回目はスナップショットをスキップ", !ghCalls2.some((c) => c.method === "PUT" && c.url.includes("/contents/backups/")));

  // 復元フロー
  await page.evaluate(() => {
    window.fetch = (url, opts = {}) => {
      const u = String(url); const method = opts.method || "GET";
      if (u.match(/\/contents\/backups\?/) && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify([{ name: "app-state-2026-07-06.json", sha: "sha-recent" }]), { status: 200 }));
      }
      if (u.includes("/contents/backups/app-state-2026-07-06.json") && method === "GET") {
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
    return { j: s.journals["2026-07-06"], token: s.settings.github.token, aiKey: s.settings.ai.apiKey, t: s.dataModifiedAt };
  });
  check("復元でスナップショット内容が反映", restored.j === "スナップショットのジャーナル");
  check("復元後も token を引き継ぐ", restored.token === "ghp_test");
  check("復元後も APIキーを引き継ぐ", restored.aiKey === "sk-ant-test-key-123");
  check("復元は最新変更として dataModifiedAt 更新", restored.t > "2026-07-06T20:00");

  // ---- キー未設定時のボタン状態 ----
  console.log("[6] キー未設定時");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
    s.settings.ai.apiKey = "";
    s.currentView = "reports";
    localStorage.setItem("taskchute-journal-pwa-state-v1", JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('[data-action="generate-report"]');
  await page.waitForTimeout(300);
  const disabledBtn = await page.locator('button:has-text("AIレビュー(要APIキー)")').count();
  check("キー未設定は disabled ボタン + ヒント", disabledBtn >= 1);

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
