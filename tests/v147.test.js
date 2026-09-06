// v147 検証: UI改善計画Phase2(数字と警告の信頼回復)。CHANGES_v147.md参照。
// 入力: workbench/out/2026-07-27-taskchute-ui-review/ui-improvement-plan.md(承認済み計画)。
//
// (1) ホーム「今日のタスクシュート」見出しに「(Project紐づき)」が付き、「X/Yブロック」の
//     Yは実際に一覧表示されるProject紐づきBlock数と一致する(母数をヒートマップ等と同じ
//     「当日の全Block」へ統一すると一覧件数とズレて別の混乱を生むため、見出しで明示する
//     代替案を採った。taskchute-notes/decisions.md 2026-07-27参照)
// (2) 廃止(2026-08-22): 12週サイクル残り日数の基準日統一検証。週次タブ・ホーム12週
//     サイクルカードともにv217で仕様削除済み(slim-spec.md §1-1/§4-2)のため削除した。
// (3) 「今日の状態」1枚化: 宣言・体力予算・電池残量・週Wishの4つとも良好なら非表示。
//     いずれか要対応なら1〜2行summary+detailsに内訳(体力予算チップ/電池チップ/
//     宣言未入力/週Wish未設定)が揃う。過去日は体力予算チップの単独表示のみ(既存仕様維持)
// (4) orange/green/tealの文字色AAトークン(--orange-text等)が定義され4.5:1以上を満たす。
//     「充/放」「着手中/未着手」ラベルが10px→11.5pxになる
// (5) Block編集モーダル: レバレッジ3問クイズが既定closedで、判定済み(leverageType設定済み)
//     ならsummaryに判定結果が出る。フッタの削除ボタンがmargin-right:autoで左端に分離される
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
const TODAY = "2026-07-27";
const YESTERDAY = "2026-07-26";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const hhmm = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  // app.js の weekRange() (土曜起点)をテスト側でも再現し、期待する週キーを算出する(v121と同じ手法)
  function weekStartOf(dateISO) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = (dt.getDay() + 1) % 7; // Sat=0
    dt.setDate(dt.getDate() - dow);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const WEEK_KEY = weekStartOf(TODAY);

  function planBlock({ id, title, startMin, minutes = 30, taskId = "", category = "", completed = false }) {
    return {
      id, taskId, date: TODAY, title, category,
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false, source: "", estimateMin: null,
      leverageType: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    };
  }
  const testProject = () => ({
    id: "v147-proj", kind: "normal", title: "v147テスト案件", category: "", status: "active",
    description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`,
    deleted: false, collapsed: false
  });
  const testTask = (id, title) => ({
    id, projectId: "v147-proj", parentTaskId: "", title, category: "", status: "todo", dueDate: "",
    description: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
  });

  async function seed({
    blocks = [], tasks = [], projects = [], view = "home", settings = {},
    dailyDeclarations = undefined, weeklyWishes = undefined
  } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, projects, TODAY, view, settings, dailyDeclarations, weeklyWishes }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = projects;
      s.selectedDate = TODAY;
      s.currentView = view;
      Object.assign(s.settings, settings);
      if (dailyDeclarations !== undefined) s.dailyDeclarations = dailyDeclarations;
      if (weeklyWishes !== undefined) s.weeklyWishes = weeklyWishes;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view, settings, dailyDeclarations, weeklyWishes });
    await page.reload();
    await page.waitForTimeout(400);
  }

  try {
    // 06:00固定(既定decayStartMinutes=07:00より前 → 電池残量は満タン=100%でbatteryOKが安定する)
    await page.clock.setFixedTime(new Date(2026, 6, 27, 6, 0, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // (1) 今日のタスクシュート見出し+分母(Project紐づき維持)
    // ============================================================
    // v230: homeタスクシュート/「今日の状態」/電池チップは描画ごと撤去。
    // タスクシュート一覧とバッテリー曲線の現行仕様はv112/v144で継続検証する。
    console.log("[1-3f] v230: 旧home集約UIの不存在とtoday移行");
    await seed({
      blocks: [
        planBlock({ id: "b-linked", title: "Project紐づきBlock", startMin: 9 * 60, taskId: "v147-task" }),
        planBlock({ id: "b-routine", title: "ルーティンBlock", startMin: 7 * 60, category: "ルーティン" })
      ],
      tasks: [testTask("v147-task", "v147テストタスク")],
      projects: [testProject()],
      view: "home"
    });
    check("旧home viewはtodayへフォールバックしTOWERを表示する",
      await page.locator('#app[data-view="today"] .today-tower').count() === 1);

    // (4) AAコントラストトークン + 10px→11.5pxラベル
    // ============================================================
    console.log("[4] orange/green/tealの文字色AAトークンが定義され、実際に組み合わせて使われる背景上で4.5:1以上を満たす");
    // v147レビュー対応: 白背景だけでなく、-textトークンが実際に併用される--*-soft/--panel-soft
    // 背景とのペアで4.5:1を検証する(白だけでは実背景で4.17〜4.41にとどまり未達だった指摘への対応)。
    function relLuminance(hex) {
      const c = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
      const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
    function contrastPair(hexA, hexB) {
      const La = relLuminance(hexA), Lb = relLuminance(hexB);
      const lighter = Math.max(La, Lb), darker = Math.min(La, Lb);
      return (lighter + 0.05) / (darker + 0.05);
    }
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      return {
        orangeText: v("--orange-text"), greenText: v("--green-text"), tealText: v("--teal-text"),
        orangeSoft: v("--orange-soft"), greenSoft: v("--green-soft"), tealSoft: v("--teal-soft"),
        panelSoft: v("--panel-soft"), panel: v("--panel")
      };
    });
    check("--orange-textが定義されている", !!tokens.orangeText, JSON.stringify(tokens));
    check("--green-textが定義されている", !!tokens.greenText, JSON.stringify(tokens));
    check("--teal-textが定義されている", !!tokens.tealText, JSON.stringify(tokens));
    const isHex = (h) => /^#[0-9a-fA-F]{6}$/.test(h);
    // 実際にapp.js/styles.cssで組み合わせて使われる最低限のペア
    // (体力予算/バッジ等はtext×同系-soft、今日の状態カード本体はtext×panel-soft)
    const pairs = [
      ["orange-text × orange-soft", tokens.orangeText, tokens.orangeSoft],
      ["green-text × green-soft", tokens.greenText, tokens.greenSoft],
      ["teal-text × teal-soft", tokens.tealText, tokens.tealSoft],
      ["orange-text × panel-soft", tokens.orangeText, tokens.panelSoft],
      ["green-text × panel-soft", tokens.greenText, tokens.panelSoft],
      ["teal-text × panel-soft", tokens.tealText, tokens.panelSoft],
      ["orange-text × panel(白相当)", tokens.orangeText, tokens.panel],
      ["green-text × panel(白相当)", tokens.greenText, tokens.panel],
      ["teal-text × panel(白相当)", tokens.tealText, tokens.panel]
    ];
    for (const [label, fg, bg] of pairs) {
      if (isHex(fg) && isHex(bg)) {
        const ratio = contrastPair(fg, bg);
        check(`${label}が4.5:1以上(実測${ratio.toFixed(2)}:1)`, ratio >= 4.5, `${fg} on ${bg} => ${ratio.toFixed(2)}:1`);
      } else {
        console.log(`  (skip: ${label}が#RRGGBB形式で解決できなかった: fg=${fg} bg=${bg})`);
      }
    }
    const cdLabSize = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "home-cd-lab";
      document.body.appendChild(probe);
      const size = getComputedStyle(probe).fontSize;
      probe.remove();
      return size;
    });
    check(".home-cd-labが11.5px以上になっている(旧10px)", parseFloat(cdLabSize) >= 11.5, cdLabSize);
    const badgeSize = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "home-badge";
      document.body.appendChild(probe);
      const size = getComputedStyle(probe).fontSize;
      probe.remove();
      return size;
    });
    check(".home-badgeが11.5px以上になっている(旧10px、着手中/未着手ラベル)", parseFloat(badgeSize) >= 11.5, badgeSize);

    // ============================================================
    // (5) Block編集モーダル: レバレッジ3問クイズ + フッタ削除ボタン分離
    // ============================================================
    console.log("[5a] レバレッジ3問クイズは既定closed。未判定は招待文、判定済みなら結果をsummaryに表示");
    await seed({
      blocks: [planBlock({ id: "b-lev", title: "レバレッジ確認Block", startMin: 9 * 60 })],
      view: "tasks" // v230: Block編集は現行タスクシュート導線から開く
    });
    await page.click('[data-action="edit-block"][data-id="b-lev"]');
    await page.waitForTimeout(200);
    const levHelper = page.locator(".modal-card .lev-helper");
    check(".lev-helperはdetails要素で既定closed", await levHelper.evaluate((el) => el.open) === false);
    const levSummaryUnjudged = await levHelper.locator("summary").textContent();
    check("未判定時のsummaryは招待文", levSummaryUnjudged.includes("10秒で判定する"), levSummaryUnjudged);
    // v366追随: レバレッジ種別selectは頻度の低い項目として「詳細 ›」(既定閉)へ移設された。
    await page.evaluate(() => {
      const d = document.querySelector(".modal-card details.tower-fold");
      if (d) d.open = true;
    });
    await page.selectOption('.modal-card [data-modal-field="leverageType"]', "asset");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="edit-block"][data-id="b-lev"]');
    await page.waitForTimeout(200);
    const levSummaryJudged = await page.locator(".modal-card .lev-helper summary").textContent();
    check("判定済み(資産)ならsummaryに判定結果が出る", levSummaryJudged.includes("資産"), levSummaryJudged);
    check("判定済みsummaryはもう「10秒で判定する(任意)」の招待文ではない",
      !levSummaryJudged.includes("10秒で判定する(任意)"), levSummaryJudged);

    console.log("[5b] モーダルフッタの削除ボタンがmargin-right:autoで左端に分離される");
    const deleteBtnMarginRight = await page.locator('.modal-card [data-action="modal-delete"]').first()
      .evaluate((el) => getComputedStyle(el).marginRight);
    check("削除ボタンのmargin-rightがauto相当(数値ではなく大きく開く)で分離される",
      deleteBtnMarginRight === "auto" || parseFloat(deleteBtnMarginRight) > 20, deleteBtnMarginRight);
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(150);

    console.log(failures === 0 ? "\n✅ v147 ALL PASS" : `\n❌ v147: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
