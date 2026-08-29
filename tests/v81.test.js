// v81 検証: UX監査(workbench/out/2026-07-12-ux-audit/findings.md)の
// 「A. 即実装推奨(小さく安全)」5件(CHANGES_v81.md参照)。
//   A1: ホームの完了トグル(.home-box/.home-dot, 20px)を::beforeで当たり判定44px相当に拡張
//   A2: コンディション記録ボタン群(朝の体調/服薬/余力/夜の体調)にmin-height:44pxを付与
//   A3: タイムライン完了ボタン(.tl-complete-btn)を::afterで、Wish完了チェック(.wish-check)を
//       padding+負のmarginで、それぞれ見た目を変えず当たり判定を44px相当に拡張
//   A4: 「日報を生成」のトーストに遷移予告文言を追加
//   A5: 「今日の理想」空欄カードを既定で閉じた1行プレースホルダ(homeFoldSection再利用)に縮小
// 主端末=iPhone縦持ち(幅390px)を想定した viewport で検証する。
const { chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate, randomPort, generateReportThroughGate } = require("./helpers");

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
  await blockGithubApiByDefault(page);

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(600);
  await passGithubGate(page);

  const pad2 = (n) => String(n).padStart(2, "0");
  const now0 = new Date();
  now0.setHours(9, 0, 0, 0);
  const TODAY = `${now0.getFullYear()}-${pad2(now0.getMonth() + 1)}-${pad2(now0.getDate())}`;
  const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  function planBlock({ id, title, startMin, minutes = 30, taskId = "", isMIT = false, completed = false }) {
    return {
      id, taskId, date: TODAY, title, category: "",
      plannedStartAt: `${TODAY}T${hhmm(startMin)}`,
      plannedEndAt: `${TODAY}T${hhmm(startMin + minutes)}`,
      actualStartAt: "", actualEndAt: "",
      completed, charge: 0, discharge: 0,
      comment: "", recurrenceGroupId: "", pomodoroCount: 0,
      migratedTo: "", orderIndex: 0, carryCount: 0, isMIT, source: "",
      createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
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

  try {
    // ============================================================
    // [A1] v230: ホームの完了トグル(.home-box / .home-dot)は描画ごと撤去
    // ============================================================
    console.log("[A1] v230: home完了トグルは不存在で、旧home stateはtodayへ縮退する");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.projects = s.projects || [];
      s.projects.push({
        id: "v81-proj", kind: "normal", title: "v81テスト案件", category: "", status: "active",
        description: "", dueDate: "", twelveWeekStartDate: "", createdAt: `${TODAY}T00:00`,
        updatedAt: `${TODAY}T00:00`, deleted: false, collapsed: false
      });
      s.tasks = s.tasks || [];
      s.tasks.push({
        id: "v81-task", projectId: "v81-proj", parentTaskId: "", title: "v81テストタスク",
        category: "", status: "todo", dueDate: "", description: "",
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      });
      s.selectedDate = TODAY;
      s.currentView = "home";  // 旧端末stateを模擬。normalizeStateがtodayへ補完する。
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.evaluate(({ KEY, block }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks = [block];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, block: planBlock({ id: "v81-mit-block", title: "MITブロック", startMin: 600, isMIT: true }) });
    await page.evaluate(({ KEY, block2 }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.blocks.push(block2);
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, block2: planBlock({ id: "v81-tc-block", title: "着手ブロック", startMin: 660, taskId: "v81-task" }) });
    await page.reload();
    await page.waitForTimeout(400);

    check("旧currentView=homeはtodayへ縮退する",
      await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY) === "today");
    check("縮退先でTOWERが描画される", await page.locator(".today-tower").count() === 1);

    // ============================================================
    // [A2] コンディション記録ボタン群(ジャーナルタブ)
    // ============================================================
    console.log("[A2] コンディション記録ボタン(朝の体調/服薬/余力/夜の体調)がmin-height 44px以上");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    // v148(UI改善計画Phase3-4)以降、当日パネルは朝/夜の2detailsに分かれ、現在時刻(実行時の
    // 実時計)でどちらか一方だけが既定openになる。開閉状態はJSのモジュール変数
    // (_journalSegmentOverride、非永続)で管理され、<summary>への本物のクリックだけを見るため、
    // .openプロパティの直接書き換えでは次の再描画で巻き戻る。両方のボタンの実測サイズを
    // 時刻に関係なく見たいので、閉じている方のsummaryを実際にクリックして開く。
    for (const cls of ["journal-segment-morning", "journal-segment-evening"]) {
      const el = page.locator(`.${cls}`);
      const isOpen = await el.evaluate((e) => e.open);
      if (!isOpen) await el.locator("summary").click();
    }
    await page.waitForTimeout(150);

    const condButtons = [
      ["朝の体調", '[data-action="set-morning"]'],
      ["服薬", '[data-action="toggle-meds"]'],
      ["今日の余力", '[data-action="set-capacity"]'],
      ["夜の体調", '[data-action="set-evening-mood"]']
    ];
    for (const [label, sel] of condButtons) {
      check(`${label}ボタンが描画されている`, await page.locator(sel).count() >= 1);
      const rect = await getRect(sel);
      check(`${label}ボタンの実測height >= 44px`, rect.height >= 44, JSON.stringify(rect));
    }
    check("廃止された主観睡眠ボタンは描画されない", await page.locator('[data-action="set-sleep"]').count() === 0);

    // ============================================================
    // [A3-1] タイムライン完了ボタン(.tl-complete-btn)
    // ============================================================
    console.log("[A3-1] タイムライン完了ボタン: 見た目22px(mobile)のまま::afterで当たり判定44px相当");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "timeline";
      s.timelineMode = "planned";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    const tlSel = '.tl-complete-btn[data-id="v81-tc-block"]';
    check(".tl-complete-btnが描画されている", await page.locator(tlSel).count() === 1);
    const tlRect = await getRect(tlSel);
    // mobile media queryはwidthのみ22pxに上書きし、heightは既存の base min-height:24px が
    // 上書きされず効いたまま(v81で新規に変えたものではない既存の挙動)。見た目のサイズ自体が
    // 大きく変わっていないことだけを確認する。
    check(".tl-complete-btnの見た目サイズは変わっていない(mobile: width<=23, height<=24)", tlRect.width <= 23 && tlRect.height <= 24, JSON.stringify(tlRect));
    const tlAfter = await getPseudoInset(tlSel, "::after");
    check(
      ".tl-complete-btnの::afterがmobile用inset(-11px)を持つ",
      tlAfter.top === "-11px" && tlAfter.left === "-11px" && tlAfter.right === "-11px" && tlAfter.bottom === "-11px",
      JSON.stringify(tlAfter)
    );
    const tlHoverBefore = await getPseudoInset(tlSel, "::before");
    check(
      "既存のホバー用::before(チェックマーク表示)はcontent未設定のまま(regression: ::afterと衝突していない)",
      tlHoverBefore.content === "none",
      JSON.stringify(tlHoverBefore)
    );
    // regression: ::afterも.tl-complete-btn自身の生成コンテンツなので直接クリックを妨げない
    // v150(UI改善計画Phase4b・R3、完了作法統一): .tl-complete-btnはtoggle-block(即完了)に
    // 一本化されたため、直接クリックはモーダルを開かず即座に完了する(v81-mit-blockと同じ形)。
    await page.locator(tlSel).click();
    await page.waitForTimeout(150);
    const tcBlockAfterClick = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === "v81-tc-block")?.completed;
    }, KEY);
    check("(regression) .tl-complete-btnへの直接クリックで完了トグルが機能する(::afterに邪魔されていない)", tcBlockAfterClick === true, String(tcBlockAfterClick));
    check("完了直後のトーストに「実績を編集」ボタンが出る",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="v81-tc-block"]').count() === 1);

    // ============================================================
    // [A3-2] Wish完了チェック(.wish-check)
    // ============================================================
    console.log("[A3-2] Wish完了チェック: 見た目24pxのままpadding+負のmarginで当たり判定44px相当");
    const wishProjectId = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      const wp = s.projects.find((p) => p.kind === "wish" && !p.deleted);
      return wp ? wp.id : null;
    }, KEY);
    check("Wish Projectが既定で存在する", !!wishProjectId);
    await page.evaluate(({ KEY, wishProjectId, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.tasks.push({
        id: "v81-wish", projectId: wishProjectId, parentTaskId: "", title: "v81テストWish",
        category: "", status: "todo", dueDate: "", description: "", lifeArea: "", motivation: "",
        targetYear: null, targetMonth: null, realized: false, realizedDate: "",
        createdAt: `${TODAY}T00:00`, updatedAt: `${TODAY}T00:00`, deleted: false
      });
      s.currentView = "wish";
      s.wishViewMode = "list";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, wishProjectId, TODAY });
    await page.reload();
    await page.waitForTimeout(400);

    const wishSel = '.wish-check[data-id="v81-wish"]';
    check(".wish-checkが描画されている", await page.locator(wishSel).count() === 1);
    const wishRect = await getRect(wishSel);
    check(".wish-checkの見た目サイズは変わっていない(24px)", wishRect.width === 24 && wishRect.height === 24, JSON.stringify(wishRect));
    // v81: ネイティブcheckbox自体はpaddingで当たり判定を拡張できない(実機検証で確認済み。
    // CHANGES_v81.md参照)ため、<label class="wish-check-wrap">でラップし、そちらの実ボックスを
    // padding+負のmarginで44px相当に拡張している(::beforeでの拡張は、positioned pseudo が
    // 通常フローの子input要素より手前に描画され直接クリックを奪ってしまうv79回帰があったため不採用)。
    const wishWrapSel = '.wish-check-wrap:has(.wish-check[data-id="v81-wish"])';
    check(".wish-check-wrap(labelラッパー)が描画されている", await page.locator(wishWrapSel).count() === 1);
    const wishWrapRect = await getRect(wishWrapSel);
    check(
      ".wish-check-wrapの実ボックス(border-box)が44px相当",
      wishWrapRect.width >= 44 && wishWrapRect.height >= 44,
      JSON.stringify(wishWrapRect)
    );
    // regression: label越しでも直接inputをクリックでき、既存のdata-action/checkedロジックが働く
    // (realizeWishはwindow.confirmを挟む既存挙動。v79スイートと同じくdialogをacceptする。
    //  実現済みにすると既定フィルタ(showRealized=false)でカード自体が一覧から消える既存挙動
    //  [v79テスト参照]のため、クリック後の確認はDOMのisCheckedではなくstateで行う)
    check("(regression) 初期状態は未チェック", !(await page.locator(wishSel).isChecked()));
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(wishSel).click();
    await page.waitForTimeout(150);
    const wishRealizedAfterClick = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.tasks.find((t) => t.id === "v81-wish")?.realized;
    }, KEY);
    check("(regression) labelでラップ後もinputへの直接クリックで実現済みにトグルできる", wishRealizedAfterClick === true, String(wishRealizedAfterClick));

    // ============================================================
    // [A4] 「日報を生成」後もジャーナルに留まる
    // ============================================================
    console.log("[A4] 「日報を生成」クリック後もジャーナルに留まり、生成完了トーストが出る");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      // v162: A1〜で積んだ未完了Block(v81-mit-block等)が残っていると「日報を生成」クリックが
      // 未完了理由モーダルに横取りされ、直接の日報生成トーストを検証できなくなる
      // (本テストの主題はトースト文言であり、未完了理由フローとは無関係のため明示的に外す)。
      s.blocks = [];
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    await generateReportThroughGate(page);
    await page.waitForTimeout(200);
    const toastText = await page.locator("#toast").textContent();
    check(
      "トーストが日報生成完了を伝える",
      (toastText || "").includes("日報を生成しました"),
      toastText
    );
    const viewAfterGenerate = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY);
    check("日報生成後もcurrentViewはjournalのまま", viewAfterGenerate === "journal", viewAfterGenerate);

    // ============================================================
    // [A5] v230: 「今日の理想」homeカードは撤去、旧state値は温存
    // ============================================================
    console.log("[A5] v230: 「今日の理想」homeカードは描画されず、既存journalMeta.idealは保持される");
    await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "today";
      s.journalMeta = s.journalMeta || {};
      s.journalMeta[TODAY] = { ...(s.journalMeta[TODAY] || {}), ideal: "v81既存の理想" };
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY, TODAY });
    await page.reload();
    await page.waitForTimeout(400);
    check("home-ideal-empty/home-ideal-inputは描画されない",
      await page.locator('[data-fold-id="home-ideal-empty"], .home-ideal-input').count() === 0);
    const savedIdeal = await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.journalMeta?.[TODAY]?.ideal;
    }, { KEY, TODAY });
    check("既存state.journalMeta[date].idealは削除されない", savedIdeal === "v81既存の理想", savedIdeal);

    console.log(failures === 0 ? "\n✅ v81 ALL PASS" : `\n❌ v81: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
