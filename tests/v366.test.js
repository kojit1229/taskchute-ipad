// v366検証: Block編集シート(残り)。order-v366-block-sheet-rest.md どおり、v359で持ち越した
// 3点を実装する: (1) 時間節の見積チップ15/25/40/60(estimateMinへ一発入力・手入力欄も残す)、
// (2) 日付行の「明日へ」「来週へ」(今日+1日/今日+7日、planned日付も追従、保存は既存modal-save)、(3) 頻度の低い項目
// (レバレッジ種別・完了済み(Block)・🏁タスク完了)を末尾「詳細 ›」折りたたみ
// (既定閉・非永続)へ移す。data-modal-fieldの名前・意味・保存/繰り返しロジックは無変更。
//
// (1) 見積チップでestimateMinが入り保存で反映、手入力で外れるとハイライト解除
// (2) 明日へ/来週へで日付が+1/+7(月末・年末跨ぎfixture)、保存で反映
// (3) 「詳細 ›」既定閉。開くと3項目(レバレッジ種別・完了済み(Block)・🏁タスク完了)が出て
//     従来どおり動く(v107のモーダル内タスク完了契約)。開閉操作はstate/localStorageを書かない
// (4) v359の節所属pinはtests/v359.test.js側で更新済み(移動した3項目が詳細に、総数不変)
// (5) 390px/1280pxで横スクロールなし・全input/select/textarea(checkbox除く)16px以上・
//     チップ/ボタン44px以上・pageerror 0件・new Date("を含まない・waitForTimeoutは使わない
const fs = require("fs");
const path = require("path");
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---------------------------------------------------------------
// 静的検査(ブラウザ不要)
// ---------------------------------------------------------------
function staticChecks() {
  console.log("[static] 新規data-action(estimate-chip/block-date-shift)の存在・new Date(文字列)不使用");
  const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const startIdx = src.indexOf("function buildBlockModal(block) {");
  const endIdx = src.indexOf("\nfunction saveBlockFromModal(", startIdx);
  const body = src.slice(startIdx, endIdx === -1 ? undefined : endIdx);
  // estimate-chipは[15,25,40,60].map()のテンプレート内に1回だけソース上出現し、実行時に4回展開される
  // (実際に4つ描画されることはブラウザ側E2Eで確認する)。
  check("buildBlockModal内にestimate-chip用テンプレートが1箇所ある",
    (body.match(/data-action="estimate-chip"/g) || []).length === 1);
  check("buildBlockModal内にblock-date-shift(2つ、明日へ/来週へ)が出現する",
    (body.match(/data-action="block-date-shift"/g) || []).length === 2);
  check("buildBlockModal内に new Date(\" を含まない(iOS Safari日時パース禁則)",
    !/new Date\(\s*["'`]/.test(body));
  check("registerActionsにestimate-chip/block-date-shiftのハンドラがある",
    /"estimate-chip":\s*\(/.test(src) && /"block-date-shift":\s*\(/.test(src));
  // review-v363-claude-b M-2対応: buildBlockModal本体だけでなく、日付演算を実際に書いた
  // registerActions側(block-date-shiftハンドラを含むブロック)も new Date(" 禁則の走査対象にする。
  const raStartIdx = src.indexOf('"estimate-chip": (');
  const raCloseIdx = raStartIdx === -1 ? -1 : src.indexOf("\n});", raStartIdx);
  const raEndIdx = raCloseIdx === -1 ? -1 : raCloseIdx + "\n});".length;
  const raBody = raStartIdx !== -1 && raEndIdx > raStartIdx ? src.slice(raStartIdx, raEndIdx) : "";
  check("registerActions(estimate-chip/block-date-shift)のハンドラが見つかる", raStartIdx !== -1 && raEndIdx !== -1);
  check("抽出範囲に両ハンドラが含まれる",
    /"estimate-chip":\s*\(/.test(raBody) && /"block-date-shift":\s*\(/.test(raBody));
  check("registerActions(estimate-chip/block-date-shift)内に new Date(\" を含まない(iOS Safari日時パース禁則)",
    !/new Date\(\s*["'`]/.test(raBody));
}

(async () => {
  staticChecks();

  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;

  async function waitForStateReady(pg) {
    await pg.waitForFunction((k) => {
      try { return !!JSON.parse(localStorage.getItem(k)); } catch { return false; }
    }, KEY);
  }
  async function waitForNavReady(pg) {
    await pg.waitForSelector('[data-action="nav"]', { state: "attached" });
  }
  async function waitForModalClosed(pg) {
    await pg.waitForFunction(() => !document.querySelector("#modalRoot")?.classList.contains("open"));
  }
  async function waitForModalField(pg, fieldName) {
    await pg.waitForSelector(`.modal-card [data-modal-field="${fieldName}"]`, { state: "attached" });
  }

  function makeBlock(id, extra = {}) {
    return {
      id, taskId: "", date: TODAY, title: `Block ${id}`, category: "",
      plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:30`,
      actualStartAt: "", actualEndAt: "",
      completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "",
      pomodoroCount: 0, migratedTo: "", orderIndex: 0, carryCount: 0, isMIT: false,
      source: "", estimateMin: null, leverageType: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, ...extra
    };
  }

  async function seed({ blocks = [], tasks = [], projects = [], view = "timeline" } = {}, pg = page) {
    // 注: state.selectedDateはapp.js起動時に常にtodayISO()へ強制されるため、ここで別日を
    // 指定しても無意味(reload後にtodayへ上書きされる)。別日のBlockを開くテストは
    // reload後にdata-date-pickerで移動する(下記[2][2b]参照)。
    await pg.evaluate(({ KEY, blocks, tasks, projects, TODAY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = tasks;
      s.projects = projects;
      s.blocks = blocks;
      s.recurrences = [];
      s.selectedDate = TODAY;
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, tasks, projects, TODAY, view });
    await pg.reload();
    await waitForNavReady(pg);
  }

  async function stateNow(pg = page) {
    return pg.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // localStorageの全キーと、アプリが参照するESMの実stateを別々に比較する。
  async function snapshot(pg = page) {
    return pg.evaluate(async () => {
      const { state } = await import("/src/state/store.js");
      return {
        state: JSON.stringify(state),
        storage: JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))
      };
    });
  }
  async function unchanged(label, before, pg = page) {
    const after = await snapshot(pg);
    check(`${label}: 実state不変`, after.state === before.state);
    check(`${label}: localStorage全キー不変`, after.storage === before.storage);
  }
  async function cancelAndReopen(id, pg = page) {
    await pg.locator('.modal-card [data-action="modal-close"]').first().click();
    await waitForModalClosed(pg);
    await openEditor(id, pg);
  }
  async function checkHorizontal(pg, width, label) {
    // 入場アニメーションの縮尺が境界実測に混ざらないよう完了を待つ。
    await pg.evaluate(async () => {
      await Promise.all(document.querySelector(".modal-card").getAnimations().map((animation) => animation.finished));
    });
    const metrics = await pg.evaluate(() => {
      const body = document.querySelector(".modal-body");
      const rect = body.getBoundingClientRect();
      const left = rect.left + body.clientLeft;
      const right = left + body.clientWidth;
      const controls = [...document.querySelectorAll(".modal-card input, .modal-card select, .modal-card textarea, .modal-card button")]
        .filter((el) => !el.closest("details:not([open])") && el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { field: el.dataset.modalField || el.dataset.action || el.tagName, left: r.left, right: r.right };
        });
      const doc = document.scrollingElement || document.documentElement;
      return { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, left, right, controls,
        pageScrollWidth: doc.scrollWidth, pageClientWidth: doc.clientWidth };
    });
    console.log(`  横幅実測 ${width}px ${label}: ${JSON.stringify(metrics)}`);
    check(`${width}px ${label}: ページ横スクロールなし`, metrics.pageScrollWidth <= metrics.pageClientWidth + 1);
    check(`${width}px ${label}: modal-body横スクロールなし`, metrics.clientWidth > 0 && metrics.scrollWidth <= metrics.clientWidth + 1);
    const outside = metrics.controls.filter((r) => r.left < Math.max(0, metrics.left) - 1 || r.right > Math.min(width, metrics.right) + 1);
    check(`${width}px ${label}: 入力・ボタンの左右がmodal-bodyと画面内`, metrics.controls.length > 0 && outside.length === 0, JSON.stringify(outside));
  }

  async function openEditor(id, pg = page) {
    await pg.click(`[data-action="edit-block"][data-id="${id}"]`);
    await waitForModalField(pg, "title");
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(page);
    await passGithubGate(page);

    // ============================================================
    // (1) 見積チップ: 押すとestimateMinへ入り保存で反映。手入力で外れるとハイライト解除
    // ============================================================
    console.log("[1] 見積チップ(15/25/40/60)でestimateMinが入り保存で反映、手入力で外れるとハイライト解除");
    await seed({ blocks: [makeBlock("b1")] });
    await openEditor("b1");
    const chip25 = page.locator('.modal-card [data-action="estimate-chip"][data-min="25"]');
    const estimateInput = page.locator('.modal-card [data-modal-field="estimateMin"]');
    check("見積チップが4つ表示される", await page.locator('.modal-card [data-action="estimate-chip"]').count() === 4);
    const beforeChips = await snapshot();
    for (const min of [15, 25, 40, 60]) {
      await page.locator(`.modal-card [data-action="estimate-chip"][data-min="${min}"]`).click();
      check(`${min}分チップの入力値`, await estimateInput.inputValue() === String(min));
      const active = await page.locator('.modal-card .estimate-chip.active').evaluateAll((els) => els.map((el) => el.dataset.min));
      check(`${min}分チップのみ選択`, JSON.stringify(active) === JSON.stringify([String(min)]));
      await unchanged(`${min}分チップ保存前`, beforeChips);
    }
    await cancelAndReopen("b1");
    check("チップ変更をキャンセルすると元の空欄へ戻る", await estimateInput.inputValue() === "");
    check("キャンセル再表示で選択なし", await page.locator('.modal-card .estimate-chip.active').count() === 0);
    await unchanged("チップキャンセル再表示", beforeChips);
    await chip25.click();
    check("25分チップ押下でestimateMin入力に25が入る", await estimateInput.inputValue() === "25", await estimateInput.inputValue());
    check("25分チップがactiveになる", await chip25.evaluate((el) => el.classList.contains("active")));
    await estimateInput.fill("22");
    // fillはinputイベントを発火するため、ハイライト同期ハンドラ(document input listener)が働く。
    check("手入力(チップ値と不一致)でチップのactiveが解除される",
      await page.locator('.modal-card .estimate-chip.active').count() === 0);
    const chip40 = page.locator('.modal-card [data-action="estimate-chip"][data-min="40"]');
    await chip40.click();
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s1 = await stateNow();
    check("保存後にblock.estimateMinが40になる", s1.blocks.find((b) => b.id === "b1")?.estimateMin === 40,
      JSON.stringify(s1.blocks.find((b) => b.id === "b1")));

    await seed({ blocks: [15, 25, 40, 60].map((min) => makeBlock(`initial-chip-${min}`, { estimateMin: min })) });
    for (const min of [15, 25, 40, 60]) {
      await openEditor(`initial-chip-${min}`);
      const active = await page.locator('.modal-card .estimate-chip.active').evaluateAll((els) => els.map((el) => el.dataset.min));
      check(`保存済み${min}分から初期選択`, JSON.stringify(active) === JSON.stringify([String(min)]) && await estimateInput.inputValue() === String(min));
      await page.locator('.modal-card [data-action="modal-close"]').first().click();
      await waitForModalClosed(page);
    }

    console.log("[1b] チップを押さず手入力した値もそのまま保存される(手入力欄は残る)");
    await seed({ blocks: [makeBlock("b1b")] });
    await openEditor("b1b");
    await page.locator('.modal-card [data-modal-field="estimateMin"]').fill("33");
    await page.click('[data-action="modal-save"]');
    await waitForModalClosed(page);
    const s1b = await stateNow();
    check("手入力した33がそのまま保存される", s1b.blocks.find((b) => b.id === "b1b")?.estimateMin === 33,
      JSON.stringify(s1b.blocks.find((b) => b.id === "b1b")));

    // ============================================================
    // (2) 明日へ/来週へ: todayISO()+1/+7日(表示中Blockの日付ではない、既存
    //     postponeBlockToNextDay/carryOverBlockと同じ基準、監督者裁定2026-09-05 M-1対応)。
    //     保存でplannedStartAt/plannedEndAtの日付部も追従する(既存carryOverBlockのshift規約と
    //     同じ、時刻HH:mmは維持。M-2対応)。actualStartAt/actualEndAtは実績のため据え置き。
    // ============================================================
    // 「今日」を固定して意味論を検証する必要があるため、共有pageのclockを実行途中で
    // 変更するのではなく専用のcontext/pageを都度作る(reload直後のclock変更起点の
    // タイミング不安定を避けるため。他の390px/1280px計測ブロックと同じ構え)。
    console.log("[2] 「明日へ」はtodayISO()+1日が基準(表示中Blockの日付+1ではない)。月末跨ぎ・planned*追従");
    // 「今日」を月末(2026-01-31)に固定し、todayより3日前(2026-01-28)のBlockを開く。
    // 「表示中日付+1」の実装なら2026-01-29になるが、正しい意味論(todayISO()+1)なら2026-02-01になる。
    const jan31 = new Date(2026, 0, 31, 10, 0, 0, 0);
    const ctxJan = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageJan = await ctxJan.newPage();
    pageJan.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(jan31):", e.message); });
    await blockGithubApiByDefault(pageJan);
    await pageJan.clock.setFixedTime(jan31);
    await pageJan.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageJan);
    await passGithubGate(pageJan);
    await seed({ blocks: [makeBlock("b2", { date: "2026-01-28", plannedStartAt: "2026-01-28T09:00", plannedEndAt: "2026-01-28T09:30" })] }, pageJan);
    await pageJan.fill('[data-date-picker]', "2026-01-28");
    await pageJan.waitForSelector('[data-action="edit-block"][data-id="b2"]', { state: "attached" });
    await openEditor("b2", pageJan);
    const dateInput = pageJan.locator('.modal-card [data-modal-field="date"]');
    const plannedStartInput = pageJan.locator('.modal-card [data-modal-field="plannedStartAt"]');
    const plannedEndInput = pageJan.locator('.modal-card [data-modal-field="plannedEndAt"]');
    check("初期日付は2026-01-28", await dateInput.inputValue() === "2026-01-28");
    const beforepageJan = await snapshot(pageJan);
    await pageJan.click('.modal-card [data-action="block-date-shift"][data-days="1"]');
    check("「明日へ」はtoday(2026-01-31)+1日=2026-02-01になる(表示中日付2026-01-28+1の2026-01-29ではない)",
      await dateInput.inputValue() === "2026-02-01", await dateInput.inputValue());
    check("plannedStartAtの日付部も2026-02-01へ追従(時刻09:00は維持)",
      await plannedStartInput.inputValue() === "2026-02-01T09:00", await plannedStartInput.inputValue());
    check("plannedEndAtの日付部も2026-02-01へ追従(時刻09:30は維持)",
      await plannedEndInput.inputValue() === "2026-02-01T09:30", await plannedEndInput.inputValue());
    await unchanged("日付1保存前", beforepageJan, pageJan);
    await cancelAndReopen("b2", pageJan);
    for (const [field, value] of Object.entries({ date: "2026-01-28", plannedStartAt: "2026-01-28T09:00", plannedEndAt: "2026-01-28T09:30" })) {
      check(`日付1キャンセル再表示: ${field}復元`, await pageJan.locator(`[data-modal-field="${field}"]`).inputValue() === value);
    }
    await unchanged("日付1キャンセル再表示", beforepageJan, pageJan);
    await pageJan.click('.modal-card [data-action="block-date-shift"][data-days="1"]');
    await pageJan.click('[data-action="modal-save"]');
    await waitForModalClosed(pageJan);
    const s2 = await stateNow(pageJan);
    const savedB2 = s2.blocks.find((b) => b.id === "b2");
    check("保存後にblock.dateが2026-02-01になる", savedB2?.date === "2026-02-01", JSON.stringify(savedB2));
    // 保存はfromLocalInput()を経由するため秒(:00)が付与される(既存の仕様、v366のスコープ外)。
    check("保存後もplannedStartAt/plannedEndAtの日付部が2026-02-01のまま(時刻維持)",
      savedB2?.plannedStartAt === "2026-02-01T09:00:00" && savedB2?.plannedEndAt === "2026-02-01T09:30:00",
      JSON.stringify(savedB2));
    await ctxJan.close();

    console.log("[2b] 「来週へ」はtodayISO()+7日が基準(年末跨ぎ)。planned*追従");
    const dec28 = new Date(2026, 11, 28, 10, 0, 0, 0);
    const ctxDec = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
    const pageDec = await ctxDec.newPage();
    pageDec.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror(dec28):", e.message); });
    await blockGithubApiByDefault(pageDec);
    await pageDec.clock.setFixedTime(dec28);
    await pageDec.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageDec);
    await passGithubGate(pageDec);
    await seed({ blocks: [makeBlock("b2b", { date: "2026-12-20", plannedStartAt: "2026-12-20T09:00", plannedEndAt: "2026-12-20T09:30" })] }, pageDec);
    await pageDec.fill('[data-date-picker]', "2026-12-20");
    await pageDec.waitForSelector('[data-action="edit-block"][data-id="b2b"]', { state: "attached" });
    await openEditor("b2b", pageDec);
    const dateInput2 = pageDec.locator('.modal-card [data-modal-field="date"]');
    const plannedStartInput2 = pageDec.locator('.modal-card [data-modal-field="plannedStartAt"]');
    const beforepageDec = await snapshot(pageDec);
    await pageDec.click('.modal-card [data-action="block-date-shift"][data-days="7"]');
    check("「来週へ」はtoday(2026-12-28)+7日=2027-01-04になる(表示中日付2026-12-20+7の2026-12-27ではない)",
      await dateInput2.inputValue() === "2027-01-04", await dateInput2.inputValue());
    check("plannedStartAtの日付部も2027-01-04へ追従",
      await plannedStartInput2.inputValue() === "2027-01-04T09:00", await plannedStartInput2.inputValue());
    await unchanged("日付7保存前", beforepageDec, pageDec);
    await cancelAndReopen("b2b", pageDec);
    for (const [field, value] of Object.entries({ date: "2026-12-20", plannedStartAt: "2026-12-20T09:00", plannedEndAt: "2026-12-20T09:30" })) {
      check(`日付7キャンセル再表示: ${field}復元`, await pageDec.locator(`[data-modal-field="${field}"]`).inputValue() === value);
    }
    await unchanged("日付7キャンセル再表示", beforepageDec, pageDec);
    await pageDec.click('.modal-card [data-action="block-date-shift"][data-days="7"]');
    await pageDec.click('[data-action="modal-save"]');
    await waitForModalClosed(pageDec);
    const s2b = await stateNow(pageDec);
    const savedB2b = s2b.blocks.find((b) => b.id === "b2b");
    check("保存後にblock.dateが2027-01-04になる", savedB2b?.date === "2027-01-04", JSON.stringify(savedB2b));
    check("保存後もplannedStartAt/plannedEndAtの日付部が2027-01-04のまま",
      savedB2b?.plannedStartAt === "2027-01-04T09:00:00" && savedB2b?.plannedEndAt === "2027-01-04T09:30:00",
      JSON.stringify(savedB2b));
    await ctxDec.close();

    // ============================================================
    // (3) 「詳細 ›」既定閉。開くと3項目が出て従来どおり動く(v107のモーダル内タスク完了契約)。
    //     開閉操作はstate/localStorageを書かない。
    // ============================================================
    console.log("[3] 「詳細 ›」は既定閉。開くとレバレッジ種別・完了済み(Block)・🏁タスク完了が出る");
    await seed({
      tasks: [{
        id: "t3", projectId: "", parentTaskId: "", title: "詳細検証Task", category: "", status: "todo", dueDate: "",
        description: "", selfDueOff: false, targetYear: null, targetMonth: null, lifeArea: "", motivation: "",
        realized: false, realizedDate: "", nextRoutineId: "", leverageType: "", leverageNote: "",
        aiWork: false, aiWorkBrief: "", progressNum: 0, progressDen: 10, doneCriteria: "", firstStep: "",
        criteriaRequest: false, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      }],
      blocks: [makeBlock("b3", { taskId: "t3" })]
    });
    await openEditor("b3");
    const details = page.locator(".modal-card details.tower-fold");
    check("「詳細 ›」要素が1つある", await details.count() === 1);
    check("「詳細 ›」は既定閉(open属性なし)", await details.evaluate((el) => el.open) === false);
    check("閉状態ではレバレッジ種別selectは非可視", await page.locator('.modal-card [data-modal-field="leverageType"]').isVisible() === false);
    const stateBeforeOpen = await snapshot();
    // 「詳細 ›」を開く操作(summaryクリック)自体はstate/localStorageを書き換えない(非永続)。
    await page.click(".modal-card details.tower-fold summary");
    await unchanged("詳細を開く", stateBeforeOpen);
    check("開くとレバレッジ種別selectが可視になる", await page.locator('.modal-card [data-modal-field="leverageType"]').isVisible() === true);
    check("開くと完了済み(Block)チェックが可視になる", await page.locator('.modal-card [data-modal-field="completed"]').isVisible() === true);
    const taskCompleteBtn = page.locator('.modal-card [data-action="toggle-task-complete"][data-id="b3"]');
    check("開くと🏁タスク完了トグルが可視になる(v107契約)", await taskCompleteBtn.isVisible() === true);
    await page.click(".modal-card details.tower-fold summary");
    check("再クリックで閉じる(非永続なので閉じたら再度非可視)",
      await page.locator('.modal-card [data-modal-field="leverageType"]').isVisible() === false);

    await unchanged("詳細を閉じる", stateBeforeOpen);
    await page.click(".modal-card details.tower-fold summary");
    await unchanged("詳細を再度開く", stateBeforeOpen);
    await cancelAndReopen("b3");
    check("開いたままキャンセルして再表示すると詳細は閉じる", await details.evaluate((el) => el.open) === false);
    await unchanged("詳細キャンセル再表示", stateBeforeOpen);

    console.log("[3b] 開いた状態で🏁タスク完了トグルを押すと従来どおりタスクが完了する(v107契約の維持)");
    await page.click(".modal-card details.tower-fold summary");
    await taskCompleteBtn.click();
    // review-v363-claude-a L-1対応: 常にtrueを返すno-op待機ではなく、実際にtoggleTaskComplete
    // FromBlockのstate反映(Task.status===completed)が成立するまで待つ。
    await page.waitForFunction((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      return s?.tasks?.find((t) => t.id === "t3")?.status === "completed";
    }, KEY);
    const s3 = await stateNow();
    check("🏁押下でTaskがcompletedになる(v107契約)", s3.tasks.find((t) => t.id === "t3")?.status === "completed",
      JSON.stringify(s3.tasks.find((t) => t.id === "t3")));

    // ============================================================
    // (5) 390px/1280px 横スクロールなし・全input/select/textarea 16px・44pxボタン・pageerror0
    // ============================================================
    console.log("[5] 390px/1280pxで横スクロールなし、390pxで全input/select/textareaが16px以上、チップ/ボタンは44px以上");
    const ctxMobile = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pageMobile = await ctxMobile.newPage();
    let mobileErrors = 0;
    pageMobile.on("pageerror", (e) => { mobileErrors++; console.log("  ❌ pageerror(mobile):", e.message); });
    await blockGithubApiByDefault(pageMobile);
    await pageMobile.clock.setFixedTime(now0);
    await pageMobile.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageMobile);
    await passGithubGate(pageMobile);
    await pageMobile.evaluate(({ KEY, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = []; s.projects = []; s.blocks = blocks; s.recurrences = [];
      s.selectedDate = TODAY; s.currentView = "timeline";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: [makeBlock("mb1")], TODAY });
    await pageMobile.reload();
    await waitForNavReady(pageMobile);
    await pageMobile.click('[data-action="edit-block"][data-id="mb1"]');
    await waitForModalField(pageMobile, "title");
    // 「詳細 ›」も開いた状態で計測する(閉状態の非表示要素はfont-size計測対象から自然に外れるため、
    // 折りたたみ内のleverageType/completedも計測対象に含めるにはここで開く必要がある)。
    await checkHorizontal(pageMobile, 390, "詳細閉");
    await pageMobile.click(".modal-card details.tower-fold summary");
    await checkHorizontal(pageMobile, 390, "詳細開");
    const fontSizeReport = await pageMobile.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.modal-card input, .modal-card select, .modal-card textarea'))
        .filter((el) => el.type !== "checkbox");
      return els.map((el) => ({
        field: el.getAttribute("data-modal-field") || el.type || el.tagName.toLowerCase(),
        fontSize: parseFloat(getComputedStyle(el).fontSize)
      }));
    });
    check(".modal-card内のinput/select/textarea(checkbox除く)が1つ以上ある", fontSizeReport.length > 0, fontSizeReport.length);
    check("全input/select/textarea(checkbox除く)のfont-sizeが16px以上(iOS自動ズーム対策)",
      fontSizeReport.every((r) => r.fontSize >= 16), JSON.stringify(fontSizeReport.filter((r) => r.fontSize < 16)));
    const chipAndShiftHeights = await pageMobile.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        '.modal-card [data-action="estimate-chip"], .modal-card [data-action="block-date-shift"]'));
      return els.map((el) => el.offsetHeight);
    });
    check("見積チップ・明日へ/来週へボタンが44px以上ある", chipAndShiftHeights.length === 6 && chipAndShiftHeights.every((h) => h >= 44),
      JSON.stringify(chipAndShiftHeights));
    // review-v363-claude-a M-4対応: 「詳細 ›」のsummary自体が390pxでタップ可能(44px以上)か
    // を計測する(モーダル内に到達可能でも、summaryが見切れていては開けない)。
    const detailsSummaryHeight = await pageMobile.evaluate(() =>
      document.querySelector(".modal-card details.tower-fold summary")?.offsetHeight ?? 0);
    check("「詳細 ›」のsummaryが44px以上ある", detailsSummaryHeight >= 44, detailsSummaryHeight);
    check("390px幅でpageerrorが0件", mobileErrors === 0, mobileErrors);
    await ctxMobile.close();

    const ctxWide = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pageWide = await ctxWide.newPage();
    let wideErrors = 0;
    pageWide.on("pageerror", (e) => { wideErrors++; console.log("  ❌ pageerror(1280):", e.message); });
    await blockGithubApiByDefault(pageWide);
    await pageWide.clock.setFixedTime(now0);
    await pageWide.goto(`http://localhost:${PORT}/`);
    await waitForStateReady(pageWide);
    await passGithubGate(pageWide);
    await pageWide.evaluate(({ KEY, blocks, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks = []; s.projects = []; s.blocks = blocks; s.recurrences = [];
      s.selectedDate = TODAY; s.currentView = "timeline";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks: [makeBlock("wb1")], TODAY });
    await pageWide.reload();
    await waitForNavReady(pageWide);
    await pageWide.click('[data-action="edit-block"][data-id="wb1"]');
    await waitForModalField(pageWide, "title");
    await checkHorizontal(pageWide, 1280, "詳細閉");
    await pageWide.click(".modal-card details.tower-fold summary");
    await checkHorizontal(pageWide, 1280, "詳細開");
    check("1280px幅でpageerrorが0件", wideErrors === 0, wideErrors);
    await ctxWide.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v366 全チェック成功" : `\n❌ v366 ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
