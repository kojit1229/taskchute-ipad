// v333: 「実行」ラッパー(タスクシュート/タイムライン統合)。
// スコープ = v333a(ラッパー+モバイル)。PC 2ペイン(B)・PCサイドバー統合(C後半)は
// タイムライン絶対配置エンジンへ踏み込む高リスク変更のため次バージョン(v333b)へ持ち越し
// (発注書「やらないこと: タイムライン配置計算・Blockロジックの変更」に抵触する範囲)。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const PORT = randomPort();
const TODAY = "2026-09-04";
const FIXED_NOW = new Date(2026, 8, 4, 10, 0, 0);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function project(id, extra = {}) {
  return { id, title: id === "p1" ? "プロジェクトA" : id, kind: "normal", status: "active", deleted: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function task(id, extra = {}) {
  return { id, projectId: "p1", title: id, kind: "normal", status: "todo", deleted: false,
    selfDueOff: true, progressNum: 0, progressDen: 10,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}
function block(id, taskId, extra = {}) {
  return { id, taskId, date: TODAY, title: id, category: "仕事",
    plannedStartAt: `${TODAY}T09:00:00`, plannedEndAt: `${TODAY}T09:30:00`,
    actualStartAt: "", actualEndAt: "", everStartedAt: "", completed: false,
    charge: 0, discharge: 0, estimateMin: 30, recurrenceGroupId: "", source: "",
    orderIndex: 0, migratedTo: "", deleted: false, isMIT: false,
    createdAt: `${TODAY}T08:00:00`, updatedAt: `${TODAY}T08:00:00`, ...extra };
}

async function resetSetItemLog(page) {
  await page.evaluate(() => { window.__setItemChanges = []; });
}
async function contentChangingWrites(page, key) {
  return page.evaluate((k) => (window.__setItemChanges || []).filter((x) => x === k).length, key);
}

async function seed(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    Object.assign(current, values);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__setItemChanges = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      try {
        const prev = this.getItem(key);
        if (prev !== value) window.__setItemChanges.push(key);
      } catch (e) { /* noop */ }
      return orig.call(this, key, value);
    };
  });
  try {
    await blockGithubApiByDefault(page);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    const tToday = task("t-today", { dueDate: TODAY });
    const upA = block("b-up-a", "t-today", { plannedStartAt: `${TODAY}T11:00:00` });

    console.log("[1] exec初期表示は計画モード(v331/v332の3段)。セグメントで実績へ切替るとRADARとDRIFT/TIME COMB(閉)、計画へ戻せる。切替はstate/localStorage非書込");
    await seed(page, {
      currentView: "exec", selectedDate: TODAY,
      projects: [project("p1")], tasks: [tToday], blocks: [upA]
    });
    check("execヘッダ「TOWER / 実行」が出る", (await page.textContent(".exec-header-line")).includes("TOWER / 実行"));
    check("初期表示は計画モードがactive", await page.locator('[data-action="exec-mode-toggle"][data-mode="plan"]').first().evaluate((el) => el.classList.contains("active")));
    check("計画モードで「これから」セクションが出る(v331/v332の3段)", await page.locator(".exec-lower .exec-upcoming-section").count() === 1);
    check("計画モードでTIMELINE RADARは出ない", await page.locator(".tl-radar-panel").count() === 0);

    await resetSetItemLog(page);
    const beforeToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".tl-radar-panel");
    check("実績モードでTIMELINE RADARが出る", await page.locator(".tl-radar-panel").count() === 1);
    check("実績モードでDRIFT/TIME COMBが折りたたみ(既定閉)で出る",
      await page.locator("details.exec-analysis-fold").count() === 1
      && (await page.evaluate(() => document.querySelector("details.exec-analysis-fold")?.open)) === false);
    check("実績モードで計画側の「これから」セクションは出ない", await page.locator(".exec-lower").count() === 0);
    const afterToggle = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    check("モード切替はlocalStorage(state)を書き換えない(文字列比較)", beforeToggle === afterToggle);
    check("モード切替は内容変更を伴うsetItemを1回も呼ばない", await contentChangingWrites(page, STATE_KEY) === 0);

    await page.click('[data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForSelector(".exec-lower");
    check("計画へ戻せる", await page.locator(".exec-lower .exec-upcoming-section").count() === 1);

    console.log("[2] 日付バー操作は両モードで同じ日を指す(state.selectedDateは1つ・renderDateBar共通)");
    await page.click('[data-action="date-next"]');
    const dateAfterPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).selectedDate);
    check("計画モードの翌日操作でselectedDateが進む", dateAfterPlan !== TODAY, dateAfterPlan);
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".tl-radar-panel");
    const dateShownActual = await page.inputValue('[data-date-picker]');
    check("実績モードの日付ピッカーも同じ日を指す", dateShownActual === dateAfterPlan, `${dateShownActual} vs ${dateAfterPlan}`);
    await page.click('[data-action="date-prev"]');
    const dateAfterActual = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).selectedDate);
    check("実績モードの前日操作でselectedDateが戻る(元日付)", dateAfterActual === TODAY, dateAfterActual);
    await page.click('[data-action="exec-mode-toggle"][data-mode="plan"]');
    await page.waitForSelector(".exec-lower");
    const dateShownPlan = await page.inputValue('[data-date-picker]');
    check("計画モードへ戻しても同じ日のまま", dateShownPlan === TODAY, dateShownPlan);

    console.log("[3] ナビ: モバイル4項目(今日/ジャーナル/実行/その他)・旧「時間」は消える");
    const bottomNavLabels = await page.$$eval("#bottomNav button", (els) => els.map((el) => el.childNodes[0]?.textContent?.trim()));
    check("モバイル下部ナビが4項目", bottomNavLabels.length === 4, JSON.stringify(bottomNavLabels));
    check("ナビ項目に「実行」がある", bottomNavLabels.includes("実行"), JSON.stringify(bottomNavLabels));
    check("ナビ項目に「時間」は無い(タスクシュート/タイムライン統合)", !bottomNavLabels.includes("時間"), JSON.stringify(bottomNavLabels));
    check("「実行」ボタンがactive", await page.locator('#bottomNav button:has-text("実行")').evaluate((el) => el.classList.contains("active")));

    console.log("[4] 旧tasksビューは内部的に残り壊れない。タイムラインrail「開く」はexecの実績モードへ着地する");
    await seed(page, {
      currentView: "tasks", selectedDate: TODAY,
      projects: [project("p1")], tasks: [tToday], blocks: [upA]
    });
    check("旧tasksビューへ直接遷移しても壊れず表示される(内部的に残置)", await page.locator(".exec-header-line").count() === 1);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(50);
    await page.click('#timelineRail [data-action="nav"][data-view="exec"]');
    await page.waitForSelector(".tl-radar-panel");
    check("rail「開く」はexecの実績モードへ着地する",
      await page.locator(".tl-radar-panel").count() === 1
      && await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).currentView) === "exec");
    check("pageerrorなしで着地(壊れない)", pageErrors.length === 0, JSON.stringify(pageErrors));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(50);

    console.log("[5] execの計画/実績で既存の開始・新規Block等が従来どおり動く");
    await seed(page, {
      currentView: "exec", selectedDate: TODAY,
      projects: [project("p1")], tasks: [tToday], blocks: [upA]
    });
    await page.click('[data-action="now-start"][data-id="b-up-a"]');
    await page.waitForSelector('[data-declare-note]');
    check("▶開始で宣言モーダルが開く(従来どおり)", await page.locator('[data-declare-note]').count() === 1);
    await page.click('[data-action="declare-skip"]');
    await page.waitForSelector('.exec-row-now');
    check("宣言せず開始で「いま」行に移る(従来どおり)", await page.locator(".exec-row-now").count() === 1);
    await page.click('[data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".tl-radar-panel");
    check("実績モードで「+ 新規Block」ボタンが出る", await page.locator('[data-action="timeline-new-block"]').first().count() > 0);
    check("実績モードでも開始済みBlockが埋め込みタイムラインに従来どおり表示される",
      await page.locator('.timeline-card[data-id="b-up-a"]').count() === 1);

    console.log("[7] レビュー対応(A-H1/B-H2): 計画モードに見込み終了・余白・バッファ帯・＋Blockが出る。完了・今日へ・＋Block追加(Enter)・「実績を見る」フッタが従来どおり動く");
    const yesterday = "2026-09-03";
    const bComplete = block("b-complete", "t-today", { plannedStartAt: `${TODAY}T13:00:00` });
    const bCarry = block("b-carry", "t-today", { date: yesterday, plannedStartAt: `${yesterday}T09:00:00`, plannedEndAt: `${yesterday}T09:30:00` });
    // seed()はObject.assignで最上位キーを浅くマージするため、settingsをまるごと差し替えると
    // 既存のgithub接続情報が消えてGATE画面へ戻ってしまう。既存settingsを読み出してから
    // dailyBufferMinだけ足す。
    const currentSettings = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings, STATE_KEY);
    await seed(page, {
      currentView: "exec", selectedDate: TODAY,
      projects: [project("p1")], tasks: [tToday], blocks: [upA, bComplete, bCarry],
      settings: { ...currentSettings, dailyBufferMin: 60 }
    });
    check("計画モードで見込み終了が出る", (await page.textContent("#projected-end")).includes("見込み終了"));
    check("計画モードで余白が出る", (await page.textContent(".exec-header-line")).includes("余白"));
    check("計画モードでバッファ帯(buffer-meter)が出る", await page.locator(".buffer-meter").count() === 1);
    check("計画モードで＋Block(details)が出る", await page.locator(".exec-add #blockTitle").count() === 1);

    check("今日へ(繰越パネル)が出る", await page.locator('[data-action="carry-over"][data-id="b-carry"]').count() === 1);
    await page.click('[data-action="carry-over"][data-id="b-carry"]');
    // requestCarryOver()は元Blockの日付を書き換えるのではなく、選択中の日付へ新規Blockを
    // 作って元BlockへmigratedToを付ける(carryOverBlock、app.js:4403)。
    await page.waitForFunction((id) => !!JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.find((b) => b.id === id)?.migratedTo, "b-carry");
    check("「今日へ」で繰越元Blockにmigratedtoが付き、選択中の日付へ新規Blockが作られる", await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1"));
      const src = s.blocks.find((b) => b.id === "b-carry");
      const moved = s.blocks.find((b) => b.id === src.migratedTo);
      return !!moved && moved.date === s.selectedDate;
    }));

    check("完了(toggle-block)前はb-completeが未完了", await page.evaluate(() =>
      !JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.find((b) => b.id === "b-complete").completed));
    await page.click('[data-action="toggle-block"][data-id="b-complete"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.find((b) => b.id === "b-complete")?.completed === true);
    check("完了(toggle-block)でb-completeが完了になる(従来どおり)",
      await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.find((b) => b.id === "b-complete").completed === true));
    // v129/v293: Block完了は身体スキャンモーダルを開く(既存挙動、execラッパー固有ではない)。
    // 後続のクリックを塞がないよう「記録せず閉じる」で畳む。
    if (await page.locator('[data-action="body-scan-discard"]').count()) {
      await page.click('[data-action="body-scan-discard"]');
      await page.waitForSelector('[data-action="body-scan-discard"]', { state: "detached" });
    }

    const blocksBeforeAdd = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.length);
    await page.click(".exec-add summary");
    await page.fill("#blockTitle", "v333手動追加Block");
    await page.locator("#blockTitle").press("Enter");
    await page.waitForFunction((before) => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.length > before, blocksBeforeAdd);
    check("＋Block(details開いて#blockTitle+Enter)でBlockが増える",
      await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.some((b) => b.title === "v333手動追加Block")));

    check("計画モード末尾に「実績を見る ›」フッタが出る",
      await page.locator('.exec-switch-footer [data-action="exec-mode-toggle"][data-mode="actual"]').count() === 1);
    await page.click('.exec-switch-footer [data-action="exec-mode-toggle"][data-mode="actual"]');
    await page.waitForSelector(".tl-radar-panel");
    check("「実績を見る ›」クリックで実績モードへ切替わる",
      await page.locator('.exec-mode-segmented [data-mode="actual"]').evaluate((el) => el.classList.contains("active")));

    console.log("[8] レビュー対応(A-H2/A-M6/M-5): 実績モードで下書きスケジュール・空き時間タップ(timeline-new-block)・TOWERトークン・RADAR可視。execを離れるとモードが計画へ戻る");
    check("実績モードのヘッダに下書きスケジュールボタンが出る(重複なし1件)",
      await page.locator('[data-action="ai-schedule"]').count() === 1);
    // v334レビュー(A-H1/B-H2)対応: 右列を_execModeに連動させたため、実績モードは
    // renderTimelineView({mode:"actual"})で固定表示しstate.timelineModeを読み書きしない
    // 設計へ変更した。予定/実績セグメントは計画モード側(state.timelineModeの切替UI)へ移動し、
    // 実績モードのヘッダには出さない(tests/v334.test.js[2][3]で新しい配置を検証済み)。
    check("実績モードのヘッダに予定/実績セグメントは出ない(v334でstate.timelineMode非依存の固定表示へ変更)",
      await page.locator('.exec-header-actions [data-action="timeline-mode"]').count() === 0);
    const towerVar = await page.locator(".tl-radar-panel").evaluate((el) => getComputedStyle(el.closest(".tower-skin.timeline-tower")).getPropertyValue("--tower-bg").trim());
    check("実績モードで--tower-bgトークンが定義されている(H-2)", towerVar.length > 0, towerVar);
    const radarBox = await page.locator(".tl-radar-panel").boundingBox();
    check("実績モードでTIMELINE RADARパネルが可視(boundingBox)", !!radarBox && radarBox.width > 0 && radarBox.height > 0, JSON.stringify(radarBox));

    const blocksBeforeGapTap = await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.length);
    // v108と同じ理由: .timeline-cards-area(left:60px〜)が.time-rowに重なるため、重ならない
    // 左端(x=20)を、既存Blockの無い23時台(data-minute=1380)で狙う。
    await page.click('.time-row[data-action="timeline-new-block"][data-minute="1380"]', { position: { x: 20, y: 15 } });
    await page.waitForSelector('.modal-card [data-modal-field="title"]');
    check("空き時間タップ(.time-row)で新規Block作成モーダルが開く(従来どおり、状態はまだ増えない)",
      await page.locator('.modal-card [data-modal-field="title"]').count() === 1
      && await page.evaluate(() => JSON.parse(localStorage.getItem("taskchute-journal-pwa-state-v1")).blocks.length) === blocksBeforeGapTap);
    await page.click('.modal-card .modal-footer [data-action="modal-close"]');
    await page.waitForSelector(".modal-card", { state: "detached" });

    await page.click('#bottomNav [data-action="nav"][data-view="today"]');
    await page.waitForSelector('#app[data-view="today"]');
    await page.click('#bottomNav [data-action="nav"][data-view="exec"]');
    await page.waitForSelector('#app[data-view="exec"]');
    check("execを離れて戻ると計画モードへリセットされる(reloadなし、M-1)",
      await page.locator('.exec-mode-segmented [data-mode="plan"]').evaluate((el) => el.classList.contains("active"))
      && await page.locator(".exec-lower").count() === 1);

    console.log("[6] 390px横スクロールなし・pageerror 0・モード切替以外は既存どおりstateが動く");
    const scrollW390 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW390 = await page.evaluate(() => document.documentElement.clientWidth);
    check("390pxで横スクロールが発生しない", scrollW390 <= clientW390 + 1, `${scrollW390} vs ${clientW390}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(50);
    const scrollW1280 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW1280 = await page.evaluate(() => document.documentElement.clientWidth);
    check("1280pxで横スクロールが発生しない", scrollW1280 <= clientW1280 + 1, `${scrollW1280} vs ${clientW1280}`);
    check("pageerrorが0件(全体)", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\n✅ v333 ALL PASS" : `\n❌ v333: ${failures} 件失敗`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
