// v143 検証: 計器盤「今週のヒント」(computeInsights、決定論ルールエンジン)+
// v141で到達不能になっていたAIフィードバック手動取込系の死コード削除。CHANGES_v143.md参照。
//
// (1) 5ルール(放電超過/ヒートマップ上位下位/見積誤差/睡眠帯/充電効果上位)を1データセットで
//     すべて発火させ、文言とドリルダウン導線(既存action流用+新設search-jump)を検証する。
// (2) ドリルダウン: 放電超過(曜日)→energy-open-routine、見積誤差(カテゴリ)→energy-open-category、
//     睡眠帯→search-jump(ジャーナルの該当日)の3系統をクリックして遷移先stateを確認する。
// (3) 最小サンプル数ガード: 睡眠帯の対サンプルが3件未満に減ると、そのルールだけ静かに消える
//     (他の発火中ルールは残る)ことを確認する。
// (4) データが無ければ「今週のヒント」セクション自体が非表示(静かな計器)。
// (5) 死コード削除後もHome「AIから」カード(homeAiFeedbackReadHTML/state.feedback)が機能する回帰。
// (7) レビュー対応: 睡眠帯の件数表示・ドリルダウン対象(dates)を、実際にstartValsへ寄与した日
//     (計画Blockがある日)だけに揃える(sleepログはあるがBlockが無い日を含めない)。
// (8) レビュー対応: カテゴリ名に<や"を含む場合でもエスケープされ、スクリプト実行や属性破壊が
//     起きないこと(充電効果上位ヒントのドリルダウンボタンで検証)。
// (9) レビュー対応: 見積誤差ヒントは丸め前のmedで±5%未満なら出さない(自己矛盾文の根絶)。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  // 2026-07-31は金曜日(週定義=土曜始まりなのでthisWeek=2026-07-25、4週分のsinceは2026-07-04。
  // v142テストと同じ暦を使い回す)。
  const now0 = new Date(2026, 6, 31, 20, 0, 0, 0);
  const TODAY = "2026-07-31";

  // 曜日(JSのgetDay: 0=日..6=土)ごとの固定シナリオ。時刻・帯・充放電・見積を曜日で作り分け、
  // computeInsightsの5ルールすべてが同じ4週(2026-07-04〜07-31・28日)のデータで発火するよう設計:
  //   ルール1(放電超過・曜日): 火曜のみ平均net負(-3) → 「火曜が構造的にマイナス」
  //   ルール2(ヒートマップ上位下位): 土曜早朝=着手率100%(最良) / 木曜午後=着手率25%(最低)
  //   ルール3(見積誤差): 〈会議〉(水曜)が実績300%(見積30分・実績90分)
  //   ルール4(睡眠帯): 木曜のうち07-09/16/23の3日を睡眠5.0h(未着手)にし、5.5h未満帯の
  //     着手率中央値(0)が全体中央値(100)よりはるかに低くなるようにする
  //   ルール5(充電効果上位): 〈休息〉(日曜)がnet中央値+4で最上位
  const WD_CFG = {
    0: { category: "休息", charge: 5, discharge: 1, start: "10:00", end: "10:30", allStarted: true },
    1: { category: "作業", charge: 3, discharge: 2, start: "10:00", end: "10:30", allStarted: true },
    2: { category: "作業", charge: 1, discharge: 4, start: "10:00", end: "10:30", allStarted: true },
    3: { category: "会議", charge: 2, discharge: 2, start: "13:00", end: "13:30", allStarted: true, estimateMin: 30, actualEnd: "14:30" },
    4: { category: "運動", charge: 3, discharge: 1, start: "16:00", end: "16:30" },  // started扱いは下でindex指定
    5: { category: "作業", charge: 2, discharge: 2, start: "19:00", end: "19:30", allStarted: true },
    6: { category: "作業", charge: 2, discharge: 2, start: "06:00", end: "06:45", allStarted: true, estimateMin: 45, actualEnd: "06:50" }
  };
  const LOW_SLEEP_DATES = ["2026-07-09", "2026-07-16", "2026-07-23"];  // 木曜4回中はじめの3回(07-30は除く)

  function buildDates() {
    const out = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(2026, 6, 4 + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ date: iso, wd: d.getDay() });
    }
    return out;
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // seed: 28日分(曜日ごとの固定シナリオ)+ 木曜3日の睡眠5.0h(未着手)
    // ============================================================
    await page.evaluate(({ KEY, TODAY, WD_CFG, DATES, LOW_SLEEP_DATES }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = [];

      const thuDates = DATES.filter((d) => d.wd === 4).map((d) => d.date);
      DATES.forEach(({ date, wd }, i) => {
        const cfg = WD_CFG[wd];
        let started;
        if (wd === 4) {
          // 木曜: 07-30(最後の1回)だけ着手済み、他3回は未着手 → 着手率25%
          started = date === thuDates[thuDates.length - 1];
        } else {
          started = !!cfg.allStarted;
        }
        s.blocks.push({
          id: `b-${i}`, date, title: `T${i}`, category: cfg.category,
          plannedStartAt: `${date}T${cfg.start}`, plannedEndAt: `${date}T${cfg.end}`,
          actualStartAt: started ? `${date}T${cfg.start}` : "",
          actualEndAt: started ? `${date}T${cfg.actualEnd || cfg.end}` : "",
          completed: true, charge: cfg.charge, discharge: cfg.discharge,
          estimateMin: cfg.estimateMin || 0,
          deleted: false
        });
        s.sleep.logs[date] = { bed: "23:00", wake: "06:30", sleepH: LOW_SLEEP_DATES.includes(date) ? 5.0 : 8.0 };
      });

      s.selectedDate = TODAY;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, WD_CFG, DATES: buildDates(), LOW_SLEEP_DATES });
    await page.reload();
    await page.waitForTimeout(500);

    // ============================================================
    // (1) 5ルールすべてが1つの「今週のヒント」節に出る
    // ============================================================
    console.log("[1] 計器盤「今週のヒント」— 5ルールすべて発火");
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);

    check("「今週のヒント」節が1つ表示される", await page.locator(".stats-insights-panel").count() === 1);
    check("見出しが出る", (await page.locator(".stats-insights-panel h2").textContent()).includes("今週のヒント"));

    const rows = await page.locator(".stats-insight-row").allTextContents();
    check("ヒントは5件(ルールにつき最大1件×5ルール)", rows.length === 5, String(rows.length));

    const panelText = await page.locator(".stats-insights-panel").textContent();
    check("ルール1(放電超過・曜日): 火曜が構造的にマイナス(平均-3.0)・直近4週固定の注記付き",
      panelText.includes("火曜が構造的にマイナス") && panelText.includes("-3.0") && panelText.includes("直近4週で評価"), panelText);
    check("ルール2(ヒートマップ上位下位): 土曜早朝100%・木曜午後25%",
      panelText.includes("土曜早朝は着手率100%") && panelText.includes("木曜午後は25%"), panelText);
    check("ルール3(見積誤差): 〈会議〉が実績300%・長引きがち",
      panelText.includes("〈会議〉は実績が見積の300%") && panelText.includes("長引きがち"), panelText);
    check("ルール4(睡眠帯): 5.5h未満の日は着手率-100pt",
      panelText.includes("睡眠5.5h未満の日は着手率が-100pt"), panelText);
    check("ルール5(充電効果上位): 〈休息〉がnet中央値+4",
      panelText.includes("〈休息〉は充電効果が高い") && panelText.includes("+4"), panelText);

    check("着手率(予定ベース)の定義注記キャプションが出る(2定義の混同防止)",
      panelText.includes("着手率(予定ベース)") && panelText.includes("同じ定義"));

    const buttonCount = await page.locator(".stats-insight-row button").count();
    check("ドリルダウンボタンは6個(ルール2だけ2個・他4ルールは1個ずつ)", buttonCount === 6, String(buttonCount));

    // ============================================================
    // (1b) レビュー対応(監督者裁定): stats-rangeを12wに切り替えると一般ルールは追従するが、
    //      ルール1(放電超過)はcomputeEnergyStructureの設計どおり直近4週固定のまま変わらない。
    //      4週窓の外(8〜12週前)に高net完了Blockを投入し、12w切替でのみルール5(充電効果上位)
    //      の対象が変わることで「範囲追従」を、ルール1が変わらないことで「4週固定」を確認する。
    // ============================================================
    console.log("[1b] stats-range=12wで一般ルールは追従・ルール1は直近4週固定のまま");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      ["2026-05-23", "2026-05-24", "2026-05-25"].forEach((date, i) => {
        s.blocks.push({
          id: `old-${i}`, date, title: `OLD${i}`, category: "旅行",
          plannedStartAt: `${date}T09:00`, plannedEndAt: `${date}T09:30`,
          actualStartAt: `${date}T09:05`, actualEndAt: `${date}T09:30`,
          completed: true, charge: 5, discharge: 0, estimateMin: 0, deleted: false
        });
      });
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    const panelText4w = await page.locator(".stats-insights-panel").textContent();
    check("4w(既定)では8〜12週前の旧データは範囲外なので、ルール5は引き続き〈休息〉のまま",
      panelText4w.includes("〈休息〉は充電効果が高い") && !panelText4w.includes("〈旅行〉"), panelText4w);
    check("4wでもルール1は直近4週固定の火曜のまま", panelText4w.includes("火曜が構造的にマイナス"), panelText4w);

    await page.click('[data-action="stats-range"][data-range="12w"]');
    await page.waitForTimeout(300);
    const panelText12w = await page.locator(".stats-insights-panel").textContent();
    check("12wに切り替えるとルール5(充電効果上位)が範囲追従し〈旅行〉(net+5)に変わる(一般ルールの範囲追従の証明)",
      panelText12w.includes("〈旅行〉は充電効果が高い"), panelText12w);
    check("12wに切り替えてもルール1(放電超過)は直近4週固定のまま火曜(範囲拡大の影響を受けない)",
      panelText12w.includes("火曜が構造的にマイナス") && panelText12w.includes("直近4週で評価"), panelText12w);

    await page.click('[data-action="stats-range"][data-range="4w"]');
    await page.waitForTimeout(300);

    // ============================================================
    // (2) ドリルダウン導線: 3系統をクリックして遷移先stateを確認
    // ============================================================
    console.log("[2-a] ドリルダウン: 放電超過(曜日)→ energy-open-routine(ルーティンタブ+曜日フィルタ)");
    await page.click('.stats-insights-panel button:has-text("火曜のルーティンを見る")');
    await page.waitForTimeout(300);
    let st = await stateNow();
    check("ルーティンタブへ遷移し、曜日フィルタが火曜(2)になる",
      st.currentView === "routine" && st.settings.routineDayFilter === 2,
      `view=${st.currentView} dayFilter=${st.settings.routineDayFilter}`);

    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    console.log("[2-b] ドリルダウン: 見積誤差(カテゴリ)→ energy-open-category(タイムライン+カテゴリフィルタ)");
    await page.click('.stats-insights-panel button:has-text("ブロックを見る")');  // 複数あるうち先頭(ルール3=会議)
    await page.waitForTimeout(300);
    st = await stateNow();
    check("タイムラインタブへ遷移し、カテゴリフィルタが会議になる",
      st.currentView === "timeline" && st.settings.timelineCategoryFilter === "会議",
      `view=${st.currentView} catFilter=${st.settings.timelineCategoryFilter}`);

    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    console.log("[2-c] ドリルダウン: 睡眠帯 → search-jump(ジャーナルの直近該当日)");
    await page.click('.stats-insights-panel button:has-text("直近の該当日を見る")');
    await page.waitForTimeout(300);
    st = await stateNow();
    check("ジャーナルタブへ遷移し、選択日が直近の該当日(2026-07-23)になる",
      st.currentView === "journal" && st.selectedDate === "2026-07-23",
      `view=${st.currentView} date=${st.selectedDate}`);

    // ============================================================
    // (3) 最小サンプル数ガード: 睡眠帯の対サンプルを3件未満に減らすと、そのルールだけ消える
    // ============================================================
    console.log("[3] 睡眠帯の対サンプルが3件未満に減ると、ルール4だけ静かに消える(他は残る)");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep.logs["2026-07-09"].sleepH = 8.0;  // 5.5h未満帯を3日→2日に減らす(n<3でガード対象)
      s.selectedDate = "2026-07-31";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    const panelTextGuard = await page.locator(".stats-insights-panel").textContent();
    check("睡眠帯ヒントは消える(対サンプル2件<3)", !panelTextGuard.includes("睡眠5.5h未満"), panelTextGuard);
    check("他の4ルールは残る(放電超過・ヒートマップ・見積誤差・充電効果上位)",
      panelTextGuard.includes("火曜が構造的にマイナス") &&
      panelTextGuard.includes("土曜早朝は着手率100%") &&
      panelTextGuard.includes("〈会議〉は実績が見積の300%") &&
      panelTextGuard.includes("〈休息〉は充電効果が高い"),
      panelTextGuard);
    const rowsGuard = await page.locator(".stats-insight-row").allTextContents();
    check("ヒントは4件に減る", rowsGuard.length === 4, String(rowsGuard.length));

    // ============================================================
    // (4) データが無ければ「今週のヒント」節ごと非表示(静かな計器)
    // ============================================================
    console.log("[4] データが無ければ「今週のヒント」節ごと非表示");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.sleep.logs = {};
      s.condition.logs = {};
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    check("データ皆無で「今週のヒント」節が非表示", await page.locator(".stats-insights-panel").count() === 0);
    check("計器盤自体は引き続き機能する(空データ案内が出る・回帰なし)",
      (await page.locator("main").textContent()).includes("まだ十分なデータがありません"));

    // ============================================================
    // (5) 死コード削除の回帰: Home「AIから」カード(state.feedback経由の閲覧)が引き続き機能する
    // ============================================================
    console.log("[5] 死コード削除後もHome「AIから」カードが機能する(回帰)");
    const PREV = "2026-07-30";
    await page.evaluate(({ KEY, PREV }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [];
      s.feedback = { [PREV]: "## 明日への提案\n\n- [ ] v143回帰確認用マーカー\n" };
      s.feedbackFiles = [PREV];
      s.selectedDate = "2026-07-31";
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, PREV });
    await page.reload();
    await page.waitForTimeout(700);
    check("ホーム「AIから」の本文閲覧detailsが出る(homeAiFeedbackReadHTML)",
      await page.locator(".home-ai-feedback-read").count() === 1);
    const homeText = await page.locator("main").textContent();
    check("state.feedback由来の前日フィードバック本文が読める(削除の巻き添えなし)",
      homeText.includes("v143回帰確認用マーカー"), homeText.slice(0, 300));

    // ============================================================
    // (6) 死コード自体がもう到達不能でない(=存在しない)ことの確認: 撤去済み要素が出ない
    // ============================================================
    console.log("[6] 削除済みUI(.mdアップロード欄・AI返信取込ボタン等)が出ないまま(回帰)");
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    check(".mdアップロード欄が無い", await page.locator("input[data-feedback-upload]").count() === 0);
    check("data-feedback-date欄が無い", await page.locator("[data-feedback-date]").count() === 0);
    check("AI返信から取り込みボタンが無い", await page.locator('[data-action="journal-import-ai"]').count() === 0);

    // ============================================================
    // (7) レビュー対応: 睡眠帯の件数・ドリルダウン対象は「実際に着手率計算に使った日」だけに揃える
    //     (sleepログはあるがBlockが無い日を、件数・直近該当日の対象に含めない)
    // ============================================================
    console.log("[7] 睡眠ログはあるがBlockが無い日は、ヒントの件数・ドリルダウン対象から除外される");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep.logs = {};
      s.condition.logs = {};
      s.blocks = [];
      // 5.5h未満帯: Blockがある3日(07-05,07-12,07-19、着手率0%)+ Blockが無い1日(07-26、最新日)。
      // 生の睡眠ログ件数は4だが、着手率計算に使えるのは3日だけ(07-26はcomputeDailyMetricsの
      // plannedBlocks=0でstartTotal=0となりstartValsから除外される)。
      const lowWithBlock = ["2026-07-05", "2026-07-12", "2026-07-19"];
      const lowNoBlock = "2026-07-26";
      lowWithBlock.forEach((date, i) => {
        s.sleep.logs[date] = { bed: "23:00", wake: "06:30", sleepH: 5.0 };
        s.blocks.push({
          id: `low-${i}`, date, title: `LOW${i}`, category: "作業",
          plannedStartAt: `${date}T10:00`, plannedEndAt: `${date}T10:30`,
          actualStartAt: "", actualEndAt: "", completed: true, charge: 1, discharge: 1,
          estimateMin: 0, deleted: false
        });
      });
      s.sleep.logs[lowNoBlock] = { bed: "23:00", wake: "06:30", sleepH: 5.0 };  // Blockは意図的に無し

      // 7.5h以上帯: 残り24日はBlockあり・着手済み(100%)にして、全体中央値との差を明確にする
      const highDates = [];
      for (let i = 0; i < 28; i++) {
        const d = new Date(2026, 6, 4 + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!lowWithBlock.includes(iso) && iso !== lowNoBlock) highDates.push(iso);
      }
      highDates.forEach((date, i) => {
        s.sleep.logs[date] = { bed: "23:00", wake: "06:30", sleepH: 8.0 };
        s.blocks.push({
          id: `high-${i}`, date, title: `HIGH${i}`, category: "作業",
          plannedStartAt: `${date}T10:00`, plannedEndAt: `${date}T10:30`,
          actualStartAt: `${date}T10:05`, actualEndAt: `${date}T10:30`,
          completed: true, charge: 1, discharge: 1, estimateMin: 0, deleted: false
        });
      });
      s.selectedDate = "2026-07-31";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    const panelText7 = await page.locator(".stats-insights-panel").textContent();
    check("睡眠帯ヒントの件数はstartVals基準の3日(Blockが無い07-26は数えない)",
      panelText7.includes("睡眠5.5h未満の日は着手率が-100pt(全体比、3日)"), panelText7);
    await page.click('.stats-insights-panel button:has-text("直近の該当日を見る")');
    await page.waitForTimeout(300);
    const st7 = await stateNow();
    check("ドリルダウン先はBlockが無い07-26ではなく、実際に着手率へ寄与した直近日07-19になる",
      st7.currentView === "journal" && st7.selectedDate === "2026-07-19",
      `view=${st7.currentView} date=${st7.selectedDate}`);

    // ============================================================
    // (8) レビュー対応: カテゴリ名に<や"を含んでもエスケープされ、スクリプト実行や属性破壊が起きない
    // ============================================================
    console.log("[8] カテゴリ名に<や\"を含む場合のXSS対策(充電効果上位ヒントで検証)");
    const XSS_CAT = `<img src=x onerror=window.__xssFired=1 alt="a">`;
    await page.evaluate(({ KEY, XSS_CAT }) => {
