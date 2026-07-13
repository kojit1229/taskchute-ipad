// v84 検証: ポモドーロタブに「Study With Me」YouTube埋め込みトグルを追加(ROADMAP.md v90番台)。
//   ①トグルONでiframe生成・URL形式(youtube-nocookie.com/embed + start秒)
//   ②OFFで破棄
//   ③タブ離脱(pomodoro以外のviewへ遷移)で破棄・再訪で復元(トグル状態は永続)
//   ④設定画面での動画ID/開始秒の直接編集 + YouTube URL貼り付けからの自動抽出
//   ⑤normalizeStateの後方互換マイグレーション(既存値優先)
//   +プライバシー: iframe src はトークン等を含まない静的URLのみ
//   +tick安定性: 500ms tickの再描画(常時タイマー)でiframeのDOMノードが壊れない
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate } = require("./helpers");

const PORT = 4221;
const KEY = "taskchute-journal-pwa-state-v1";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  try {
    await blockGithubApiByDefault(page);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    // ============================================================
    // [⑤] normalizeState: 旧state(studyWithMe関連フィールドなし)からの後方互換マイグレーション
    // normalizeState()はメモリ上のstateに対して起動時に適用される(localStorageへの書き戻しは
    // 別の保存タイミングで行われるため即座には反映されない)。よって検証は「アプリが実際にどう
    // 描画・動作するか」で行う(localStorageの中身を直接読むのではなく)。
    // ============================================================
    console.log("[⑤] normalizeStateの後方互換マイグレーション(既存値優先)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.pomodoro.studyWithMeOn;           // v83以前を模した状態(トグルフィールド無し)
      delete s.settings.studyWithMe;             // 設定側も無し
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check(
      "settings.studyWithMe.videoId が既定値(Kが指定した動画)で補完され表示される",
      await page.locator('[data-swm-field="videoId"]').inputValue() === "WgxzRsiIwb8"
    );
    check(
      "settings.studyWithMe.startSec が既定値1986で補完され表示される",
      await page.locator('[data-swm-field="startSec"]').inputValue() === "1986"
    );
    // pomodoro.studyWithMeOn がbooleanに補完されていること(トグルが正常にON/OFFできる=
    // 補完前のundefinedのまま扱われていないことの間接確認)
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "pomodoro";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check("(補完後)トグルはOFF状態で描画される(primaryクラスが付いていない)", await page.locator('[data-action="toggle-study-with-me"]').evaluate((el) => !el.classList.contains("primary")));
    await page.click('[data-action="toggle-study-with-me"]');
    await page.waitForTimeout(150);
    check("補完されたstudyWithMeOn(false)から正常にONへトグルできる", await page.locator(".study-with-me-frame").count() === 1);
    await page.click('[data-action="toggle-study-with-me"]');
    await page.waitForTimeout(150);

    // 既存値優先: videoIdだけ既に設定済み(startSecは無し)の状態からのマイグレーション
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.studyWithMe = { videoId: "customVideo1" };  // startSecフィールドなし
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);
    check(
      "既存のvideoIdは上書きされず維持される(既存値優先)",
      await page.locator('[data-swm-field="videoId"]').inputValue() === "customVideo1"
    );
    check(
      "欠けていたstartSecだけ既定値で補完される",
      await page.locator('[data-swm-field="startSec"]').inputValue() === "1986"
    );

    // 以降のテスト用に既定値へ戻す
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.studyWithMe = { videoId: "WgxzRsiIwb8", startSec: 1986 };
      s.pomodoro.studyWithMeOn = false;
      s.pomodoro.tab = "manual";
      s.currentView = "pomodoro";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    // ============================================================
    // [①②] トグルON/OFFでのiframe生成・破棄、URL形式
    // ============================================================
    console.log("[①] トグルONで正しいURL形式のiframeが生成される");
    check("初期状態(OFF)ではiframeが無い", await page.locator(".study-with-me-frame").count() === 0);
    await page.click('[data-action="toggle-study-with-me"]');
    await page.waitForTimeout(150);
    check("トグルONでiframeが1つ生成される", await page.locator(".study-with-me-frame").count() === 1);
    const src1 = await page.locator(".study-with-me-frame").getAttribute("src");
    check(
      "srcが youtube-nocookie.com/embed/{videoId}?start={秒} 形式",
      src1 === "https://www.youtube-nocookie.com/embed/WgxzRsiIwb8?start=1986",
      src1
    );
    check("iframeに autoplay パラメータが付与されていない(タップ再生の担保)", !/autoplay/i.test(src1 || ""), src1);
    check("iframeタグ自体にautoplay属性が無い", (await page.locator(".study-with-me-frame").evaluate((el) => el.hasAttribute("autoplay"))) === false);

    console.log("[②] トグルOFFでiframeが破棄される");
    await page.click('[data-action="toggle-study-with-me"]');
    await page.waitForTimeout(150);
    check("トグルOFFでiframeが破棄される", await page.locator(".study-with-me-frame").count() === 0);
    const stateAfterOff = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro.studyWithMeOn, KEY);
    check("トグル状態(OFF)がstateに永続化されている", stateAfterOff === false);

    // ============================================================
    // [③] タブ(view)離脱で破棄・再訪で復元(トグル状態は永続)
    // モバイル幅ではサイドバーのnavボタンが非表示(ボトムナビにpomodoroが無い)ため、
    // 他スイート(v83等)と同じくstate.currentView直接操作 + reload で画面遷移を再現する。
    // ============================================================
    console.log("[③] Pomodoro以外のviewへ移動するとiframeが破棄され、戻ると復元される");
    await page.click('[data-action="toggle-study-with-me"]');
    await page.waitForTimeout(150);
    check("(準備)再度ONにしてiframeが表示されている", await page.locator(".study-with-me-frame").count() === 1);

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(300);
    check("Pomodoroタブを離れる(home)とiframeが破棄される", await page.locator(".study-with-me-frame").count() === 0);
    const stateWhileAway = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).pomodoro.studyWithMeOn, KEY);
    check("離脱してもトグル状態(ON)はstateに残っている(破棄されるのはDOMのみ)", stateWhileAway === true);

    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "pomodoro";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(300);
    check("Pomodoroタブに戻るとトグルON状態のままiframeが復元される", await page.locator(".study-with-me-frame").count() === 1);

    // ============================================================
    // [tick安定性] 常時タイマー(passiveタブ)の500ms tickでiframeのDOMノードが壊れない
    // ============================================================
    console.log("[tick安定性] 500ms毎の再描画でiframeが再生成されない(常時タイマー表示中)");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.pomodoro.tab = "passive";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(300);
    check("(準備)passiveタブでもiframeがONのまま表示されている", await page.locator(".study-with-me-frame").count() === 1);
    await page.evaluate(() => {
      const el = document.querySelector(".study-with-me-frame");
      el.__v84Marker = "same-node-" + Date.now();
    });
    const markerBefore = await page.evaluate(() => document.querySelector(".study-with-me-frame")?.__v84Marker);
    const timeTextBefore = await page.locator(".pomo-time-overlay").textContent();
    await page.waitForTimeout(1300); // tickは500ms毎 → 2〜3回発火するはず
    const markerAfter = await page.evaluate(() => document.querySelector(".study-with-me-frame")?.__v84Marker);
    check(
      "1.3秒後もiframeが同一DOMノードのまま(tickで再生成されていない)",
      markerAfter === markerBefore && !!markerAfter,
      JSON.stringify({ markerBefore, markerAfter })
    );
    const timeTextAfter = await page.locator(".pomo-time-overlay").textContent();
    check(
      "その間、カウントダウン表示は差分更新で変化している(表示自体は生きている)",
      timeTextAfter !== timeTextBefore,
      JSON.stringify({ timeTextBefore, timeTextAfter })
    );

    // ============================================================
    // [④] 設定画面: 動画ID/開始秒の直接編集 + YouTube URL貼り付けからの自動抽出
    // ============================================================
    console.log("[④] 設定画面のStudy With Me欄: 直接編集とURL貼り付け抽出");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "settings";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(400);

    check("設定画面に動画ID欄が表示されている", await page.locator('[data-swm-field="videoId"]').count() === 1);
    check("設定画面に開始秒欄が表示されている", await page.locator('[data-swm-field="startSec"]').count() === 1);
    const videoIdInputFont = await page.locator('[data-swm-field="videoId"]').evaluate((el) => getComputedStyle(el).fontSize);
    check("動画ID入力欄はfont-size 16px以上(iOS自動ズーム防止)", parseFloat(videoIdInputFont) >= 16, videoIdInputFont);
    const startSecInputFont = await page.locator('[data-swm-field="startSec"]').evaluate((el) => getComputedStyle(el).fontSize);
    check("開始秒入力欄はfont-size 16px以上(iOS自動ズーム防止)", parseFloat(startSecInputFont) >= 16, startSecInputFont);
    const urlInputFont = await page.locator('#study-with-me-url-input').evaluate((el) => getComputedStyle(el).fontSize);
    check("URL貼り付け欄はfont-size 16px以上(iOS自動ズーム防止)", parseFloat(urlInputFont) >= 16, urlInputFont);

    // --- URL貼り付け: 数値秒形式(&t=125s) ---
    await page.fill("#study-with-me-url-input", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s");
    await page.waitForTimeout(150);
    check("URL貼り付け(数値秒)で動画ID欄が更新される", await page.locator('[data-swm-field="videoId"]').inputValue() === "dQw4w9WgXcQ");
    check("URL貼り付け(数値秒)で開始秒欄が125に更新される", await page.locator('[data-swm-field="startSec"]').inputValue() === "125");
    const stateAfterUrl1 = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.studyWithMe, KEY);
    check("stateにも反映されている(数値秒)", stateAfterUrl1.videoId === "dQw4w9WgXcQ" && stateAfterUrl1.startSec === 125, JSON.stringify(stateAfterUrl1));

    // --- URL貼り付け: youtu.be短縮形 + 複合時間形式(1h2m3s = 3723秒) ---
    // (YouTube動画IDは常に11文字。abcdEFGH123 = 11文字)
    await page.fill("#study-with-me-url-input", "https://youtu.be/abcdEFGH123?t=1h2m3s");
    await page.waitForTimeout(150);
    check("youtu.be形式から動画IDを抽出できる", await page.locator('[data-swm-field="videoId"]').inputValue() === "abcdEFGH123");
    check("複合時間形式(1h2m3s)を秒数(3723)に変換できる", await page.locator('[data-swm-field="startSec"]').inputValue() === "3723");

    // --- URL貼り付け: embed形式、t指定なし(startSecは変更されない) ---
    // (ZZZZZzzzzZZ = 11文字)
    await page.fill("#study-with-me-url-input", "https://www.youtube-nocookie.com/embed/ZZZZZzzzzZZ");
    await page.waitForTimeout(150);
    check("embed形式から動画IDを抽出できる", await page.locator('[data-swm-field="videoId"]').inputValue() === "ZZZZZzzzzZZ");
    check("t/start指定が無いURLでは開始秒が変更されない(直前の3723のまま)", await page.locator('[data-swm-field="startSec"]').inputValue() === "3723");

    // --- 無効な文字列を貼っても既存値を壊さない ---
    await page.fill("#study-with-me-url-input", "これはYouTube URLではありません");
    await page.waitForTimeout(150);
    check("動画IDを検出できないテキストでは値が変わらない", await page.locator('[data-swm-field="videoId"]').inputValue() === "ZZZZZzzzzZZ");

    // --- 動画ID欄・開始秒欄を直接編集(change) ---
    await page.fill('[data-swm-field="videoId"]', "manualVideoId");
    await page.locator('[data-swm-field="videoId"]').blur();
    await page.fill('[data-swm-field="startSec"]', "42");
    await page.locator('[data-swm-field="startSec"]').blur();
    await page.waitForTimeout(150);
    const stateAfterManual = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.studyWithMe, KEY);
    check(
      "動画ID/開始秒を直接編集した内容がstateに反映される",
      stateAfterManual.videoId === "manualVideoId" && stateAfterManual.startSec === 42,
      JSON.stringify(stateAfterManual)
    );

    // 設定変更がPomodoroタブのiframe srcに反映されることを確認
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "pomodoro";
      s.pomodoro.tab = "manual";
      s.pomodoro.studyWithMeOn = true;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(300);
    const src2 = await page.locator(".study-with-me-frame").getAttribute("src");
    check(
      "設定変更後のvideoId/startSecがPomodoroタブのiframe srcに反映される",
      src2 === "https://www.youtube-nocookie.com/embed/manualVideoId?start=42",
      src2
    );

    // ============================================================
    // [プライバシー] iframe srcはトークン等を含まない静的URLのみ
    // ============================================================
    console.log("[プライバシー] iframe src にトークン等の個人情報が混入しない");
    const SECRET_TOKEN = "ghp_v84SecretTokenShouldNeverLeak";
    await page.evaluate(({ KEY, SECRET_TOKEN }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.settings.github.token = SECRET_TOKEN;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, SECRET_TOKEN });
    await page.reload();
    await page.waitForTimeout(300);
    const src3 = await page.locator(".study-with-me-frame").getAttribute("src");
    check("iframe srcにGitHubトークンが含まれない", !(src3 || "").includes(SECRET_TOKEN), src3);
    check(
      "iframe srcは想定の静的URL形式(videoId + start秒のみ)に一致する",
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]+\?start=\d+$/.test(src3 || ""),
      src3
    );

    console.log(failures === 0 ? "\n✅ v84 ALL PASS" : `\n❌ v84: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
