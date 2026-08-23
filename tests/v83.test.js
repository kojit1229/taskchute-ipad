// v83 検証: UX監査(workbench/out/2026-07-12-ux-audit/findings.md)のB4/B8(CHANGES_v83.md参照)。
//   B4: 完了トグルUI(.home-box/.home-dot/.checkbox-button/.tl-complete-btn/.wish-check)の
//       形状を丸チェックに統一。チェック済み状態(塗り+✓)の表現も統一。
//       v81で入れた当たり判定44px拡張(::before/::after・wish-check-wrapのlabel拡張)は壊さない。
//   B8: renderMarkdownの結果メモ化(入力テキスト→サニタイズ済みHTMLの単純キャッシュ)。
//       同一テキストの再描画はmarked.parseを再実行しない。cachedFeedback更新(新着fetch)時は
//       テキスト自体が変わるためキーが変わり、表示は正しく更新される(明示的invalidation不要)。
// 主端末=iPhone縦持ち(幅390px)を想定した viewport で検証する。
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now0 = new Date();
  now0.setHours(10, 0, 0, 0); // 日中固定(深夜跨ぎのTODAY判定ズレを避ける。他スイートと同じ理由)
  const TODAY = isoDate(now0);
  const YESTERDAY = isoDate(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - 1));
  const DAY_BEFORE_YESTERDAY = isoDate(new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() - 2));
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function planBlock({ id, date = TODAY, title, startMin, minutes = 30, taskId = "", isMIT = false, completed = false }) {
    return {
      id, taskId, date, title, category: "",
      plannedStartAt: `${date}T${hhmm(startMin)}`,
      plannedEndAt: `${date}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT, source: "",
      createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`, deleted: false
    };
  }

  async function getRect(selector) {
    return page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
  }
  async function getPseudoInset(selector, pseudo) {
    return page.locator(selector).first().evaluate((el, pseudo) => {
      const cs = getComputedStyle(el, pseudo);
      return { top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left, content: cs.content };
    }, pseudo);
  }
  // B4-1: 形状が丸(円/ピル)かどうかを、border-top-left-radiusの解決値とboxサイズから判定する。
  // border-radius:50%指定は getComputedStyle 時にboxサイズを基準にpx解決される(例: 24px四方なら12px)。
  // border-radius:999px等の絶対値指定はそのまま返るため、半径 >= 短辺/2 であれば見た目は円/ピルになる。
  async function isCircular(selector) {
    return page.locator(selector).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const minSide = Math.min(rect.width, rect.height);
      return { radius, minSide, isCircle: radius >= (minSide / 2 - 0.5) };
    });
  }
  async function bgColor(selector) {
    return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  }
  async function afterContent(selector) {
    return page.locator(selector).first().evaluate((el) => getComputedStyle(el, "::after").content);
  }

  try {
    // ============================================================
    // 準備: 5種の完了トグルがそれぞれ描画される状態を作る
    // ============================================================
    await blockGithubApiByDefault(page);
    // B8-2用: 「今日から見た昨日」分のAIフィードバックfetchをfixtureで差し替え可能にする
    // (v57/v62と同じ流儀。実ファイルは一切使わない)
    let feedbackFixture = null;
    await page.route((url) =>
      url.hostname === "api.github.com" && decodeURIComponent(url.pathname).endsWith(`/taskchute/AIフィードバック_${YESTERDAY}.md`),
    (route) => {
      if (feedbackFixture === null) return route.fulfill({ status: 404, body: "not found (test-fixture)" });
      route.fulfill({ status: 200, contentType: "text/markdown", body: feedbackFixture });
    });

    await page.clock.setFixedTime(now0);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await passGithubGate(page);

    await page.evaluate(({ KEY, TODAY, DAY_BEFORE_YESTERDAY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = s.projects || [];
      s.projects.push({
        id: "v83-proj", kind: "normal", title: "v83テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`,
        updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
      });
      s.tasks = s.tasks || [];
      s.tasks.push(
        { id: "v83-task1", projectId: "v83-proj", parentTaskId: "", title: "v83タスク1(着手率パネル用)",
          category: "", status: "todo", dueDate: "", description: "",
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
        { id: "v83-task2", projectId: "v83-proj", parentTaskId: "", title: "v83タスク2(完了色チェック用)",
          category: "", status: "todo", dueDate: "", description: "",
          createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
      );
      const wishProject = s.projects.find((p) => p.kind === "wish" && !p.deleted);
      if (wishProject) {
        s.tasks.push(
          { id: "v83-wish1", projectId: wishProject.id, parentTaskId: "", title: "v83テストWish(未実現)",
            category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
            targetYear: null, targetMonth: null, realized: false, realizedDate: "",
            createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false },
          { id: "v83-wish2", projectId: wishProject.id, parentTaskId: "", title: "v83テストWish(実現済み)",
            category: "", status: "completed", dueDate: "", description: "", lifeArea: "", motivation: "",
            targetYear: null, targetMonth: null, realized: true, realizedDate: TODAY,
            createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false }
        );
      }
      s.wishFilter = { area: "", showRealized: true }; // 実現済みWishも一覧に出す(既定は隠れる)
      s.wishViewMode = "list";
      s.journals = s.journals || {};
      s.journals[DAY_BEFORE_YESTERDAY] = "v83キャッシュ検証テキストA_" + Date.now();
      s.journals[YESTERDAY] = "v83キャッシュ検証テキストB_" + Date.now();
      s.selectedDate = TODAY;
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY, DAY_BEFORE_YESTERDAY, YESTERDAY });
    await page.evaluate(({ KEY, blocks }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = blocks;
      localStorage.setItem(KEY, JSON.stringify(s));
    }, {
      KEY, blocks: [
        planBlock({ id: "v83-mit-block", title: "MITブロック(完了済み)", startMin: 540, isMIT: true, completed: true }),
        planBlock({ id: "v83-tc-block", title: "着手ブロック(未完了)", startMin: 600, taskId: "v83-task1", completed: false }),
        planBlock({ id: "v83-done-block", title: "完了ブロック(色確認用)", startMin: 660, taskId: "v83-task2", completed: true })
      ]
    });
    await page.reload();
    await page.waitForTimeout(400);

    // ============================================================
    // [B4-1] v230でhome2種を撤去。残る3種の完了トグルの形状統一(丸チェック)
    // ============================================================
    console.log("[B4-1] v230: homeトグルは不存在、残る.checkbox-button/.tl-complete-btn/.wish-checkは丸チェック");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "tasks";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    const cbSel = '.checkbox-button[data-id="v83-done-block"]';
    check(".checkbox-buttonが描画されている(タスクシュート実行リスト)", await page.locator(cbSel).count() === 1);
    const checkboxButtonShape = await isCircular(cbSel);
    check(".checkbox-buttonが円形", checkboxButtonShape.isCircle, JSON.stringify(checkboxButtonShape));
    // v83-done-blockはcompleted:trueなので.doneが付いている
    const checkboxButtonDoneBg = await bgColor(cbSel);
    const checkboxButtonDoneText = await page.locator(cbSel).textContent();

    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "timeline";
      s.timelineMode = "planned";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    const tlSel = '.tl-complete-btn[data-id="v83-tc-block"]';
    check(".tl-complete-btnが描画されている", await page.locator(tlSel).count() === 1);
    const tlShape = await isCircular(tlSel);
    check(".tl-complete-btnが円形(既存)", tlShape.isCircle, JSON.stringify(tlShape));

    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "wish";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    const wishSel1 = '.wish-check[data-id="v83-wish1"]'; // 未実現
    const wishSel2 = '.wish-check[data-id="v83-wish2"]'; // 実現済み
    check(".wish-checkが描画されている(未実現)", await page.locator(wishSel1).count() === 1);
    check(".wish-checkが描画されている(実現済み)", await page.locator(wishSel2).count() === 1);
    const wishShape = await isCircular(wishSel1);
    check(".wish-checkが円形(v83でネイティブ角丸四角から変更)", wishShape.isCircle, JSON.stringify(wishShape));
    const wishCheckedBg = await page.locator(wishSel2).evaluate((el) => getComputedStyle(el).backgroundColor);

    // ---- チェック済み状態(塗り+✓)も統一されているか ----
    console.log("[B4-1] チェック済み状態(塗り+✓)の表現統一");
    // .checkbox-buttonは自身に.doneが付く。.wish-checkは:checked。
    check(
      "チェック済みの塗り色が.checkbox-button/.wish-checkで一致する(var(--green)に統一)",
      checkboxButtonDoneBg === wishCheckedBg,
      JSON.stringify({ checkboxButtonDoneBg, wishCheckedBg })
    );
    check("チェック済みの.checkbox-buttonに✓が表示される", (checkboxButtonDoneText || "").includes("✓"), checkboxButtonDoneText);
    const wishCheckedAfter = await afterContent(wishSel2);
    check("実現済み.wish-checkは::afterで✓を表示する(塗り+✓の表現に統一)", wishCheckedAfter.includes("✓"), wishCheckedAfter);
    const wishUncheckedAfter = await afterContent(wishSel1);
    check("未実現.wish-checkは✓を表示しない(regression)", !wishUncheckedAfter.includes("✓"), wishUncheckedAfter);

    // ============================================================
    // [B4-2] v81の残存wish当たり判定44px拡張が壊れていないことの回帰確認
    // ============================================================
    console.log("[B4-2] v230: 削除済みhome拡張は不存在、残る.wish-check-wrapの44pxを回帰確認");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "wish";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    const wishWrapSel = `.wish-check-wrap:has(${wishSel1})`;
    const wishWrapRect = await getRect(wishWrapSel);
    check(
      ".wish-check-wrap(labelラッパー)の実ボックスが引き続き44px相当(v81回帰。wish-check自体のCSS全面変更で崩れていないか)",
      wishWrapRect.width >= 44 && wishWrapRect.height >= 44,
      JSON.stringify(wishWrapRect)
    );
    const wishRect = await getRect(wishSel1);
    check(".wish-checkの見た目サイズは24pxのまま(v81回帰)", wishRect.width === 24 && wishRect.height === 24, JSON.stringify(wishRect));

    // regression: label越しのクリックで実現済みにトグルできる(appearance:none化で壊れていないか)
    check("(regression) 初期状態(v83-wish1)は未チェック", !(await page.locator(wishSel1).isChecked()));
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(wishSel1).click();
    await page.waitForTimeout(150);
    const wishRealizedAfterClick = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.tasks.find((t) => t.id === "v83-wish1")?.realized;
    }, KEY);
    check("(regression) wish-checkのクリックで実現済みにトグルできる(appearance:none化の副作用なし)", wishRealizedAfterClick === true, String(wishRealizedAfterClick));

    // ============================================================
    // [B8-1] renderMarkdownのキャッシュ: 同一テキストはparseされ直さない/異なるテキストは正しく表示される
    // ============================================================
    console.log("[B8-1] renderMarkdownの結果メモ化: 同一テキストはmarked.parse再実行なし、異なるテキストは正しく再描画される");
    // ジャーナルの「前日」パネルは renderMarkdown(state.journals[previous]) を毎回呼ぶ。
    // selectedDate=YESTERDAY → previous=DAY_BEFORE_YESTERDAY(テキストA)を表示させて初回parseさせる。
    // v85メモ: 起動時(reload)は必ずselectedDate=今日に強制されるため、YESTERDAYへは
    // reload後にセッション中の日付ピッカー操作で移動する(以前のようにlocalStorage注入では
    // 起動時リセットで上書きされてしまう)。ここで重要なのは、起動直後にjournalタブを
    // selectedDate=今日のまま一度でも描画してしまうと、その時点の「前日パネル」=YESTERDAY
    // (テキストB)が先にmarked.parseでキャッシュされてしまい、後段の「date-next後は
    // キャッシュミスでparseが走る」検証が偽陰性になる。そのため、日付移動を終えてから
    // 初めてjournalタブへ入る順序にする(tasks→日付ピッカーでYESTERDAYへ→journalへnav)。
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "tasks";  // v230: home撤去後もdatebarを持つ現行view
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    await page.evaluate((d) => {
      const el = document.querySelector("[data-date-picker]");
      el.value = d;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, YESTERDAY);
    await page.waitForTimeout(200);
    // viewport 390px(mobile)ではサイドバーnavが非表示になり#bottomNav側だけが可視のため、
    // #bottomNav配下を明示して2要素ヒットの曖昧さを避ける
    await page.click('#bottomNav [data-action="nav"][data-view="journal"]');
    await page.waitForTimeout(200);
    const journalTextInitial = await page.locator(".journal-grid").textContent();
    check("初期表示(前日パネル)にテキストAが表示されている", (journalTextInitial || "").includes("v83キャッシュ検証テキストA_"), (journalTextInitial || "").slice(0, 200));

    // ここから marked.parse の呼び出し回数を監視する(初期描画分はカウントしない)
    await page.evaluate(() => {
      const orig = window.marked.parse.bind(window.marked);
      window.__markedCallCount = 0;
      window.marked.parse = (...args) => { window.__markedCallCount++; return orig(...args); };
    });
    const markedCallCount = () => page.evaluate(() => window.__markedCallCount || 0);

    // date-next: selectedDate=TODAY, previous=YESTERDAY(テキストB) → 新規キー(異なるテキスト)なのでparseが走る
    await page.click('[data-action="date-next"]');
    await page.waitForTimeout(200);
    const journalTextB = await page.locator(".journal-grid").textContent();
    check("date-next後、前日パネルにテキストBが正しく表示される(新規テキストのキャッシュミスで再parse)", (journalTextB || "").includes("v83キャッシュ検証テキストB_"), (journalTextB || "").slice(0, 200));
    check("テキストAが残留していない(regression: キャッシュの取り違えが無い)", !(journalTextB || "").includes("v83キャッシュ検証テキストA_"));
    const countAfterB = await markedCallCount();
    check("異なるテキスト(B)の描画でmarked.parseが呼ばれる(キャッシュミス)", countAfterB >= 1, String(countAfterB));

    // date-prev: selectedDate=YESTERDAYに戻る, previous=DAY_BEFORE_YESTERDAY(テキストA、初回表示時に既にキャッシュ済み)
    await page.click('[data-action="date-prev"]');
    await page.waitForTimeout(200);
    const journalTextA2 = await page.locator(".journal-grid").textContent();
    check("date-prevで前日パネルにテキストAが正しく再表示される(キャッシュヒット)", (journalTextA2 || "").includes("v83キャッシュ検証テキストA_"), (journalTextA2 || "").slice(0, 200));
    const countAfterA2 = await markedCallCount();
    check(
      "同一テキスト(A)への復帰ではmarked.parseが再実行されない(呼び出し回数が増えていない=キャッシュヒット)",
      countAfterA2 === countAfterB,
      JSON.stringify({ countAfterB, countAfterA2 })
    );

    // ============================================================
    // [B8-2] 新着FB(cachedFeedback更新)時に表示が正しく更新される(明示的invalidation不要の設計)
    // ============================================================
    console.log("[B8-2] cachedFeedback更新(新着fetch)時、renderMarkdownのキャッシュに邪魔されず表示が更新される");
    // v230: Home撤去後は同じcachedFeedback/renderMarkdown経路をATISで確認する。
    const OLD_MARKER = "v83旧フィードバックマーカー_" + Date.now();
    const NEW_MARKER = "v83新フィードバックマーカー_" + Date.now();

    feedbackFixture = `# AIフィードバック\n\n${OLD_MARKER}\n`;
    await page.evaluate(({ KEY, YESTERDAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.selectedDate = YESTERDAY;
      s.currentView = "today";
      if (s.feedback) delete s.feedback[YESTERDAY];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, YESTERDAY });
    await page.reload();
    await page.waitForTimeout(700);
    const fbTextOld = await page.locator(".tower-atis-feedback").textContent();
    check("旧フィードバック内容が表示される(cachedFeedback経由のrenderMarkdown)", (fbTextOld || "").includes(OLD_MARKER), (fbTextOld || "").slice(0, 300));

    // バッチが新しい内容で上書きした状況を再現(fixtureを差し替えて再取得=アプリ再起動相当)
    feedbackFixture = `# AIフィードバック\n\n${NEW_MARKER}\n`;
    await page.reload();
    await page.waitForTimeout(700);
    const fbTextNew = await page.locator(".tower-atis-feedback").textContent();
    check("新着フィードバックの内容が表示される(古い内容のまま固まっていない)", (fbTextNew || "").includes(NEW_MARKER), (fbTextNew || "").slice(0, 300));
    check("旧フィードバック内容が残留していない(regression: キャッシュの取り違えが無い)", !(fbTextNew || "").includes(OLD_MARKER));

    console.log(failures === 0 ? "\n✅ v83 ALL PASS" : `\n❌ v83: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
