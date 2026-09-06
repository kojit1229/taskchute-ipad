// tests/v367.test.js — ビジョン「この画面で編集」(K承認2026-09-05)。
// 発注文 workbench/out/2026-09-02-tc-life-platform/order-v366-vision-edit.md どおり、
// v361で持ち越した(4)「この画面で編集」を実装する。本文をtextarea(16px)で編集し、
// 既存のpersonal-data書込関数(pushFileToGitHub)を再利用してVision.mdへPUTする。
// 新しい認証経路は作らない。テストはfetchモックでGET(読取)/PUT(保存)の両方を検証する。
const fs = require("fs");
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // 配信時だけ読み取りプローブを追加。本体ファイル・延期処理の振る舞いは変更しない。
  // 変異試験も配信テキストだけを変えるため、ディスク上のapp.jsの復元は不要。
  await page.route(/\/app\.js(?:\?.*)?$/, (route) => {
    let source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    if (process.env.V366_MUTATION === "failsafe") {
      const guard = "if (overdue && isVisionEditTextareaFocused()) return;";
      if (!source.includes(guard)) throw new Error("変異対象が見つかりません");
      source = source.replace(guard, "/* v367 test mutation: failsafe guard removed */");
    }
    source += "\nwindow.__v367Probe = () => ({ pending: _deferredRenderPending, since: _deferredRenderPendingSince, cached: cachedVisionMd, hydrating: _feedbackHydrateInFlight });\n";
    return route.fulfill({ status: 200, contentType: "text/javascript", body: source });
  });

  const now0 = new Date();
  now0.setHours(12, 0, 0, 0);
  const pad2 = (n) => String(n).padStart(2, "0");
  const fixedTime = (h, m, s = 0) => new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), h, m, s, 0);

  const VISION_MD = "# 10年後\n家族と健康を土台に生きる。\n\n## 今年\nTaskChute Journalを育てる。";
  const EDITED_MD = VISION_MD + "\n\n### 追記_v367\n編集画面から保存したテスト本文。";
  // 独立レビューM-1: 実データ(personal-data/taskchute/content/Vision.md)はCRLF改行のため、
  // 無編集保存で全行LF化する差分ノイズが出ないことを検証する専用fixture。
  const CRLF_VISION_MD = VISION_MD.replace(/\n/g, "\r\n");
  // 独立レビューH-1: 実データのVision.mdは425行(18,079 bytes)相当。同規模のfixtureで
  // textareaが40vh固定の箱にならず本文量に合わせて伸長することを検証する。
  const LARGE_LINE_COUNT = 425;
  const LARGE_VISION_MD = ["# 本文量_v367"]
    .concat(Array.from({ length: LARGE_LINE_COUNT - 1 }, (_, i) => `行${i + 1}_ダミー本文_v367`))
    .join("\n");

  // visionMode: GET(読取)の挙動 / saveMode: PUT(保存)の挙動 / visionBody: 200成功時に返す本文
  let visionMode = "success";  // "success" | "fail" | "unauthorized"
  let saveMode = "success";    // "success" | "fail"
  let visionBody = VISION_MD;
  const putCalls = [];
  let heldPut = null;
  let onHeldPut = null;
  let remoteState = null;

  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const req = route.request();
    const p = decodeURIComponent(new URL(req.url()).pathname);
    if (p.endsWith("/contents/taskchute/content/Vision.md")) {
      if (req.method() === "GET") {
        const accept = req.headers()["accept"] || "";
        if (accept.includes("raw+json")) {
          // fetchGitHubRawResult経由の読取(3状態)
          if (visionMode === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
          if (visionMode === "unauthorized") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
          return route.fulfill({ status: 200, contentType: "text/markdown", body: visionBody });
        }
        // pushFileToGitHub内のSHA取得(保存前の既存ファイル確認)
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: "sha-before-v367" }) });
      }
      if (req.method() === "PUT") {
        putCalls.push({ path: p, body: JSON.parse(req.postData() || "{}") });
        if (saveMode === "hold") { heldPut = route; onHeldPut(); return; }
        if (saveMode === "fail") {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "強制失敗_v367" }) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-after-v367" } }) });
      }
    }
    if (p.endsWith("/contents/taskchute/app-state.json") && req.method() === "GET" && remoteState) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        sha: "sha-remote-v367", encoding: "base64", content: Buffer.from(JSON.stringify(remoteState)).toString("base64")
      }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  // 発注仕様の確認: 「閲覧/編集開始/キャンセルはstate非書込」を本リポジトリ確立の
  // 「内容変更0回方式」(v320/v321/v361と同じsetItemフック)で検証する。
  await page.addInitScript(() => {
    window.__v367StorageWrites = [];
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) {
        window.__v367StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
      }
      return originalSetItem.call(this, key, value);
    };
  });
  const changedStateWrites = () => page.evaluate((key) =>
    (window.__v367StorageWrites || []).filter((entry) => entry.key === key && entry.changed).length, KEY);

  async function seed() {
    await page.evaluate(({ KEY, view }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = view;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, view: "vision" });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
  }

  async function toast() {
    return (await page.locator("#toast").textContent()) || "";
  }
  async function rememberEditor() {
    await page.locator("[data-vision-edit-textarea]").evaluate((el) => {
      el.focus();
      el.setSelectionRange(2, 7, "backward");
      window.__v367Editor = el;
    });
  }
  async function checkEditor(label, expected) {
    const actual = await page.evaluate(() => {
      const el = document.querySelector("[data-vision-edit-textarea]");
      return { same: el === window.__v367Editor, focus: document.activeElement === el,
        start: el?.selectionStart, end: el?.selectionEnd, direction: el?.selectionDirection, value: el?.value };
    });
    check(`${label}: DOM同一性`, actual.same);
    check(`${label}: フォーカス`, actual.focus);
    check(`${label}: 選択範囲・方向`, actual.start === 2 && actual.end === 7 && actual.direction === "backward", JSON.stringify(actual));
    check(`${label}: 入力内容`, actual.value === expected, actual.value);
  }
  async function changedHydrate(body, time) {
    await page.waitForFunction(() => !window.__v367Probe().hydrating);
    check("hydrate前に延期が残っていない", !(await page.evaluate(() => window.__v367Probe().pending)));
    visionBody = body;
    await page.clock.setFixedTime(time);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction((body) => {
      const p = window.__v367Probe();
      return p.cached === body && p.pending && p.since > 0 && !p.hydrating;
    }, body);
    check("changed=trueのhydrate完了・延期登録を観測", true);
  }

  try {
    await page.clock.install({ time: fixedTime(12, 0) });
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.clock.setFixedTime(fixedTime(12, 0, 0));

    // ============================================================
    console.log("[1] 接続済み・取得成功: 編集ボタン→textarea(16px・全文)→保存でPUTが1回(パス=取得元・本文=編集後・sha付き)→読む画面へ戻り本文更新+トースト");
    // ============================================================
    visionMode = "success";
    saveMode = "success";
    await seed();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("接続済み・取得成功では「この画面で編集」ボタンが出る",
      await page.locator('[data-action="vision-edit-open"]').count() === 1);

    await page.evaluate(() => { window.__v367StorageWrites = []; });
    await page.click('[data-action="vision-edit-open"]');
    const textarea = page.locator("[data-vision-edit-textarea]");
    await textarea.waitFor({ state: "attached" });
    check("編集ボタンで読む画面が消えtextareaに切り替わる", await page.locator(".vision-read").count() === 0);
    const initialValue = await textarea.inputValue();
    check("textareaの初期値がVision.md全文と一致する", initialValue === VISION_MD, initialValue);
    const taFontSize = await textarea.evaluate((el) => getComputedStyle(el).fontSize);
    check("textareaのcomputed font-sizeが16px", taFontSize === "16px", taFontSize);
    check("保存・キャンセルのタッチ領域が44px以上", await page.locator(".vision-edit-bar button").evaluateAll((buttons) =>
      buttons.every((el) => el.getBoundingClientRect().height >= 44 && el.getBoundingClientRect().width >= 44)));
    check("編集開始まではstate非書込(内容変更0回方式)", await changedStateWrites() === 0);

    await textarea.fill(EDITED_MD);
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="vision-edit-save"]');
    await page.waitForFunction(() => document.querySelector(".vision-read .md-render") !== null);
    check("保存でPUTが1回呼ばれる", putCalls.length === 1, String(putCalls.length));
    check("PUT先のパスが取得元と同じ(taskchute/content/Vision.md)",
      putCalls[0]?.path === "/repos/kojit1229/personal-data/contents/taskchute/content/Vision.md", JSON.stringify(putCalls[0]));
    const putBody = putCalls[0]?.body || {};
    check("PUT本文(base64)が編集後のテキストと一致する",
      Buffer.from(putBody.content || "", "base64").toString("utf8") === EDITED_MD);
    check("PUTにsha(既存ファイルの上書き)が付く", putBody.sha === "sha-before-v367", JSON.stringify(putBody));
    check("保存成功で読む画面に戻る(textareaが消える)", await page.locator("[data-vision-edit-textarea]").count() === 0);
    check("読む画面の本文が保存後の内容に更新される",
      (await page.locator(".vision-read .md-render").innerText()).includes("追記_v367"));
    check("保存成功トーストは「保存しました」", (await toast()).includes("保存しました"), await toast());

    // ============================================================
    console.log("[2] 保存失敗(PUT 500): トースト+textareaと編集内容が残る");
    // ============================================================
    putCalls.length = 0;
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    await textarea.fill("失敗するはずの編集内容_v367");
    saveMode = "fail";
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="vision-edit-save"]');
    await page.waitForFunction(() => (document.querySelector("#toast")?.textContent || "").includes("失敗"));
    check("保存失敗でPUTは1回呼ばれる(失敗もリクエスト自体は行う)", putCalls.length === 1, String(putCalls.length));
    check("保存失敗トーストが失敗を示す", (await toast()).includes("失敗"), await toast());
    check("保存失敗トーストは成功文言(保存しました)を主張しない", !(await toast()).includes("保存しました"), await toast());
    check("保存失敗後もtextareaのまま(読む画面に戻らない)", await page.locator("[data-vision-edit-textarea]").count() === 1);
    check("保存失敗後もtextareaの編集内容が残る",
      await textarea.inputValue() === "失敗するはずの編集内容_v367", await textarea.inputValue());

    // ============================================================
    console.log("[3] キャンセル: 破棄・本文不変・PUT 0回");
    // ============================================================
    saveMode = "success";
    putCalls.length = 0;
    await textarea.fill("キャンセルされるはずの編集内容_v367");
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });
    check("キャンセルでtextareaが消え読む画面に戻る", await page.locator("[data-vision-edit-textarea]").count() === 0);
    check("キャンセルでPUTは0回", putCalls.length === 0, String(putCalls.length));
    check("キャンセルで本文は([1]で保存した内容のまま)変わらない",
      (await page.locator(".vision-read .md-render").innerText()).includes("追記_v367")
      && !(await page.locator(".vision-read .md-render").innerText()).includes("キャンセルされるはずの編集内容"));

    console.log("[3b] PUT応答保留中の追記・キャンセル・二重保存");
    for (const outcome of ["success", "fail", "cancel-fail", "reopen-success", "reopen-fail"]) {
      await page.click('[data-action="vision-edit-open"]');
      await textarea.fill(`送信本文_${outcome}`);
      saveMode = "hold";
      const before = putCalls.length;
      const held = new Promise((resolve) => { onHeldPut = resolve; });
      page.once("dialog", (d) => d.accept());
      await page.click('[data-action="vision-edit-save"]');
      await held;
      check(`${outcome}: 保存ボタン無効`, await page.locator('[data-action="vision-edit-save"]').isDisabled());
      // disabledを迂回したイベントでもハンドラ自身が二重送信を防ぐ。
      let duplicateDialogs = 0;
      const dismissDuplicate = (d) => { duplicateDialogs++; return d.dismiss(); };
      page.on("dialog", dismissDuplicate);
      await page.locator('[data-action="vision-edit-save"]').dispatchEvent("click");
      page.off("dialog", dismissDuplicate);
      check(`${outcome}: 二重確認・二重PUTなし`, duplicateDialogs === 0 && putCalls.length === before + 1);
      const appended = `送信本文_${outcome}\n応答待ち中の追記`;
      await textarea.fill(appended);
      await rememberEditor();
      if (outcome.includes("cancel") || outcome.startsWith("reopen")) {
        await page.click('[data-action="vision-edit-cancel"]');
        if (outcome.startsWith("reopen")) {
          await page.click('[data-action="vision-edit-open"]');
          await textarea.fill(appended);
          await rememberEditor();
          check(`${outcome}: 再編集も送信完了まで保存無効`, await page.locator('[data-action="vision-edit-save"]').isDisabled());
        }
      }
      await page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
      const success = outcome.endsWith("success");
      await heldPut.fulfill({ status: success ? 200 : 500, contentType: "application/json",
        body: JSON.stringify(success ? { content: { sha: "held-sha" } } : { message: "保留後失敗_v367" }) });
      await page.waitForFunction(() => /保存しました|保存に失敗/.test(document.querySelector("#toast").textContent));
      check(`${outcome}: PUTは送信時本文のみ`, Buffer.from(putCalls[before].body.content, "base64").toString("utf8") === `送信本文_${outcome}`);
      if (outcome === "cancel-fail") {
        check("キャンセル後の失敗応答で編集を復活させない", await textarea.count() === 0);
      } else {
        await checkEditor(outcome, appended);
        check(`${outcome}: 応答後は再保存可能`, await page.locator('[data-action="vision-edit-save"]').isEnabled());
        await page.click('[data-action="vision-edit-cancel"]');
      }
      if (success) check(`${outcome}: 送信した本文は保存済み`, (await page.locator(".vision-read .md-render").innerText()).includes(`送信本文_${outcome}`));
      check(`${outcome}: 例外なし`, pageErrors.length === 0, JSON.stringify(pageErrors));
    }
    saveMode = "success";

    // ============================================================
    console.log("[4] トークン無し/401では編集ボタンなし+接続が必要な旨の1行、取得失敗(500)中もボタンなし");
    // ============================================================
    visionMode = "unauthorized";
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.trim().length > 0;
    });
    check("401(未接続)では編集ボタンが出ない", await page.locator('[data-action="vision-edit-open"]').count() === 0);
    check("401では接続が必要な旨の1行が出る(個人データ未接続)",
      (await page.locator(".vision-status").textContent() || "").includes("個人データ未接続"));

    visionMode = "fail";
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.includes("取得できませんでした");
    });
    check("取得失敗(500、前回本文なし)でも編集ボタンは出ない",
      await page.locator('[data-action="vision-edit-open"]').count() === 0);

    // 前回本文ありのまま取得だけ失敗する「時点(古い)」状態でも編集ボタンが出ないこと・
    // 理由1行が添えられることを確認する(古い本文の上書き防止)。
    visionMode = "success";
    await page.reload();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    visionMode = "fail";
    await page.click('.vision-actions [data-action="reload-md"]');
    await page.waitForSelector(".vision-stale-badge", { state: "attached" });
    check("「時点(古い)」表示中は編集ボタンが出ない(古い本文の上書き防止)",
      await page.locator('[data-action="vision-edit-open"]').count() === 0);
    check("「時点(古い)」表示中は編集できない理由の1行が出る",
      await page.locator(".vision-edit-blocked").count() === 1);

    // ============================================================
    console.log("[4b] M-3: トークン未設定(personalDataReady===false)でも編集ボタンへ到達しない");
    // ============================================================
    // 独立レビューM-3: 401/500だけでなく、トークンそのものが未設定の経路も検証する。
    // このアプリはrender()がpersonalDataReady()===falseの間、起動時セットアップゲート
    // (renderGate)だけを表示しビジョンタブ本体には一切到達しない設計(v361/v362レビューで
    // 既出の防御的分岐)。ゆえに「トークン未設定」は画面のどこにも編集ボタンが存在しないことを
    // ゲート画面自体で確認する形になる(401/500ケースの代替にはならない別経路であることの実証)。
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = "";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForSelector('[data-github-field="token"]', { state: "attached" });
    check("トークン未設定では起動時セットアップゲートが表示される(ビジョンタブへ到達しない)",
      await page.locator('[data-github-field="token"]').count() === 1);
    check("トークン未設定では画面のどこにも編集ボタンが存在しない",
      await page.locator('[data-action="vision-edit-open"]').count() === 0);
    // 後続セクションのためトークンを復元する(passGithubGateがreloadまで行う)。
    await passGithubGate(page);

    // ============================================================
    console.log("[5] 編集中にhydrate相当の再描画トリガ(visibilitychange経由)が来てもtextareaの値・フォーカスが残る");
    // ============================================================
    visionMode = "success";
    await page.reload();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    await textarea.click();
    await textarea.fill("編集中に消えてはいけない本文_v367");
    await rememberEditor();
    await changedHydrate(VISION_MD + "\n\n## hydrate新本文_v367", fixedTime(12, 5));
    await checkEditor("[5] changed hydrate", "編集中に消えてはいけない本文_v367");
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForFunction(() => !window.__v367Probe().pending);
    check("[5] キャンセル後に新着本文を表示", (await page.locator(".vision-read .md-render").innerText()).includes("hydrate新本文_v367"));

    console.log("[5b] リモートstate更新・コア一致経路の自動取込中も入力を保持");
    await page.click('[data-action="vision-edit-open"]');
    await textarea.fill("自動取込中も保持する下書き_v367");
    await rememberEditor();
    remoteState = await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      state.settings.autoSync = true;
      state.settings.lastPushedAt = "";
      state.dataModifiedAt = state.selectedDate + "T12:00:00";
      const remote = JSON.parse(JSON.stringify(state));
      remote.dataModifiedAt = state.selectedDate + "T12:06:00";
      remote.zeroThinking.entries.push({ id: "remote-v367", theme: "取込テスト", text: "remote-v367", date: state.selectedDate,
        createdAt: remote.dataModifiedAt, updatedAt: remote.dataModifiedAt });
      return remote;
    });
    // 実際のvisibilitychangeからrunAutoSyncPullを呼ぶ。hydrate本文は変更しない。
    await page.clock.setFixedTime(fixedTime(12, 7));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => (document.querySelector("#toast")?.textContent || "").includes("他端末の記録を取り込みました"));
    const pulled = await page.evaluate(async () => {
      const { state } = await import("./src/state/store.js");
      return { merged: state.zeroThinking.entries.some((e) => e.id === "remote-v367"),
        stamp: state.settings.lastPushedAt, pending: window.__v367Probe().pending };
    });
    check("[5b] リモート記録・進めたdataModifiedAtを採用", pulled.merged && pulled.stamp === remoteState.dataModifiedAt, JSON.stringify(pulled));
    check("[5b] 自動取込による延期登録を観測", pulled.pending);
    await checkEditor("[5b] コア一致の自動取込", "自動取込中も保持する下書き_v367");
    await page.evaluate(async () => { (await import("./src/state/store.js")).state.settings.autoSync = false; });
    remoteState = null;
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForFunction(() => !window.__v367Probe().pending);

    // ============================================================
    console.log("[6] 390/1280px横スクロールなし・pageerror0・閲覧/編集開始/キャンセルはstate非書込・new Date(\"なし・新規waitForTimeoutなし");
    // ============================================================
    async function hasHorizontalOverflow() {
      return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    }
    await page.evaluate(() => { window.__v367StorageWrites = []; });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 390);
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("390pxで横スクロールしない(読む画面)", !(await hasHorizontalOverflow()));
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    check("390pxで横スクロールしない(編集画面)", !(await hasHorizontalOverflow()));
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("1280pxで横スクロールしない(読む画面)", !(await hasHorizontalOverflow()));
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    check("1280pxで横スクロールしない(編集画面)", !(await hasHorizontalOverflow()));

    check("閲覧・編集開始・キャンセルまでの一連操作はstateへ内容変更書込が0回(内容変更0回方式)",
      await changedStateWrites() === 0, JSON.stringify(await page.evaluate(() => window.__v367StorageWrites)));
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });

    await page.setViewportSize({ width: 1100, height: 1200 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1100);

    // ============================================================
    console.log("[7] H-1: 425行規模の本文でtextareaが本文量に合わせて自動伸長する(40vh固定の箱にならない)");
    // ============================================================
    visionMode = "success";
    visionBody = LARGE_VISION_MD;
    await page.reload();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    const grownBox = await textarea.evaluate((el) => ({
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, cssMinHeightPx: window.innerHeight * 0.4
    }));
    check("425行fixtureでtextareaの高さが40vh固定ではなく本文量ぶん伸びている(scrollHeightがmin-height=40vhより十分大きい)",
      grownBox.scrollHeight > grownBox.cssMinHeightPx * 1.5, JSON.stringify(grownBox));
    check("自動伸長後はscrollHeightとclientHeightが一致する(内部スクロールバーが残っていない)",
      Math.abs(grownBox.scrollHeight - grownBox.clientHeight) <= 1, JSON.stringify(grownBox));
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });
    visionBody = VISION_MD;

    // ============================================================
    console.log("[8] M-1: 元本文がCRLFなら無編集保存でも改行コードを保ったままPUTする(差分ゼロ)");
    // ============================================================
    visionMode = "success";
    visionBody = CRLF_VISION_MD;
    putCalls.length = 0;
    await page.reload();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    // HTMLTextAreaElement.valueの仕様上、ここで読める値はCRLFがLFへ正規化された文字列になる。
    const taValueLf = await textarea.inputValue();
    check("textarea.valueはブラウザ仕様どおりLFへ正規化されて見える(CRLFがそのまま残るわけではない)",
      !taValueLf.includes("\r") && taValueLf === VISION_MD, JSON.stringify(taValueLf));
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="vision-edit-save"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });
    check("無編集保存でもPUTは1回", putCalls.length === 1, String(putCalls.length));
    const crlfPutText = Buffer.from(putCalls[0]?.body?.content || "", "base64").toString("utf8");
    check("無編集保存のPUT本文が元のCRLF本文とバイト単位で完全一致する(改行コードを保持・差分ゼロ)",
      crlfPutText === CRLF_VISION_MD, JSON.stringify({ crlfPutText, CRLF_VISION_MD }));
    visionBody = VISION_MD;

    // ============================================================
    console.log("[9] M-2: 60秒フェイルセーフのrenderは、textareaへフォーカス中は強制flushせず延期を継続する");
    // ============================================================
    visionMode = "success";
    visionBody = VISION_MD;
    await page.reload();
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    await page.click('[data-action="vision-edit-open"]');
    await textarea.waitFor({ state: "attached" });
    await textarea.click();
    await textarea.fill("60秒フェイルセーフでも消えてはいけない本文_v367");
    await rememberEditor();
    await changedHydrate(VISION_MD + "\n\n### 新着_failsafe_v367\n", fixedTime(12, 10));
    await checkEditor("[9] 延期登録直後", "60秒フェイルセーフでも消えてはいけない本文_v367");
    // 時計はgoto前に導入済み。延期登録時刻を観測した後で61秒を進める。
    const pendingSince = await page.evaluate(() => window.__v367Probe().since);
    await page.clock.pauseAt(fixedTime(12, 10));
    // setFixedTimeのDate固定を解除し、仮想タイマーとDate.nowを一緒に進める。
    await page.clock.setSystemTime(fixedTime(12, 10));
    await page.clock.fastForward(61 * 1000);
    check("[9] 延期登録から61秒経過", await page.evaluate((since) => Date.now() - since >= 61000, pendingSince));
    await checkEditor("[9] 61秒後", "60秒フェイルセーフでも消えてはいけない本文_v367");
    await page.click('[data-action="vision-edit-cancel"]');
    await page.waitForSelector(".vision-read .md-render", { state: "attached" });

    check("pageerror 0件", pageErrors.length === 0, JSON.stringify(pageErrors));
    const stripLineComments = (src) => src.split("\n").map((line) => line.replace(/\/\/.*/, "")).join("\n");
    const appSource = stripLineComments(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
    check('app.jsに new Date("文字列") 形の禁止パターンが無い(コード部分のみ)', !/new Date\(\s*["'`]/.test(appSource));
    const selfSource = fs.readFileSync(__filename, "utf8");
    check("v367.test.js自体に新規waitForTimeout呼び出しを追加していない", !/\.waitForTimeout\(/.test(selfSource));

    console.log(failures === 0 ? "\n✅ v367 ALL PASS" : `\n❌ v367: ${failures} 件失敗`);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
