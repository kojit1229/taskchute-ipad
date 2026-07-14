// v91 検証: ジャーナルテンプレに「### 依頼」節を新設(K指示: 依頼はこの見出し配下に書く運用へ)。
// FORMAT_CONTRACT.md(loop/)・CHANGES_v91.md 参照。
//
// 機械可読契約: loop/scripts/journal-requests-extract.py がこの見出しを検出して依頼を抽出する
// (バッチ側の検証は同スクリプトの手動テストで別途実施済み。ここではアプリ側の契約だけを見る)。
//
// ①defaultJournal()の初期値に「### 依頼」が含まれる
// ②ジャーナル本文(「### 依頼」節込み)が日報生成時に「## 8. ジャーナル」節へそのまま出力される
// ③既存契約「## 8. ジャーナル」見出し自体が壊れていない
// ④normalizeState 後方互換: 既存端末のjournalTemplateに「### 依頼」が無ければ追記され、
//   既に持っている場合は二重に追記されない
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4226;
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
  await blockGithubApiByDefault(page);
  // v67/v68と同様: 本番バッチが実際に生成するAI連携ファイルを常に404にルーティングし、
  // リポジトリの実ファイル有無に結果が左右されないようにする。
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [1] defaultJournal() の初期値に「### 依頼」が含まれる
    // ============================================================
    console.log("[1] 新規日のジャーナル初期値(defaultJournal経由)に「### 依頼」節が含まれる");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals = {};
      delete s.settings.journalTemplate;
      s.selectedDate = TODAY;
      s.currentView = "journal";
      s.blocks = []; s.tasks = []; s.projects = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);

    const s1 = await stateNow();
    const journalText1 = s1.journals[TODAY] || "";
    check("ensureJournal() 経由の初期ジャーナルに「### 依頼」見出しが含まれる", journalText1.includes("### 依頼"), journalText1.slice(-300));
    check("ガイド文(丸括弧のプレースホルダ)が含まれる", journalText1.includes("AIへの依頼はこの見出しの下に"), journalText1.slice(-300));

    // ============================================================
    // [2] ジャーナル本文が日報生成時に「## 8. ジャーナル」節へそのまま出る
    // ============================================================
    console.log("[2] 「### 依頼」節を含むジャーナル本文が、日報生成時に「## 8. ジャーナル」節にそのまま出力される");
    const customJournal = [
      `# ${TODAY} のジャーナル`,
      ``,
      `## 📝 自由記述`,
      `v91テスト用の自由記述本文`,
      ``,
      `### 依頼`,
      `(AIへの依頼はこの見出しの下に1行1件で書いてください。例:「相場帳のバグを直して」)`,
      `v91テスト用の依頼本文_相場帳のバグを直して`,
      ``
    ].join("\n");
    await page.evaluate(({ KEY, TODAY, customJournal }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.journals = { [TODAY]: customJournal };
      s.reports = {};
      s.questions = [];
      s.blocks = []; s.tasks = []; s.projects = [];
      s.selectedDate = TODAY;
      s.currentView = "reports";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, customJournal });
    await page.reload();
    await page.waitForTimeout(500);

    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const report2 = s2.reports[TODAY] || "";

    // ============================================================
    // [3] 既存契約「## 8. ジャーナル」見出し自体が壊れていない
    // ============================================================
    console.log("[3] 既存契約: 日報生成結果に「## 8. ジャーナル」見出しが存在する(壊れていない)");
    check("「## 8. ジャーナル」見出しが日報に存在する", report2.includes("## 8. ジャーナル"), report2.slice(0, 200));
    check("ジャーナル本文(「### 依頼」節込み)がそのまま日報に含まれる", report2.includes("### 依頼") && report2.includes("v91テスト用の依頼本文_相場帳のバグを直して"), report2);
    check("ガイド文(丸括弧プレースホルダ)もそのまま含まれる(バッチ側のフィルタはpython側の責務のため、アプリ側の全文出力は素通しでよい)",
      report2.includes("AIへの依頼はこの見出しの下に1行1件で書いてください"), report2);

    // ============================================================
    // [4] normalizeState 後方互換: 既存journalTemplateへの追記型マイグレーション
    // ============================================================
    console.log("[4] normalizeState: 既存端末のjournalTemplateに「### 依頼」が無ければ追記され、既に持つ場合は二重追記されない");
    const legacyTemplate = [
      `# 2020-01-01 のジャーナル`,
      ``,
      `## 🛏 睡眠`,
      `就寝: __:__  /  起床: __:__`,
      ``,
      `## 📝 自由記述`,
      ``,
      ``
    ].join("\n");
    await page.evaluate(({ KEY, legacyTemplate }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.journalTemplate = legacyTemplate;  // 「### 依頼」を持たない旧端末を模す
      s.blocks = []; s.tasks = []; s.projects = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, legacyTemplate });
    await page.reload();
    await page.waitForTimeout(500);
    const s4a = await stateNow();
    const tpl4a = s4a.settings.journalTemplate || "";
    check("旧journalTemplateに「### 依頼」が追記される", tpl4a.includes("### 依頼"), tpl4a);
    check("旧テンプレの既存内容(睡眠・自由記述)は保持される(上書きしない)",
      tpl4a.includes("## 🛏 睡眠") && tpl4a.includes("## 📝 自由記述"), tpl4a);
    const occurrences4a = (tpl4a.match(/### 依頼/g) || []).length;
    check("「### 依頼」は1回だけ追記される(二重追記でない)", occurrences4a === 1, `occurrences=${occurrences4a}`);

    // 既に「### 依頼」を持つテンプレは変更されない(再normalize時の冪等性)
    await page.reload();
    await page.waitForTimeout(500);
    const s4b = await stateNow();
    const occurrences4b = (s4b.settings.journalTemplate.match(/### 依頼/g) || []).length;
    check("再読込(再normalizeState)しても「### 依頼」が増えない(冪等)", occurrences4b === 1, `occurrences=${occurrences4b}`);

    console.log(failures === 0 ? "\n✅ v91 ALL PASS" : `\n❌ v91: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
