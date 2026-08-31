// v311 pomodoro/timer/render表示: CABIN TIMERのLINK FLIGHT・一時停止/再開・Block連動着陸。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, STATE_KEY } = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-08-31";
const at = (time) => `${TODAY}T${time}:00`;
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function block(id, title, start, options = {}) {
  return {
    id, taskId: "", date: TODAY, title, category: options.category || "仕事",
    plannedStartAt: at(start), plannedEndAt: at(options.end || "11:00"),
    actualStartAt: options.actualStartAt || "", actualEndAt: options.actualEndAt || "",
    completed: Boolean(options.completed), charge: 0, discharge: 0, estimateMin: 30,
    comment: "", recurrenceGroupId: "", pomodoroCount: 0, interruptions: [], migratedTo: "",
    orderIndex: 0, deleted: false, createdAt: at("08:00"), updatedAt: at("08:00")
  };
}

const idlePomodoro = () => ({
  running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus",
  paused: false, pausedRemainMs: 0
});

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1180, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  async function stateNow() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  }

  async function seed(blocks, pomodoro = idlePomodoro()) {
    await page.evaluate(({ key, blocksValue, pomodoroValue, today }) => {
      const state = JSON.parse(localStorage.getItem(key));
      Object.assign(state, {
        blocks: blocksValue, tasks: [], projects: [], recurrences: [], currentView: "today",
        selectedDate: today, pomodoro: pomodoroValue
      });
      state.settings.focusTimerAuto = false;
      state.settings.autoSync = false;
      state.settings.pomoGuidedAccessHint = false;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, blocksValue: blocks, pomodoroValue: pomodoro, today: TODAY });
    await page.reload();
    await page.waitForSelector(".today-pomodoro");
  }

  async function resetWriteCount() {
    await page.evaluate((key) => {
      if (!window.__v311SetItemOriginal) {
        window.__v311SetItemOriginal = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, value) {
          if (k === key) window.__v311StateWrites = (window.__v311StateWrites || 0) + 1;
          return window.__v311SetItemOriginal.call(this, k, value);
        };
      }
      window.__v311StateWrites = 0;
    }, STATE_KEY);
  }

  const writeCount = () => page.evaluate(() => window.__v311StateWrites || 0);

  async function openLinkModal() {
    await page.click('.today-pomodoro [data-action="open-pomodoro-link"]');
    await page.waitForSelector("#modalRoot.open .link-modal");
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 31, 10, 0, 0));
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] 旧stateをpaused=false/pausedRemainMs=0へ移行する");
    await seed([], { running: false, blockId: "", startedAt: "", endsAt: "", mode: "focus" });
    const migrated = (await stateNow()).pomodoro;
    check("normalizeStateが一時停止フィールドを補完", migrated.paused === false && migrated.pausedRemainMs === 0, JSON.stringify(migrated));

    console.log("[2] LINK FLIGHTはNOW→ARRIVALS→連動なしの順で、閉じても開始しない");
    const nowBlock = block("now-flight", "実行中の便", "09:30", { actualStartAt: at("09:45") });
    const arrival = block("arrival-flight", "ARRIVALSの便", "10:30");
    const completed = block("completed-flight", "完了済み便", "11:30", { completed: true, actualEndAt: at("09:00") });
    await seed([nowBlock, arrival, completed]);
    await openLinkModal();
    const optionOrder = await page.locator(".pomodoro-link-options > *").evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-block-id"), cls: node.className, text: node.textContent.trim()
    })));
    check("NOW便を最上段の強調枠に表示", optionOrder[0]?.id === "now-flight" && optionOrder[0].cls.includes("now-opt"), JSON.stringify(optionOrder));
    check("ARRIVALS未完了便だけを続けて表示", optionOrder.some((row) => row.id === "arrival-flight") && !optionOrder.some((row) => row.id === "completed-flight"));
    check("最後は連動なし", optionOrder.at(-1)?.id === "" && optionOrder.at(-1)?.text.includes("連動なし"));
    await page.locator("#modalRoot").click({ position: { x: 4, y: 4 } });
    check("背景タップは開始せず閉じる", await page.locator("#modalRoot.open").count() === 0 && !(await stateNow()).pomodoro.running);
    await openLinkModal();
    await page.click('.link-modal [data-action="modal-close"]');
    check("キャンセルも開始しない", !(await stateNow()).pomodoro.running);

    console.log("[3] NOW開始→一時停止→時刻を進めても凍結→再開→終了理由記録");
    await openLinkModal();
    await page.click('.pomodoro-link-option.now-opt[data-block-id="now-flight"]');
    let state = await stateNow();
    check("NOW便へリンクして25分セッションを開始", state.pomodoro.running && state.pomodoro.blockId === "now-flight" && !state.pomodoro.paused, JSON.stringify(state.pomodoro));
    check("既存actualStartAtは維持", state.blocks.find((item) => item.id === "now-flight").actualStartAt === at("09:45"));
    await page.clock.setFixedTime(new Date(2026, 7, 31, 10, 2, 0));
    await resetWriteCount();
    await page.click('.today-pomodoro [data-action="pause-pomodoro"]');
    state = await stateNow();
    const frozenMs = state.pomodoro.pausedRemainMs;
    const frozenText = await page.locator(".today-pomodoro .pomo-time-overlay").textContent();
    check("paused中もrunning=trueで残り23分をスナップショット", state.pomodoro.running && state.pomodoro.paused && frozenMs === 23 * 60 * 1000, JSON.stringify(state.pomodoro));
    check("一時停止はstateを1回保存", await writeCount() === 1, String(await writeCount()));
    await page.clock.setFixedTime(new Date(2026, 7, 31, 10, 7, 0));
    await new Promise((resolve) => setTimeout(resolve, 700));
    check("一時停止中は表示とsnapshotが減らない",
      await page.locator(".today-pomodoro .pomo-time-overlay").textContent() === frozenText
      && (await stateNow()).pomodoro.pausedRemainMs === frozenMs);
    await resetWriteCount();
    await page.click('.today-pomodoro [data-action="resume-pomodoro"]');
    state = await stateNow();
    check("再開はendsAtを現在+snapshotへ再計算", !state.pomodoro.paused && state.pomodoro.endsAt.startsWith(`${TODAY}T10:30`), JSON.stringify(state.pomodoro));
    check("再開はstateを1回保存", await writeCount() === 1, String(await writeCount()));
    await resetWriteCount();
    await page.click('.today-pomodoro [data-action="stop-pomodoro"]');
    check("■終了は既存チョコ停理由ピッカーを開き、選択前は動作継続",
      await page.locator(".interrupt-reason-picker").count() === 1 && (await stateNow()).pomodoro.running);
    await page.click('.interrupt-reason-picker [data-action="interrupt-reason"][data-reason="疲労"]');
    state = await stateNow();
    const stoppedBlock = state.blocks.find((item) => item.id === "now-flight");
    check("終了は完全停止しactualStartAtをクリア", !state.pomodoro.running && stoppedBlock.actualStartAt === "", JSON.stringify(state.pomodoro));
    check("終了理由を退行なく記録", stoppedBlock.interruptions.length === 1 && stoppedBlock.interruptions[0].reason === "疲労");
    check("理由記録+完全停止を各1回保存", await writeCount() === 2, String(await writeCount()));

    console.log("[4] ARRIVALS便と連動なしで開始する");
    await page.clock.setFixedTime(new Date(2026, 7, 31, 10, 0, 0));
    await seed([block("arrival-only", "選択するARRIVALS", "10:30")]);
    await openLinkModal();
    await page.click('.pomodoro-link-option[data-block-id="arrival-only"]');
    state = await stateNow();
    check("ARRIVALS便へリンクしactualStartAtを記録", state.pomodoro.blockId === "arrival-only" && Boolean(state.blocks[0].actualStartAt));

    const untouched = [block("none-a", "触らない便A", "10:30"), block("none-b", "触らない便B", "11:00")];
    await seed(untouched);
    await resetWriteCount();
    await openLinkModal();
    await page.click('.pomodoro-link-option.no-link[data-block-id=""]');
    state = await stateNow();
    check("連動なしはrunning=true/blockId空", state.pomodoro.running && state.pomodoro.blockId === "", JSON.stringify(state.pomodoro));
    check("連動なし開始は全BlockのactualStartAtを一切変更しない", state.blocks.every((item) => item.actualStartAt === ""), JSON.stringify(state.blocks));
    check("連動なし開始はstateを1回だけ保存", await writeCount() === 1, String(await writeCount()));
    await resetWriteCount();
    await page.click('.today-pomodoro [data-action="stop-pomodoro"]');
    check("連動なしの■終了は理由ピッカーなしで完全停止・1回保存",
      !(await stateNow()).pomodoro.running && await page.locator(".interrupt-reason-picker").count() === 0 && await writeCount() === 1);

    console.log("[5] NOWなし/ARRIVALS 0件でも連動なしを選べる");
    await seed([]);
    await openLinkModal();
    check("NOW選択肢を出さない", await page.locator(".pomodoro-link-option.now-opt").count() === 0);
    check("ARRIVALS 0件を表示", (await page.locator(".pomodoro-link-empty").textContent()).includes("未完了便はありません"));
    check("0件でも連動なし選択肢を残す", await page.locator('.pomodoro-link-option.no-link[data-block-id=""]').count() === 1);
    await page.click('.link-modal [data-action="modal-close"]');

    console.log("[6] completePomodoro/nowConveyorComplete/saveActualEntryの3経路で連動着陸する");
    const active = (id, extra = {}) => ({
      running: true, blockId: id, startedAt: at("10:00"), endsAt: at("10:25"), mode: "focus",
      paused: false, pausedRemainMs: 0, ...extra
    });
    await seed([block("pomo-complete", "ポモ経由", "10:00", { actualStartAt: at("10:00") })], active("pomo-complete"));
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "complete-pomodoro";
      button.dataset.testAction = "complete-pomodoro";
      document.body.appendChild(button);
    });
    await page.click('[data-test-action="complete-pomodoro"]');
    await page.click('#modalRoot [data-action="report-skip"]');
    state = await stateNow();
    check("completePomodoro経路でBlock完了+着陸", !state.pomodoro.running && state.blocks[0].completed && state.blocks[0].pomodoroCount === 1);

    // v311レビュー(Codex)で発見した実害の再発防止: autoCloseStaleRoutineRuns等の既存経路で
    // 未完了のまま古いactualEndAtだけが残ったBlock(Block card個別の「25分」ボタン経由で
    // 再度ポモ連動されうる)を、通常のcompletePomodoro経路で完了させても、古い時刻を
    // 「今完了した」時刻として誤って再利用せず、必ず現在時刻へ上書きすることを固定する。
    await seed([block("stale-end", "古いactualEndAtが残るBlock", "10:00", {
      actualStartAt: at("10:00"), actualEndAt: at("08:00")
    })], active("stale-end"));
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "complete-pomodoro";
      button.dataset.testAction = "complete-pomodoro";
      document.body.appendChild(button);
    });
    await page.click('[data-test-action="complete-pomodoro"]');
    await page.click('#modalRoot [data-action="report-skip"]');
    state = await stateNow();
    check("completePomodoro経路は古いactualEndAtを再利用せず現在時刻へ上書きする",
      state.blocks[0].completed && !state.blocks[0].actualEndAt.startsWith(`${TODAY}T08:00`)
      && state.blocks[0].actualEndAt.startsWith(`${TODAY}T10:00`), JSON.stringify(state.blocks[0]));

    await seed([block("paused-direct", "一時停止中の直接完了", "10:00", { actualStartAt: at("10:00") })],
      active("paused-direct", { paused: true, pausedRemainMs: 12 * 60 * 1000 }));
    await page.click('.tower-runway [data-action="now-conveyor-complete"][data-id="paused-direct"]');
    state = await stateNow();
    check("一時停止中もnowConveyorCompleteでBlock完了+着陸", !state.pomodoro.running && state.blocks[0].completed);

    await seed([block("actual-save", "実績保存経由", "10:00", { actualStartAt: at("10:00") })], active("actual-save"));
    await page.click('.tower-runway [data-action="complete-block-with-actual"][data-id="actual-save"]');
    await page.waitForSelector('#modalRoot.open [data-action="modal-save"]');
    await page.click('#modalRoot [data-action="modal-save"]');
    state = await stateNow();
    check("saveActualEntryFromModal経路で実績完了+着陸し入力した終了時刻を維持",
      !state.pomodoro.running && state.blocks[0].completed && state.blocks[0].pomodoroCount === 1
      && state.blocks[0].actualEndAt.startsWith(`${TODAY}T11:00`), JSON.stringify(state));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
