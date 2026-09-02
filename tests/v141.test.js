// v141 検証: (a) ジャーナルタブのAIフィードバック列(3列目)撤去+残り2列の拡幅
//           (b) 「今日行ったお店」ログ(店名/URL/感想、1日複数件)+年間一覧。CHANGES_v141.md参照。
//
// (a-1) journal-grid が2列(.panelが2つ)になっている。AIフィードバック関連のDOM
//       (.mdアップロード欄/data-feedback-date/journal-import-aiボタン/前日フィードバックdetails)
//       がジャーナルに一切残っていない。
// (a-2) fetchロジック・保存データ自体は無変更: Homeの「AIから」カードは引き続き前日フィードバックを読める。
// (b-1) normalizeState後方互換: storeVisitsキーが無い旧stateにも[]が補完される。
// (b-2) 当日欄からの新規追加(name/url/comment)→state.storeVisitsに1件登録され、一覧に反映される。
// (b-3) 店名未入力はエラートーストで弾かれる(保存されない)。
// (b-4) 既存件の編集(内容を書き換えて保存)。
// (b-5) 既存件の削除は確認ダイアログを通す(キャンセルなら残る、確認すれば論理削除されて消える)。
// (b-6) モーダル自身の「削除」ボタン経由(deleteFromModal)でも同様に削除できる。
// (b-7) 年間一覧: 年単位・月別グループ表示。0件の月/別年の記録は出ない。URLは新規タブリンク、
//       javascript:等の危険なURLはリンク化されない(プレーンテキスト表示)。
// (b-8) name/url/commentの入力欄はcomputed font-sizeが16px以上(iOS自動ズーム防止)。
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
  await blockGithubApiByDefault(page);

  // v67/v68と同じ理由: 本番バッチが実際にAIプラン_*.json/AIフィードバック_*.md/週次レビュー_*.mdを
  // 日次でcommitするため、既定では404隔離しつつ(b)側のfeedbackFixtureだけ個別ルートで上書きする。
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0);
  const TODAY = isoDate(now0);
  const YESTERDAY = isoDate(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - 1));

  // v57/v68等と同じ流儀: 「今日から見た昨日」分のAIフィードバックfetchだけfixtureで
  // 差し替え可能にする(実ファイルは一切使わない)。
  let feedbackFixture = null;
  let feedbackRequestCount = 0;
  await page.route((url) =>
    url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith(`/taskchute/AIフィードバック_${YESTERDAY}.md`),
  (route) => {
    feedbackRequestCount += 1;
    if (feedbackFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
    route.fulfill({ status: 200, contentType: "text/markdown", body: feedbackFixture });
  });
  await page.route((url) => {
    const p = decodeURIComponent(url.pathname);
    return /\/AIプラン_.*\.json$/.test(p) || /\/週次レビュー_.*\.md$/.test(p);
  }, (route) => route.fulfill({ status: 404, body: "not found (test-forced)" }));

  async function stateNow() {
    return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  }

  // v148(UI改善計画Phase3-4)以降、お店ログ(renderStoreVisitsCard)はジャーナル当日パネルの
  // 「夜」detailsの中にある。now0(このスイートは10:00固定)では朝だけが既定openになるため、
  // お店ログを操作する前に夜detailsを強制的に開く(state/localStorageは汚さない純粋なDOM操作。
  // reloadを挟むたびに開閉状態は既定に戻るので、reload後は毎回呼び直す)。
  async function openJournalEvening() {
    // 開閉状態はJSのモジュール変数(_journalSegmentOverride、非永続)で管理され、<summary>への
    // 本物のクリックだけを見るため、.openプロパティの直接書き換えでは次の再描画で巻き戻る。
    const el = page.locator(".journal-segment-evening");
    if ((await el.count()) === 0) return;
    const isOpen = await el.evaluate((e) => e.open);
    if (!isOpen) await el.locator(":scope > summary").click();
    await page.waitForTimeout(150);
  }

  try {
    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.selectedDate = TODAY;
      s.currentView = "journal";
      s.storeVisits = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(500);

    // ============================================================
    // (a-1) journal-gridが2列(.panelが2つ)。AIフィードバック関連DOMが一切残っていない
    // ============================================================
    console.log("[a-1] ジャーナルは2列レイアウト、AIフィードバック列のDOMが残っていない");
    const panelCount = await page.locator(".journal-grid > .panel").count();
    check(".journal-gridの直下パネルが2つになっている(3列目撤去)", panelCount === 2, String(panelCount));
    const colTracks = await page.locator(".journal-grid").evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    check("grid-template-columnsのトラック数が2", colTracks === 2, String(colTracks));
    check("AIフィードバックの見出しが無い", !(await page.locator("main").textContent()).includes("🤖 AIフィードバック"));
    check(".mdアップロード欄が無い", await page.locator("input[data-feedback-upload]").count() === 0);
    check("data-feedback-date欄が無い", await page.locator("[data-feedback-date]").count() === 0);
    check("AI返信から取り込みボタンが無い", await page.locator('[data-action="journal-import-ai"]').count() === 0);
    check("昨日のAIフィードバックdetailsが無い", await page.locator(".journal-yesterday-feedback").count() === 0);

    // ============================================================
    // (a-2) fetchロジック・保存データは無変更
    // ============================================================
    console.log("[a-2] 回帰: AIフィードバックのfetch・保存が引き続き機能する");
    // hydrateStaticMarkdownは起動時に一度だけ「今日から見た昨日」分を無条件fetchするため、
    // fixtureを用意した後は再起動相当(reload)で再fetchさせる(v57等と同じ流儀)。
    feedbackFixture = "# AIフィードバック本文_v141\n\n昨日の振り返り_v141\n";
    await page.evaluate(({ KEY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      if (s.feedback) delete s.feedback[YESTERDAY];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, YESTERDAY });
    await page.reload();
    await page.waitForTimeout(700);
    check("前日フィードバックをpersonal-data APIから再取得する(回帰)", feedbackRequestCount >= 1, String(feedbackRequestCount));

    // ============================================================
    // (b-1) normalizeState後方互換: storeVisitsキーが無い旧stateにも[]が補完される
    // ============================================================
    console.log("[b-1] normalizeState: storeVisitsキーが無い旧stateでも[]が補完されクラッシュしない");
    await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      delete s.storeVisits;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    const svAfterMigration = await stateNow();
    check("storeVisitsが配列として補完される", Array.isArray(svAfterMigration.storeVisits) && svAfterMigration.storeVisits.length === 0, JSON.stringify(svAfterMigration.storeVisits));
    check("pageerrorが起きずクラッシュしない(旧stateからの後方互換)", true);

    // ============================================================
    // (b-8)+(b-2) 当日欄からの新規追加。入力欄font-sizeも合わせて確認
    // ============================================================
    console.log("[b-2] 当日欄「+ 追加」→モーダルで店名/URL/感想を入力して保存→一覧に反映される");
    await openJournalEvening();
    await page.click('[data-action="store-visit-add"]');
    await page.waitForTimeout(200);
    check("お店追加モーダルが開く", await page.locator('.modal-card:has-text("お店を追加")').count() === 1);
    check("新規追加時は削除ボタンが出ない", await page.locator('.modal-card [data-action="modal-delete"]').count() === 0);

    for (const field of ["name", "url", "comment"]) {
      const fs2 = await page.locator(`[data-modal-field="${field}"]`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check(`[data-modal-field="${field}"]のcomputed font-sizeが16px以上`, fs2 >= 16, `(実際: ${fs2}px)`);
    }

    await page.fill('[data-modal-field="name"]', "テスト食堂_v141");
    await page.fill('[data-modal-field="url"]', "https://example.com/testshop");
    await page.fill('[data-modal-field="comment"]', "美味しかった_v141\n2行目のコメント");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);

    const s2 = await stateNow();
    check("state.storeVisitsに1件登録される", (s2.storeVisits || []).filter((v) => !v.deleted).length === 1, JSON.stringify(s2.storeVisits));
    const sv1 = s2.storeVisits.find((v) => v.name === "テスト食堂_v141");
    check("登録データのdateが当日", sv1?.date === TODAY, JSON.stringify(sv1));
    check("登録データのurlが保存される", sv1?.url === "https://example.com/testshop");
    check("登録データのcommentが保存される(改行込み)", sv1?.comment === "美味しかった_v141\n2行目のコメント");
    check("id/createdAt/updatedAtが補完される", !!sv1?.id && !!sv1?.createdAt && !!sv1?.updatedAt);
    check("一覧にリンク付きで表示される", await page.locator(`.store-visit-card a:has-text("テスト食堂_v141")`).count() === 1);
    const hrefVal = await page.locator(`.store-visit-card a:has-text("テスト食堂_v141")`).getAttribute("href");
    check("リンクのhrefが保存したURLと一致", hrefVal === "https://example.com/testshop", String(hrefVal));
    const targetVal = await page.locator(`.store-visit-card a:has-text("テスト食堂_v141")`).getAttribute("target");
    check("リンクがtarget=_blankで新規タブを開く", targetVal === "_blank", String(targetVal));
    check("一覧に感想が表示される", (await page.locator(".store-visit-card").textContent()).includes("美味しかった_v141"));

    // ============================================================
    // (b-3) 店名未入力はエラートーストで弾かれる
    // ============================================================
    console.log("[b-3] 店名を空のまま保存しようとするとトーストで弾かれ、保存されない");
    await page.click('[data-action="store-visit-add"]');
    await page.waitForTimeout(200);
    await page.fill('[data-modal-field="comment"]', "店名なしテスト_v141");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const toastText = await page.locator("#toast").textContent();
    check("「店名を入力してください」トーストが出る", toastText.includes("店名を入力してください"), toastText);
    const s3 = await stateNow();
    check("店名未入力の記録は追加されない(1件のまま)", (s3.storeVisits || []).filter((v) => !v.deleted).length === 1);
    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(200);

    // ============================================================
    // (b-4) 既存件の編集
    // ============================================================
    console.log("[b-4] 既存件を「編集」から書き換えて保存できる");
    await page.click(`[data-action="store-visit-edit"][data-id="${sv1.id}"]`);
    await page.waitForTimeout(200);
    check("編集モーダルが開き既存の店名が入っている", await page.locator('[data-modal-field="name"]').inputValue() === "テスト食堂_v141");
    check("編集時は削除ボタンが出る", await page.locator('.modal-card [data-action="modal-delete"]').count() === 1);
    await page.fill('[data-modal-field="name"]', "テスト食堂_v141_改名");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s4 = await stateNow();
    const sv1After = s4.storeVisits.find((v) => v.id === sv1.id);
    check("編集内容が保存される(店名変更)", sv1After?.name === "テスト食堂_v141_改名", JSON.stringify(sv1After));
    check("idは変わらない", sv1After?.id === sv1.id);
    check("updatedAtが更新される", sv1After?.updatedAt >= sv1.updatedAt);
    check("一覧表示も更新される", await page.locator(`.store-visit-card:has-text("テスト食堂_v141_改名")`).count() === 1);

    // ============================================================
    // (b-5) 既存件の削除は確認つき(キャンセル/確認の両方を確認)
    // ============================================================
    console.log("[b-5] 削除は確認ダイアログを通す(キャンセルなら残り、確認すれば消える)");
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click(`[data-action="store-visit-delete"][data-id="${sv1.id}"]`);
    await page.waitForTimeout(200);
    const s5a = await stateNow();
    check("キャンセル時は削除されない", !(s5a.storeVisits.find((v) => v.id === sv1.id)?.deleted));
    check("キャンセル時は一覧にまだ表示される", await page.locator(`.store-visit-card:has-text("テスト食堂_v141_改名")`).count() === 1);

    await page.evaluate(() => { window.confirm = () => true; });
    await page.click(`[data-action="store-visit-delete"][data-id="${sv1.id}"]`);
    await page.waitForTimeout(300);
    const s5b = await stateNow();
    check("確認後は論理削除(deleted:true)される", s5b.storeVisits.find((v) => v.id === sv1.id)?.deleted === true);
    check("削除後は一覧から消える", await page.locator(`.store-visit-card:has-text("テスト食堂_v141_改名")`).count() === 0);

    // ============================================================
    // (b-6) モーダル自身の「削除」ボタン(deleteFromModal経由)でも削除できる
    // ============================================================
    console.log("[b-6] モーダル内「削除」ボタン(deleteFromModal経由)でも削除できる");
    await page.click('[data-action="store-visit-add"]');
    await page.waitForTimeout(200);
    await page.fill('[data-modal-field="name"]', "モーダル削除用_v141");
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(300);
    const s6a = await stateNow();
    const sv2 = s6a.storeVisits.find((v) => v.name === "モーダル削除用_v141");
    check("モーダル削除用の1件が登録される", !!sv2);
    await page.click(`[data-action="store-visit-edit"][data-id="${sv2.id}"]`);
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('.modal-card [data-action="modal-delete"]');
    await page.waitForTimeout(300);
    const s6b = await stateNow();
    check("モーダルの削除ボタン経由でも論理削除される", s6b.storeVisits.find((v) => v.id === sv2.id)?.deleted === true);
    check("モーダルが閉じる", await page.locator(".modal-card").count() === 0);

    // ============================================================
    // (b-7) 年間一覧: 年単位・月別グループ、URLリンク、危険URLの非リンク化
    // ============================================================
    console.log("[b-7] 年間一覧: 月別グループ表示、0件の月/別年は出ない、危険URLはリンク化しない");
    const [ty, tm] = TODAY.split("-");
    const otherMonth = tm === "01" ? "06" : "01";
    const otherMonthDate = `${ty}-${otherMonth}-10`;
    const otherYear = String(Number(ty) - 1);
    const otherYearDate = `${otherYear}-05-05`;
    await page.evaluate(({ KEY, TODAY, otherMonthDate, otherYearDate }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.storeVisits = (s.storeVisits || []).filter((v) => !v.deleted).concat([
        {
          id: "sv-othermonth-v141", date: otherMonthDate, name: "月違いの店_v141",
          url: "javascript:alert(1)", comment: "危険URLテスト",
          createdAt: `${otherMonthDate}T10:00`, updatedAt: `${otherMonthDate}T10:00`, deleted: false
        },
        {
          id: "sv-otheryear-v141", date: otherYearDate, name: "去年の店_v141",
          url: "", comment: "",
          createdAt: `${otherYearDate}T10:00`, updatedAt: `${otherYearDate}T10:00`, deleted: false
        }
      ]);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, otherMonthDate, otherYearDate });
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('[data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(300);
    await openJournalEvening();

    await page.click('[data-action="store-visit-year"]');
    await page.waitForTimeout(200);
    check("年間一覧モーダルが開く", await page.locator('.modal-card:has-text("年間一覧")').count() === 1);
    const yearModalText = await page.locator(".modal-card").textContent();
    check("当年の記録(月違い)が表示される", yearModalText.includes("月違いの店_v141"));
    check("去年の記録は表示されない(年フィルタ)", !yearModalText.includes("去年の店_v141"));
    const dangerLinkCount = await page.locator('.modal-card a:has-text("月違いの店_v141")').count();
    check("javascript:等の危険URLはリンク化されず店名がプレーンテキストで出る", dangerLinkCount === 0, String(dangerLinkCount));
    check("危険URLの店名自体は引き続き読める(フェイルセーフ)", yearModalText.includes("月違いの店_v141"));

    await page.click('[data-action="modal-close"]');
    await page.waitForTimeout(200);
    check("閉じるボタンでモーダルが閉じる", await page.locator(".modal-card").count() === 0);

    console.log(failures === 0 ? "\n✅ v141 ALL PASS" : `\n❌ v141: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
