// v256: JOURNALのIME変換中にタブを切り替えても、未確定入力を含むDOMを
// composition確定まで保持し、その後は要求済みビューを必ず描画することを検証する。
const {
  chromium,
  launchOptions,
  startServer,
  blockGithubApiByDefault,
  passGithubGate,
  randomPort,
  STATE_KEY
} = require("./helpers");

const PORT = randomPort();
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => { failures++; console.log("  ❌ pageerror:", error.message); });
  await blockGithubApiByDefault(page);

  const pad2 = (value) => String(value).padStart(2, "0");
  const fixedNow = new Date(2026, 7, 24, 10, 0, 0, 0);
  const TODAY = `${fixedNow.getFullYear()}-${pad2(fixedNow.getMonth() + 1)}-${pad2(fixedNow.getDate())}`;

  async function seed(view, journalText = "") {
    await page.goto(`http://localhost:${PORT}/styles.css`);
    await page.evaluate(({ key, view, today, journalText }) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.currentView = view;
      state.selectedDate = today;
      state.journals[today] = journalText;
      localStorage.setItem(key, JSON.stringify(state));
    }, { key: STATE_KEY, view, today: TODAY, journalText });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(`.nav-button[data-view="${view}"].active`);
  }

  try {
    await page.clock.setFixedTime(fixedNow);
    await page.goto(`http://localhost:${PORT}/`);
    await passGithubGate(page);

    console.log("[1] IME composition中のJOURNAL→Wish切替は、確定までrenderを延期して入力DOMを保持する");
    await seed("journal", "確定済み_v256");
    const journalTextarea = page.locator(`[data-journal-date="${TODAY}"]`);
    await journalTextarea.click();
    await page.evaluate(() => {
      const textarea = document.activeElement;
      textarea.value += "＋未確定_v256";
      textarea.setAttribute("data-test-marker", "v256-composing");
      textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      document.querySelector('.nav-button[data-view="wish"]').click();
    });

    const deferredState = await page.evaluate((key) => {
      const textarea = document.querySelector("[data-journal-date]");
      return {
        journalPresent: Boolean(textarea),
        marker: textarea?.getAttribute("data-test-marker") || null,
        value: textarea?.value || "",
        requestedView: JSON.parse(localStorage.getItem(key)).currentView,
        wishRendered: Boolean(document.querySelector('.nav-button[data-view="wish"].active'))
      };
    }, STATE_KEY);
    check("composition中はJOURNAL DOMが再構築されない", deferredState.journalPresent && deferredState.marker === "v256-composing", JSON.stringify(deferredState));
    check("未確定文字を含むtextarea.valueが保持される", deferredState.value === "確定済み_v256＋未確定_v256", JSON.stringify(deferredState.value));
    check("切替要求はstateへ保存されるがWishの描画は保留される", deferredState.requestedView === "wish" && !deferredState.wishRendered, JSON.stringify(deferredState));

    if (deferredState.journalPresent) {
      await page.evaluate(() => {
        const textarea = document.querySelector("[data-journal-date]");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("compositionend", { bubbles: true }));
      });
      const stillPresentAfterCompositionEnd = await page.locator('[data-test-marker="v256-composing"]').count() === 1;
      check("compositionend後も入力フォーカス中はDOMを保持する", stillPresentAfterCompositionEnd);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForSelector('.nav-button[data-view="wish"].active');
      check("focusout後は保留していたWishを最終描画する", await page.locator('.nav-button[data-view="wish"].active').count() === 1);

      await page.evaluate(() => document.querySelector('.nav-button[data-view="journal"]').click());
      await page.waitForSelector(`[data-journal-date="${TODAY}"]`);
      check("JOURNALへ戻ると確定した全文がstateから復元される",
        await page.locator(`[data-journal-date="${TODAY}"]`).inputValue() === "確定済み_v256＋未確定_v256");
    } else {
      check("focusout後は保留していたWishを最終描画する", false, "修正前の即時renderでJOURNAL DOMが消失");
      check("JOURNALへ戻ると確定した全文がstateから復元される", false, "未確定入力をcommitできない");
    }

    console.log("[2] 非IMEのJOURNAL切替と、JOURNAL以外からの切替は従来どおり同期描画する");
    await seed("journal", "通常入力_v256");
    const ordinaryTextarea = page.locator(`[data-journal-date="${TODAY}"]`);
    await ordinaryTextarea.click();
    await ordinaryTextarea.fill("通常入力を確定_v256");
    await page.locator('.nav-button[data-view="wish"]').click();
    check("非IMEのJOURNAL→Wish切替はclick完了時点で描画済み",
      await page.locator('.nav-button[data-view="wish"].active').count() === 1);
    check("非IMEの確定済み入力は保持される",
      await page.evaluate(({ key, today }) => JSON.parse(localStorage.getItem(key)).journals[today], { key: STATE_KEY, today: TODAY }) === "通常入力を確定_v256");

    await seed("settings");
    await page.locator("[data-settings-sync] > summary").click();
    await page.locator('[data-github-field="dataRepo"]').click();
    await page.locator('.nav-button[data-view="journal"]').click();
    check("JOURNAL以外(settings)→JOURNAL切替もclick完了時点で描画済み",
      await page.locator('.nav-button[data-view="journal"].active').count() === 1
        && await page.locator(`[data-journal-date="${TODAY}"]`).count() === 1);

    console.log("[3] compositionend/focusout欠落時も60秒フェイルセーフで要求済みビューを最終描画する");
    await seed("journal", "フェイルセーフ_v256");
    await page.locator(`[data-journal-date="${TODAY}"]`).click();
    await page.evaluate(() => {
      const textarea = document.activeElement;
      textarea.setAttribute("data-test-marker", "v256-failsafe");
      textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      document.querySelector('.nav-button[data-view="wish"]').click();
    });
    check("フェイルセーフ前はWish描画を延期する", await page.locator('[data-test-marker="v256-failsafe"]').count() === 1);
    await page.clock.setFixedTime(new Date(fixedNow.getTime() + 61 * 1000));
    await page.waitForSelector('.nav-button[data-view="wish"].active');
    check("60秒超過後はフォーカス/IME状態に関わらずWishを描画する",
      await page.locator('.nav-button[data-view="wish"].active').count() === 1
        && await page.locator('[data-test-marker="v256-failsafe"]').count() === 0);
  } catch (error) {
    failures++;
    console.log("  ❌ 例外:", error.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nv256: 全件成功" : `\nv256: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
