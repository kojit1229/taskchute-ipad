// v142 検証: 日次結合ヘルパー computeDailyMetrics(内部関数のため、計器盤「睡眠」セクションの
// 描画結果を通した間接検証。既存テスト規約どおりapp.jsはtype=moduleでinternalsをwindowに
// 露出しないため、他のv53系テスト同様にDOM/表示結果からロジックを検証する)+
// 計器盤(統計)の新セクション「睡眠」(帯グラフ/中央値ベースライントレンド/睡眠帯別比較)。
//
// (1) 帯グラフ: 直近4週(28行)。ログが無い日・bed/wakeの並びが軸窓と矛盾する異常日は
//     バーを描かない(pageerrorも起きない)。stats-rangeを12wに変えても4週固定のまま。
// (2) トレンド: sleepHが読める日だけを線に載せ、直近28日中央値をベースラインとして表示する。
//     sleepHが数値文字列(CSV由来の非正規state)でもtoNumber()経由でクラッシュせず取り込まれる
//     (decisions.md 2026-07-20記載の既知バグの再発防止確認)。
// (3) 睡眠帯別比較: 4帯それぞれの日数・着手率中央値・エネルギーnet中央値。3件未満の帯は
//     非表示(帯自体の日数だけでなく、着手率/net個別の対サンプルが3件未満の場合も「—」表示)。
//     condition.logs側の主観(sleepHours)のみの日は実測欠損時のフォールバック専用で、
//     帯別集計(実測sleepH基準)には数えない = 実測/主観が結合ロジック上は混同されない確認。
// (4) 全期間(all)レンジはBlockの無い古い睡眠ログも取り込む(sinceをBlock最古日だけでなく
//     睡眠ログ最古日でも延長する。4w/12wなど固定レンジは影響を受けないことも確認)。
// (5) 睡眠データが1件も無ければ「睡眠」セクション自体が非表示(静かな計器)。
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

  const pad2 = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // 2026-07-31は金曜日(週定義=土曜始まりなので thisWeek=2026-07-25、4週分のsinceは2026-07-04。
  // 直近28日分のシード(2026-07-04〜2026-07-31相当)が確実に4w範囲へ収まる)。
  const now0 = new Date(2026, 6, 31, 10, 0, 0, 0);
  const TODAY = iso(now0);
  const daysAgo = (n) => iso(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - n));

  // 4帯それぞれ6日ずつ(startPct/net中央値が一意に決まるよう、帯ごとに同じ実績パターンで揃える)
  const BUCKET_CFG = [
    { sleepH: 5.0, actual: false, charge: 1, discharge: 4 },  // 5.5h未満   → startPct 0%  / net -3
    { sleepH: 6.0, actual: true, charge: 2, discharge: 3 },   // 5.5〜6.5h  → startPct 100% / net -1
    { sleepH: 7.0, actual: true, charge: 3, discharge: 2 },   // 6.5〜7.5h  → startPct 100% / net +1
    { sleepH: 8.0, actual: true, charge: 4, discharge: 1 }    // 7.5h以上   → startPct 100% / net +3
  ];

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // seed: 24日分(6日×4帯)+ 文字列sleepH1日 + 主観のみ1日 + 帯グラフ用の異常日1日
    // ============================================================
    await page.evaluate(({ KEY, TODAY, BUCKET_CFG, daysAgoList, strDay, subjDay, anomalyDay }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep = s.sleep || { logs: {} };
      s.sleep.logs = {};
      s.condition = s.condition || { logs: {} };
      s.condition.logs = {};
      s.blocks = (s.blocks || []).filter(() => false);  // 既存blocksをクリアして数え間違いを防ぐ

      daysAgoList.forEach(({ date, cfg }, i) => {
        s.sleep.logs[date] = { bed: "23:30", wake: "06:30", sleepH: cfg.sleepH };
        s.blocks.push({
          id: `sb-${i}`, date, title: `SB${i}`, category: "",
          plannedStartAt: `${date}T09:00`, plannedEndAt: `${date}T09:30`,
          actualStartAt: cfg.actual ? `${date}T09:05` : "",
          actualEndAt: cfg.actual ? `${date}T09:30` : "",
          completed: true, charge: cfg.charge, discharge: cfg.discharge,
          deleted: false
        });
      });
      // 文字列sleepH(CSV由来の非正規state)。5.5〜6.5h帯へ加わり(6→7日)、実績パターンは同帯と揃える
      s.sleep.logs[strDay] = { bed: "23:30", wake: "06:30", sleepH: "6.2" };
      s.blocks.push({
        id: "sb-str", date: strDay, title: "SBstr", category: "",
        plannedStartAt: `${strDay}T09:00`, plannedEndAt: `${strDay}T09:30`,
        actualStartAt: `${strDay}T09:05`, actualEndAt: `${strDay}T09:30`,
        completed: true, charge: 2, discharge: 3, deleted: false
      });
      // 主観のみ(実測sleep.logsが無い日)。帯別集計(実測基準)には数えられないはず
      s.condition.logs[subjDay] = { sleepHours: 5 };
      // 帯グラフ用の異常日: bed(15:00)がwake(07:00)より軸上で後ろに来る(right<=left)→バー非表示
      s.sleep.logs[anomalyDay] = { bed: "15:00", wake: "07:00" };

      s.selectedDate = TODAY;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, {
      KEY, TODAY,
      daysAgoList: Array.from({ length: 24 }, (_, i) => ({ date: daysAgo(23 - i), cfg: BUCKET_CFG[i % 4] })),
      strDay: daysAgo(24), subjDay: daysAgo(25), anomalyDay: daysAgo(26)
    });
    await page.reload();
    await page.waitForTimeout(500);

    // ============================================================
    // (1)+(2)+(3) 計器盤「睡眠」セクション(4w既定)
    // ============================================================
    console.log("[1] 計器盤「睡眠」セクション(4w既定)");
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);

    check("睡眠セクションが1つ表示される", await page.locator(".stats-sleep-panel").count() === 1);
    check("見出し「睡眠」が出る", (await page.locator(".stats-sleep-panel h2").textContent()).includes("睡眠"));

    console.log("[1-a] 就寝・起床の帯グラフ: 直近4週=28行、異常日はバーを描かない");
    const bandRows = await page.locator(".stats-sleep-band-row").count();
    check("帯グラフの行数が28(直近4週固定)", bandRows === 28, String(bandRows));
    const bandBars = await page.locator(".stats-sleep-band-bar").count();
    check("バー本数が25(28行中、ログ無し2日+異常1日=計3日を除く)", bandBars === 25, String(bandBars));

    console.log("[1-b] 睡眠時間トレンド+28日中央値ベースライン");
    const sleepSvgCircles = await page.locator(".stats-sleep-panel .stats-line-svg circle").count();
    check("トレンドの点が25個(sleepHが読める日=24帯日+文字列sleepH1日)", sleepSvgCircles === 25, String(sleepSvgCircles));
    const sleepPanelText = await page.locator(".stats-sleep-panel").textContent();
    check("中央値ベースラインが本文中央値6.2hとして出る(文字列sleepHも数値として中央値計算に混入)", sleepPanelText.includes("6.2h"), sleepPanelText.slice(0, 400));
    check("5.5h/6.5hの目安の説明文が出る", sleepPanelText.includes("5.5h/6.5h"));

    console.log("[1-c] 睡眠帯別 当日実績(中央値)");
    // ラベルと件数・数値を同じ行(bucketRows由来のスコープ変数)から読むことで、
    // パネル全体テキストへのincludes判定(異なる行の値が偶然揃って誤ってPASSする恐れがある)
    // を避ける。数値も「0%」が「100%」に部分一致してしまわないよう、否定先読み正規表現で
    // 厳密化する(Codexレビュー指摘)。
    const bucketRows = await page.locator(".stats-sleep-bucket-row").allTextContents();
    const lt55 = bucketRows.find((t) => t.includes("5.5h未満"));
    const mid1 = bucketRows.find((t) => t.includes("5.5〜6.5h"));
    const mid2 = bucketRows.find((t) => t.includes("6.5〜7.5h"));
    const gt75 = bucketRows.find((t) => t.includes("7.5h以上"));
    const hasExactPct = (text, pct) => new RegExp(`(?<!\\d)${pct}%(?!\\d)`).test(text || "");
    const hasExactNet = (text, net) => new RegExp(`(?<![\\d.])${net.replace("+", "\\+")}(?!\\d)`).test(text || "");
    const hasDayCount = (text, n) => (text || "").includes(`(${n}日)`);

    check("5.5h未満(6日)", hasDayCount(lt55, 6), lt55);
    check("5.5〜6.5h(7日=文字列sleepH分を含む)", hasDayCount(mid1, 7), mid1);
    check("6.5〜7.5h(6日)", hasDayCount(mid2, 6), mid2);
    check("7.5h以上(6日)", hasDayCount(gt75, 6), gt75);

    check("5.5h未満: 着手率0%・net -3", hasExactPct(lt55, 0) && hasExactNet(lt55, "-3"), lt55);
    check("5.5〜6.5h: 着手率100%・net -1", hasExactPct(mid1, 100) && hasExactNet(mid1, "-1"), mid1);
    check("6.5〜7.5h: 着手率100%・net +1", hasExactPct(mid2, 100) && hasExactNet(mid2, "+1"), mid2);
    check("7.5h以上: 着手率100%・net +3", hasExactPct(gt75, 100) && hasExactNet(gt75, "+3"), gt75);

    console.log("[1-d] 主観のみ(condition.logs.sleepHours)の日は実測帯別集計に数えられない");
    check("主観フォールバックは帯別カウントに混入しない(5.5h未満が7日にならず6日のまま)", hasDayCount(lt55, 6) && !hasDayCount(lt55, 7));

    // ============================================================
    // (1e) 帯の日数(n)>=3でも、着手率/netそれぞれの対サンプルが3件未満なら「—」表示になる
    //      (必須修正2: 以前は帯のn(睡眠件数)だけを見ており、Blockが無い日が多い帯だと
    //      2件だけの中央値を表示してしまっていた。netが0件のとき「+0」になる誤表示も同時に直した)
    // ============================================================
    console.log("[1e] 帯のn>=3でも対サンプル(着手率/net)が3件未満なら「—」表示になる");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      // 6.5〜7.5h帯(sb-2/6/10/14/18/22)のうち4件のBlockだけを削除する(sleep.logsは触らない
      // ため帯の日数nは6のまま。Blockが残るのはsb-18/sb-22の2件だけになる)
      const removeIds = new Set(["sb-2", "sb-6", "sb-10", "sb-14"]);
      s.blocks = s.blocks.filter((b) => !removeIds.has(b.id));
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    const bucketRowsGuard = await page.locator(".stats-sleep-bucket-row").allTextContents();
    const mid2Guard = bucketRowsGuard.find((t) => t.includes("6.5〜7.5h"));
    check("6.5〜7.5h帯は日数(6日)のまま(sleepHログ自体は6日分残っている)", hasDayCount(mid2Guard, 6), mid2Guard);
    const guardDashCount = ((mid2Guard || "").match(/—/g) || []).length;
    check("着手率・netとも対サンプルが2件(<3)のため「—」表示になる(2箇所とも)", guardDashCount === 2, mid2Guard);

    // ============================================================
    // (2) stats-rangeを12wに変えても帯グラフは4週固定のまま
    // ============================================================
    console.log("[2] stats-range=12wでも帯グラフは4週固定");
    await page.click('[data-action="stats-range"][data-range="12w"]');
    await page.waitForTimeout(300);
    const bandRows12w = await page.locator(".stats-sleep-band-row").count();
    check("12wでも帯グラフの行数は28のまま", bandRows12w === 28, String(bandRows12w));
    await page.click('[data-action="stats-range"][data-range="4w"]');
    await page.waitForTimeout(300);

    // ============================================================
    // (3) 3件未満の帯は非表示(5.5h未満を2日まで減らす)
    // ============================================================
    console.log("[3] 3件未満の帯は非表示になる(5.5h未満を6日→2日に減らす)");
    await page.evaluate(({ KEY, removeDates }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      removeDates.forEach((d) => { delete s.sleep.logs[d]; });
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, removeDates: [daysAgo(23), daysAgo(19), daysAgo(15), daysAgo(11)] });  // i=0,4,8,12 → cfg index0(lt55)の4日分を削除、残り2日
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    const sleepPanelText2 = await page.locator(".stats-sleep-panel").textContent();
    check("5.5h未満(n=2)の帯が非表示になる", !sleepPanelText2.includes("5.5h未満"));
    check("他の3帯は引き続き表示される", sleepPanelText2.includes("5.5〜6.5h") && sleepPanelText2.includes("6.5〜7.5h") && sleepPanelText2.includes("7.5h以上"));

    // ============================================================
    // (4) 全期間(all)レンジでBlockより古い睡眠ログも取り込まれる(必須修正1の回帰確認)
    // ============================================================
    // 現在の最古BlockはdaysAgo(24)(文字列sleepH日のsb-str)。修正前は「全期間」のsinceが
    // このBlock最古日だけから決まり、daysAgo(34)相当までしか遡らなかった(daysBetween=24→
    // weeks=5→since=thisWeek-28=today-34)。daysAgo(40)にBlockを伴わない睡眠ログだけを
    // 追加し、修正後は睡眠ログの最古日(daysAgo(40))まで起点が延びて6.5〜7.5h帯(daysAgo(40)の
    // sleepH=7.0が該当)の件数が6→7に増えること、かつ4w/12wなど他レンジは影響を受けない
    // ことを確認する。
    console.log("[4] 全期間(all)レンジはBlockが無い古い睡眠ログも取り込む(sinceをsleep.logs最古日で延長)");
    await page.click('[data-action="stats-range"][data-range="all"]');
    await page.waitForTimeout(300);
    const bucketRowsAllBefore = await page.locator(".stats-sleep-bucket-row").allTextContents();
    const mid2AllBefore = bucketRowsAllBefore.find((t) => t.includes("6.5〜7.5h"));
    check("全期間(追加前): 6.5〜7.5h帯は6日", (mid2AllBefore || "").includes("(6日)"), mid2AllBefore);

    const veryOldDay = daysAgo(40);
    await page.evaluate(({ KEY, veryOldDay }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep.logs[veryOldDay] = { bed: "23:00", wake: "06:00", sleepH: 7.0 };  // Blockは意図的に無し
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, veryOldDay });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);

    await page.click('[data-action="stats-range"][data-range="4w"]');
    await page.waitForTimeout(300);
    const bucketRows4wAfter = await page.locator(".stats-sleep-bucket-row").allTextContents();
    const mid2_4wAfter = bucketRows4wAfter.find((t) => t.includes("6.5〜7.5h"));
    check("4wは影響を受けない(古い睡眠ログを追加しても6日のまま)", (mid2_4wAfter || "").includes("(6日)"), mid2_4wAfter);

    await page.click('[data-action="stats-range"][data-range="all"]');
    await page.waitForTimeout(300);
    const bucketRowsAllAfter = await page.locator(".stats-sleep-bucket-row").allTextContents();
    const mid2AllAfter = bucketRowsAllAfter.find((t) => t.includes("6.5〜7.5h"));
    check("全期間(追加後): 6.5〜7.5h帯が7日に増える(Blockの無い古い睡眠ログも取り込まれた)", (mid2AllAfter || "").includes("(7日)"), mid2AllAfter);

    await page.click('[data-action="stats-range"][data-range="4w"]');
    await page.waitForTimeout(300);

    // ============================================================
    // (5) 睡眠データが1件も無ければセクション自体が非表示
    // ============================================================
    console.log("[5] 睡眠データが1件も無ければ「睡眠」セクションごと非表示");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.sleep.logs = {};
      s.condition.logs = {};
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="stats"]');
    await page.waitForTimeout(400);
    check("睡眠データ皆無で睡眠セクションが非表示", await page.locator(".stats-sleep-panel").count() === 0);
    check("他の計器盤セクションは引き続き表示される(回帰なし)", (await page.locator("main").textContent()).includes("エネルギー収支の週次推移"));

    console.log(failures === 0 ? "\n✅ v142 ALL PASS" : `\n❌ v142: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
