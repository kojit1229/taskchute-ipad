// tests/iron-log-e2e.test.js(先行執筆・結線前) — P4 IRON LOG専用画面のE2E契約。
// 正典: p4-interface.md §3(iron-log.js界面凍結)、slim-spec.md §2-2・§3(仕様)。
// v233の対象は画面結線・表示・当日セット追加・実行中Block連動まで。
// NOW LANDING導線・Block完了時の自動転記・未記録通知はv234以降で追加済み。
// tower-core.test.js / helpers.js の書式・helpers利用・seed流儀をそのまま踏襲する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const KEY = STATE_KEY;
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

  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const fixedTime = (h = 12, m = 0, s = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, s, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const today = isoOf(base);
  const atMinute = (date, minute) => `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`;
  const block = (id, title, date, minute, extra = {}) => ({
    id, title, date, category: "開発", plannedStartAt: atMinute(date, minute), plannedEndAt: "",
    actualStartAt: "", actualEndAt: "", completed: false, deleted: false, orderIndex: 0, ...extra
  });
  // ジム系Block(既定キーワード ["ジム","筋トレ"] に一致させる)。
  const gymBlock = (id, title, minute, extra = {}) => block(id, title, today, minute, { category: "ジム", ...extra });

  // condition.logs[today].gym の1セット。at はfixed clock範囲内のHH:mm。
  const set = (exercise, weight, reps, minute, extra = {}) => ({ exercise, weight, reps, at: atMinute(today, minute), ...extra });

  async function seed({ view = "iron-log", blocks = [], gym = [], settings = {}, deleteSettings = [], reload = true } = {}) {
    await page.evaluate(({ KEY, view, blocks, gym, settings, deleteSettings, today }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      if (view === "timeline") {
        s.timelineMode = "planned";
        s.selectedDate = today;
      }
      s.blocks = blocks;
      s.condition = s.condition || {};
      s.condition.logs = s.condition.logs || {};
      s.condition.logs[today] = s.condition.logs[today] || {};
      s.condition.logs[today].gym = gym;
      s.settings = { ...s.settings, ...settings };
      for (const key of deleteSettings) delete s.settings[key];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, view, blocks, gym, settings, deleteSettings, today });
    if (reload) {
      await page.reload();
      await page.waitForSelector(`#app[data-view="${view}"]`, { state: "attached" });
    }
  }

  async function readState() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  try {
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('[data-action="gate-continue"]', { state: "attached" });
    await passGithubGate(page);

    console.log("[1] gym[]ありでIRON LOG画面がPAYLOAD/TODAY'S SETS/TOTALSを描画する");
    await seed({
      gym: [set("ベンチプレス", 60, 10, 9 * 60), set("スクワット", 80, 5, 9 * 60 + 10)]
    });
    check("ヘッダはIRON LOG/筋トレ", (await page.locator(".eyebrow").textContent()) === "IRON LOG"
      && (await page.locator(".view-header h1").textContent()) === "筋トレ");
    check("PAYLOADは合計1,000kgを表示", (await page.locator(".iron-total span").textContent()) === "1,000");
    check("DAILY TARGETは既定2,000kg", ((await page.locator(".iron-goal-line").textContent()) || "").includes("2,000 kg"));
    check("ゲージ幅は目標比50%", (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:50%"));
    check("未達成時はgoal-hitクラスなし", await page.locator(".iron.goal-hit").count() === 0);
    const remain = await page.locator(".iron-remain").textContent();
    check("残量とセット換算ヒントを表示(直近セット80kg×5であと3セット)", /あと\s*1,000\s*kg/.test(remain || "")
      && /80kg×5回 をあと 3 セット/.test(remain || ""), remain);
    const rows = page.locator(".iron-set-row");
    check("TODAY'S SETSは新しいセットが先頭(新→旧)", await rows.count() === 2
      && (await rows.nth(0).locator(".iron-set-name").textContent()) === "スクワット"
      && (await rows.nth(1).locator(".iron-set-name").textContent()) === "ベンチプレス");
    check("各行に重量×回数と小計kgを表示", (await rows.nth(0).locator(".iron-set-detail").textContent()) === "80kg × 5"
      && (await rows.nth(0).locator(".iron-set-kg").textContent()) === "+400");
    check("TOTALSは累計/今月/自己ベストの3枚", await page.locator(".iron-totals-cell").count() === 3
      && (await page.locator(".iron-totals-cell").nth(1).locator("strong").textContent()) === "1,000 kg");
    check("実行中ジムタスクが無ければLINKED FLIGHTは未連動表示", await page.locator(".iron-linked-status.is-idle").count() === 1
      && ((await page.locator(".iron-linked-status.is-idle").textContent()) || "").includes("未連動"));

    console.log("[2] 1行フォームでセット追加→当日総重量とゲージが即時更新");
    await seed({ gym: [] });
    check("初期状態は0kg・0%", (await page.locator(".iron-total span").textContent()) === "0"
      && (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:0%"));
    check("前回記録が無ければ重量・回数は空欄",
      (await page.locator("#ironFormWeight").inputValue()) === ""
        && (await page.locator("#ironFormReps").inputValue()) === "");
    await page.locator("#ironFormWeight").fill("60");
    await page.locator("#ironFormReps").fill("10");
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelector(".iron-total span")?.textContent !== "0");
    check("ベンチプレス60kg×10追加で600kgへ更新", (await page.locator(".iron-total span").textContent()) === "600");
    check("ゲージ幅が30%へ更新", (await page.locator(".iron-bar").getAttribute("style") || "").includes("width:30%"));
    const afterAdd = await readState();
    const addedSet = afterAdd.condition.logs[today].gym[0];
    check("state.condition.logs[当日].gymへ1件追加される", afterAdd.condition.logs[today].gym.length === 1
      && addedSet.exercise === "ベンチプレス" && addedSet.weight === 60 && addedSet.reps === 10, JSON.stringify(addedSet));

    console.log("[3] 2,000kg目標達成でTARGET ACHIEVEDバナーが点灯する");
    await seed({ gym: [set("ベンチプレス", 110, 10, 9 * 60), set("ベンチプレス", 110, 10, 9 * 60 + 10)] }); // 2,200kg
    check("合計2,200kgでgoal-hitクラスが付く", await page.locator(".iron.goal-hit").count() === 1);
    const achievedDisplay = await page.locator(".iron-achieved").evaluate((el) => getComputedStyle(el).display);
    check("TARGET ACHIEVEDバナーが表示状態(display!=none)", achievedDisplay !== "none", achievedDisplay);
    check("TARGET ACHIEVEDの文言を表示", ((await page.locator(".iron-achieved").textContent()) || "").includes("TARGET ACHIEVED"));
    check("達成時は目標超過表示に切替", ((await page.locator(".iron-remain").textContent()) || "").includes("目標超過")
      && ((await page.locator(".iron-remain").textContent()) || "").includes("+200"));

    console.log("[4] 実行中ジムBlockはLINKED FLIGHTに表示され、追加セットがblockIdで紐づく");
    const running = gymBlock("gym-running", "本日の筋トレ", 9 * 60, { actualStartAt: atMinute(today, 9 * 60) });
    await page.clock.setFixedTime(fixedTime(9, 30, 0)); // 開始から30分経過
    await seed({ blocks: [running], gym: [] });
    check("LINKED FLIGHTが実行中表示", await page.locator(".iron-linked-status:not(.is-idle)").count() === 1
      && ((await page.locator(".iron-linked-status").textContent()) || "").includes("実行中"));
    check("連動タスク名を表示", (await page.locator(".iron-linked-name").textContent()) === "本日の筋トレ");
    const linkedTime = await page.locator(".iron-linked-time").textContent();
    check("開始時刻09:00と経過00:30を表示", /09:00 開始/.test(linkedTime || "") && /00:30/.test(linkedTime || ""), linkedTime);
    await page.locator("#ironFormWeight").fill("60");
    await page.locator("#ironFormReps").fill("10");
    await page.locator('[data-action="iron-add-set"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".iron-set-row").length === 1);
    const linkedState = await readState();
    const linkedAddedSet = linkedState.condition.logs[today].gym[0];
    check("追加したセットのblockIdが実行中Blockに一致", linkedAddedSet.blockId === "gym-running", JSON.stringify(linkedAddedSet));

    console.log("[5] ジムBlock完了時、紐づくセットがblock.commentへ凍結書式で自動転記される");
    await page.clock.setFixedTime(fixedTime(9, 0, 0));
    const gymForComment = gymBlock("gym-complete", "ジム(自動転記)", 9 * 60, {
      actualStartAt: atMinute(today, 9 * 60), estimateMin: 60
    });
    const linkedSets = [
      set("ベンチプレス", 60, 10, 9 * 60 + 5, { blockId: "gym-complete" }),
      set("ベンチプレス", 60, 10, 9 * 60 + 10, { blockId: "gym-complete" }),
      set("ショルダープレス", 30, 8, 9 * 60 + 15, { blockId: "gym-complete" })
    ];
    await seed({ view: "today", blocks: [gymForComment], gym: linkedSets });
    await page.waitForSelector('.tower-now-actions [data-action="complete-block-with-actual"]');
    await page.locator('.tower-now-actions [data-action="complete-block-with-actual"]').click();
    await page.locator('[data-modal-field="actualStartAt"]').fill(atMinute(today, 9 * 60).slice(0, 16));
    await page.locator('[data-modal-field="actualEndAt"]').fill(atMinute(today, 10 * 60).slice(0, 16));
    await page.locator('.modal-card [data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, id }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === id)?.completed === true;
    }, { KEY, id: "gym-complete" });
    const afterComplete = await readState();
    const completedBlock = afterComplete.blocks.find((b) => b.id === "gym-complete");
    check("block.commentへ凍結書式(合計1,440kg・×2圧縮)で自動転記される",
      completedBlock.comment === "総重量 1,440kg(ベンチプレス 60kg×10×2、ショルダープレス 30kg×8)",
      completedBlock.comment);

    console.log("[6] 未記録(紐づくセット0件)での完了時に非ブロッキング通知を出す");
    await page.clock.setFixedTime(fixedTime(9, 0, 0));
    const gymNoSets = gymBlock("gym-empty", "ジム(未記録)", 9 * 60, {
      actualStartAt: atMinute(today, 9 * 60), estimateMin: 30
    });
    await seed({ view: "today", blocks: [gymNoSets], gym: [] });
    await page.waitForSelector('.tower-now-actions [data-action="complete-block-with-actual"]');
    await page.evaluate(() => {
      window.__emptyConfirmCalls = 0;
      window.confirm = () => { window.__emptyConfirmCalls += 1; return true; };
    });
    await page.locator('.tower-now-actions [data-action="complete-block-with-actual"]').click();
    await page.locator('[data-modal-field="actualStartAt"]').fill(atMinute(today, 9 * 60).slice(0, 16));
    await page.locator('[data-modal-field="actualEndAt"]').fill(atMinute(today, 9 * 60 + 30).slice(0, 16));
    await page.locator('.modal-card [data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, id }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === id)?.completed === true;
    }, { KEY, id: "gym-empty" });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "IRON LOGのセットが未記録です", null, { timeout: 1000 }).catch(() => {});
    check("未記録通知でconfirmを呼ばない", (await page.evaluate(() => window.__emptyConfirmCalls)) === 0);
    check("紐づくセット0件の完了で未記録トーストが出る",
      (await page.locator("#toast").textContent()) === "IRON LOGのセットが未記録です");
    const afterEmptyComplete = await readState();
    check("通知後も完了自体は成立する", afterEmptyComplete.blocks.find((b) => b.id === "gym-empty")?.completed === true);

    console.log("[7] 未連動セットはBlock実行時間内だけをフォールバック紐付けする");
    const gymForRange = gymBlock("gym-range", "ジム(時間範囲)", 9 * 60, {
      actualStartAt: atMinute(today, 9 * 60), estimateMin: 60
    });
    const rangeSets = [
      set("範囲前", 10, 1, 8 * 60 + 55),
      set("ベンチプレス", 60, 10, 9 * 60 + 15),
      set("範囲後", 20, 1, 10 * 60 + 5)
    ];
    await seed({ view: "today", blocks: [gymForRange], gym: rangeSets });
    await page.locator('.tower-now-actions [data-action="complete-block-with-actual"]').click();
    await page.locator('[data-modal-field="actualStartAt"]').fill(atMinute(today, 9 * 60).slice(0, 16));
    await page.locator('[data-modal-field="actualEndAt"]').fill(atMinute(today, 10 * 60).slice(0, 16));
    await page.locator('.modal-card [data-action="modal-save"]').click();
    await page.waitForFunction(({ KEY, id }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === id)?.completed === true;
    }, { KEY, id: "gym-range" });
    const afterRangeComplete = await readState();
    const storedRangeSets = afterRangeComplete.condition.logs[today].gym;
    check("範囲内セットは完了Blockへ紐付く", storedRangeSets[1].blockId === "gym-range", JSON.stringify(storedRangeSets));
    check("範囲前後のセットは未連動のまま残る",
      !storedRangeSets[0].blockId && !storedRangeSets[2].blockId, JSON.stringify(storedRangeSets));
    check("Blockコメントは範囲内セットだけで生成される",
      afterRangeComplete.blocks.find((b) => b.id === "gym-range")?.comment === "総重量 600kg(ベンチプレス 60kg×10)",
      afterRangeComplete.blocks.find((b) => b.id === "gym-range")?.comment);

    console.log("[8] 一括承認では未記録トーストを抑止する");
    const bulkGym = gymBlock("gym-bulk-empty", "ジム(一括承認)", 10 * 60, {
      plannedEndAt: atMinute(today, 10 * 60 + 30)
    });
    await seed({ view: "timeline", blocks: [bulkGym], gym: [] });
    await page.evaluate(() => {
      window.__bulkConfirmCalls = 0;
      window.__bulkToastMessages = [];
      window.confirm = () => { window.__bulkConfirmCalls += 1; return true; };
      const toast = document.querySelector("#toast");
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.textContent) window.__bulkToastMessages.push(node.textContent);
          }
        }
      }).observe(toast, { childList: true, subtree: true, characterData: true });
    });
    await page.locator('[data-action="bulk-approve-planned"]').click();
    await page.waitForFunction(({ KEY, id }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === id)?.completed === true;
    }, { KEY, id: "gym-bulk-empty" });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("予定通り完了"));
    const bulkSignals = await page.evaluate(() => ({
      confirmCalls: window.__bulkConfirmCalls,
      toastMessages: window.__bulkToastMessages,
      currentToast: document.querySelector("#toast")?.textContent || ""
    }));
    check("一括承認のconfirmは全体確認1回だけ", bulkSignals.confirmCalls === 1, JSON.stringify(bulkSignals));
    check("一括承認では未記録トーストを出さない",
      !bulkSignals.toastMessages.includes("IRON LOGのセットが未記録です")
        && !bulkSignals.currentToast.includes("IRON LOGのセットが未記録です"),
      JSON.stringify(bulkSignals));

    console.log("[9] NOW LANDINGのIRON LOG導線は実行中ジムBlockだけに表示され遷移できる");
    await page.clock.setFixedTime(fixedTime(9, 30, 0));
    const gymForLink = gymBlock("gym-link", "ジム導線", 9 * 60, { actualStartAt: atMinute(today, 9 * 60) });
    await seed({ view: "today", blocks: [gymForLink], gym: [] });
    const ironLink = page.locator('.tower-nowhud .tower-ironlog-link[data-action="open-iron-log"]');
    check("実行中ジムBlockでは▶ IRON LOGボタンが出る", await ironLink.count() === 1
      && (await ironLink.textContent()) === "▶ IRON LOG");
    await ironLink.click();
    await page.waitForSelector('#app[data-view="iron-log"]');
    check("ボタン押下でiron-log画面へ遷移する", await page.locator('#app[data-view="iron-log"] .iron').count() === 1);
    const nonGym = block("dev-running", "通常作業", today, 9 * 60, { actualStartAt: atMinute(today, 9 * 60) });
    await seed({ view: "today", blocks: [nonGym], gym: [] });
    check("実行中の非ジムBlockでは▶ IRON LOGボタンが出ない",
      await page.locator('.tower-nowhud .tower-ironlog-link[data-action="open-iron-log"]').count() === 0);

    console.log("[10] v272 種目メニューは追加・並び替え・削除をLOAD SETへ同期し、過去セットを保持する");
    await seed({ gym: [], settings: { gymExerciseList: ["STALE"] }, deleteSettings: ["gymExerciseList"] });
    const defaultNames = ["ベンチプレス", "スクワット", "デッドリフト", "ラットプルダウン", "ショルダープレス", "その他"];
    check("未編集時はMENU/LOAD SETの両方に既定6種目を同順で表示",
      JSON.stringify(await page.locator(".iron-menu-name").allTextContents()) === JSON.stringify(defaultNames)
        && JSON.stringify(await page.locator("#ironFormExercise option").allTextContents()) === JSON.stringify(defaultNames));
    check("先頭▲・末尾▼はdisabled",
      await page.locator('[data-action="iron-menu-up"][data-id="0"]').isDisabled()
        && await page.locator('[data-action="iron-menu-down"][data-id="5"]').isDisabled());
    check("追加入力は44px以上、既定6件の一覧は264px縦予算内",
      await page.locator("#ironMenuName").evaluate((el) => el.getBoundingClientRect().height >= 44)
        && await page.locator(".iron-menu-list").evaluate((el) => {
          const style = getComputedStyle(el);
          return style.maxHeight === "264px" && style.overflowY === "auto";
        }));

    const menuInput = page.locator("#ironMenuName");
    const maxLengthName = "123456789012345678901234";
    await menuInput.pressSequentially(`${maxLengthName}5`);
    check("25文字目以降はmaxlength=24により入力されない", (await menuInput.inputValue()) === maxLengthName);
    await page.locator('[data-action="iron-menu-add"]').click();
    await page.waitForFunction(({ KEY, maxLengthName }) => {
      const list = JSON.parse(localStorage.getItem(KEY)).settings.gymExerciseList;
      return Array.isArray(list) && list.at(-1) === maxLengthName;
    }, { KEY, maxLengthName });
    check("24文字ちょうどはstate・MENU・LOAD SETへ追加成功",
      (await readState()).settings.gymExerciseList.at(-1) === maxLengthName
        && (await page.locator(".iron-menu-name").last().textContent()) === maxLengthName
        && (await page.locator(".iron-menu-name").last().getAttribute("title")) === maxLengthName
        && (await page.locator("#ironFormExercise option").last().textContent()) === maxLengthName);
    check("7件目からMENU一覧内でスクロール可能",
      await page.locator(".iron-menu-list").evaluate((el) => el.scrollHeight > el.clientHeight));

    await seed({
      gym: [set("A", 60, 10, 9 * 60)],
      settings: { gymExerciseList: ["A", "B", "C"] }
    });
    await page.locator("#ironMenuName").fill("  D  ");
    await page.locator('[data-action="iron-menu-add"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.gymExerciseList.length === 4, KEY);
    let menuState = await readState();
    check("追加はtrim後の名前をstate末尾へ保存", JSON.stringify(menuState.settings.gymExerciseList) === '["A","B","C","D"]');
    check("追加した種目はMENU/LOAD SETの末尾へ即時反映",
      JSON.stringify(await page.locator(".iron-menu-name").allTextContents()) === '["A","B","C","D"]'
        && JSON.stringify(await page.locator("#ironFormExercise option").allTextContents()) === '["A","B","C","D"]');

    await page.locator('[data-action="iron-menu-down"][data-id="0"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.gymExerciseList[0] === "B", KEY);
    menuState = await readState();
    check("▼で隣接swapをstateへ保存", JSON.stringify(menuState.settings.gymExerciseList) === '["B","A","C","D"]');
    check("並び替え後のMENU/LOAD SET順も一致",
      JSON.stringify(await page.locator(".iron-menu-name").allTextContents()) === '["B","A","C","D"]'
        && JSON.stringify(await page.locator("#ironFormExercise option").allTextContents()) === '["B","A","C","D"]');

    await page.locator('[data-action="iron-menu-delete"][data-id="1"]').click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.gymExerciseList.length === 3, KEY);
    menuState = await readState();
    check("削除はメニューstateとLOAD SETから対象種目だけを除く",
      JSON.stringify(menuState.settings.gymExerciseList) === '["B","C","D"]'
        && await page.locator('#ironFormExercise option[value="A"]').count() === 0);
    check("メニューからAを削除してもTODAY'S SETS/TOTALSの過去記録は残る",
      (await page.locator(".iron-set-name").textContent()) === "A"
        && (await page.locator(".iron-total span").textContent()) === "600");

    await page.locator(".iron-set-del").click();
    // v284: 削除は物理削除からtombstone化(同期での復活防止)。「当日セットだけを削除」の検証意図は
    // 「有効セット0件+メニューは不変」なので、deleted除外後の件数とtombstone残存へ追従。
    await page.waitForFunction(({ KEY, today }) => {
      const gym = JSON.parse(localStorage.getItem(KEY)).condition.logs[today]?.gym || [];
      return gym.filter((g) => !g?.deleted).length === 0;
    }, { KEY, today });
    const afterSetDelete = await readState();
    const gymAfterDelete = afterSetDelete.condition.logs[today].gym || [];
    check("既存iron-delete-setは引き続き当日セットだけを削除(tombstone化・メニュー不変)",
      gymAfterDelete.filter((g) => !g?.deleted).length === 0
        && gymAfterDelete.length === 1 && !!gymAfterDelete[0]?.deletedAt
        && JSON.stringify(afterSetDelete.settings.gymExerciseList) === '["B","C","D"]');

    console.log(failures === 0 ? "[iron-log-e2e] 全PASS" : `[iron-log-e2e] ${failures}件失敗`);
  } catch (e) {
    failures++;
    console.log("  ❌ 例外:", e.message);
  } finally {
    await browser.close();
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
})();
