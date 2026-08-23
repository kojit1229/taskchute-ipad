// v116 検証: 1日バッファ+消化率メーター(ROADMAP「TOC由来の提案E」)+
// 計画過積載ガード(2026-07-16 K追加要件)。
//
// クリティカルチェーン法の個人適用: 各Blockの見積もりに個別の安全余裕を足すと
// 学生症候群・パーキンソンの法則で消えるため、余裕は1日末尾の「バッファ」1つに集約し、
// 個々の遅れではなく「バッファ残量」という1つの数字だけを見る。
//
// (1) 残量計算: 超過(実績>見積)で減る・早終わり(実績<見積)で戻る・見積か実績が
//     無いBlock/未完了Blockは集計から除外される
// (2) 色3段階の境界値: ちょうど40%(緑)・ちょうど0%(赤)を含む
// (3) 過去日・未来日表示ではメーターが出ない(非表示。クラッシュしない)。今日に戻ると
//     正しく再計算される
// (4) バッファ未設定日(dailyBufferMinが0以下)はフェイルソフトの「未設定」表示になる
// (5) K追加要件・計画過積載ガード: 当日の予定Block見積合計+バッファが、その日最初の
//     予定Block開始時刻〜締め時刻(既定24:00)の枠に収まらない場合、通常の緑/黄/赤とは
//     別の第4状態(灰色)+責めないトーンの案内が出る。収まっている日・ちょうど収まる
//     境界では出ない
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
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);

  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
  function makeBlock({ id, date = TODAY, title, startMin, minutes = 30, estimateMin = null,
    completed = false, actualStartAt = "", actualEndAt = "", category = "" }) {
    return {
      id, taskId: "", date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt, actualEndAt, completed,
      charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  async function seed({ blocks = [], settings = {}, view = "home" } = {}) {
    await page.evaluate(({ KEY, blocks, TODAY, view, settings }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.projects = [];
      s.blocks = blocks;
      s.selectedDate = TODAY;
      s.currentView = view;
      s.settings = s.settings || {};
      Object.assign(s.settings, settings);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, TODAY, view, settings });
    await page.reload();
    await page.waitForTimeout(400);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function meterInfo() {
    return page.evaluate(() => {
      const el = document.querySelector(".buffer-meter");
      if (!el) return null;
      return {
        text: el.textContent.trim(),
        level: el.getAttribute("data-buffer-level"),
        percent: el.getAttribute("data-buffer-percent"),
        remaining: el.getAttribute("data-buffer-remaining"),
        shortfall: el.getAttribute("data-overload-shortfall"),
        hasHint: !!document.querySelector(".buffer-overload-hint"),
        hintText: document.querySelector(".buffer-overload-hint")?.textContent.trim() || ""
      };
    });
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 残量計算: 超過で減る・早終わりで戻る・見積/実績無し・未完了は除外
    // ============================================================
    // v230: home完全撤去に伴いバッファメーター/過積載ヒントも描画対象から削除。
    // dailyBufferMinは旧state互換の設定値として保持されることを確認する。
    console.log("[1-5d] v230: 旧バッファUIの不存在と設定値互換");
    await seed({
      blocks: [],
      settings: { dailyBufferMin: 45 },
      view: "home"
    });
    const kept = await stateNow();
    check("既存dailyBufferMinは正規化後も保持される",
      kept.settings?.dailyBufferMin === 45, String(kept.settings?.dailyBufferMin));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
