// v81 検証: UX監査(workbench/out/2026-07-12-ux-audit/findings.md)の
// 「A. 即実装推奨(小さく安全)」5件(CHANGES_v81.md参照)。
//   A1: ホームの完了トグル(.home-box/.home-dot, 20px)を::beforeで当たり判定44px相当に拡張
//   A2: コンディション記録ボタン群(朝の体調/睡眠/服薬/余力/夜の体調)にmin-height:44pxを付与
//   A3: タイムライン完了ボタン(.tl-complete-btn)を::afterで、Wish完了チェック(.wish-check)を
//       padding+負のmarginで、それぞれ見た目を変えず当たり判定を44px相当に拡張
//   A4: 「日報を生成」のトーストに遷移予告文言を追加
//   A5: 「今日の理想」空欄カードを既定で閉じた1行プレースホルダ(homeFoldSection再利用)に縮小
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
    // [A1] ホームの完了トグル(.home-box / .home-dot)
    // ============================================================
    console.log("[A1] ホーム完了トグル: 見た目20pxのまま::beforeで当たり判定44px相当");
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
      s.currentView = "home";
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

    check(".home-boxが描画されている(今日の主役)", await page.locator(".home-box").count() >= 1);
    const homeBoxRect = await getRect(".home-box");
    check(".home-boxの見た目サイズは変わっていない(<=24px)", homeBoxRect.width <= 24 && homeBoxRect.height <= 24, JSON.stringify(homeBoxRect));
    const homeBoxBefore = await getPseudoInset(".home-box", "::before");
    check(
      ".home-boxの::beforeが44px相当のinset(-12px)を持つ",
      homeBoxBefore.top === "-12px" && homeBoxBefore.left === "-12px" && homeBoxBefore.right === "-12px" && homeBoxBefore.bottom === "-12px",
      JSON.stringify(homeBoxBefore)
    );

    check(".home-dotが描画されている(タスクシュート/ながれ)", await page.locator(".home-dot").count() >= 1);
    const homeDotRect = await getRect(".home-dot");
    check(".home-dotの見た目サイズは変わっていない(<=24px)", homeDotRect.width <= 24 && homeDotRect.height <= 24, JSON.stringify(homeDotRect));
    const homeDotBefore = await getPseudoInset(".home-dot", "::before");
    check(
      ".home-dotの::beforeが44px相当のinset(-12px)を持つ",
      homeDotBefore.top === "-12px" && homeDotBefore.left === "-12px" && homeDotBefore.right === "-12px" && homeDotBefore.bottom === "-12px",
      JSON.stringify(homeDotBefore)
    );

    // regression: ::beforeは.home-box自身の生成コンテンツなのでクリックのtargetは.home-box自身になり、
    // 実クリックを妨げない(擬似要素を別要素でラップしたwish-checkと違い、同一要素内では問題ない)ことを確認
    // v150(UI改善計画Phase4b・R3、完了作法統一): .home-boxはtoggle-block(即完了)に一本化された
    // ため、直接クリックはモーダルを開かず即座に完了する。実績の編集は完了直後のトースト
    // 「実績を編集」ボタンから、従来の実績登録モーダル(complete-block-with-actual)を開く形になった。
    await page.locator('.home-box[data-id="v81-mit-block"]').click();
    await page.waitForTimeout(150);
    const mitBlockAfterClick = await page.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.blocks.find((b) => b.id === "v81-mit-block")?.completed;
    }, KEY);
    check("(regression) .home-boxへの直接クリックで完了トグルが機能する(::beforeに邪魔されていない)", mitBlockAfterClick === true, String(mitBlockAfterClick));
    check("完了直後のトーストに「実績を編集」ボタンが出る",
      await page.locator('.toast-action[data-action="complete-block-with-actual"][data-id="v81-mit-block"]').count() === 1);
    await page.click('.toast-action[data-action="complete-block-with-actual"][data-id="v81-mit-block"]');
    await page.waitForTimeout(150);
    check("トーストの「実績を編集」から実績登録モーダルが開く", await page.locator('[data-action="modal-save"]').count() === 1);
    await page.click('[data-action="modal-save"]');
    await page.waitForTimeout(150);

    // ============================================================
    // [A2] コンディション記録ボタン群(ジャーナルタブ)
    // ============================================================
    console.log("[A2] コンディション記録ボタン(朝の体調/睡眠/服薬/余力/夜の体調)がmin-height 44px以上");
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
      ["睡眠", '[data-action="set-sleep"]'],
      ["服薬", '[data-action="toggle-meds"]'],
      ["今日の余力", '[data-action="set-capacity"]'],
      ["夜の体調", '[data-action="set-evening-mood"]']
    ];
    for (const [label, sel] of condButtons) {
      check(`${label}ボタンが描画されている`, await page.locator(sel).count() >= 1);
      const rect = await getRect(sel);
      check(`${label}ボタンの実測height >= 44px`, rect.height >= 44, JSON.stringify(rect));
    }

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
    // [A4] 「日報を生成」のトーストに遷移予告文言
    // ============================================================
    console.log("[A4] 「日報を生成」クリック後、トーストに遷移予告(日報タブへ移動する旨)が入る");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "journal";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);

    await page.click('[data-action="generate-report"]');
    await page.waitForTimeout(200);
    const toastText = await page.locator("#toast").textContent();
    check(
      "トースト文言が遷移(日報タブへ移動)を予告している",
      /(日報タブ|移動)/.test(toastText || ""),
      toastText
    );
    const viewAfterGenerate = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).currentView, KEY);
    check("(regression) 日報生成後、currentViewはreportsに遷移する", viewAfterGenerate === "reports", viewAfterGenerate);

    // ============================================================
    // [A5] 「今日の理想」空欄カードの折りたたみ
    // ============================================================
    console.log("[A5] 「今日の理想」空欄カード: 既定で閉じた1行、タップで展開して入力・保存できる");
    await page.evaluate(({ KEY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.currentView = "home";
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY });
    await page.reload();
    await page.waitForTimeout(400);
    // v149: 「今日の理想」はホームの2タブ分割でアファメーション扱いとなり「ホーム」タブへ移動した
    // (今日タブが既定のため、まずタブを切り替える)。
    await page.click('[data-action="home-tab"][data-tab="home"]');
    await page.waitForTimeout(150);

    const idealFold = page.locator('details[data-fold-id="home-ideal-empty"]');
    check("「今日の理想」空欄カードがdetailsとして描画されている", await idealFold.count() === 1);
    check("既定で閉じている(open属性が無い)", !(await idealFold.evaluate((el) => el.open)));
    const idealSummaryText = await idealFold.locator("summary").textContent();
    check("summaryにタップ展開を示す文言がある", /タップ/.test(idealSummaryText || ""), idealSummaryText);
    // <details>は閉じていてもDOM上には子要素が残る(ブラウザのUAスタイルでdisplay:noneになるだけ)ため、
    // 存在(count)ではなく可視性(isVisible)で「閉じている間は見えない」ことを確認する。
    check("閉じている間は.home-ideal-inputが非表示", !(await idealFold.locator(".home-ideal-input").isVisible()));

    await idealFold.locator("summary").click();
    await page.waitForTimeout(150);
    check("クリックで展開される(open属性が付く)", await idealFold.evaluate((el) => el.open));
    const idealInput = idealFold.locator(".home-ideal-input");
    check("展開後は.home-ideal-inputが見える", await idealInput.count() === 1);

    await idealInput.fill("v81テストの理想");
    await page.waitForTimeout(150);
    const savedIdeal = await page.evaluate(({ KEY, TODAY }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s.journalMeta?.[TODAY]?.ideal;
    }, { KEY, TODAY });
    check("(regression) 入力した理想がstate.journalMeta[date].idealに保存される", savedIdeal === "v81テストの理想", savedIdeal);

    console.log(failures === 0 ? "\n✅ v81 ALL PASS" : `\n❌ v81: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
