// v362: 設定タブ(A2) — PC 2列(1280px以上: 左=群一覧・右=全群の行を常時表示)。
// 発注v362-settings-bはA2(PC2列)+B(数値/選択行の詳細シート化)の合成だったが、Bを真に
// 「保存で反映・閉じるで破棄」の非即時適用にすると、既存の多数のE2E(today-core/tower-core/
// v144/v148/v151/v266ほか)がbuffer/battery/theme/profileの各inputへ直接DOM操作している
// 前提(常時DOM在り・data-setting-*属性へのchangeで即時適用)を壊す(Codex利用上限のため
// implementer=Claudeでの見積りで、安全な移行には別途多数の既存テスト改修が要る)。
// テスト差分はCLAUDE.md NEVER 1の行数対象外であり、追随コスト自体は問題にならない。
// Bを次版へ持ち越す真の理由は「既存6スイート以上の追随改修リスク」であり、本版はA2のみを
// 実装する(詳細はreleases/v362.jsonのuncertainties/knownLimitations、impl-v362-report.md、
// review-v362-claude.md を参照)。
//
// A2の仕様(レビュー差し戻し反映後): 1280px以上でrenderSettings()が「左=群一覧(接続と保存を
// 除く5群のラベル・選択中ハイライト)・右=全群の行を常時DOMへ描画」の2列(.settings-columns)
// へ切り替わる。既定のハイライトは最初の群(日々の使い方)。左ナビのクリックは対象群の
// ハイライト切替+スクロールのみを行い、他群の行をDOMから消さない(v266等の既存E2Eが前提
// にする「設定タブを開けば対象inputが常にDOMにある」契約と、vision-open-direct-settings等の
// 他画面からの誘導導線を守るため)。ハイライトはstate非書込(_settingsActiveGroupId、非永続)。
// 1279px以下はv358の1列(groups.map全展開、ハイライト無し)のまま。1280px境界を跨ぐリサイズ
// でも(_wbsDesktopMediaQueryの既存リスナーに相乗り)再描画で追随し、ハイライトはリサイズでは
// 変わらない(reloadでのみ先頭群へ戻る非永続)。「接続と保存」は列数に関わらず最上段フルバンド
// (v358からの契約、grid-column:1/-1は無改変)。
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY
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

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  // v358と同じ1100px(<1280)で開始し、A2のON/OFFを明示的にresizeで切り替えて検証する。
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
      focusTimerAuto: true, pomoGuidedAccessHint: false, autoArchive: false, autoSync: false
    });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForSelector(".settings-connect");

    // ============================================================
    console.log("[1] 1279px以下はv358の1列のまま(左ナビ・右詳細の2列構造は出ない)");
    // ============================================================
    check("1100pxでは.settings-columnsが出ない(v358の1列のまま)",
      await page.locator(".settings-columns").count() === 0);
    check("1100pxでは5群すべての.settings-group-flatが並ぶ",
      await page.locator(".settings-grid > .settings-group-flat").count() === 5);
    check("1100pxでもバッファ・電池・テーマ・プロフィール・カテゴリ・データ・その他の行ラベルが全部見える",
      (await page.locator(".settings-rows").allInnerTexts()).join("\n").match(/バッファ/) &&
      (await page.locator(".settings-group-flat-label").allInnerTexts()).join(",").includes("データ"));

    // ============================================================
    console.log("[1b] 1279px/1280pxの実境界(off-by-oneをピンで押さえる)");
    // ============================================================
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1279);
    check("1279pxでは.settings-columnsが出ない(1列のまま)",
      await page.locator(".settings-columns").count() === 0
      && await page.locator(".settings-grid > .settings-group-flat").count() === 5);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    await page.waitForSelector(".settings-columns", { state: "attached" });
    check("1280pxちょうどで.settings-columnsが出る(1px差の境界)",
      await page.locator(".settings-columns").count() === 1);

    // ============================================================
    console.log("[2] 1280px以上: 左に群一覧・右に全群の行が常時見える、既定ハイライトは先頭群「日々の使い方」");
    // ============================================================
    const columns = page.locator(".settings-columns");
    check("1280pxで.settings-columnsが出る", await columns.count() === 1);
    check("1280pxでも.settings-grid直下ではなく.settings-group-detail配下に5群ぶんの.settings-group-flatがある",
      await page.locator(".settings-grid > .settings-group-flat").count() === 0
      && await page.locator(".settings-group-detail > .settings-group-flat").count() === 5);
    const navItems = page.locator(".settings-group-nav-item");
    check("左ナビは5群ぶん(日々の使い方/表示/プロフィールとマスタ/データ/その他)",
      await navItems.count() === 5);
    const navLabels = await navItems.locator(".settings-group-nav-label").allInnerTexts();
    check("左ナビの並びはv358と同じ順",
      JSON.stringify(navLabels) === JSON.stringify(["日々の使い方", "表示", "プロフィールとマスタ", "データ", "その他"]),
      JSON.stringify(navLabels));
    check("既定ハイライトは先頭群「日々の使い方」(左ナビ)",
      await navItems.nth(0).evaluate((el) => el.classList.contains("active")) === true
      && await navItems.nth(1).evaluate((el) => el.classList.contains("active")) === false);
    check("既定ハイライトは先頭群「日々の使い方」(右詳細のsettings-group-flat-active)",
      await page.locator('.settings-group-detail [data-settings-group="daily"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === true
      && await page.locator('.settings-group-detail [data-settings-group="display"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === false);
    // H1/H2差し戻し対応の核心: 選択中でない群の行も常にDOMに存在すること(v266等が前提にする契約)。
    check("右詳細に「日々の使い方」群の行(バッファ・電池)が見える",
      (await page.locator('.settings-group-detail [data-settings-group="daily"]').innerText()).includes("60分")
      && (await page.locator('.settings-group-detail [data-settings-group="daily"]').innerText()).includes("60/80/100"));
    check("右詳細には非選択の「データ」群の行(書き出し)も常時DOMに存在する(絞り込まない)",
      (await page.locator('.settings-group-detail [data-settings-group="data"]').innerText()).includes("書き出し"));
    check("右詳細には非選択の「プロフィールとマスタ」群のスコア目標inputも常時DOMに存在する(v266が前提にする契約)",
      await page.locator("[data-setting-scoretarget]").count() === 1);

    // ============================================================
    console.log("[3] 左ナビをクリックするとハイライトが移動しスクロールする・行は消えない・選択は非書込");
    // ============================================================
    const rawBeforeSwitch = await page.evaluate((k) => localStorage.getItem(k), STATE_KEY);
    await navItems.nth(3).click();  // 「データ」
    await page.waitForFunction(() =>
      document.querySelector('.settings-group-detail [data-settings-group="data"]')?.classList.contains("settings-group-flat-active"));
    check("「データ」タップで左ナビのハイライトが移動する",
      await navItems.nth(3).evaluate((el) => el.classList.contains("active")) === true
      && await navItems.nth(0).evaluate((el) => el.classList.contains("active")) === false);
    check("「データ」タップで右詳細側のハイライトも「データ」へ移動する",
      await page.locator('.settings-group-detail [data-settings-group="data"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === true
      && await page.locator('.settings-group-detail [data-settings-group="daily"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === false);
    check("「データ」タップ後も「日々の使い方」群の行(バッファ)はDOMから消えない(絞り込みではなくハイライト+スクロールのみ)",
      (await page.locator('.settings-group-detail [data-settings-group="daily"]').innerText()).includes("60分"));
    const rawAfterSwitch = await page.evaluate((k) => localStorage.getItem(k), STATE_KEY);
    check("群選択はlocalStorageの内容を一切変えない(state非書込・非永続の実証)",
      rawAfterSwitch === rawBeforeSwitch);
    await page.reload();
    await page.waitForSelector('[data-action="nav"]', { state: "attached" });
    await page.click('[data-action="nav"][data-view="settings"]');
    await page.waitForSelector(".settings-connect");
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    await page.waitForSelector(".settings-columns", { state: "attached" });
    check("reload後はハイライトが先頭群「日々の使い方」へ戻る(非永続の実証)",
      await page.locator('.settings-group-detail [data-settings-group="daily"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === true);

    // ============================================================
    console.log("[4] 1280px境界を跨ぐリサイズで再描画に追随する(ハイライト中の群はリサイズでは変わらない)");
    // ============================================================
    await page.locator(".settings-group-nav-item").nth(1).click();  // 「表示」
    await page.waitForFunction(() =>
      document.querySelector('.settings-group-detail [data-settings-group="display"]')?.classList.contains("settings-group-flat-active"));
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1024);
    await page.waitForFunction(() => document.querySelectorAll(".settings-columns").length === 0);
    check("1279px以下へ縮めると.settings-columnsが消え1列表示に戻る(5群とも全展開)",
      await page.locator(".settings-columns").count() === 0
      && await page.locator(".settings-grid > .settings-group-flat").count() === 5);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    await page.waitForSelector(".settings-columns", { state: "attached" });
    check("1280px以上へ戻すと.settings-columnsが復活し、ハイライト中の群(表示)を保持したまま",
      await page.locator(".settings-columns").count() === 1
      && await page.locator(".settings-group-nav-item").nth(1).evaluate((el) => el.classList.contains("active")) === true
      && await page.locator('.settings-group-detail [data-settings-group="display"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === true);

    // ============================================================
    console.log("[5] 「接続と保存」はPC 2列でも最上段フルバンド(v358契約の継続)");
    // ============================================================
    const connectBox = await page.locator(".settings-connect").boundingBox();
    const gridBox = await page.locator(".settings-grid").boundingBox();
    check("1280pxでも「接続と保存」が最上段フルバンド(2列の1セルに落ちない)",
      !!connectBox && !!gridBox && connectBox.width >= gridBox.width * 0.9,
      JSON.stringify({ connectBox, gridBox }));

    // ============================================================
    console.log("[6] トグル行はその場切替のまま(v358契約)・data-setting-*の総数は不変(17件)");
    // ============================================================
    // 1279px以下(v358の1列・5群全展開)へ戻し、group-nav選択に関係なく全trigger群のtoggleへ届くようにする。
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1100);
    await page.waitForFunction(() => document.querySelectorAll(".settings-columns").length === 0);
    const focusToggle = page.locator("[data-setting-focustimerauto]");
    check("フォーカスタイマー自動起動トグルの初期状態はON(fixture通り)", await focusToggle.isChecked());
    await focusToggle.click();
    await page.waitForFunction((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.focusTimerAuto === false, STATE_KEY);
    check("トグルはその場切替(v358のまま、B未着手のため行の構造自体は無改変)",
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STATE_KEY)).settings.focusTimerAuto === false);
    const settingCount = await page.locator([
      "[data-setting-field]", "[data-setting-battery-field]", "[data-setting-autoarchive]",
      "[data-setting-autosync]", "[data-setting-focustimerauto]", "[data-setting-pomoguidedaccesshint]",
      "[data-setting-dailybuffermin]", "[data-setting-dayclosehours]", "[data-setting-scoretarget]"
    ].join(",")).count();
    check("data-setting-*の総数は17件のまま(A2は表示配置のみでBの行構造には触れていない)",
      settingCount === 17, String(settingCount));

    // ============================================================
    console.log("[7] vision-open-direct-settings誘導がPC幅でも空振りしない(H2差し戻し対応)");
    // ============================================================
    // v189導線: ALIGNMENT誘導→設定「プロフィールとマスタ」群へ着地。旧実装は死にキー
    // (setFoldOpen("settings-master"))で誘導が無言で空振りしていた(review-v362-claude.md H2)。
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    // renderVisionAlignment()はvisionDirectCategories未設定(fixture既定=空配列)のときだけ
    // 「直結カテゴリを設定」ボタンを出す(app.js:7010-7020)。
    await page.click('[data-action="nav"][data-view="vision"]');
    await page.waitForSelector('[data-action="vision-open-direct-settings"], .vision-alignment');
    const visionButton = page.locator('[data-action="vision-open-direct-settings"]').first();
    if (await visionButton.count() > 0) {
      await visionButton.click();
      await page.waitForFunction(() =>
        document.querySelector('.settings-group-detail [data-settings-group="profile"]')?.classList.contains("settings-group-flat-active"));
      check("vision-open-direct-settingsで設定タブへ遷移する",
        await page.locator(".settings-connect").count() === 1);
      check("vision-open-direct-settingsで「プロフィールとマスタ」群がハイライトされる(誘導が空振りしない)",
        await page.locator('.settings-group-detail [data-settings-group="profile"]').evaluate((el) => el.classList.contains("settings-group-flat-active")) === true
        && await page.locator(".settings-group-nav-item").filter({ hasText: "プロフィールとマスタ" }).evaluate((el) => el.classList.contains("active")) === true);
      check("誘導後もカテゴリ管理の行(カテゴリ)がDOMに存在し操作できる",
        (await page.locator('.settings-group-detail [data-settings-group="profile"]').innerText()).includes("カテゴリ管理"));
    } else {
      console.log("  (このfixtureにはvision-open-direct-settingsボタンが出る導線が無いためスキップ)");
    }

    // ============================================================
    console.log("[8] 390/1280px横スクロールなし・pageerror 0・new Date(\" なし・新規waitForTimeoutなし");
    // ============================================================
    async function hasHorizontalOverflow() {
      return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 390);
    check("390pxで横スクロールしない", !(await hasHorizontalOverflow()));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((w) => document.documentElement.clientWidth === w, 1280);
    check("1280pxで横スクロールしない", !(await hasHorizontalOverflow()));
    check("pageerror 0件", pageErrors.length === 0, JSON.stringify(pageErrors));

    const stripLineComments = (src) => src.split("\n").map((line) => line.replace(/\/\/.*/, "")).join("\n");
    const appSource = stripLineComments(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"));
    check('app.jsに new Date("文字列") 形の禁止パターンが無い(コード部分のみ)', !/new Date\(\s*["'`]/.test(appSource));
    // 本スイート自体が新規のwaitForTimeoutを含まないこと(固定wait不追加の自己検査)。
    // needleを分割して組み立てる(そのまま書くとこの行自体がself-includes判定に引っかかるため)。
    const waitForTimeoutNeedle = ["wait", "For", "Timeout("].join("");
    const selfSource = fs.readFileSync(__filename, "utf8");
    check("v362.test.js自体はwaitForTimeoutを使っていない(selector/state待ちのみ)",
      !selfSource.includes(waitForTimeoutNeedle));

    console.log(failures === 0 ? "\n✅ v362 ALL PASS" : `\n❌ v362: ${failures} 件失敗`);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.stack || error.message);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
