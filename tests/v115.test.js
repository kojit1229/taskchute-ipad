// v115 検証: 縮退版+連続ルーティン(ハビットスタック)(ROADMAP「TOC由来の提案G」、2026-07-16 K採用)。
// v114(保護系ルーティンの連続欠落表示)の続き。
//
// (1) 縮退版(①): fallbackTitleが設定された保護系ルーティンにのみ「縮退版で実行」ボタンが出る。
//     タップすると当日のBlockが完了扱いになり(タイトルに"(縮退版)"付記)、連続欠落日数が
//     リセットされる(v114のバッジ表示と連動)。fallbackTitle未設定のルーティンにはボタンが出ない。
// (2) 連続ルーティン(②): チェーンを開始すると現在のステップだけがフルスクリーンで表示され、
//     「完了して次へ」で順送りに進む。全ステップ完了でチェーンが完了扱いになり、ステップの
//     タイトルと同名の繰り返しルーティンがあれば、そのルーティンの連続欠落日数もリセットされる。
// (3) アンカー(③): anchor属性を持つルーティン/チェーンは通常のスケジュールでは実体化されず、
//     アンカー元(ルーティン)が完了した直後の時刻に、ルーティンはBlockとして自動生成され、
//     チェーンはscheduledStartAtとして記録される。
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
  // 実時刻依存フレークを避けるためTODAYは実行時の「今日」10:00に固定する(v108/v113/v114同様)
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

  function makeBlock({ id, date, title, recurrenceGroupId, completed, time }) {
    return {
      id, taskId: "", date, title, category: "ルーティン",
      plannedStartAt: `${date}T${time}`, plannedEndAt: `${date}T${time.slice(0, 2)}:${String(Number(time.slice(3, 5)) + 10).padStart(2, "0")}`,
      actualStartAt: "", actualEndAt: "", completed,
      charge: 0, discharge: 0, expectedCharge: "", expectedDischarge: "", comment: "",
      recurrenceGroupId, pomodoroCount: 0, migratedTo: "", carryCount: 0, orderIndex: 0, isMIT: false,
      source: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  function makeRule({ id, title, time, protection, fallbackTitle, fallbackMinutes, anchor, anchorDate }) {
    return {
      id, title, category: "ルーティン", taskId: "", kind: "daily", startTime: time, endTime: "",
      anchorDate: anchorDate || D3, expectedCharge: "", expectedDischarge: "", source: "", exceptionDates: [],
      protection: Boolean(protection),
      fallbackTitle: fallbackTitle || "",
      fallbackMinutes: fallbackMinutes ?? null,
      anchor: anchor || "",
      createdAt: `${D3}T00:00`, updatedAt: `${D3}T00:00`, deleted: false
    };
  }

  // ---- (1) 縮退版 ----
  // ruleGym(protection:true, fallbackTitle設定あり): D3完了→D2,D1,今日 未完了 = 連続欠落3日
  const ruleGym = makeRule({ id: "rule-gym", title: "ジム", time: "06:00", protection: true, fallbackTitle: "自宅ストレッチ", fallbackMinutes: 5 });
  const blocksGym = [
    makeBlock({ id: "blk-gym-d3", date: D3, title: "ジム", recurrenceGroupId: ruleGym.id, completed: true, time: "06:00" }),
    makeBlock({ id: "blk-gym-d2", date: D2, title: "ジム", recurrenceGroupId: ruleGym.id, completed: false, time: "06:00" }),
    makeBlock({ id: "blk-gym-d1", date: D1, title: "ジム", recurrenceGroupId: ruleGym.id, completed: false, time: "06:00" }),
    makeBlock({ id: "blk-gym-today", date: TODAY, title: "ジム", recurrenceGroupId: ruleGym.id, completed: false, time: "06:00" })
  ];
  // ruleReading(protection:true、fallbackTitle未設定): ボタンが出ないことの回帰確認用
  const ruleReading = makeRule({ id: "rule-reading", title: "読書", time: "20:00", protection: true });
  const blocksReading = [
    makeBlock({ id: "blk-reading-d1", date: D1, title: "読書", recurrenceGroupId: ruleReading.id, completed: true, time: "20:00" }),
    makeBlock({ id: "blk-reading-today", date: TODAY, title: "読書", recurrenceGroupId: ruleReading.id, completed: false, time: "20:00" })
  ];

  // ---- (2) 連続ルーティン(チェーン) ----
  // ruleMeditation(protection:true、チェーンのステップ「瞑想」とタイトルが一致): 連続欠落3日
  const ruleMeditation = makeRule({ id: "rule-meditation", title: "瞑想", time: "07:30", protection: true });
  const blocksMeditation = [
    makeBlock({ id: "blk-med-d3", date: D3, title: "瞑想", recurrenceGroupId: ruleMeditation.id, completed: true, time: "07:30" }),
    makeBlock({ id: "blk-med-d2", date: D2, title: "瞑想", recurrenceGroupId: ruleMeditation.id, completed: false, time: "07:30" }),
    makeBlock({ id: "blk-med-d1", date: D1, title: "瞑想", recurrenceGroupId: ruleMeditation.id, completed: false, time: "07:30" }),
    makeBlock({ id: "blk-med-today", date: TODAY, title: "瞑想", recurrenceGroupId: ruleMeditation.id, completed: false, time: "07:30" })
  ];
  const chainMorning = {
    id: "chain-morning", title: "朝の整えチェーン10分",
    steps: [
      { id: "s1", title: "目薬", estimatedMinutes: 0.5 },
      { id: "s2", title: "深呼吸", estimatedMinutes: 2 },
      { id: "s3", title: "瞑想", estimatedMinutes: 7 }
    ],
    anchor: "", createdAt: `${D3}T00:00`, updatedAt: `${D3}T00:00`, deleted: false
  };

  // ---- (3) アンカー ----
  // ruleAnchorSource(アンカー元、anchor無し、通常どおり毎日実体化される)
  const ruleAnchorSource = makeRule({ id: "rule-anchor-source", title: "歯磨き", time: "07:00", anchorDate: TODAY });
  const blocksAnchorSource = [
    makeBlock({ id: "blk-anchor-source-today", date: TODAY, title: "歯磨き", recurrenceGroupId: ruleAnchorSource.id, completed: false, time: "07:00" })
  ];
  // ruleAnchored(anchor=ruleAnchorSource.id): 通常のスケジュールでは実体化されず、
  // アンカー元完了直後にだけBlockが生成されるはず
  const ruleAnchored = makeRule({ id: "rule-anchored", title: "アンカー対象ルーティン", time: "23:00", protection: true, anchor: "rule-anchor-source", anchorDate: TODAY });
  // chainAnchored(anchor=ruleAnchorSource.id): アンカー元完了直後にscheduledStartAtが記録されるはず
  const chainAnchored = {
    id: "chain-anchored", title: "アンカー対象チェーン",
    steps: [{ id: "ca1", title: "ストレッチ", estimatedMinutes: 3 }],
    anchor: "rule-anchor-source", createdAt: `${D3}T00:00`, updatedAt: `${D3}T00:00`, deleted: false
  };

  // ---- (3b) アンカー元が崩れている場合の連続欠落日数(独立レビュー指摘 severity:high対応) ----
  // ruleAnchorSourceBroken(アンカー元、anchor無し): D3のみ完了、D2/D1/今日は未完了=崩れている。
  const ruleAnchorSourceBroken = makeRule({ id: "rule-anchor-source-broken", title: "白湯", time: "06:30", anchorDate: D3 });
  const blocksAnchorSourceBroken = [
    makeBlock({ id: "blk-anchor-source-broken-d3", date: D3, title: "白湯", recurrenceGroupId: ruleAnchorSourceBroken.id, completed: true, time: "06:30" }),
    makeBlock({ id: "blk-anchor-source-broken-d2", date: D2, title: "白湯", recurrenceGroupId: ruleAnchorSourceBroken.id, completed: false, time: "06:30" }),
    makeBlock({ id: "blk-anchor-source-broken-d1", date: D1, title: "白湯", recurrenceGroupId: ruleAnchorSourceBroken.id, completed: false, time: "06:30" }),
    makeBlock({ id: "blk-anchor-source-broken-today", date: TODAY, title: "白湯", recurrenceGroupId: ruleAnchorSourceBroken.id, completed: false, time: "06:30" })
  ];
  // ruleAnchoredBroken(anchor=ruleAnchorSourceBroken.id、protection:true): アンカー元が崩れているため
  // maintainRecurrencesからも除外され、過去日(D1/D2/D3)のBlockは一切実体化されない(=修正前は
  // computeProtectionMissedStreakが「対象日にBlockが1件も無い」で即打ち切りとなりstreak過小
  // カウントのバグがあった)。今日分のBlockだけは(バッジを画面上で観測できるように)未完了で
  // 1件seedする——これは「アンカーが過去に一度発火して今日のBlockだけは存在するが、
  // まだ実行していない」状態を模した最小限のDOM可視化であり、D1/D2/D3のギャップ橋渡し判定
  // (このテストが検証したい本題)には影響しない。
  const ruleAnchoredBroken = makeRule({ id: "rule-anchored-broken", title: "アンカー対象(壊れているアンカー元)", time: "23:30", protection: true, anchor: "rule-anchor-source-broken", anchorDate: TODAY });
  const blocksAnchoredBroken = [
    makeBlock({ id: "blk-anchored-broken-today", date: TODAY, title: "アンカー対象(壊れているアンカー元)", recurrenceGroupId: ruleAnchoredBroken.id, completed: false, time: "23:30" })
  ];

  async function seed() {
    await page.evaluate(({ KEY, TODAY, recurrences, blocks, chains }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = [];
      s.projects = [];
      s.blocks = blocks;
      s.recurrences = recurrences;
      s.routineChains = chains;
      s.chainRuns = [];
      s.selectedDate = TODAY;
      s.currentView = "routine";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, {
      KEY, TODAY,
      recurrences: [ruleGym, ruleReading, ruleMeditation, ruleAnchorSource, ruleAnchored, ruleAnchorSourceBroken, ruleAnchoredBroken],
      blocks: [...blocksGym, ...blocksReading, ...blocksMeditation, ...blocksAnchorSource, ...blocksAnchorSourceBroken, ...blocksAnchoredBroken],
      chains: [chainMorning, chainAnchored]
    });
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
          streak: badge ? badge.getAttribute("data-protection-streak") : null,
          warn: badge ? badge.classList.contains("warn") : null,
          hasFallbackBtn: !!el.querySelector(".fallback-btn")
        };
      }), { containerSelector, titleSelector });
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);
    await seed();

    // ============================================================
    // (1) 縮退版: ボタン表示条件 + 実行で当日Blockが完了・連続欠落日数がリセットされる
    // ============================================================
    console.log("[1] 縮退版(fallbackTitle設定済みルーティンのみボタン表示、実行で連続欠落がリセット)");
    const before = await badgesIn(".routine-card", ".routine-card-title");
    const gymBefore = before.find((b) => b.title === "ジム");
    const readingBefore = before.find((b) => b.title === "読書");
    check("ジム(fallbackTitle設定済み)は連続3日欠落バッジが出る", gymBefore && gymBefore.streak === "3", JSON.stringify(gymBefore));
    check("ジムに「縮退版で実行」ボタンが出る", gymBefore && gymBefore.hasFallbackBtn, JSON.stringify(gymBefore));
    check("読書(fallbackTitle未設定)にはボタンが出ない", readingBefore && readingBefore.hasFallbackBtn === false, JSON.stringify(readingBefore));

    await page.click('[data-action="routine-fallback"][data-id="rule-gym"]');
    await page.waitForTimeout(300);
    const sAfterFallback = await stateNow();
    const gymBlockAfter = (sAfterFallback.blocks || []).find((b) => b.id === "blk-gym-today");
    check("縮退版実行で当日Blockが完了扱いになる", gymBlockAfter && gymBlockAfter.completed === true, JSON.stringify(gymBlockAfter));
    check("タイトルに(縮退版)が付記される", gymBlockAfter && gymBlockAfter.title.includes("(縮退版)"), JSON.stringify(gymBlockAfter));
    check("コメントに縮退版の詳細が残る", gymBlockAfter && gymBlockAfter.comment.includes("自宅ストレッチ") && gymBlockAfter.comment.includes("5"), JSON.stringify(gymBlockAfter));
    const after = await badgesIn(".routine-card", ".routine-card-title");
    const gymAfter = after.find((b) => b.title.includes("ジム"));
    check("縮退版実行後は連続欠落日数が0になる", gymAfter && gymAfter.streak === "0", JSON.stringify(gymAfter));
    check("完了済みになったので縮退版ボタンはもう出ない", gymAfter && gymAfter.hasFallbackBtn === false, JSON.stringify(gymAfter));

    // ============================================================
    // (2) 連続ルーティン(チェーン): 順次進行 + 全ステップ完了で構成要素の連続欠落もリセット
    // ============================================================
    console.log("[2] 連続ルーティン(チェーン)の順次進行と全ステップ完了判定");
    const medBefore = (await badgesIn(".routine-card", ".routine-card-title")).find((b) => b.title === "瞑想");
    check("瞑想は開始前、連続3日欠落バッジが出る", medBefore && medBefore.streak === "3", JSON.stringify(medBefore));

    await page.click('[data-action="chain-run-open"][data-id="chain-morning"]');
    await page.waitForTimeout(200);
    check("チェーン開始で1ステップ目(目薬)がフルスクリーン表示される", (await page.textContent(".now-title")).trim() === "目薬");

    await page.click('[data-action="chain-step-complete"]');
    await page.waitForTimeout(200);
    check("1ステップ完了で2ステップ目(深呼吸)に進む", (await page.textContent(".now-title")).trim() === "深呼吸");

    await page.click('[data-action="chain-step-complete"]');
    await page.waitForTimeout(200);
    check("2ステップ完了で3ステップ目(瞑想)に進む", (await page.textContent(".now-title")).trim() === "瞑想");

    await page.click('[data-action="chain-step-complete"]');
    await page.waitForTimeout(300);
    const nowTitleCount = await page.locator(".now-title").count();
    check("全ステップ完了でフルスクリーンが閉じ通常画面に戻る", nowTitleCount === 0, String(nowTitleCount));

    const sAfterChain = await stateNow();
    const chainRun = (sAfterChain.chainRuns || []).find((r) => r.chainId === "chain-morning" && r.date === TODAY);
    check("チェーンrunがcompletedAtを持つ(全ステップ完了)", chainRun && !!chainRun.completedAt, JSON.stringify(chainRun));
    check("チェーンrunのcurrentIndexがステップ数(3)に達している", chainRun && chainRun.currentIndex === 3, JSON.stringify(chainRun));
    const medBlockAfter = (sAfterChain.blocks || []).find((b) => b.recurrenceGroupId === "rule-meditation" && b.date === TODAY);
    check("タイトル一致するルーティン(瞑想)の当日Blockが完了扱いになる", medBlockAfter && medBlockAfter.completed === true, JSON.stringify(medBlockAfter));
    const medAfter = (await badgesIn(".routine-card", ".routine-card-title")).find((b) => b.title === "瞑想");
    check("瞑想の連続欠落日数がチェーン経由で0にリセットされる", medAfter && medAfter.streak === "0", JSON.stringify(medAfter));

    // ============================================================
    // (3) アンカー: アンカー元(歯磨き)完了直後に、アンカー対象ルーティン/チェーンが自動配置される
    // ============================================================
    console.log("[3] アンカーによる自動配置(習慣スタッキング)");
    const sBeforeAnchor = await stateNow();
    const anchoredBlockBefore = (sBeforeAnchor.blocks || []).find((b) => b.recurrenceGroupId === "rule-anchored" && b.date === TODAY);
    check("アンカー対象ルーティンは、アンカー完了前は当日Blockを持たない", !anchoredBlockBefore, JSON.stringify(anchoredBlockBefore));

    await page.click('[data-action="toggle-block"][data-id="blk-anchor-source-today"]');
    await page.waitForTimeout(300);
    const sAfterAnchor = await stateNow();
    const sourceBlock = (sAfterAnchor.blocks || []).find((b) => b.id === "blk-anchor-source-today");
    check("アンカー元(歯磨き)Blockが完了する", sourceBlock && sourceBlock.completed === true, JSON.stringify(sourceBlock));
    const anchoredBlockAfter = (sAfterAnchor.blocks || []).find((b) => b.recurrenceGroupId === "rule-anchored" && b.date === TODAY);
    check("アンカー元完了直後にアンカー対象ルーティンの当日Blockが自動生成される", !!anchoredBlockAfter, JSON.stringify(anchoredBlockAfter));
    if (anchoredBlockAfter && sourceBlock) {
      const toMin = (dt) => { const m = /T(\d{1,2}):(\d{2})/.exec(dt); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
      const expectedMin = toMin(sourceBlock.actualEndAt) + 1;
      check("自動生成されたBlockの開始時刻はアンカー完了時刻の1分後", toMin(anchoredBlockAfter.plannedStartAt) === expectedMin,
        `expected=${expectedMin} actual=${toMin(anchoredBlockAfter.plannedStartAt)}`);
    }
    const anchoredChainRun = (sAfterAnchor.chainRuns || []).find((r) => r.chainId === "chain-anchored" && r.date === TODAY);
    check("アンカー対象チェーンにscheduledStartAtが記録される", anchoredChainRun && !!anchoredChainRun.scheduledStartAt, JSON.stringify(anchoredChainRun));
    check("アンカー対象チェーンはまだ完了していない(スケジュールされただけ)", anchoredChainRun && !anchoredChainRun.completedAt, JSON.stringify(anchoredChainRun));

    // ============================================================
    // (3b) アンカー元が崩れている場合の連続欠落日数(独立レビュー指摘 severity:high対応、2026-07-16)
    // ruleAnchoredBroken(protection:true, anchor=ruleAnchorSourceBroken)は、アンカー元(白湯)が
    // D2/D1/今日と未完了続きのため、maintainRecurrencesの除外によりD1/D2/D3のBlockが
    // 実体化されていない。修正前は「対象日にBlockが1件も無い」で即打ち切りとなりstreakが
    // 過小カウント(アンカー元が今日崩れているとstreak=0で警告自体が消える)されていた。
    // ============================================================
    console.log("[3b] アンカー元が崩れている場合も連続欠落日数を正しくカウントする");
    const brokenBadges = await badgesIn(".routine-card", ".routine-card-title");
    const brokenCard = brokenBadges.find((b) => b.title === "アンカー対象(壊れているアンカー元)");
    check("アンカー元がD1/D2/D3で未完了でも、その日数分(4日=今日+D1+D2+D3)が正しく加算される",
      brokenCard && brokenCard.streak === "4", JSON.stringify(brokenCard));
    check("アンカー元が当日も未完了なので、当日を含めてstreakが継続する(0にならない)",
      brokenCard && brokenCard.streak !== "0", JSON.stringify(brokenCard));
    check("2日以上の連続欠落なので警告バッジ(warn)が付く", brokenCard && brokenCard.hasBadge && brokenCard.warn === true, JSON.stringify(brokenCard));

    // ============================================================
    // (4) Block編集モーダル: 「制約保護系」ONで縮退版・アンカー入力欄が現れ、保存でルールへ反映される
    // ============================================================
    console.log("[4] 編集モーダルの縮退版/アンカー入力欄がルールへ反映される");
    await page.click('[data-action="edit-block"][data-id="blk-reading-today"]');
    await page.waitForTimeout(200);
    // ruleReadingは元々protection:trueなので、縮退版欄は最初から見えているはず
    const fallbackFieldVisible = await page.$('[data-modal-field="fallbackTitle"]') !== null;
    check("protection:trueのルーティンは編集モーダルに縮退版欄が出る", fallbackFieldVisible);
    await page.fill('[data-modal-field="fallbackTitle"]', "軽い読書1ページ");
    await page.fill('[data-modal-field="fallbackMinutes"]', "3");
    const anchorSelectExists = await page.$('[data-modal-field="anchor"]') !== null;
    check("アンカー選択欄も編集モーダルに出る", anchorSelectExists);
    await page.selectOption('[data-modal-field="anchor"]', "rule-gym");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const sAfterModal = await stateNow();
    const ruleReadingAfter = (sAfterModal.recurrences || []).find((r) => r.id === "rule-reading");
    check("保存で縮退版タイトルがルールへ反映される", ruleReadingAfter && ruleReadingAfter.fallbackTitle === "軽い読書1ページ", JSON.stringify(ruleReadingAfter));
    check("保存で縮退版の所要分がルールへ反映される", ruleReadingAfter && ruleReadingAfter.fallbackMinutes === 3, JSON.stringify(ruleReadingAfter));
    check("保存でアンカーがルールへ反映される", ruleReadingAfter && ruleReadingAfter.anchor === "rule-gym", JSON.stringify(ruleReadingAfter));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
