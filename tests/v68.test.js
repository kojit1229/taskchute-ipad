// v68 検証: 非同期AI対話(日報の「AIへの質問」→ origin:"user" 問い) +
//           人生実験機構(state.experiments、1件のみ推奨のカードUI)。
//
// (a) generateReport(): origin:"user"かつ未解決の問いがあれば「## AIへの質問」節が出る。
//     無ければ節ごと省略される。日報タブの #reportAskInput に1行入力して「日報を生成」を押すと
//     origin:"user" の問いが1件作られ、入力欄はクリアされる。
// (b) 実験カード(state.experiments): 「+ 実験を始める」→モーダルで仮説/判定材料/開始日/終了日
//     (既定14日後)を入力して保存 → running として1件作られる。
// (c) 2件目の抑制: 実験中に「別の実験を試したい」を押してもモーダルは開かず
//     「1つに絞る」文言のトーストが出る。
//     v141メモ: ジャーナルのAIフィードバック欄「🧪 実験にする」ボタンは同欄のUI撤去に伴い
//     消滅したため、当該ボタンの回帰チェックは削除した(同じガードは(c)本体で確認済み)。
// (d) 終了日超過: 実験中カードに結論入力欄+「続ける(kept)/手放す(dropped)」ボタンが出る。
//     結論が空だと拒否され、入力すればstatus/conclusionが保存される。
// (e) kept実験は「原則(アファメーション)への昇格候補」として結論がコピーボタン付きで表示される。
// (f) 編集/削除: 実験中(未超過)は「編集」から仮説等を更新でき、削除するとdeleted:trueになり
//     activeExperiment()がnullに戻る(再び「+ 実験を始める」に戻る)。
// (g) normalizeState 後方互換: experimentsキー自体が無い旧stateにも[]が補完され、
//     旧エントリ(status/conclusion等が無い)にも既定値が補完される。
//
// 方針: v62/v65/v67と同じく、app.js は type="module" のため内部関数はwindowに露出しない。
// ブラウザ操作 + localStorage 状態の直接注入で観測する。AIプラン/AIフィードバック/週次レビューの
// 実ファイルfetchはpage.routeで常に404隔離し、リポジトリの実ファイル有無に結果が左右されないようにする。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  // v67と同じ理由: 本番バッチが実際にAIプラン_*.json/AIフィードバック_*.md/週次レビュー_*.mdを
  // 日次でcommitするため、これらを常に404にルーティングして環境依存を消す。
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };

  function makeQuestionSeed(text, origin, status = "open") {
    return {
      id: `q-${origin}-${status}-${Math.random().toString(36).slice(2, 8)}`,
      text, origin, status,
      settledNote: "", settledAt: null, lastTouchedAt: null,
      linkedProjectId: null, linkedTaskId: null,
      createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false
    };
  }

  async function seed({ view = "home", questions = [], experiments } = {}) {
    await page.evaluate(({ KEY, TODAY, view, questions, experiments }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.tasks = [];
      s.projects = [];
      s.journals = s.journals || {};
      s.reports = {};
      s.questions = questions;
      if (experiments !== undefined) s.experiments = experiments;
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, view, questions, experiments });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // "## 見出し" から次の "## " 見出し(または末尾)までを切り出す。
  // 日報には既存v39の「いま持ち続けている「問い」:」節(origin不問で全open/deepening問いを列挙)が
  // 別にあるため、「## AIへの質問」の origin フィルタ検証はこの節の中だけを見て行う。
  function extractSection(md, heading) {
    const idx = md.indexOf(heading);
    if (idx === -1) return null;
    const rest = md.slice(idx + heading.length);
    const next = rest.search(/\n##\s/);
    return next === -1 ? rest : rest.slice(0, next);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
    // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
    await passGithubGate(page);

    // ============================================================
    // (g) normalizeState 後方互換
    // ============================================================
    console.log("[1] normalizeState 後方互換: experimentsキー自体が無い旧state → []補完、旧エントリ → 既定値補完");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.experiments;  // フィールド自体が無い旧state
      s.blocks = []; s.tasks = []; s.projects = []; s.questions = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="home"]');  // 正規化値を永続化させる
    await page.waitForTimeout(200);
    const norm1 = await stateNow();
    check("旧stateにexperiments:[]が補完される", Array.isArray(norm1.experiments) && norm1.experiments.length === 0, JSON.stringify(norm1.experiments));

    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.experiments = [{ id: "legacy-exp", hypothesis: "睡眠を7時間確保する" }];  // status/conclusion等が無い旧エントリ
      s.blocks = []; s.tasks = []; s.projects = []; s.questions = [];
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('[data-action="nav"][data-view="home"]');
    await page.waitForTimeout(200);
    const norm2 = await stateNow();
    const legacyExp = (norm2.experiments || []).find((e) => e.id === "legacy-exp");
    check("旧実験エントリにstatus:runningが補完される", legacyExp?.status === "running", JSON.stringify(legacyExp));
    check("旧実験エントリにconclusion:\"\"が補完される", legacyExp?.conclusion === "", JSON.stringify(legacyExp));
    check("旧実験エントリにendDateが補完される(空でない)", !!legacyExp?.endDate, JSON.stringify(legacyExp));
    check("仮説テキストは保持される(既存値優先)", legacyExp?.hypothesis === "睡眠を7時間確保する");

    // ============================================================
    // (a) 「AIへの質問」節: origin:"user"かつ未解決のみ拾う。空なら省略
    // ============================================================
    console.log("[2] generateReport(): origin:user & status!=settled の問いだけ「## AIへの質問」節に出る");
    await seed({
      view: "reports",
      questions: [
        makeQuestionSeed("来週の12WY目標、このペースで間に合いそう?", "user", "open"),
        makeQuestionSeed("結論済みのuser質問(出ないはず)", "user", "settled"),
        makeQuestionSeed("originがmanualの問い(出ないはず)", "manual", "open")
      ]
    });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const report2 = s2.reports[TODAY] || "";
    check("「## AIへの質問」見出しが出る", report2.includes("## AIへの質問"), report2.slice(0, 400));
    const askSection2 = extractSection(report2, "## AIへの質問") || "";
    check("未解決のuser質問本文が「## AIへの質問」節に出る", askSection2.includes("来週の12WY目標、このペースで間に合いそう?"), askSection2);
    check("settled済みのuser質問は「## AIへの質問」節に出ない", !askSection2.includes("結論済みのuser質問"), askSection2);
    check("origin:manualの問いは「## AIへの質問」節に出ない(既存v39の「いま持ち続けている問い」節とは別)", !askSection2.includes("originがmanualの問い"), askSection2);

    console.log("[3] generateReport(): origin:userの未解決質問が無ければ「## AIへの質問」節ごと省略される");
    await seed({ view: "reports", questions: [makeQuestionSeed("manualの問い", "manual", "open")] });
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    check("該当質問が無い日は見出しが出ない", !(s3.reports[TODAY] || "").includes("## AIへの質問"));

    console.log("[4] 日報タブの#reportAskInputに1行入力→「日報を生成」でorigin:userの問いが1件作られ、入力欄がクリアされる");
    await seed({ view: "reports", questions: [] });
    check("#reportAskInputが存在する", await page.locator("#reportAskInput").count() === 1);
    await page.fill("#reportAskInput", "投資の勉強、今のペースで合ってる?");
    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s4 = await stateNow();
    const createdQ = (s4.questions || []).find((q) => q.text === "投資の勉強、今のペースで合ってる?");
    check("origin:userの問いが作られる", !!createdQ, JSON.stringify(s4.questions));
    check("originはuser", createdQ?.origin === "user");
    check("statusはopen", createdQ?.status === "open");
    check("日報にも反映される", (s4.reports[TODAY] || "").includes("投資の勉強、今のペースで合ってる?"));
    check("入力欄がクリアされる", await page.locator("#reportAskInput").inputValue() === "");

    // ============================================================
    // (b) 実験カード: 新規作成
    // ============================================================
    console.log("[5] 実験カード: 「+ 実験を始める」→モーダルで仮説等を入力して保存→runningで1件作られる");
    await seed({ view: "journal", experiments: [] });
    check("実験なし表示(+実験を始めるボタン)", await page.locator('[data-action="experiment-add"]').count() >= 1);
    await page.click('.exp-card [data-action="experiment-add"]');
    await page.waitForTimeout(200);
    check("実験モーダルが開く", await page.locator('.modal-card:has-text("実験を始める")').count() === 1);
    check("開始日は既定で今日", await page.locator('[data-modal-field="startDate"]').inputValue() === TODAY);
    check("終了日は既定で14日後", await page.locator('[data-modal-field="endDate"]').inputValue() === addDaysStr(TODAY, 14));
    await page.fill('[data-modal-field="hypothesis"]', "締切を1日前倒しすると着手率が上がる");
    await page.fill('[data-modal-field="metric"]', "該当タスクの着手率");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s5 = await stateNow();
    check("実験が1件作られる", (s5.experiments || []).length === 1, JSON.stringify(s5.experiments));
    const newExp = s5.experiments[0];
    check("statusはrunning", newExp?.status === "running");
    check("仮説が保存される", newExp?.hypothesis === "締切を1日前倒しすると着手率が上がる");
    check("判定材料が保存される", newExp?.metric === "該当タスクの着手率");
    check("実験中カードに仮説文が表示される", (await page.locator(".exp-card .exp-hypothesis").textContent()).includes("締切を1日前倒し"));

    // ============================================================
    // (c) 2件目の抑制
    // ============================================================
    console.log("[6] 実験中に2件目を作ろうとすると「1つに絞る」トーストが出て、モーダルは開かない");
    check("「別の実験を試したい」ボタンが出る(実験中モード)", await page.locator('[data-action="experiment-add"]:has-text("別の実験を試したい")').count() === 1);
    await page.click('[data-action="experiment-add"]:has-text("別の実験を試したい")');
    await page.waitForTimeout(300);
    check("モーダルは開かない", await page.locator(".modal-card").count() === 0);
    const toastText6 = await page.locator("#toast").textContent();
    check("「1つに絞る」文言のトーストが出る", toastText6.includes("実験は1つに絞りましょう"), toastText6);
    const s6 = await stateNow();
    check("実験は増えない(1件のまま)", (s6.experiments || []).length === 1);
    // v141: ジャーナルのAIフィードバック欄「🧪 実験にする」ボタンはUI撤去に伴い削除された
    // (旧[7]。ガード自体は上の「別の実験を試したい」チェックで確認済み)。

    // ============================================================
    // (f) 編集/削除(終了日未超過)
    // ============================================================
    console.log("[8] 終了日未超過の実験中は「編集」から更新でき、「削除」でdeleted:trueになりカードが戻る");
    await page.click('[data-action="edit-experiment"]');
    await page.waitForTimeout(200);
    check("編集モーダルが開き既存の仮説が入っている", await page.locator('[data-modal-field="hypothesis"]').inputValue() === "締切を1日前倒しすると着手率が上がる");
    await page.fill('[data-modal-field="metric"]', "着手率(更新後)");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s8a = await stateNow();
    check("編集内容が保存される", s8a.experiments[0].metric === "着手率(更新後)");
    check("編集してもstatusはrunningのまま", s8a.experiments[0].status === "running");

    await page.evaluate(() => { window.confirm = () => true; });  // v49と同じ流儀
    await page.click('[data-action="edit-experiment"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="modal-delete"]');
    await page.waitForTimeout(300);
    const s8b = await stateNow();
    check("削除するとdeleted:trueになる", s8b.experiments[0].deleted === true);
    check("削除後は「+ 実験を始める」に戻る(activeExperimentがnull)", await page.locator('.exp-card:has-text("+ 実験を始める")').count() === 1);

    // ============================================================
    // (d)(e) 終了日超過の判定 + kept実験の昇格候補表示
    // ============================================================
    console.log("[9] 終了日超過: 結論入力欄+続ける/手放すボタンが出る。結論が空だと拒否される");
    await seed({
      view: "journal",
      experiments: [{
        id: "exp-overdue-1", hypothesis: "朝一で最重要タスクに着手する", metric: "MIT達成率",
        startDate: addDaysStr(TODAY, -17), endDate: addDaysStr(TODAY, -3), status: "running",
        conclusion: "", createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false
      }]
    });
    check("終了日超過の注記が出る", (await page.locator(".exp-card").textContent()).includes("終了日を過ぎています"));
    check("結論入力欄が出る", await page.locator("#exp-conclusion-input").count() === 1);
    check("続ける(kept)ボタンが出る", await page.locator('[data-action="experiment-keep"]').count() === 1);
    check("手放す(dropped)ボタンが出る", await page.locator('[data-action="experiment-drop"]').count() === 1);
    await page.click('[data-action="experiment-keep"]');
    await page.waitForTimeout(300);
    const toastText9 = await page.locator("#toast").textContent();
    check("結論が空だと拒否のトーストが出る", toastText9.includes("結論を1行"), toastText9);
    const s9 = await stateNow();
    check("statusはrunningのまま", s9.experiments[0].status === "running");

    console.log("[10] 結論を書いて「続ける(kept)」→ status:kept + conclusion保存、原則への昇格候補として表示される");
    await page.fill("#exp-conclusion-input", "朝一MIT着手を標準の進め方にする");
    await page.click('[data-action="experiment-keep"]');
    await page.waitForTimeout(300);
    const s10 = await stateNow();
    check("statusがkeptになる", s10.experiments[0].status === "kept", JSON.stringify(s10.experiments[0]));
    check("結論が保存される", s10.experiments[0].conclusion === "朝一MIT着手を標準の進め方にする");
    check("kept後は実験中カードが「+ 実験を始める」に戻る", await page.locator('.exp-card:has-text("+ 実験を始める")').count() === 1);
    check("昇格候補見出しが出る", (await page.locator(".exp-promote").textContent()).includes("原則(アファメーション)への昇格候補"));
    check("昇格候補の結論文が出る", (await page.locator(".exp-promote").textContent()).includes("朝一MIT着手を標準の進め方にする"));
    check("結論をコピーボタンがある", await page.locator('[data-action="experiment-copy-conclusion"]').count() === 1);

    console.log("[11] 週次レビュータブにも同じ実験セクションが出る(ジャーナルと共有)");
    await page.click('[data-action="nav"][data-view="weekly"]');
    await page.waitForTimeout(300);
    check("週次レビューにも人生実験セクションが出る", await page.locator('.weekly-sec.exp-card:has-text("人生実験")').count() === 1);
    check("週次レビューにも昇格候補が出る", (await page.locator(".exp-promote").textContent()).includes("朝一MIT着手を標準の進め方にする"));

    console.log("[12] 終了日超過→「手放す(dropped)」: status:dropped、昇格候補には出ない");
    await seed({
      view: "journal",
      experiments: [{
        id: "exp-overdue-2", hypothesis: "夜に翌日の計画を立てる", metric: "翌朝の着手までの時間",
        startDate: addDaysStr(TODAY, -20), endDate: addDaysStr(TODAY, -6), status: "running",
        conclusion: "", createdAt: `${TODAY}T00:00:00`, updatedAt: `${TODAY}T00:00:00`, deleted: false
      }]
    });
    await page.fill("#exp-conclusion-input", "夜は疲れていて質が落ちるので手放す");
    await page.click('[data-action="experiment-drop"]');
    await page.waitForTimeout(300);
    const s12 = await stateNow();
    check("statusがdroppedになる", s12.experiments[0].status === "dropped");
    check("結論が保存される", s12.experiments[0].conclusion === "夜は疲れていて質が落ちるので手放す");
    check("droppedは昇格候補に出ない", await page.locator(".exp-promote").count() === 0);
    check("dropped後は「+ 実験を始める」に戻る", await page.locator('.exp-card:has-text("+ 実験を始める")').count() === 1);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
