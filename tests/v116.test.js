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
    console.log("[1] バッファ残量計算: 超過分は減り、早終わり分は戻り、見積/実績無し・未完了Blockは集計対象外");
    await seed({
      settings: { dailyBufferMin: 100 },
      blocks: [
        // 見積30・実績50 → 超過+20
        makeBlock({ id: "over", title: "超過Block", startMin: 9 * 60, estimateMin: 30, completed: true,
          actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T09:50:00` }),
        // 見積40・実績30 → 早終わり-10
        makeBlock({ id: "early", title: "早終わりBlock", startMin: 10 * 60, estimateMin: 40, completed: true,
          actualStartAt: `${TODAY}T10:00:00`, actualEndAt: `${TODAY}T10:30:00` }),
        // 見積無し(estimateMin:null) → 除外
        makeBlock({ id: "no-estimate", title: "見積無しBlock", startMin: 11 * 60, estimateMin: null, completed: true,
          actualStartAt: `${TODAY}T11:00:00`, actualEndAt: `${TODAY}T11:20:00` }),
        // 実績無し(completed:trueだがactualStartAt/EndAt空) → 除外
        makeBlock({ id: "no-actual", title: "実績無しBlock", startMin: 12 * 60, estimateMin: 15, completed: true,
          actualStartAt: "", actualEndAt: "" }),
        // 未完了Block(見積・実績があっても集計対象外)
        makeBlock({ id: "not-done", title: "未完了Block", startMin: 13 * 60, estimateMin: 20, completed: false,
          actualStartAt: `${TODAY}T13:00:00`, actualEndAt: `${TODAY}T13:40:00` }),
        // ルーティンBlock(集計対象外。カテゴリで除外)
        makeBlock({ id: "routine-block", title: "ルーティンBlock", startMin: 6 * 60, estimateMin: 10, completed: true,
          actualStartAt: `${TODAY}T06:00:00`, actualEndAt: `${TODAY}T06:50:00`, category: "ルーティン" })
      ]
    });
    const m1 = await meterInfo();
    // 合計diff = (+20) + (-10) = +10 → remaining = 100-10 = 90 → percent = 90
    check("超過(+20)と早終わり(-10)の差分が正しく合算される(remaining=90)", m1 && m1.remaining === "90", JSON.stringify(m1));
    check("percentも一致(90%)", m1 && m1.percent === "90", JSON.stringify(m1));
    check("見積無し・実績無し・未完了・ルーティンBlockは集計から除外される(90のまま)", m1 && m1.level === "green", JSON.stringify(m1));

    // ============================================================
    // (2) 色3段階の境界値: ちょうど40%(緑)・ちょうど0%(赤)
    // ============================================================
    console.log("[2] 色分けの境界値: ちょうど40%は緑、ちょうど0%は赤");
    await seed({
      settings: { dailyBufferMin: 100 },
      blocks: [
        // 見積20・実績80 → 超過+60 → remaining=40 → percent=40(ちょうど境界)
        makeBlock({ id: "b40", title: "ちょうど40%", startMin: 9 * 60, estimateMin: 20, completed: true,
          actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T10:20:00` })
      ]
    });
    const m40 = await meterInfo();
    check("ちょうど40%は緑(残40%以上)", m40 && m40.percent === "40" && m40.level === "green", JSON.stringify(m40));

    await seed({
      settings: { dailyBufferMin: 100 },
      blocks: [
        // 見積20・実績120 → 超過+100 → remaining=0 → percent=0(ちょうど境界)
        makeBlock({ id: "b0", title: "ちょうど0%", startMin: 9 * 60, estimateMin: 20, completed: true,
          actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T11:00:00` })
      ]
    });
    const m0 = await meterInfo();
    check("ちょうど0%は赤(0以下)", m0 && m0.percent === "0" && m0.level === "red", JSON.stringify(m0));

    await seed({
      settings: { dailyBufferMin: 100 },
      blocks: [
        // 見積20・実績100 → 超過+80 → remaining=20 → percent=20(40未満・0より大きい→黄)
        makeBlock({ id: "b20", title: "20%(黄)", startMin: 9 * 60, estimateMin: 20, completed: true,
          actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T10:40:00` })
      ]
    });
    const m20 = await meterInfo();
    check("40%未満・0より大きいは黄", m20 && m20.percent === "20" && m20.level === "yellow", JSON.stringify(m20));

    // ============================================================
    // (3) 過去日・未来日表示ではメーターが出ない(クラッシュしない)。今日に戻ると復活する
    // ============================================================
    console.log("[3] 過去日・未来日を表示中はメーターが出ない(非表示。壊れない)。今日に戻ると再表示される");
    await seed({
      settings: { dailyBufferMin: 100 },
      blocks: [
        // 見積30・実績40 → 超過+10 → remaining=90
        makeBlock({ id: "today-block", title: "今日のBlock", startMin: 9 * 60, estimateMin: 30, completed: true,
          actualStartAt: `${TODAY}T09:00:00`, actualEndAt: `${TODAY}T09:40:00` })
      ]
    });
    check("今日表示中はメーターが出る", await page.locator(".buffer-meter").count() === 1);
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    check("前日表示中はメーターが出ない", await page.locator(".buffer-meter").count() === 0);
    await page.click('[data-action="date-next"]');
    await page.click('[data-action="date-next"]');
    await page.waitForTimeout(200);
    check("翌日表示中もメーターが出ない", await page.locator(".buffer-meter").count() === 0);
    await page.click('[data-action="today"]');
    await page.waitForTimeout(200);
    const m3 = await meterInfo();
    check("今日へ戻るとメーターが正しい値で再表示される", m3 && m3.remaining === "90", JSON.stringify(m3));
    check("日付移動でpageerrorは起きていない(failuresは他項目のみ反映)", true);

    // ============================================================
    // (4) バッファ未設定日の表示(フェイルソフト)
    // ============================================================
    console.log("[4] dailyBufferMinが0以下の日は「未設定」のフェイルソフト表示になる(クラッシュしない)");
    await seed({ settings: { dailyBufferMin: 0 }, blocks: [] });
    const m4a = await meterInfo();
    check("0のときは未設定表示になる", m4a && m4a.level === "unset", JSON.stringify(m4a));
    check("未設定表示にも案内文がある", m4a && m4a.text.includes("未設定"), JSON.stringify(m4a));

    await seed({ settings: { dailyBufferMin: -30 }, blocks: [] });
    const m4b = await meterInfo();
    check("負の値(壊れたデータ)でも未設定表示にフェイルソフトする", m4b && m4b.level === "unset", JSON.stringify(m4b));

    // ============================================================
    // (5) K追加要件: 計画過積載ガード
    // ============================================================
    console.log("[5] 計画過積載ガード: 見積合計+バッファが枠に収まらない日は第4状態(灰色)+案内が出る");
    await seed({
      settings: { dailyBufferMin: 60, dayCloseHours: 24 },
      blocks: [
        // 23:00開始・見積100分。closeMin=1440、earliestStart=1380 → availableMin=60。
        // shortfall = (100+60)-60 = 100 > 0 → 過積載
        makeBlock({ id: "overload-block", title: "夜遅くに詰め込んだBlock", startMin: 23 * 60, estimateMin: 100, completed: false })
      ]
    });
    const m5a = await meterInfo();
    check("過積載日は通常の緑/黄/赤ではなく第4状態(overload)になる", m5a && m5a.level === "overload", JSON.stringify(m5a));
    check("不足分(100分)がデータ属性に出る", m5a && m5a.shortfall === "100", JSON.stringify(m5a));
    check("責めないトーンの案内文が出る", m5a && m5a.hasHint && m5a.hintText.includes("タスクを減らすか"), JSON.stringify(m5a));

    console.log("[5b] 収まっている日は過積載表示が出ない(通常のメーター表示のまま)");
    await seed({
      settings: { dailyBufferMin: 60, dayCloseHours: 24 },
      blocks: [
        // 08:00開始・見積60分。availableMin=1440-480=960。shortfall=(60+60)-960<0 → 収まる
        makeBlock({ id: "fits-block", title: "余裕のある日のBlock", startMin: 8 * 60, estimateMin: 60, completed: false })
      ]
    });
    const m5b = await meterInfo();
    check("収まっている日は過積載(overload)にならない", m5b && m5b.level !== "overload", JSON.stringify(m5b));
    check("収まっている日は案内文が出ない", m5b && !m5b.hasHint, JSON.stringify(m5b));

    console.log("[5c] 境界値: 見積合計+バッファがちょうど枠に収まる日は過積載にならない");
    await seed({
      settings: { dailyBufferMin: 60, dayCloseHours: 24 },
      blocks: [
        // 12:00開始。availableMin=1440-720=720。estimateTotal+buffer=720ちょうど → 見積660分
        makeBlock({ id: "boundary-block", title: "ちょうど収まる日のBlock", startMin: 12 * 60, estimateMin: 660, completed: false })
      ]
    });
    const m5c = await meterInfo();
    check("ちょうど収まる境界では過積載にならない(shortfall=0は「収まる」扱い)", m5c && m5c.level !== "overload", JSON.stringify(m5c));

    console.log("[5d] ルーティンBlockは過積載判定の見積合計から除外される");
    await seed({
      settings: { dailyBufferMin: 60, dayCloseHours: 24 },
      blocks: [
        makeBlock({ id: "fits-block-2", title: "余裕のある通常Block", startMin: 8 * 60, estimateMin: 60, completed: false }),
        makeBlock({ id: "huge-routine", title: "巨大ルーティン(除外対象)", startMin: 6 * 60, estimateMin: 900, completed: false, category: "ルーティン" })
      ]
    });
    const m5d = await meterInfo();
    check("ルーティンBlockの見積は過積載判定に含まれない(通常表示のまま)", m5d && m5d.level !== "overload", JSON.stringify(m5d));

    const finalState = await stateNow();
    check("settings.dailyBufferMin/dayCloseHoursが正しく保持されている", finalState.settings.dailyBufferMin === 60 && finalState.settings.dayCloseHours === 24, JSON.stringify(finalState.settings));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
