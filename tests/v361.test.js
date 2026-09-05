// tests/v361.test.js — ビジョンタブ(1)(2)(3): 読む画面主役・ALIGNMENT事実表示・3状態。
// 発注文 workbench/out/2026-09-02-tc-life-platform/order-v361-vision.md どおり、
// 「この画面で編集」(4)は実行コード差分200行予算のため本バージョンでは未実装(app.js側に
// その旨のコメントを残している)。ここでは(1)本文16px/1.85/68ch・見出し階層、
// (2)ALIGNMENTの事実表示(%なし)、(3)3状態(読み込み中/取得失敗/時点(古い))、
// (5)390/1280横スクロールなし・pageerror0・閲覧はstate非書込・new Date("なし、を検証する。
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

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(12, 0, 0, 0);
  const dateISOof = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const TODAY = dateISOof(now0);
  const daysAgoISO = (n) => dateISOof(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - n));
  const atOn = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;
  const fixedTime = (h, m, s = 0) => new Date(now0.getFullYear(), now0.getMonth(), now0.getDate(), h, m, s, 0);

  const block = (id, dateISO, extra = {}) => ({
    id, taskId: "", date: dateISO, title: id, category: "",
    plannedStartAt: "", plannedEndAt: "", actualStartAt: "", actualEndAt: "",
    completed: false, charge: 0, discharge: 0, estimateMin: 30,
    recurrenceGroupId: "", orderIndex: 0, migratedTo: "", deleted: false,
    createdAt: atOn(dateISO, "00:00"), updatedAt: atOn(dateISO, "00:00"), ...extra
  });

  // fixture: 直結カテゴリ=開発。今日=2件・合計90分(30分+60分)。過去6日は各1件30分ずつ。
  // 手計算: 今日の直結時間=90分=1h30m。直結Block数=2件。7日平均=(90+30*6)/7=270/7≈38.57分
  //   → 四捨五入39分 → 0h39m/日。
  const visionBlocks = [
    block("d-today-1", TODAY, { category: "開発", completed: true, actualStartAt: atOn(TODAY, "09:00"), actualEndAt: atOn(TODAY, "09:30"), estimateMin: 30 }),
    block("d-today-2", TODAY, { category: "開発", completed: true, actualStartAt: atOn(TODAY, "10:00"), actualEndAt: atOn(TODAY, "11:00"), estimateMin: 60 }),
    // 直結カテゴリ外(除外されることの確認用)
    block("d-today-other", TODAY, { category: "回復", completed: true, actualStartAt: atOn(TODAY, "13:00"), actualEndAt: atOn(TODAY, "13:40"), estimateMin: 40 }),
    ...[1, 2, 3, 4, 5, 6].map((n) => block(`d-past-${n}`, daysAgoISO(n), {
      category: "開発", completed: true, actualStartAt: atOn(daysAgoISO(n), "09:00"), actualEndAt: atOn(daysAgoISO(n), "09:30"), estimateMin: 30
    }))
  ];

  const VISION_MD = "# 10年後\n家族と健康を土台に生きる。\n\n## 今年(2026)\nTaskChute Journalを育てる。\n\n### 決めた一つ\n必ずやり切る。";

  let visionMode = "success";  // "success" | "fail" | "hold" | "unauthorized" | "empty"
  const heldRoutes = [];
  await page.route((url) => url.hostname === "api.github.com", (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p.endsWith("/contents/taskchute/content/Vision.md")) {
      if (visionMode === "hold") { heldRoutes.push(route); return; }
      if (visionMode === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      // v361-fix(B-H1): トークンにpersonal-data権限が無い(401)は、トークン未設定と同じ
      // 「未接続」扱いにする(監督裁定)。
      if (visionMode === "unauthorized") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      // v361-fix(M-2/B-M1): 200かつ本文が空文字(Vision.mdはあるが未記入)の状態。
      if (visionMode === "empty") return route.fulfill({ status: 200, contentType: "text/markdown", body: "" });
      return route.fulfill({ status: 200, contentType: "text/markdown", body: VISION_MD });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  // v361-fix(B-H2): 「閲覧はstate非書込」を、本リポジトリ確立の「内容変更0回方式」
  // (v320/v321と同じsetItemフック)で検証できるようにする。dataModifiedAtの前後比較だけでは
  // dataModifiedAtを更新しない書込を見逃す(独立レビューH2)。
  await page.addInitScript(() => {
    window.__v361StorageWrites = [];
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) {
        window.__v361StorageWrites.push({ key: String(key), changed: this.getItem(key) !== String(value) });
      }
      return originalSetItem.call(this, key, value);
    };
  });
  const changedStateWrites = () => page.evaluate((key) =>
    (window.__v361StorageWrites || []).filter((entry) => entry.key === key && entry.changed).length, KEY);

  async function seed({ blocks = [], view = "vision", visionDirectCats = ["開発"] } = {}) {
    await page.evaluate(({ KEY, blocks, view, visionDirectCats, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      s.currentView = view;
      s.selectedDate = TODAY;
      s.settings.visionDirectCategories = visionDirectCats;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, blocks, view, visionDirectCats, TODAY });
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
  }

  async function panelText(selector) {
    return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, selector);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await page.clock.setFixedTime(fixedTime(12, 0, 0));

    // ============================================================
    console.log("[1] 読む画面: 本文16px/行間1.85/68ch(CSS)・見出し階層(h1/h2/h3)が保たれる");
    // ============================================================
    visionMode = "success";
    await seed({ blocks: visionBlocks });
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    const cssSource = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
    check("styles.cssに.vision-read .md-renderのfont-size(16px=var(--text-md))指定がある",
      /\.vision-read \.md-render\s*\{[^}]*font-size:\s*var\(--text-md\)/.test(cssSource));
    check("styles.cssに.vision-read .md-renderのline-height:1.85指定がある",
      /\.vision-read \.md-render\s*\{[^}]*line-height:\s*1\.85/.test(cssSource));
    check("styles.cssに.vision-read .md-renderのmax-width:68ch指定がある",
      /\.vision-read \.md-render\s*\{[^}]*max-width:\s*68ch/.test(cssSource));
    const computedFontSize = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".vision-read .md-render")).fontSize);
    check("実際のcomputed font-sizeが16px", computedFontSize === "16px", computedFontSize);
    const headingTags = await page.evaluate(() =>
      [...document.querySelectorAll(".vision-read .md-render h1, .vision-read .md-render h2, .vision-read .md-render h3")]
        .map((el) => el.tagName));
    check("見出し階層(h1→h2→h3)がVision.mdの#/##/###どおりに保たれる",
      JSON.stringify(headingTags) === JSON.stringify(["H1", "H2", "H3"]), JSON.stringify(headingTags));

    // ============================================================
    console.log("[2] ALIGNMENT: fixture(直結Block2件・合計90分・7日分)から計算した事実値と一致・%を含まない");
    // ============================================================
    const alignmentText = await panelText(".vision-alignment");
    check("ALIGNMENTに%を一切含まない", !/[0-9]\s*%/.test(alignmentText || ""), alignmentText);
    const todayTime = await panelText('[data-vision-metric="today"]');
    const blockCount = await panelText('[data-vision-metric="blocks"]');
    const avg7d = await panelText('[data-vision-metric="avg7d"]');
    check("今日の直結時間が手計算と一致(開発90分=1h30m。回復40分は含まない)", todayTime === "1h30m", todayTime);
    check("直結Block件数が手計算と一致(今日の開発Block2件 / 当日の実績Block総数3件。M-3: モックどおり分母つき)",
      blockCount === "2 / 3", blockCount);
    check("7日平均が手計算と一致((90+30*6)/7≈38.57分→四捨五入39分=0h39m)", avg7d === "0h39m/日", avg7d);
    console.log("[2-M4] ALIGNMENTに「直結カテゴリを変える ›」導線が常設される(直結カテゴリ設定済み時)");
    check("直結カテゴリ設定済みでも変更導線(vision-open-direct-settings)が出る",
      await page.locator('.vision-alignment [data-action="vision-open-direct-settings"]').count() === 1);

    // ============================================================
    console.log("[2b] H-1: 過去日の止め忘れBlock(actualEndAtなし)は7日平均の集計から除外される");
    // ============================================================
    // 3日前に「開始したが止め忘れた」開発Blockを1本混ぜる。旧実装(statsTimeLogDataをそのまま
    // 7日ぶん積む)だと過去日はnowMs(=常に翌日以降)で終端を打ち切れず24:00に張り付き、
    // その1本だけで約15時間(3日前09:00〜24:00)を追加してしまう。修正後は当日以外の
    // actualEndAtなしBlockを除外するため、[2]と同じ0h39m/日のままであるはず。
    const forgottenDate = daysAgoISO(3);
    const forgottenBlock = block("d-forgot-3", forgottenDate, {
      category: "開発", completed: false, actualStartAt: atOn(forgottenDate, "09:00"), actualEndAt: "", estimateMin: 30
    });
    await seed({ blocks: [...visionBlocks, forgottenBlock] });
    const avg7dAfterForgot = await panelText('[data-vision-metric="avg7d"]');
    check("3日前の止め忘れBlockを混ぜても7日平均は変わらない(24:00張り付き除外。H-1)",
      avg7dAfterForgot === "0h39m/日", avg7dAfterForgot);

    // ============================================================
    console.log("[3] 3状態: 読み込み中→成功、取得失敗(最終試行HH:MM)、時点(古い)バッジ");
    // ============================================================
    // [3a] 読み込み中: レスポンスを保留した状態でreloadし、DOM文言を確認してから解放する。
    visionMode = "hold";
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.includes("読み込んでいます");
    });
    check("読み込み中は「読み込んでいます」を表示する", true);
    for (const r of heldRoutes.splice(0)) {
      await r.fulfill({ status: 200, contentType: "text/markdown", body: VISION_MD });
    }
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("解放後は本文が表示される(固定表示のまま固まらない)",
      (await panelText(".vision-read .md-render")).includes("10年後"));

    // [3b] 取得失敗(前回本文なし): fixedTimeで最終試行時刻を固定し、HH:MM表示を検証する。
    visionMode = "fail";
    await page.clock.setFixedTime(fixedTime(6, 12, 0));
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.includes("取得できませんでした");
    });
    const failText = await panelText(".vision-status");
    check("取得失敗は「取得できませんでした(最終試行 06:12)」を表示する",
      (failText || "").includes("取得できませんでした") && (failText || "").includes("06:12"), failText);
    check("取得失敗時に再試行ボタンが出る", await page.locator('.vision-status [data-action="reload-md"]').count() === 1);

    // [3c] 時点(古い): 先に成功させて本文をキャッシュした後、再取得だけ失敗させても前回本文が残る。
    visionMode = "success";
    await page.clock.setFixedTime(fixedTime(9, 0, 0));
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    visionMode = "fail";
    await page.clock.setFixedTime(fixedTime(9, 30, 0));
    await page.click('.vision-actions [data-action="reload-md"]');
    await page.waitForFunction(() => {
      const badge = document.querySelector(".vision-stale-badge");
      return !!badge && badge.textContent.includes("09:30");
    });
    check("取得失敗でも前回本文が残る(空白落ちしない)",
      (await panelText(".vision-read .md-render")).includes("10年後"));
    check("「時点(古い)」バッジに最終試行時刻(09:30)が出る",
      (await panelText(".vision-stale-badge") || "").includes("09:30時点(古い)"));
    // v361-fix(M-5): 取得失敗なのに「最新を読み込みました」という成功トーストを出していた
    // (独立レビューM-5)。失敗を告げる文言に変わっている・成功文言ではないことを確認する。
    const toastAfterFailedReload = (await page.locator("#toast").textContent()) || "";
    check("再試行が失敗したときのトーストは成功文言(最新を読み込みました)を主張しない",
      !toastAfterFailedReload.includes("最新を読み込みました"), toastAfterFailedReload);
    check("再試行が失敗したときのトーストは失敗を示す文言になる",
      toastAfterFailedReload.includes("失敗"), toastAfterFailedReload);

    // ============================================================
    console.log("[3d] B-H1: 401(トークンにpersonal-data権限が無い)は未接続(トークン無しと同じ扱い)");
    // ============================================================
    visionMode = "unauthorized";
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.includes("個人データ未接続");
    });
    const unauthorizedText = await panelText(".vision-status");
    check("401はトークン未設定時と同じ「個人データ未接続」文言になる(取得できませんでしたにはならない)",
      (unauthorizedText || "").includes("個人データ未接続") && !(unauthorizedText || "").includes("取得できませんでした"),
      unauthorizedText);

    // ============================================================
    console.log("[3e] M-2/B-M1: 200かつ本文が空文字なら誘導1行(催促文言なし)。白紙パネルにならない");
    // ============================================================
    visionMode = "empty";
    await page.reload();
    await page.waitForSelector('#app[data-view="vision"]', { state: "attached" });
    await page.waitForFunction(() => {
      const el = document.querySelector(".vision-status");
      return !!el && el.textContent.trim().length > 0;
    });
    const emptyBodyText = (await panelText(".vision-status")) || "";
    check("本文が空文字のとき誘導1行が出る(白紙パネルにならない)", emptyBodyText.trim().length > 0, emptyBodyText);
    check("誘導1行に催促文言(書いてください等)を含まない", !/書いて|入力してください|してください/.test(emptyBodyText), emptyBodyText);
    check("本文が空文字のときmd-renderは描かれない(白紙パネル退行がない)",
      await page.locator(".vision-read .md-render").count() === 0);

    // ============================================================
    console.log("[5] 390/1280/1920pxで横スクロールなし・pageerror0・閲覧はstate非書込・new Date(\"文字列\")なし");
    // ============================================================
    visionMode = "success";
    await page.clock.setFixedTime(fixedTime(12, 0, 0));
    await seed({ blocks: visionBlocks });
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    // v320/v321と同じ運用: 起動時(normalizeState migration等による初回persist)の書込は
    // 「閲覧」の対象外のためカウンタをここでリセットし、以降の表示・幅切替・再描画だけを計測する
    // (B-H2: 「内容変更0回方式」)。
    await page.evaluate(() => { window.__v361StorageWrites = []; });
    async function hasHorizontalOverflow() {
      return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 390);
    // v361-fix(B-M3): 本文(.vision-read .md-render h1)のhydrate完了を待たずに測ると
    // 「読み込んでいます」1行の状態で通ってしまい検出力が落ちる(独立レビューM3)。
    // 1280px側と同じく描画完了を待ってから横スクロールを検査する。
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("390pxで横スクロールしない(本文描画後)", !(await hasHorizontalOverflow()));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("1280pxで横スクロールしない", !(await hasHorizontalOverflow()));
    const leftBox1280 = await page.locator(".vision-two-pane .exec-pane-left").boundingBox();
    const rightBox1280 = await page.locator(".vision-two-pane .exec-pane-right").boundingBox();
    // v361-fix(M-1/B-M4): exec-two-pane再利用(左=固定〜600px上限・右=可変)だとPCの広い幅で
    // 逆転する(独立レビューM-1/B-M4)。専用grid(vision-two-pane、左=1fr・右=320〜360px固定)に
    // 差し替えたので、幅の大小まで検査する(x座標の前後関係だけでは検出できなかった)。
    check("1280pxでは左(本文)が右(ALIGNMENT)より広い(読む画面が主役)",
      !!leftBox1280 && !!rightBox1280 && leftBox1280.width > rightBox1280.width,
      JSON.stringify({ leftBox1280, rightBox1280 }));
    check("1280pxで右(ALIGNMENT)は320〜360px程度の固定幅(モックの狭い右ペインに合わせる)",
      !!rightBox1280 && rightBox1280.width >= 300 && rightBox1280.width <= 380, JSON.stringify(rightBox1280));

    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1920);
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    check("1920pxで横スクロールしない", !(await hasHorizontalOverflow()));
    const leftBox1920 = await page.locator(".vision-two-pane .exec-pane-left").boundingBox();
    const rightBox1920 = await page.locator(".vision-two-pane .exec-pane-right").boundingBox();
    check("1920pxでも左(本文)が右(ALIGNMENT)より広いまま(exec-two-pane再利用だと逆転していた幅)",
      !!leftBox1920 && !!rightBox1920 && leftBox1920.width > rightBox1920.width,
      JSON.stringify({ leftBox1920, rightBox1920 }));
    check("1920pxでも右(ALIGNMENT)は320〜360px程度の固定幅のまま間延びしない",
      !!rightBox1920 && rightBox1920.width >= 300 && rightBox1920.width <= 380, JSON.stringify(rightBox1920));

    // v361-fix(B-H2): 純粋な閲覧(初期表示・PC幅切替・再描画)ではstateへ内容変更書込が
    // 0回であることを、本リポジトリ確立の「内容変更0回方式」(v320/v321と同じsetItemフック)で
    // 検証する。dataModifiedAtの前後比較だけでは、dataModifiedAtを更新しない書込を
    // 見逃す(独立レビューH2)。
    check("表示・390/1280/1920pxの幅切替・再描画ではstateへ内容変更書込が0回(内容変更0回方式)",
      await changedStateWrites() === 0, JSON.stringify(await page.evaluate(() => window.__v361StorageWrites)));

    // セグメント切替(ビジョン⇔アファメーション)は永続する既存挙動(setVisionSectionが
    // persistLocalNoSchedule()でsettings.visionSectionを書き込む)であり、上記「閲覧は非書込」
    // の対象外(B-H2裁定どおり)。ここでは同期の鮮度に使うdataModifiedAtまでは
    // 巻き込まない(=同期を汚さないローカル限定の保存である)ことだけを確認する。
    const stateAfter = await page.evaluate((KEY) => localStorage.getItem(KEY), KEY);
    const dataModifiedAtBefore = JSON.parse(stateAfter).dataModifiedAt;
    await page.click('[data-action="vision-section"][data-section="affirmation"]');
    await page.waitForSelector(".vision-status, .vision-read", { state: "attached" });
    await page.click('[data-action="vision-section"][data-section="vision"]');
    await page.waitForSelector(".vision-read .md-render h1", { state: "attached" });
    const stateAfter2 = JSON.parse(await page.evaluate((KEY) => localStorage.getItem(KEY), KEY));
    check("セグメント切替(永続する既存挙動・非対象)はdataModifiedAtを更新しない(同期を汚さない)",
      stateAfter2.dataModifiedAt === dataModifiedAtBefore, JSON.stringify({ before: dataModifiedAtBefore, after: stateAfter2.dataModifiedAt }));

    check("pageerror 0件", pageErrors.length === 0, JSON.stringify(pageErrors));
    const stripLineComments = (src) => src.split("\n").map((line) => line.replace(/\/\/.*/, "")).join("\n");
    const appSource = stripLineComments(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
    check('app.jsに new Date("文字列") 形の禁止パターンが無い(コード部分のみ)', !/new Date\(\s*["'`]/.test(appSource));
    const selfSource = fs.readFileSync(__filename, "utf8");
    check("v361.test.js自体に新規waitForTimeout呼び出しを追加していない",
      !/\.waitForTimeout\(/.test(selfSource));

    console.log(failures === 0 ? "\n✅ v361 ALL PASS" : `\n❌ v361: ${failures} 件失敗`);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
