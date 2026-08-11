// v58 検証: レビュー指摘の再確認と回帰ガード。
//
// 背景: review.md にあった以下の指摘は、コード現物確認と tests/v56.test.js の
// 既存アサーションにより v56 時点で実装済みと判明した(review.md 側のチェックが
// 更新漏れだった)。v58 ではコード修正は行わず、review.md のチェックオフと、
// 将来の先祖返り(特に new Date(string) への回帰、.draft-resize のクリック横取り)
// を検知するための回帰テストをここに追加する。
//   - weekRange()/isWishStagnant()/Pomodoro 系の日時文字列パース(9時間ズレ回避)
//   - AI下書きスケジュールの削除ボタン(.draft-remove)が .draft-resize に
//     クリックを奪われる問題(短い下書きBlockで顕著)
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
  // v72: api.github.com への実ネットワーク呼び出しを既定404で塞ぐ(個人データAPI化に伴う対策。tests/helpers.js参照)
  await blockGithubApiByDefault(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // "YYYY-MM-DDTHH:mm:ss" 形式(iOS Safari が UTC と誤解釈しうる形式そのもの)で固定する
  const isoDateTime = (d) => `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  // v72: トークン+個人データリポジトリ未設定だとセットアップ画面(ゲート)で止まるため、
  // 既存スイートの前提(設定済みstate)を保つためテスト用トークンを注入する(tests/helpers.js参照)
  await passGithubGate(page);

  // ---- [1] isWishStagnant(): 60日境界を "YYYY-MM-DDTHH:mm:ss" 形式で正しく判定する ----
  console.log("[1] isWishStagnant() の60日境界(9時間ズレ回避フォーマット)");
  const now = new Date();
  const fresh = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30日前 → 停滞していない
  const stale = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000); // 61日前 → 停滞している

  const wishProjectId = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
    return wp ? wp.id : null;
  }, KEY);
  check("Wish Project が既定で存在する(normalizeState)", !!wishProjectId);

  await page.evaluate(({ KEY, wishProjectId, freshISO, staleISO }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.tasks = s.tasks || [];
    s.tasks.push(
      { id: "wish-fresh", projectId: wishProjectId, parentTaskId: "", title: "新しめのWish", category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "", targetYear: null, realized: false, createdAt: freshISO, updatedAt: freshISO, deleted: false },
      { id: "wish-stale", projectId: wishProjectId, parentTaskId: "", title: "放置中のWish", category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "", targetYear: null, realized: false, createdAt: staleISO, updatedAt: staleISO, deleted: false }
    );
    s.currentView = "wish";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, wishProjectId, freshISO: isoDateTime(fresh), staleISO: isoDateTime(stale) });
  await page.reload();
  await page.waitForTimeout(500);

  const freshText = await page.locator(".wish-card", { hasText: "新しめのWish" }).first().innerText();
  const staleText = await page.locator(".wish-card", { hasText: "放置中のWish" }).first().innerText();
  check("30日前更新のWishは🐢が付かない", !freshText.includes("🐢"), freshText);
  check("61日前更新のWishは🐢が付く(9時間ズレが起きると59〜61日境界の判定がずれる)", staleText.includes("🐢"), staleText);

  // ---- [2] Pomodoro: startedAt/endsAt の "YYYY-MM-DDTHH:mm:ss" パース ----
  console.log("[2] Pomodoro 残り時間(startedAt/endsAt の日時パース)");
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + 5 * 60 * 1000); // 5分後(2倍速表示で約10:00)
  await page.evaluate(({ KEY, startedAtISO, endsAtISO }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.blocks = s.blocks || [];
    s.blocks.push({ id: "blk-pomo", taskId: "", date: "", title: "集中作業", category: "", plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0, comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0, createdAt: startedAtISO, updatedAt: startedAtISO, deleted: false });
    s.pomodoro = { running: true, blockId: "blk-pomo", startedAt: startedAtISO, endsAt: endsAtISO, mode: "focus" };
    s.currentView = "pomodoro";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, startedAtISO: isoDateTime(startedAt), endsAtISO: isoDateTime(endsAt) });
  await page.reload();
  await page.waitForTimeout(500);

  const overlayText = (await page.locator(".pomo-time-overlay").first().textContent()).trim();
  const parts = overlayText.split(":").map(Number);
  const totalSec = (parts[0] || 0) * 60 + (parts[1] || 0);
  check("Pomodoroが「セッション切れ」として自動リセットされていない(50:00 に戻っていない)",
    overlayText !== "50:00", overlayText);
  // 5分 = 300000ms を2倍速換算(500ms=1秒)すると 600秒(10:00)。9時間ズレなら
  // endsAt が大幅に過去/未来にずれ、00:00 に張り付くか異常値になる。
  check("Pomodoro残り時間が期待レンジ内(9:30〜10:00、9時間ズレなら成立しない)",
    totalSec >= 560 && totalSec <= 600, overlayText);

  // ---- [3] weekRange(): 週起点(土曜)判定 ----
  console.log("[3] weekRange() の週起点判定(土曜)");
  const day = now.getDay(); // 0=Sun .. 6=Sat
  const satOffset = (6 - day + 7) % 7;
  const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + satOffset);
  const fri = new Date(sat.getTime() - 24 * 60 * 60 * 1000); // 前週金曜(週をまたぐ境界)

  // v85: 起動時は常にselectedDate=今日に強制されるため(各タブ既定=今日)、検証したい曜日
  // (土曜/金曜)へはreload後にセッション中の日付ピッカー操作で移動する(起動時injectionは無効化された)。
  await page.evaluate(({ KEY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.currentView = "home";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY });
  await page.reload();
  await page.waitForTimeout(500);
  // v149(UI改善計画Phase4a): 週次レビュー導線(homeWeeklyLink)は「長い弧をたしかめる」の
  // 一部としてホームの2タブ分割でホームタブへ移動した(既定は今日タブ)。
  await page.click('[data-action="home-tab"][data-tab="home"]');
  await page.waitForTimeout(150);
  await page.evaluate((satISO) => {
    const el = document.querySelector("[data-date-picker]");
    el.value = satISO;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, isoDate(sat));
  await page.waitForTimeout(200);
  check("土曜日は週次レビュー導線が表示される(weekStart===selectedDate)",
    await page.locator('[data-action="open-weekly"]').count() === 1, isoDate(sat));

  await page.evaluate((friISO) => {
    const el = document.querySelector("[data-date-picker]");
    el.value = friISO;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, isoDate(fri));
  await page.waitForTimeout(200);
  check("金曜日(前週扱い)は週次レビュー導線が表示されない(9時間ズレなら曜日判定がずれ得る)",
    await page.locator('[data-action="open-weekly"]').count() === 0, isoDate(fri));

  // ---- [4] 短い下書きBlockの削除ボタン(×)が .draft-resize にクリックを奪われない ----
  // v60メモ: 元はAIモックで「15分」の配置案を返させていたが、v60で下書きスケジュールは
  // 決定論配置(computeFreeGaps→fallbackMorningPlan)になったため、候補タスクの
  // estimateMin=15 を与えて同じ「15分の極短Block」を再現する(15分刻みに丸められる実装のため
  // 下限に近い最短の有効値として15分を使う。高さは Math.max(26, minutes/60*rowHeight) の
  // 下限26pxに張り付く、という検証対象は変わらない)。
  console.log("[4] 短い下書きBlockの削除ボタンがクリック可能");
  // v62レビュー対応: runAiSchedule()はcomputeFreeGaps(「現在時刻〜23:00」)に依存するため、
  // 23:00境界付近の実行だとfreeGapsが消えてフレーキーになる(v61で v50/v59/v60 に適用した
  // page.clock対策がこのシナリオだけ未適用だった)。日中時刻に固定して決定論化する。
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
  const TODAY = isoDate(now);
  // v199対応: 「📋 下書きスケジュール」(ai-schedule)の候補源がWBS未Block化タスクから
  // 当日登録済みBlockへ変わったため、task-shortに紐づく当日Block(9:00-9:15・15分)を
  // 合わせて登録する(estimateMinは新経路では使われないが、Block自体の長さを15分にすることで
  // 本テストの検証対象=「短い下書きBlock(高さ26px下限)の削除ボタンがクリック可能」を維持する)。
  await page.evaluate(({ KEY, TODAY }) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.projects = (s.projects || []).filter((p) => p.kind !== "normal");
    s.projects.push({ id: "proj-short", kind: "normal", title: "短時間案件", category: "", status: "active", description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false });
    s.tasks = [{ id: "task-short", projectId: "proj-short", parentTaskId: "", title: "短時間タスク", category: "", status: "todo", dueDate: TODAY, description: "", estimateMin: 15, createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }];
    s.blocks = [{
      id: "blk-task-short", taskId: "task-short", date: TODAY, title: "短時間タスク", category: "",
      plannedStartAt: `${TODAY}T09:00`, plannedEndAt: `${TODAY}T09:15`,
      actualStartAt: "", actualEndAt: "", completed: false, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
    }];
    s.selectedDate = TODAY;
    s.currentView = "tasks";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, TODAY });
  await page.reload();
  await page.waitForTimeout(500);

  await page.click('[data-action="nav"][data-view="tasks"]');
  await page.waitForTimeout(200);
  const scheduleBtn = page.locator('[data-action="ai-schedule"]');
  if (await scheduleBtn.count()) {
    await scheduleBtn.click();
    await page.waitForTimeout(600);
    check("15分の下書きBlockが表示される", await page.locator(".draft-block").count() === 1);
    await page.locator(".draft-block").scrollIntoViewIfNeeded();
    const box = await page.locator(".draft-block").boundingBox();
    check("下書きBlockの高さが最小値(26px)に張り付いている(短いBlockケース)", !!box && box.height <= 27, box && box.height);

    let removeError = null;
    try {
      await page.locator(".draft-remove").click({ timeout: 4000 });
    } catch (e) { removeError = e.message; }
    check("短いBlockでも×ボタンがクリックでき、.draft-resizeに横取りされない", !removeError, removeError || "");
    await page.waitForTimeout(300);
    check("削除後は下書きBlockが消える", await page.locator(".draft-block").count() === 0);
  } else {
    check("下書きボタンが見つからずスキップ", false, "ai-schedule button not found");
  }

  await browser.close();
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
