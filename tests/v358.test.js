// v358: 設定タブ(A) — 一覧型ラッパー+最上段「接続と保存」。
// renderSettingsを、群ごとに行を並べ行の右へ「いまの値」を常時表示する一覧型へ組み替えた
// (トグルは行右のスイッチでその場で切替、数値・選択は行タップで既存パネルを下に展開=1つだけ
// 開く・非永続)。最上段「接続と保存」に同期状態・最終保存/読込・自動保存/自動同期トグル・
// 手動保存/読込ボタンを常時表示し、リポジトリ・トークン等の既存フォームは「接続の詳細」
// (旧「データと同期」、data-settings-sync/_settingsSyncOpenOverrideを無改変で流用)へ折りたたむ。
// 保存・同期層/normalizeState/各設定値の意味・既定値・トークンの扱いは無改変(表示と配置だけ)。
// PC 2列(左=群一覧/右=詳細)は実行コード差分200行の予算内に収まらないためv359(A2)へ持ち越す。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, openSettingsGroup, STATE_KEY
} = require("./helpers");
const fs = require("fs");
const path = require("path");

const PORT = randomPort();

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

async function seed(page, values) {
  await page.evaluate(({ key, values }) => {
    const current = JSON.parse(localStorage.getItem(key));
    Object.assign(current.settings, values);
    localStorage.setItem(key, JSON.stringify(current));
  }, { key: STATE_KEY, values });
  await page.reload();
  await page.waitForSelector('[data-action="nav"]', { state: "attached" });
}

