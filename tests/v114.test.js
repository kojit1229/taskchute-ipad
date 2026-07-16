// v114 検証: 保護系ルーティンの連続欠落表示(ROADMAP「TOC由来の提案F」、2026-07-16 K採用)。
// 運動・睡眠・内省・家族時間などのルーティンは実行率(%)で裁かず、Atomic HabitsのNever miss
// twice原則(1回のミスは事故、2回目が習慣を殺す)に基づく「連続欠落日数」で見せる。
//
// (1) 繰り返しルールにprotectionフィールドが無い旧データでも normalizeState が既定false を
//     補完する(後方互換マイグレーション、クラッシュしない)
// (2) protection:true のルーティンは、Block群(recurrenceGroupIdで突合)を今日から過去へ遡って
//     連続欠落日数を正しく計算し、ルーティンタブ・ホーム双方にバッジ表示する
// (3) 連続欠落0〜1日は警告なし表示、2日以上は警告色+責めないトーンの一言が付く
// (4) protection:false(既定)の既存ルーティンには一切バッジが出ず、実行率%の集計値も
//     従来どおり(protectionの有無に関係なく全ルーティンを分母に含める)
// (5) Block編集モーダルの「制約保護系」チェックボックスON/OFFがルールへ反映され、
//     保存後の再描画に連続欠落バッジが即座に反映される
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
  // v108/v113同様、実時刻依存フレークを避けるためTODAYは実行時の「今日」10:00に固定する
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  function isoOffset(n) {
    const d = new Date(now0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const TODAY = isoOffset(0);
  const D1 = isoOffset(-1);
  const D2 = isoOffset(-2);
  const D3 = isoOffset(-3);

  // v114境界値レビュー対応: comment(既定"")は「7日より前の日付でも
  // maintainRecurrences({purge:true})のisTouchedBlock判定でパージされないようにする」ための
  // 引数。起動時(runDailyOpen({force:true}))は毎回purge:trueが走り、RECURRENCE_KEEP_PAST_DAYS
  // (7日)より前かつ「未編集」の繰り返し実体は削除される。14日キャップの境界値テストは
  // 8日以上前のBlockを生存させる必要があるため、非空commentで「編集済み」扱いにする。
  function makeBlock({ id, date, title, recurrenceGroupId, completed, time, comment = "" }) {
    return {
      id, taskId: "", date, title, category: "ルーティン",
      plannedStartAt: `${date}T${time}`, plannedEndAt: `${date}T${time.slice(0, 2)}:${String(Number(time.slice(3, 5)) + 10).padStart(2, "0")}`,
      actualStartAt: "", actualEndAt: "", completed,
      charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment,
      recurrenceGroupId, pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false,
      source: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  // v114境界値レビュー対応: anchorDate(既定D3)は「該当日より前は繰り返しにマッチしない」
  // (recurrenceMatchesDate)ため、maintainRecurrences()の自動実体化で意図しない日付の
  // Blockが増殖しないようにするガード。「今日分のBlockデータが1件も無い」ケース(ruleH)では
  // anchorDateを未来日にして、今日分の自動生成そのものを止める。
  function makeRule({ id, title, time, protection, anchorDate = D3 }) {
    const rule = {
      id, title, category: "ルーティン", taskId: "", kind: "daily", startTime: time, endTime: "",
      anchorDate, expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
      createdAt: `${D3}T00:00`, updatedAt: `${D3}T00:00`, deleted: false
    };
    // protection未指定=マイグレーションテスト用(旧データはフィールド自体が無い)
    if (protection !== undefined) rule.protection = protection;
    return rule;
  }

  // ruleA(運動・protection:true): D3完了→D2,D1,今日 未完了 = 連続欠落3日(警告)
  const ruleA = makeRule({ id: "rule-a-exercise", title: "運動", time: "06:00", protection: true });
  const blocksA = [
    makeBlock({ id: "blk-a-d3", date: D3, title: "運動", recurrenceGroupId: ruleA.id, completed: true, time: "06:00" }),
    makeBlock({ id: "blk-a-d2", date: D2, title: "運動", recurrenceGroupId: ruleA.id, completed: false, time: "06:00" }),
    makeBlock({ id: "blk-a-d1", date: D1, title: "運動", recurrenceGroupId: ruleA.id, completed: false, time: "06:00" }),
    makeBlock({ id: "blk-a-today", date: TODAY, title: "運動", recurrenceGroupId: ruleA.id, completed: false, time: "06:00" })
  ];
  // ruleB(睡眠・protection:true): D1完了→今日のみ未完了 = 連続欠落1日(警告なし)
  const ruleB = makeRule({ id: "rule-b-sleep", title: "睡眠記録", time: "07:00", protection: true });
  const blocksB = [
    makeBlock({ id: "blk-b-d1", date: D1, title: "睡眠記録", recurrenceGroupId: ruleB.id, completed: true, time: "07:00" }),
    makeBlock({ id: "blk-b-today", date: TODAY, title: "睡眠記録", recurrenceGroupId: ruleB.id, completed: false, time: "07:00" })
  ];
  // ruleC(資格勉強・protection:false=既定): 今日完了。実行率%集計の回帰確認用
  const ruleC = makeRule({ id: "rule-c-study", title: "資格勉強", time: "08:00", protection: false });
  const blocksC = [
    makeBlock({ id: "blk-c-today", date: TODAY, title: "資格勉強", recurrenceGroupId: ruleC.id, completed: true, time: "08:00" })
  ];
  // ruleD(家族時間・protectionフィールド自体が無い=旧データ模擬): 編集モーダルでのON/OFF検証用
  const ruleD = makeRule({ id: "rule-d-family", title: "家族時間", time: "09:00" });  // protection未指定
  const blocksD = [
    makeBlock({ id: "blk-d-today", date: TODAY, title: "家族時間", recurrenceGroupId: ruleD.id, completed: false, time: "09:00" })
  ];

  async function seed() {
    await page.evaluate(({ KEY, TODAY, recurrences, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.projects = [];
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.selectedDate = TODAY;
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, recurrences: [ruleA, ruleB, ruleC, ruleD], blocks: [...blocksA, ...blocksB, ...blocksC, ...blocksD] });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  async function badgesIn(containerSelector, titleSelector) {
    return page.evaluate(({ containerSelector, titleSelector }) =>
      Array.from(document.querySelectorAll(containerSelector)).map((el) => {
        const badge = el.querySelector(".protection-badge");
        return {
          title: (el.querySelector(titleSelector)?.textContent || "").trim(),
          hasBadge: !!badge,
          warn: badge ? badge.classList.contains("warn") : false,
          streak: badge ? badge.getAttribute("data-protection-streak") : null
        };
      }), { containerSelector, titleSelector });
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);
    await seed();

    // ============================================================
    // (1) normalizeStateマイグレーション: protectionフィールドが無い旧ルールにも既定falseが補完される
    // ============================================================
    console.log("[1] protectionフィールドの無い旧データにも既定falseが補完される(クラッシュしない)");
    const s1 = await stateNow();
    const rD = (s1.recurrences || []).find((r) => r.id === "rule-d-family");
    check("旧データのルールにprotection:falseが補完される", rD && rD.protection === false, JSON.stringify(rD));
    const rA = (s1.recurrences || []).find((r) => r.id === "rule-a-exercise");
    check("protection:trueを明示したルールは維持される", rA && rA.protection === true, JSON.stringify(rA));

    // ============================================================
    // (2)(3) ルーティンタブ: 連続欠落日数が正しく計算され、閾値どおりに表示が変わる
    // ============================================================
    console.log("[2] ルーティンタブで連続欠落日数バッジが表示される");
    const routineBadges = await badgesIn(".routine-card", ".routine-card-title");
    const cardA = routineBadges.find((b) => b.title === "運動");
    const cardB = routineBadges.find((b) => b.title === "睡眠記録");
    const cardC = routineBadges.find((b) => b.title === "資格勉強");
    check("運動(連続3日欠落)にバッジが出る", cardA && cardA.hasBadge, JSON.stringify(cardA));
    check("運動の連続欠落日数は3", cardA && cardA.streak === "3", JSON.stringify(cardA));
    check("2日以上は警告色(warn)が付く", cardA && cardA.warn === true, JSON.stringify(cardA));
    check("睡眠記録(連続1日欠落)にバッジが出る", cardB && cardB.hasBadge, JSON.stringify(cardB));
    check("睡眠記録の連続欠落日数は1", cardB && cardB.streak === "1", JSON.stringify(cardB));
    check("1日以下は警告色が付かない", cardB && cardB.warn === false, JSON.stringify(cardB));
    check("資格勉強(protection:false)にはバッジが出ない", cardC && cardC.hasBadge === false, JSON.stringify(cardC));

    // ============================================================
    // (4) ホームタブ: 同じバッジ表示 + 実行率%集計は従来どおり(protection有無で分母は変えない)
    // ============================================================
    console.log("[3] ホームタブでも同じ連続欠落バッジが表示され、実行率%の集計は変わらない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    const homeBadges = await badgesIn(".home-ck", ".home-ck-name");
    const homeA = homeBadges.find((b) => b.title === "運動");
    const homeC = homeBadges.find((b) => b.title === "資格勉強");
    check("ホームでも運動に連続3日欠落バッジが出る", homeA && homeA.hasBadge && homeA.streak === "3", JSON.stringify(homeA));
    check("ホームでも資格勉強(protection:false)にはバッジが出ない", homeC && homeC.hasBadge === false, JSON.stringify(homeC));
    // 今日のルーティン4件(運動/睡眠記録/資格勉強/家族時間)中、完了は資格勉強の1件のみ → 25%
    const pctText = await page.textContent(".home-rate-pct");
    check("実行率%はprotectionに関係なく全ルーティンを分母に含める(1/4=25%)", pctText.includes("25%"), pctText);

    // ============================================================
    // (5) Block編集モーダル: 「制約保護系」チェックボックスのON/OFFがルールへ反映される
    // ============================================================
    console.log("[4] 編集モーダルで「制約保護系」チェックボックスをONにするとルールに反映され、バッジが出る");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="edit-block"][data-id="blk-d-today"]');
    await page.waitForTimeout(200);
    const hasCheckboxBefore = await page.$('[data-modal-field="protection"]') !== null;
    check("category=ルーティンの繰り返しBlock編集で「制約保護系」チェックボックスが出る", hasCheckboxBefore);
    await page.check('[data-modal-field="protection"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const rDAfter = (s2.recurrences || []).find((r) => r.id === "rule-d-family");
    check("チェックON→保存でルールのprotectionがtrueになる", rDAfter && rDAfter.protection === true, JSON.stringify(rDAfter));
    const badgesAfter = await badgesIn(".routine-card", ".routine-card-title");
    const cardDAfter = badgesAfter.find((b) => b.title === "家族時間");
    check("保存直後の再描画で家族時間にバッジが出る", cardDAfter && cardDAfter.hasBadge, JSON.stringify(cardDAfter));

    // OFFに戻すと消える(回帰: トグルの両方向を確認)
    await page.click('[data-action="edit-block"][data-id="blk-d-today"]');
    await page.waitForTimeout(200);
    await page.uncheck('[data-modal-field="protection"]');
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const rDAfter2 = (s3.recurrences || []).find((r) => r.id === "rule-d-family");
    check("チェックOFF→保存でルールのprotectionがfalseに戻る", rDAfter2 && rDAfter2.protection === false, JSON.stringify(rDAfter2));
    const badgesAfter2 = await badgesIn(".routine-card", ".routine-card-title");
    const cardDAfter2 = badgesAfter2.find((b) => b.title === "家族時間");
    check("OFFに戻すとバッジも消える", cardDAfter2 && cardDAfter2.hasBadge === false, JSON.stringify(cardDAfter2));

    // ============================================================
    // (6) 境界値: ちょうど2日連続欠落(閾値オンポイント)/0日欠落(即警告なし)/
    //     14日超過(PROTECTION_MAX_LOOKBACK_DAYSでキャップ)
    //     ※既存(1)〜(5)のセクションとは独立させるため、ここで状態を全置換する
    //     (home実行率%等、既存アサーションに影響を与えないため)。
    // ============================================================
    console.log("[5] 境界値: streak=2(閾値ちょうど)/streak=0(当日完了)/14日キャップ");
    // ruleE(瞑想): D2完了→D1,今日 未完了 = 連続欠落ちょうど2日(streak>=2の閾値オンポイント。
    // 既存テストのstreak=3(ruleA)・streak=1(ruleB)はどちらも閾値を跨いだ側のみで、
    // 「ちょうど2」自体はオフバイワン検出のため未検証だった)
    const ruleE = makeRule({ id: "rule-e-meditation", title: "瞑想", time: "05:00", protection: true });
    const blocksE = [
      makeBlock({ id: "blk-e-d2", date: D2, title: "瞑想", recurrenceGroupId: ruleE.id, completed: true, time: "05:00" }),
      makeBlock({ id: "blk-e-d1", date: D1, title: "瞑想", recurrenceGroupId: ruleE.id, completed: false, time: "05:00" }),
      makeBlock({ id: "blk-e-today", date: TODAY, title: "瞑想", recurrenceGroupId: ruleE.id, completed: false, time: "05:00" })
    ];
    // ruleF(腹式呼吸): 今日完了のみ = 連続欠落0日(missed=0が「completed=trueで即打ち切り」経路を通る)
    const ruleF = makeRule({ id: "rule-f-breathing", title: "腹式呼吸", time: "05:30", protection: true });
    const blocksF = [
      makeBlock({ id: "blk-f-today", date: TODAY, title: "腹式呼吸", recurrenceGroupId: ruleF.id, completed: true, time: "05:30" })
    ];
    // ruleI(ストレッチ強化): 今日〜14日前まで15日分すべて未完了(8日以上前はcommentを付けて
    // maintainRecurrencesのパージ(RECURRENCE_KEEP_PAST_DAYS=7日)を回避)。
    // PROTECTION_MAX_LOOKBACK_DAYS=14のため、実際は15日連続欠落でもバッジは14でキャップされる
    // はず(15日目のデータが存在すること自体が「キャップが効いていなければ15になる」ことの
    // 反証材料になる)。
    const ruleI = makeRule({ id: "rule-i-cap", title: "ストレッチ強化", time: "05:45", protection: true });
    const blocksI = [];
    for (let i = 0; i <= 14; i++) {
      blocksI.push(makeBlock({
        id: `blk-i-d${i}`, date: isoOffset(-i), title: "ストレッチ強化",
        recurrenceGroupId: ruleI.id, completed: false, time: "05:45",
        comment: i >= 8 ? "seed-anchor(パージ回避用)" : ""
      }));
    }

    await page.evaluate(({ KEY, TODAY, recurrences, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.projects = [];
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.selectedDate = TODAY;
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, recurrences: [ruleE, ruleF, ruleI], blocks: [...blocksE, ...blocksF, ...blocksI] });
    await page.reload();
    await page.waitForTimeout(500);

    const boundaryBadges = await badgesIn(".routine-card", ".routine-card-title");
    const cardE = boundaryBadges.find((b) => b.title === "瞑想");
    const cardF = boundaryBadges.find((b) => b.title === "腹式呼吸");
    const cardI = boundaryBadges.find((b) => b.title === "ストレッチ強化");
    check("ちょうど2日連続欠落で警告バッジが出る(streak>=2の閾値オンポイント)", cardE && cardE.hasBadge, JSON.stringify(cardE));
    check("ちょうど2日連続欠落の日数は2", cardE && cardE.streak === "2", JSON.stringify(cardE));
    check("ちょうど2日連続欠落は警告色(warn)が付く", cardE && cardE.warn === true, JSON.stringify(cardE));
    check("0日欠落(当日完了)にもバッジは出る(0日と分かるように)", cardF && cardF.hasBadge, JSON.stringify(cardF));
    check("0日欠落の連続日数は0", cardF && cardF.streak === "0", JSON.stringify(cardF));
    check("0日欠落は警告色が付かない", cardF && cardF.warn === false, JSON.stringify(cardF));
    check("15日分の欠落データがあってもPROTECTION_MAX_LOOKBACK_DAYS(14)でキャップされる", cardI && cardI.streak === "14", JSON.stringify(cardI));
    check("14日キャップでも警告色(warn)は付く", cardI && cardI.warn === true, JSON.stringify(cardI));

    // ============================================================
    // (7) 境界値: 該当日(今日)にBlockデータが1件も無い→即座にstreak=0・警告なし
    //     computeProtectionMissedStreakは常にtodayISO()基準で過去へ遡るため、今日分の
    //     データが無ければ最初の判定で即打ち切りになるはず(canary-check.pyのコメント
    //     「対象日にBlockが1件も無い→そこで打ち切り」の1日目バージョン)。
    //     selectedDateを未来日にして、そこにだけBlockを置く(=実際の「今日」には
    //     このルールのBlockが1件も存在しない状態を作る)。anchorDateを未来日にして、
    //     maintainRecurrences()が「今日」分を自動実体化してしまわないようガードする。
    //     注意: v85仕様により起動時(reload)は必ずstate.selectedDateがtodayISO()へ
    //     強制されるため(「翌日」ボタンで日付移動した場合はセッション中のみ尊重される)、
    //     localStorageへselectedDate=未来日を仕込んでも次のreloadで無視される。そのため
    //     reload後にUI操作(「翌日」ボタン)でセッション内移動する。
    // ============================================================
    console.log("[6] 境界値: 今日分のBlockデータが1件も無いルーティンは即座にstreak=0・警告なし");
    const FUTURE_OFFSET = 5;
    const FUTURE = isoOffset(FUTURE_OFFSET);
    const ruleH = makeRule({ id: "rule-h-nodata", title: "ヨガ", time: "05:15", protection: true, anchorDate: FUTURE });
    const blocksH = [
      makeBlock({ id: "blk-h-future", date: FUTURE, title: "ヨガ", recurrenceGroupId: ruleH.id, completed: false, time: "05:15" })
    ];
    await page.evaluate(({ KEY, recurrences, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.projects = [];
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, recurrences: [ruleH], blocks: blocksH });
    await page.reload();
    await page.waitForTimeout(500);
    // v85: reload直後はselectedDateがtodayISO()に強制されるため、「翌日」ボタンをFUTURE_OFFSET回
    // クリックしてセッション内で未来日へ移動する(shiftSelectedDateはrender()のみでreloadしない)
    for (let i = 0; i < FUTURE_OFFSET; i++) {
      await page.click('[data-action="date-next"]');
      await page.waitForTimeout(100);
    }
    const noDataBadges = await badgesIn(".routine-card", ".routine-card-title");
    const cardH = noDataBadges.find((b) => b.title === "ヨガ");
    check("今日分のBlockデータが1件も無いルーティンにもバッジは出る(0日と分かるように)", cardH && cardH.hasBadge, JSON.stringify(cardH));
    check("今日分のデータが無ければstreak=0で即打ち切り", cardH && cardH.streak === "0", JSON.stringify(cardH));
    check("データ無しのstreak=0は警告色が付かない", cardH && cardH.warn === false, JSON.stringify(cardH));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
