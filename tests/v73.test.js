// v73 検証: コンディションOS(体調記録)をアプリ機能として統合。CHANGES_v73.md参照。
//
// (a) 朝の記録の拡張: 既存の朝の体調ピッカー(state.settings.morningEnergyLog)の下に
//     服薬・今日の余力のボタンが並ぶ。v235で主観睡眠の入力UIは廃止し、旧stateだけ保持する
// (b) 夜の記録: 体調(既存の5段階を再利用)+ひとこと(input)がジャーナル当日編集に追加され、
//     入力中も保存される(全再描画しないのでフォーカスは維持される既存パターンと同じ)
// (c) 運動記録: 種目・重量・回数を1タップで追記でき、同じ種目の直近記録が「前回」として
//     参考表示される。削除もできる
// (d) 加点式: 「今週はN回書けました」という肯定表現のみが出る(ストリーク・連続日数・
//     未記入を責める文言は一切出さない)
// (e) 縮退モード: 今日の朝の体調が閾値(既存ピッカーの3=少し悪い以下)のとき、ホームに
//     「今日は最低限だけ」バナーが出て、「今日のリズム」ゾーンと「AIから」カードが既定closedの
//     折りたたみになる。体調が良い日は通常表示(バナー無し・折りたたみ無し)のまま
// (g) normalizeState 後方互換: state.condition フィールド自体が無い旧stateでもクラッシュせず
//     起動でき、condition.logsがオブジェクトとして補完される
//
// 方針: 既存スイートと同じく、app.js は type="module" のため内部関数は window に露出しない。
// ブラウザ操作 + localStorage 状態の直接注入で観測する。
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
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策)
  await blockGithubApiByDefault(page);
  // v71/v72と同じく、AIプラン/AIフィードバック/週次レビューの実ファイルfetchは常に404隔離する
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/AIフィードバック_.*\.md$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);  // computeFreeGaps等が日中に依存する既存スイートと同じ理由
  const TODAY = isoDate(now0);
  const addDaysStr = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return isoDate(date);
  };
  const YESTERDAY = addDaysStr(TODAY, -1);

  // app.js の weekRange() と同じロジック(週開始=直近土曜)をNode側でも再現する(v65と同じ手法)
  function weekStartOf(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 1) % 7; // Sat=0 ... Fri=6
    date.setDate(date.getDate() - dow);
    return isoDate(date);
  }
  const WEEK = weekStartOf(TODAY);
  const weekDaysArr = Array.from({ length: 7 }, (_, i) => addDaysStr(WEEK, i));
  const SUN = weekDaysArr[1];  // WEEK(土)の翌日=日

  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  function planBlock({ id, date = TODAY, title, startMin = 9 * 60, minutes = 30, isMIT = false,
    completed = false, category = "", taskId = "" } = {}) {
    return {
      id, taskId, date, title, category,
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt: completed ? `${date}T${hhmm(startMin)}` : "",
      actualEndAt: completed ? `${date}T${hhmm(startMin + minutes)}` : "",
      completed, charge: 0, discharge: 0, isMIT,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [],
      migratedTo: "", orderIndex: 0, carryCount: 0, leverageType: "", estimateMin: null,
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  async function seed({ blocks = [], tasks = [], view = "home", selectedDate = TODAY, condition, morningEnergyLog } = {}) {
    await page.evaluate(({ KEY, blocks, tasks, view, selectedDate, condition, morningEnergyLog }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.tasks = tasks;
      s.projects = s.projects || [];
      s.questions = [];
      s.feedback = {};
      s.aiLinkFreshness = { feedbackAt: null, planAt: null };
      s.selectedDate = selectedDate;
      s.currentView = view;
      if (condition) s.condition = condition;
      if (morningEnergyLog) s.settings.morningEnergyLog = morningEnergyLog;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, view, selectedDate, condition, morningEnergyLog });
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // v148(UI改善計画Phase3-4)以降、ジャーナル当日パネルは朝/夜の2detailsに分かれ、
  // now0(このスイートは10:00固定)では朝だけが既定openになる。夜/運動記録のフィールドを
  // 操作する前に、両方を開く。アプリ側は開閉状態をJSのモジュール変数
  // (_journalSegmentOverride、非永続)で持ち、<summary>への本物のクリック(data-action=
  // "toggle-journal-segment")だけを見るため、要素の.open プロパティを直接書き換えるだけでは
  // 次のrender()で時刻基準に巻き戻ってしまう。summaryを実際にクリックする(閉じている場合のみ)。
  async function openBothJournalSegments() {
    for (const cls of ["journal-segment-morning", "journal-segment-evening"]) {
      const el = page.locator(`.${cls}`);
      if ((await el.count()) === 0) continue;
      const isOpen = await el.evaluate((e) => e.open);
      if (!isOpen) await el.locator("summary").click();
    }
    await page.waitForTimeout(150);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため注入する
    await passGithubGate(page);

    // ============================================================
    // (a) 朝の記録の拡張(服薬/今日の余力。主観睡眠UIは廃止)
    // ============================================================
    console.log("[1] 朝の記録: 主観睡眠UIは無く、服薬・今日の余力(最低限)をタップで記録できる");
    await seed({ blocks: [], view: "journal", selectedDate: TODAY, condition: { logs: { [TODAY]: {
      sleepHours: 7, meds: null, capacity: "", morningRecordedAt: "",
      eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: []
    } } } });
    check("廃止された睡眠プリセットボタンが存在しない", await page.locator('[data-action="set-sleep"]').count() === 0);
    await page.click('[data-action="toggle-meds"]');
    await page.waitForTimeout(200);
    await page.click('[data-action="set-capacity"][data-value="minimal"]');
    await page.waitForTimeout(200);
    const s1 = await stateNow();
    const log1 = s1.condition.logs[TODAY];
    check("他項目の操作後も旧睡眠値(7h)は温存される", log1?.sleepHours === 7, JSON.stringify(log1));
    check("服薬済みが保存される", log1?.meds === true, JSON.stringify(log1));
    check("今日の余力(最低限)が保存される", log1?.capacity === "minimal", JSON.stringify(log1));
    check("記録印(morningRecordedAt)が付く", !!log1?.morningRecordedAt, JSON.stringify(log1));

    console.log("[1b] 服薬ボタンは再タップで解除できる(トグル)");
    await page.click('[data-action="toggle-meds"]');
    await page.waitForTimeout(200);
    const s1b = await stateNow();
    check("服薬フラグがfalseに戻る", s1b.condition.logs[TODAY].meds === false, JSON.stringify(s1b.condition.logs[TODAY]));

    // ============================================================
    // (b) 夜の記録
    // ============================================================
    console.log("[2] 夜の記録: 体調ボタン + ひとことが保存される");
    await openBothJournalSegments();
    await page.click('[data-action="set-evening-mood"][data-value="7"]');
    await page.waitForTimeout(200);
    await page.fill(".cond-evening-note", "今日は早めに休む");
    await page.waitForTimeout(300);
    const s2 = await stateNow();
    const log2 = s2.condition.logs[TODAY];
    check("夜の体調が保存される", log2?.eveningMood === 7, JSON.stringify(log2));
    check("夜のひとことが保存される", log2?.eveningNote === "今日は早めに休む", JSON.stringify(log2));
    check("夜の記録印(eveningRecordedAt)が付く", !!log2?.eveningRecordedAt, JSON.stringify(log2));

    // ============================================================
    // (c) 運動記録
    // ============================================================
    console.log("[3] 運動記録: 種目・重量・回数を記録でき、同じ種目の前回記録が参考表示される");
    await seed({
      blocks: [], view: "journal", selectedDate: TODAY,
      condition: { logs: { [YESTERDAY]: {
        sleepHours: null, meds: null, capacity: "", morningRecordedAt: "",
        eveningMood: null, eveningNote: "", eveningRecordedAt: "",
        gym: [{ id: "g-prev", exercise: "ベンチプレス", weight: 75, reps: 5, at: `${YESTERDAY}T20:00` }]
      } } }
    });
    await openBothJournalSegments();
    await page.fill("#gym-exercise-input", "ベンチプレス");
    await page.fill("#gym-weight-input", "80");
    await page.fill("#gym-reps-input", "5");
    await page.click('[data-action="add-gym-entry"]');
    await page.waitForTimeout(300);
    const s3 = await stateNow();
    const gymEntries = s3.condition.logs[TODAY]?.gym || [];
    check("運動記録が1件保存される", gymEntries.length === 1 && gymEntries[0].exercise === "ベンチプレス"
      && gymEntries[0].weight === 80 && gymEntries[0].reps === 5, JSON.stringify(gymEntries));
    const gymCardText = await page.locator(".cond-gym-card").textContent();
    check("記録行に種目・重量・回数が表示される", gymCardText.includes("ベンチプレス 80kg × 5"), gymCardText);
    check("同じ種目の前回記録が参考表示される", gymCardText.includes("前回 75kg×5") && gymCardText.includes(YESTERDAY), gymCardText);

    console.log("[3b] 運動記録は削除できる");
    await page.click('[data-action="delete-gym-entry"]');
    await page.waitForTimeout(300);
    const s3b = await stateNow();
    check("削除後は記録が0件になる", (s3b.condition.logs[TODAY]?.gym || []).length === 0, JSON.stringify(s3b.condition.logs[TODAY]));

    // ============================================================
    // (d) 加点式(空白日を責めない)
    // ============================================================
    console.log("[4] 加点式: 「今週はN回書けました」の肯定表現のみで、ストリーク・未記入を責める文言が無い");
    const conditionSeed = { logs: {
      [weekDaysArr[0]]: { sleepHours: null, meds: null, capacity: "", morningRecordedAt: `${weekDaysArr[0]}T07:00`, eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: [] },
      [weekDaysArr[1]]: { sleepHours: null, meds: null, capacity: "", morningRecordedAt: `${weekDaysArr[1]}T07:00`, eveningMood: null, eveningNote: "", eveningRecordedAt: "", gym: [] }
    } };
    await seed({ blocks: [], view: "journal", selectedDate: TODAY, condition: conditionSeed });
    const journalHTML = await page.locator("main").innerHTML();
    check("「今週は2回書けました」が表示される", journalHTML.includes("今週は2回書けました"), journalHTML.includes("今週は") ? "count mismatch" : "not found");
    check("ストリーク・連続日数などの表現は出ない", !/連続|ストリーク|streak/i.test(journalHTML));
    check("未記入・欠席を責める表現は出ない", !/未記入|さぼ|サボ|できていません|忘れずに/.test(journalHTML));

    // ============================================================
    // (e) 縮退モード
    // ============================================================
    console.log("[5] 縮退モード: 朝の体調が3(少し悪い)以下だとホームに案内バナー+ゾーンの折りたたみが出る");
    await seed({
      blocks: [planBlock({ id: "mit-degraded", title: "縮退モード確認MIT", isMIT: true })],
      view: "home", selectedDate: TODAY,
      morningEnergyLog: { [TODAY]: 3 }
    });
    check("縮退モードの案内バナーが出る", await page.locator(".cond-degraded-banner").count() === 1);
    check("「今日のリズム」ゾーンが既定closedの折りたたみになる",
      await page.locator('details[data-fold-id="zone2-degraded"]').evaluate((el) => el.open) === false);
    check("MIT(今日の主役)は縮退時も表示される",
      (await page.locator("#home-mit-anchor").textContent()).includes("縮退モード確認MIT"));
    // v149(UI改善計画Phase4a): 「AIから」(home-ai-hub)はホームタブへ移動した(既定は今日タブ)。
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    check("「AIから」カードも既定closedの折りたたみになる",
      await page.locator('details[data-fold-id="ai-hub-degraded"]').evaluate((el) => el.open) === false);
    await page.click('[data-action="home-tab"][data-tab="today"]');
    await page.waitForTimeout(150);

    console.log("[5b] 体調が普通(7)なら縮退モードは発火せず通常表示のまま");
    await seed({
      blocks: [planBlock({ id: "mit-normal", title: "通常モード確認MIT", isMIT: true })],
      view: "home", selectedDate: TODAY,
      morningEnergyLog: { [TODAY]: 7 }
    });
    check("縮退バナーは出ない", await page.locator(".cond-degraded-banner").count() === 0);
    check("「今日のリズム」ゾーンは折りたたみ化されない(通常表示)",
      await page.locator('details[data-fold-id="zone2-degraded"]').count() === 0);
    // v146(UI改善計画Phase1-1): 「AIから」は常時表示のsectionから既定closedのdetailsへ変更された。
    // ここで検証したいのは「縮退専用の ai-hub-degraded ではなく通常の ai-hub 側が使われる」ことなので、
    // タグをdetailsに追随させる(常時表示自体はH3の折りたたみ既定値検証の担当)。
    // v149: 「AIから」はホームタブへ移動した(既定は今日タブ)。
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);
    check("「AIから」カードは通常のai-hub(縮退用ではない)側が使われる",
      await page.locator('details[data-fold-id="ai-hub-degraded"]').count() === 0
      && await page.locator('details[data-fold-id="ai-hub"].home-ai-hub').count() === 1);

    // ============================================================
    // (g) normalizeState 後方互換
    // ============================================================
    console.log("[7] normalizeState 後方互換: state.condition フィールド自体が無い旧stateでもクラッシュしない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.condition;  // フィールド自体が無い旧stateを模擬
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="journal"]');  // 正規化値を永続化させる
    await page.waitForTimeout(300);
    const s7 = await stateNow();
    check("condition.logsがオブジェクトとして補完される", s7.condition && typeof s7.condition.logs === "object", JSON.stringify(s7.condition));
    check("既存データはクラッシュせず表示できる(pageerror無し)", true);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