async function stateNow(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STATE_KEY);
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await blockGithubApiByDefault(page);

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);
    await seed(page, {
      dailyBufferMin: 60, dayCloseHours: 24,
      battery: { start: { deficit: 60, low: 80, normal: 100 }, decayPerHour: 5, decayStartMinutes: 420, max: 100 },
      theme: "dark", towerMotion: "normal",
      birthDate: "1990-01-01", twelveWeekStartDate: "2026-07-06", twelveWeekScoreTarget: 85,
      focusTimerAuto: true, pomoGuidedAccessHint: false, autoArchive: false, autoSync: false,
      github: { owner: "kojit1229", repo: "taskchute-ipad", branch: "main", path: "app-state.json",
        token: "test-token-v358", autoSave: false, lastSavedAt: "", dataOwner: "kojit1229", dataRepo: "personal-data" },
      lastPulledAt: ""
    });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForSelector(".settings-connect");

    // ============================================================
    console.log("[1] 最上段「接続と保存」: 同期状態・最終保存/読込・トグル・保存/読込ボタン");
    // ============================================================
    const connectText = await page.locator(".settings-connect").textContent();
    check("「接続と保存」見出しがある", connectText.includes("接続と保存"), connectText.slice(0, 60));
    check("同期状態(接続済み/未接続/失敗)が出る", /接続済み|未接続|異常あり/.test(connectText));
    check("最後の保存/読込の行がある", connectText.includes("最後の保存"));
    check("自動保存トグルがある", await page.locator('.settings-connect input[data-github-field="autoSave"]').count() === 1);
    check("自動同期トグルがある", await page.locator(".settings-connect input[data-setting-autosync]").count() === 1);
    check("いま保存ボタンがある", await page.locator('.settings-connect [data-action="save-github"]').count() === 1);
    check("いま読込ボタンがある", await page.locator('.settings-connect [data-action="load-github"]').count() === 1);
    // 接続の詳細(旧データと同期)の既定open/closed・同期異常時の自動open挙動はv148が専任で
    // 検証している(_settingsSyncOpenOverride/data-settings-syncを無改変で流用)ため、ここでは
    // クリックでtoggleできることだけを確認する。
    const syncDetail = page.locator("[data-settings-sync]");
    // v358修正(A-M3): 「データ」は接続の詳細の外に独立群として一覧に出ているはず。接続の詳細が
    // (同期異常時の自動openを含め)開いていても閉じていても、「データ」群の見出しと4行のラベルが
    // 独立して見えることを確認する(埋没していないことの実証。中身のボタンは他の行と同じく
    // 行タップで展開する設計のため、行ラベル自体の可視性を見る)。接続の詳細を明示的に閉じた
    // 状態を作ってから見るため、まず初期状態を退避する。
    const initialSyncOpen = await syncDetail.evaluate((el) => el.open);
    if (initialSyncOpen) {
      await syncDetail.locator("summary").click();
      await page.waitForFunction(() => document.querySelector("[data-settings-sync]")?.open === false);
    }
    // ".settings-group-flat"のhasTextはtextContent(閉じた展開行の非表示テキストも含む)で
    // マッチするため、隣の群にも「データ」を含む文字列(例: ファイル構成の「メインデータ」)が
    // 混ざると誤って別群を掴む。群見出しラベルの完全一致で特定する。
    const dataGroup = page.locator(".settings-group-flat:has(.settings-group-flat-label:text-is('データ'))").first();
    check("「データ」群は接続の詳細(closed)を開かなくても一覧に独立表示される(埋没していない)",
      await syncDetail.evaluate((el) => el.open) === false
      && await dataGroup.isVisible()
      && await dataGroup.locator("summary:has-text('書き出し')").first().isVisible()
      && await dataGroup.locator("summary:has-text('読み込み(JSON)')").first().isVisible()
      && await dataGroup.locator("label.settings-row-toggle:has-text('自動アーカイブ')").first().isVisible()
      && await dataGroup.locator("summary:has-text('デモデータに戻す')").first().isVisible());
    if (initialSyncOpen) {
      await syncDetail.locator("summary").click();
      await page.waitForFunction(() => document.querySelector("[data-settings-sync]")?.open === true);
    }

    const beforeOpen = await syncDetail.evaluate((el) => el.open);
    await syncDetail.locator("summary").click();
    await page.waitForFunction(
      (expected) => document.querySelector("[data-settings-sync]")?.open === expected, !beforeOpen
    );
    check("接続の詳細はクリックでtoggleできる", await syncDetail.evaluate((el) => el.open) === !beforeOpen);

    // ============================================================
    console.log("[2] 各群の行に「いまの値」が実値で出る(5項目以上、fixtureのsettingsと一致)");
    // ============================================================
    const rowsText = await page.locator(".settings-rows").allInnerTexts();
    const rowsJoined = rowsText.join("\n");
    check("バッファのいまの値(60分・24時)", rowsJoined.includes("60分") && rowsJoined.includes("24時"), rowsJoined.slice(0, 200));
    check("電池のいまの値(60/80/100・5/h・07:00)",
      rowsJoined.includes("60/80/100") && rowsJoined.includes("5/h") && rowsJoined.includes("07:00"));
    check("テーマのいまの値(ダーク・通常)", rowsJoined.includes("ダーク") && rowsJoined.includes("通常"));
    check("プロフィールのいまの値(生年月日・12WY開始日)",
      rowsJoined.includes("1990-01-01") && rowsJoined.includes("2026-07-06"));
    check("カテゴリのいまの値(件数)", /\d+件/.test(rowsJoined));

    // ============================================================
    console.log("[3] トグルはその場で切替・行タップで展開/1つだけ開く/開閉は非永続");
    // ============================================================
    const focusToggle = page.locator("[data-setting-focustimerauto]");
    check("フォーカスタイマー自動起動トグルの初期状態はON(fixture通り)", await focusToggle.isChecked());
    // v358修正(A-H1): トグル行は<label>で行全体を包んでいるはず(以前はinput本体24pxだけが
    // タップ対象で、行のmin-height:44pxは見た目だけだった)。行のboundingBoxが44px以上であること、
    // かつチェックボックス本体ではなくラベルのテキスト側をタップしても切り替わることを検証する。
    const focusRowLabel = page.locator("label.settings-row-toggle").filter({ has: focusToggle });
    const focusRowBox = await focusRowLabel.boundingBox();
    check("トグル行のタップ領域(<label>)は44px以上", !!focusRowBox && focusRowBox.height >= 44, JSON.stringify(focusRowBox));
    await focusRowLabel.locator(".settings-row-label").first().click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.focusTimerAuto === false, STATE_KEY);
    check("チェックボックス本体でなく行のラベル部分をタップしてもその場切替(保存経路が走る)",
      (await stateNow(page)).settings.focusTimerAuto === false);

    const FOLD_KEY = "taskchute-journal-home-fold-v1";
    // v358修正(A-H2/B-H1): 「開閉は非永続」の担保をfixture値の完全一致比較にする(以前は
    // 行ID(buffer/battery)という書かれ得ないキーの不在しか見ておらず、実際に書かれ得るキー
    // (legacyFoldId=settings-daily/settings-display)を検査していなかった)。行の開閉前後で
    // FOLD_KEYの生の値が一切変わらないことを比較し、実際に書かれうるキーの不在も明示する。
    const foldBefore = await page.evaluate((k) => localStorage.getItem(k), FOLD_KEY);

    const bufferRow = page.locator('[data-settings-row="buffer"]');
    const batteryRow = page.locator('[data-settings-row="battery"]');
    const themeRow = page.locator('[data-settings-row="theme"]');
    check("バッファ行は既定closed", await bufferRow.evaluate((el) => el.open) === false);
    await bufferRow.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('[data-settings-row="buffer"]')?.open === true);
    check("行タップで展開する", await bufferRow.evaluate((el) => el.open) === true);
    await page.fill('[data-setting-dailybuffermin]', "90");
    await page.locator("[data-setting-dailybuffermin]").dispatchEvent("change");
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.dailyBufferMin === 90, STATE_KEY);
    check("展開内で値を変えると反映される", (await stateNow(page)).settings.dailyBufferMin === 90);

    await batteryRow.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('[data-settings-row="battery"]')?.open === true);
    check("別行タップで前の行(バッファ)が閉じる", await bufferRow.evaluate((el) => el.open) === false);
    check("タップした行(電池)は開く(legacyFoldId=settings-dailyを持つ行)", await batteryRow.evaluate((el) => el.open) === true);

    // legacyFoldId=settings-displayを持つテーマ行も同様に開閉できることを確認(H2で問題視された
    // もう一方のキー)。
    await themeRow.locator("summary").click();
    await page.waitForFunction(() => document.querySelector('[data-settings-row="theme"]')?.open === true);
    check("タップした行(テーマ)も開く(legacyFoldId=settings-displayを持つ行)", await themeRow.evaluate((el) => el.open) === true);

    const foldAfter = await page.evaluate((k) => localStorage.getItem(k), FOLD_KEY);
    check("行の開閉(battery/theme含む)はFOLD_KEYの内容を一切変えない(非永続、fixture値の完全一致比較)",
      foldAfter === foldBefore, JSON.stringify({ foldBefore, foldAfter }));
    let foldAfterMap = {};
    try { foldAfterMap = JSON.parse(foldAfter || "{}"); } catch { /* noop */ }
    check("実際に書かれうるキー(settings-daily/settings-display)もFOLD_KEYに存在しない",
      foldAfterMap["settings-daily"] === undefined && foldAfterMap["settings-display"] === undefined, foldAfter);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForSelector(".settings-connect");
    check("reload後は行の開閉状態を引き継がない(非永続の実証)",
      await page.locator('[data-settings-row="battery"]').evaluate((el) => el.open) === false);

    // ============================================================
    console.log("[4] モックに無い既存設定は「その他」に残る・data-setting-*の総数が変わらない");
    // ============================================================
    const settingCount = await page.locator([
      "[data-setting-field]", "[data-setting-battery-field]", "[data-setting-autoarchive]",
      "[data-setting-autosync]", "[data-setting-focustimerauto]", "[data-setting-pomoguidedaccesshint]",
      "[data-setting-dailybuffermin]", "[data-setting-dayclosehours]", "[data-setting-scoretarget]"
    ].join(",")).count();
    check("data-setting-*の総数は17件のまま(静的pin。既存設定を1件も消していない)", settingCount === 17, String(settingCount));
    check("「現在のファイル構成」(モックに無い既存設定)は「その他」群に残っている",
      await page.locator("details:has-text('現在のファイル構成')").count() === 1);
    check("GitHub Pagesリンク(モックに無い既存設定)も消えていない",
      await page.locator("a:has-text('設計思想(CONCEPT)')").count() === 1);

    // ============================================================
    console.log("[5] GitHubトークン欄は既存UIのまま・入力中に文字が飛ばない");
    // ============================================================
    await openSettingsGroup(page, "settings-sync");
    const tokenInput = page.locator('[data-github-field="token"]');
    check("トークン欄は既存どおりtype=password", await tokenInput.getAttribute("type") === "password");
    await tokenInput.fill("");
    for (const ch of "abcXYZ123") {
      await tokenInput.type(ch, { delay: 10 });
    }
    check("1文字ずつ入力しても文字が飛ばない(全再描画で奪われない)", await tokenInput.inputValue() === "abcXYZ123");
    check("入力中もfocusが外れない", await page.evaluate(() => document.activeElement?.getAttribute("data-github-field")) === "token");

    // ============================================================
    console.log("[6] 移設したautoSave/autoSyncトグルと保存/読込ボタンの結線(実操作でpin)");
    // ============================================================
    // v358修正(B-M4): 存在確認だけでなく、実クリックでsettingsが変わること・
    // 既存action(save-github/load-github)が実際に発火してネットワーク要求まで届くことを見る。
    await page.route((url) => url.hostname === "api.github.com", (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-v358" } }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    const autoSaveToggle = page.locator('.settings-connect input[data-github-field="autoSave"]');
    check("自動保存トグルの初期値はfixture通りOFF", (await stateNow(page)).settings.github.autoSave === false);
    await autoSaveToggle.click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.github.autoSave === true, STATE_KEY);
    check("自動保存トグルの実クリックでsettings.github.autoSaveが変わる", (await stateNow(page)).settings.github.autoSave === true);

    const autoSyncToggle = page.locator(".settings-connect input[data-setting-autosync]");
    check("自動同期トグルの初期値はfixture通りOFF", (await stateNow(page)).settings.autoSync === false);
    await autoSyncToggle.click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.autoSync === true, STATE_KEY);
    check("自動同期トグルの実クリックでsettings.autoSyncが変わる", (await stateNow(page)).settings.autoSync === true);

    const [putResp] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/contents/")),
      page.locator('.settings-connect [data-action="save-github"]').click()
    ]);
    check("いま保存ボタンで既存action(save-github)が発火しPUTが飛ぶ", putResp.ok(), `status=${putResp.status()} ${putResp.url()}`);

    const [getResp] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes("/contents/")),
      page.locator('.settings-connect [data-action="load-github"]').click()
    ]);
    check("いま読込ボタンで既存action(load-github)が発火しGETが飛ぶ", getResp.status() === 404, `status=${getResp.status()} ${getResp.url()}`);

    // ============================================================
    console.log("[7] 390/768/1280pxで横スクロールなし・「接続と保存」は768/1280pxでも最上段フルバンド・pageerror 0・new Date(\" なし");
    // ============================================================
    async function hasHorizontalOverflow() {
      return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 390);
    check("390pxで横スクロールしない", !(await hasHorizontalOverflow()));

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 768);
    check("768pxで横スクロールしない", !(await hasHorizontalOverflow()));
    // v358修正(B-M9): 720px超では.settings-gridが2列になるため、grid-column指定がないと
    // 「接続と保存」がiPad幅でも2列の1セルに落ちてしまう(A2=PC2列はv359持ち越しだが、これは
    // A1の範囲内の1行修正)。
    const connectBox768 = await page.locator(".settings-connect").boundingBox();
    const gridBox768 = await page.locator(".settings-grid").boundingBox();
    check("768pxで「接続と保存」が最上段フルバンド(2列の1セルに落ちない)",
      !!connectBox768 && !!gridBox768 && connectBox768.width >= gridBox768.width * 0.9,
      JSON.stringify({ connectBox768, gridBox768 }));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    check("1280pxで横スクロールしない", !(await hasHorizontalOverflow()));
    const connectBox1280 = await page.locator(".settings-connect").boundingBox();
    const gridBox1280 = await page.locator(".settings-grid").boundingBox();
    check("1280pxでも「接続と保存」が最上段フルバンド(PC2列=A2持ち越しとは独立)",
      !!connectBox1280 && !!gridBox1280 && connectBox1280.width >= gridBox1280.width * 0.9,
      JSON.stringify({ connectBox1280, gridBox1280 }));
    check("pageerror 0件", pageErrors.length === 0, JSON.stringify(pageErrors));

    // iOS Safari禁則: new Date("文字列")パース無し(v355と同じ手法。コメント中の言及を誤検知
    // しないよう各行の//以降を落としてから検査する)。
    const stripLineComments = (src) => src.split("\n").map((line) => line.replace(/\/\/.*/, "")).join("\n");
    const appSource = stripLineComments(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"));
    check('app.jsに new Date("文字列") 形の禁止パターンが無い(コード部分のみ)', !/new Date\(\s*["'`]/.test(appSource));

    console.log(failures === 0 ? "\n✅ v358 ALL PASS" : `\n❌ v358: ${failures} 件失敗`);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
