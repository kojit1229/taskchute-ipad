// v296: 「書く瞑想」R1b(充放電ログ改善計画 第1弾R1b。K裁定2026-08-29=案A)。
// 1. 候補チップ帯(疲労/回復3以上の身体スキャン+当日の完了Block名+夜のひとこと。閾値はK裁定
//    2026-08-30により3以上=当初案の4以上から変更)。
//    タップでaddWriteMeditationChip経由の同じ入口へ流し込み、使用済みは薄表示にする。
// 2. dailyCloseゲート: 「日報を生成」押下時、当日を見ていて当日のwriteMeditationsが未保存
//    (レコード無し/放電・充電とも0件)なら「先にやりますか?」を1回だけ挟む(未完了理由
//    チップモーダルの後段)。「やる」=パネルへ/「スキップして生成」=生成続行+同日は再ゲートなし
//    (stateへは一切書かない=セッション内フラグのみ)。
// 3. JOURNAL_PROMPTS文言整理: 感謝/ハイライト/気付き・学びの3見出しのヒントを
//    「書く瞑想パネル(上)へ」の誘導文へ変更(見出し自体・他の見出しは不変)。
//
// §8-1条項:
// (a) 全経路: 疲労3+→放電候補/回復3+→充電候補/完了Block名候補/夜のひとこと候補(充電のみ)/
//     タップで追加・使用済み薄表示/ゲートが出る/「やる」でパネルへ/「スキップ」で生成続行+
//     同日再ゲートなし/保存済みなら非表示
// (b) 負例: 疲労3以下・回復3以下は出ない/未完了Blockは候補に出ない/重複追加は無害にスキップ/
//     候補0件で帯非表示/選択日が今日でなければゲート対象外
// (c) 永続化: ゲートのセッションフラグがstate(journalMeta等)へ一切漏れない
// (d) 退行: 未完了理由チップモーダル→書く瞑想ゲートの順序が保たれる/390px横スクロールなし
const path = require("path");
const {
  chromium, launchOptions, startServer, blockGithubApiByDefault, passGithubGate,
  randomPort, STATE_KEY, generateReportThroughGate, dismissWriteMeditationGateIfOpen
} = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PORT = randomPort();
const TODAY = "2026-08-29";
const YESTERDAY = "2026-08-28";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function makeBlock({ id, title, completed, incompleteReason = null, date = TODAY }) {
  return {
    id, taskId: "", date, title, category: "",
    plannedStartAt: `${date}T09:00`, plannedEndAt: `${date}T09:30`,
    actualStartAt: "", actualEndAt: "", completed, charge: 0, discharge: 0,
    comment: "", recurrenceGroupId: "", pomodoroCount: 0, migratedTo: "", orderIndex: 0,
    carryCount: 0, isMIT: false, source: "", createdAt: `${date}T00:00`, updatedAt: `${date}T00:00`,
    deleted: false, incompleteReason
  };
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("  ❌ pageerror:", e.message); });
  await blockGithubApiByDefault(page);

  // writeMeditations/blocks/bodyScansは既定で毎回リセットする(v294のseed()と同じ方式で
  // 各[N]シナリオを前段の蓄積から独立させる)。selectedDateは既定TODAY(ゲート判定の対象日)。
  async function seed({
    writeMeditations = [], blocks = [], bodyScans = [], eveningNote = "",
    selectedDate = TODAY, journalText = ""
  } = {}) {
    await page.evaluate(({ KEY, TODAY, selectedDate, writeMeditations, blocks, bodyScans, eveningNote, journalText }) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.selectedDate = selectedDate;
      s.currentView = "journal";
      s.writeMeditations = writeMeditations;
      s.blocks = blocks;
      s.bodyScans = bodyScans;
      s.condition ||= { logs: {} };
      s.condition.logs[TODAY] = { sleepHours: null, meds: null, capacity: "", morningRecordedAt: "", eveningMood: null, eveningNote, eveningRecordedAt: "", gym: [] };
      s.reports = {};  // 各[N]シナリオのreports[]生成待ちを前段の蓄積から独立させる(v162.test.jsと同じ方式)
      if (journalText) { s.journals ||= {}; s.journals[selectedDate] = journalText; }
      localStorage.setItem(KEY, JSON.stringify(s));
    }, { KEY: STATE_KEY, TODAY, selectedDate, writeMeditations, blocks, bodyScans, eveningNote, journalText });
    await page.reload();
    await page.waitForSelector('#app[data-view="journal"]', { state: "attached" });
  }
  async function stateNow() { return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), STATE_KEY); }
  async function openKm() {
    const seg = page.locator(".journal-segment-writeMeditation");
    if (!(await seg.evaluate((el) => el.open))) await seg.locator("summary").click();
    await page.waitForFunction(() => document.querySelector(".journal-segment-writeMeditation")?.open === true);
  }

  try {
    await page.clock.setFixedTime(new Date(2026, 7, 29, 19, 0, 0));  // 19時=既定open(夜18時判定)
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction((KEY) => {
      try { return JSON.parse(localStorage.getItem(KEY)) !== null; } catch { return false; }
    }, STATE_KEY);
    await passGithubGate(page);

    // ============================================================
    // [1](a)(b) 候補チップ
    // ============================================================
    // 閾値はK裁定2026-08-30により3以上(当初案の4以上から変更)。境界値は3(出る)/2(出ない)で検証する。
    // Codexレビュー指摘1(major): 前日日付の強い値(疲労5・回復5)を混ぜ、日付フィルタが
    // 効いていること(削除で落ちるテスト)を負例として追加する。
    console.log("[1](a)(b) 候補チップ: 疲労3+/回復3+/完了Block/夜のひとこと(充電のみ)。疲労2以下・回復2以下・未完了Block・前日日付は出ない");
    await seed({
      bodyScans: [
        { id: "s1", dateTime: `${TODAY}T10:00:00`, fatigue: 3, recovery: null, part: "", pomodoroBlockId: "b1" },
        { id: "s2", dateTime: `${TODAY}T11:00:00`, fatigue: 2, recovery: null, part: "", pomodoroBlockId: "b2" },
        { id: "s3", dateTime: `${TODAY}T12:00:00`, fatigue: null, recovery: 3, part: "", pomodoroBlockId: "b3" },
        { id: "s4", dateTime: `${TODAY}T13:00:00`, fatigue: null, recovery: 2, part: "", pomodoroBlockId: "b4" },
        // 前日日付・強い値(疲労5/回復5)。日付フィルタが無ければ誤って候補に出てしまう負例。
        { id: "sY1", dateTime: `${YESTERDAY}T20:00:00`, fatigue: 5, recovery: null, part: "", pomodoroBlockId: "bY1" },
        { id: "sY2", dateTime: `${YESTERDAY}T21:00:00`, fatigue: null, recovery: 5, part: "", pomodoroBlockId: "bY2" }
      ],
      blocks: [
        makeBlock({ id: "b1", title: "資料作成", completed: true }),
        makeBlock({ id: "b2", title: "軽い作業", completed: true }),
        makeBlock({ id: "b3", title: "筋トレ", completed: true }),
        makeBlock({ id: "b4", title: "散歩", completed: true }),
        makeBlock({ id: "b5", title: "未完了タスク", completed: false }),
        // 前日日付の完了Block(候補は当日分のみが対象。日付フィルタの負例)。
        makeBlock({ id: "bY1", title: "前日の重作業", completed: true, date: YESTERDAY }),
        makeBlock({ id: "bY2", title: "前日の充電作業", completed: true, date: YESTERDAY }),
        makeBlock({ id: "bY3", title: "前日完了タスク", completed: true, date: YESTERDAY })
      ],
      eveningNote: "夕方の会議が続いて疲れた"
    });
    await openKm();
    const html1 = await page.content();
    check("疲労3の候補が放電に出る(疲労3: 資料作成)", html1.includes("疲労3: 資料作成"));
    check("疲労2の候補は出ない", !html1.includes("疲労2: 軽い作業"));
    check("回復3の候補が充電に出る(回復3: 筋トレ)", html1.includes("回復3: 筋トレ"));
    check("回復2の候補は出ない", !html1.includes("回復2: 散歩"));
    check("完了Block名が候補に出る", html1.includes(">資料作成 <"));
    check("未完了Blockは完了Block候補に出ない", !html1.includes("未完了タスク"));
    check("前日日付の身体スキャン(疲労5)は当日候補に出ない(日付フィルタの負例)", !html1.includes("疲労5: 前日の重作業"));
    check("前日日付の身体スキャン(回復5)は当日候補に出ない(日付フィルタの負例)", !html1.includes("回復5: 前日の充電作業"));
    check("前日日付の完了Blockは当日候補に出ない(日付フィルタの負例)", !html1.includes("前日完了タスク"));
    const chargeCandTexts = await page.locator('[data-action="km-chip-candidate"][data-kind="charge"]').allTextContents();
    check("夜のひとことが充電候補に出る(放電には出ない=充電のみ)",
      chargeCandTexts.some((t) => t.includes("夕方の会議が続いて疲れた"))
        && !(await page.locator('[data-action="km-chip-candidate"][data-kind="discharge"]').allTextContents()).some((t) => t.includes("夕方の会議が続いて疲れた")));

    console.log("[2](b) タップで追加・使用済み薄表示・重複追加は無害にスキップ(候補タップ後の手入力同一テキストも)");
    const cand = page.locator('[data-action="km-chip-candidate"][data-kind="discharge"][data-text="疲労3: 資料作成"]');
    await cand.click();
    await page.waitForFunction(() => document.querySelectorAll('#km-discharge-list [data-action="km-chip-remove"]').length === 1);
    check("タップで放電リストに1件追加される", (await stateNow()).writeMeditations.find((w) => w.date === TODAY)?.discharge.length === 1);
    check("使用済み候補は薄表示(pointer-events:none)", (await cand.getAttribute("style") || "").includes("pointer-events:none"));
    await page.fill("#km-discharge-input", "疲労3: 資料作成");
    await page.click('[data-action="km-chip-add"][data-kind="discharge"]');
    // addWriteMeditationChip→saveState()は同期処理のため、クリックのawaitが返った時点で
    // 既にstateへ反映済み(固定waitは使わない)。
    check("同一テキストの重複追加は無害にスキップされる(1件のまま)",
      (await stateNow()).writeMeditations.find((w) => w.date === TODAY)?.discharge.length === 1);

    console.log("[3](b) 候補0件なら帯ごと非表示");
    await seed({ blocks: [], bodyScans: [], eveningNote: "" });
    await openKm();
    check("候補0件の放電欄には候補見出しが出ない", (await page.locator("#km-discharge-candidates-wrap").innerHTML()).trim() === "");
    check("候補0件の充電欄には候補見出しが出ない", (await page.locator("#km-charge-candidates-wrap").innerHTML()).trim() === "");

    // ============================================================
    // [4] JOURNAL_PROMPTS文言整理
    // ============================================================
    console.log("[4] JOURNAL_PROMPTS: 感謝/ハイライト/気付き・学びは誘導文に、自由記述/依頼は不変。見出し自体はどれも残る");
    const bodySeg = page.locator(".journal-segment-body");
    if (!(await bodySeg.evaluate((el) => el.open))) await bodySeg.locator("summary").click();
    await page.click(".journal-prompts summary");
    const promptsHtml = await page.locator(".journal-prompts").innerHTML();
    check("「🙏 感謝(3 つ)」見出しは残る", promptsHtml.includes("🙏 感謝(3 つ)"));
    check("「✨ 今日のハイライト」見出しは残る", promptsHtml.includes("✨ 今日のハイライト"));
    check("「💡 気付き・学び」見出しは残る", promptsHtml.includes("💡 気付き・学び"));
    // Codexレビュー指摘3(major): ハイライト・気付きの本文も感謝と同様に「誘導文になっている+
    // 旧文言が残っていない」を各見出しで個別assertする(promptsHtml全体へのincludesだと、
    // 他見出しの誘導文と混同して見出しごとの改修漏れを見逃す)。見出しごとの区間を切り出して検証する。
    function sectionOf(html, heading, nextHeading) {
      const start = html.indexOf(heading);
      const end = nextHeading ? html.indexOf(nextHeading, start) : html.length;
      return html.slice(start, end === -1 ? html.length : end);
    }
    const gratitudeSection = sectionOf(promptsHtml, "🙏 感謝(3 つ)", "✨ 今日のハイライト");
    const highlightSection = sectionOf(promptsHtml, "✨ 今日のハイライト", "💡 気付き・学び");
    const insightSection = sectionOf(promptsHtml, "💡 気付き・学び", "📝 自由記述");
    check("感謝: ヒントが「書く瞑想」誘導文になっている", gratitudeSection.includes("「書く瞑想」パネル(上)"));
    check("感謝: 旧文言(当たり前すぎて忘れがちな)が残っていない", !gratitudeSection.includes("当たり前すぎて忘れがちな"));
    check("ハイライト: ヒントが「書く瞑想」誘導文になっている", highlightSection.includes("「書く瞑想」パネル(上)"));
    check("ハイライト: 旧文言(今日いちばん心が動いた瞬間)が残っていない", !highlightSection.includes("今日いちばん心が動いた瞬間"));
    check("気付き・学び: ヒントが「書く瞑想」誘導文になっている", insightSection.includes("「書く瞑想」パネル(上)"));
    // 新文言は「うまくいった/いかなかった理由」という語句自体は意図的に踏襲している(旧プロンプトの
    // 要点を引き継ぎつつ移動先を示す文脈上のUX判断)ため、旧文言だけに含まれる後半の固有表現
    // (自分・他人・状況について)の消失で「丸ごとの旧文言」が残っていないことを判定する。
    check("気付き・学び: 旧文言(自分・他人・状況について、次に活かせること)が残っていない", !insightSection.includes("自分・他人・状況について"));
    // 「📝 自由記述」「依頼」は対象外の見出し。ヒント文言が元のまま(誘導文に書き換わっていない)ことだけを
    // その見出し自身の原文で確認する(感謝/ハイライトの誘導文と同じ語を含むため全文一致は使わない)。
    check("「📝 自由記述」のヒントは無改修(元の文言のまま)", promptsHtml.includes("言葉にならない違和感を、まず雑に書き出す"));
    check("「依頼」のヒントは無改修(元の文言のまま)", promptsHtml.includes("翌朝のバッチが読み取り"));

    // ============================================================
    // [5](a) dailyCloseゲート: 出る/「やる」でパネルへ
    // ============================================================
    console.log("[5](a) dailyCloseゲート: 当日writeMeditations未保存でgenerate-report押下→ゲートが出る");
    await seed({ blocks: [] });
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(() => !!document.querySelector('[data-action="km-gate-skip"]'));
    check("ゲートモーダルが開く", await page.locator(".modal-title", { hasText: "書く瞑想が未保存です" }).count() === 1);
    check("reports[TODAY]はまだ生成されない", !(await stateNow()).reports?.[TODAY]);

    console.log("[6](a) ゲート「やる」: モーダルが閉じ、書く瞑想segmentが開く");
    await page.click('[data-action="km-gate-do-it"]');
    await page.waitForFunction(() => !document.querySelector("#modalRoot")?.classList.contains("open"));
    check("モーダルが閉じる", await page.locator("#modalRoot.open").count() === 0);
    check("書く瞑想segmentが開く", await page.locator(".journal-segment-writeMeditation").evaluate((el) => el.open));
    check("「やる」ではreports[TODAY]は生成されない(パネルへ移るだけ)", !(await stateNow()).reports?.[TODAY]);

    // ============================================================
    // [7](a)(c) ゲート「スキップして生成」: 生成続行+同日再ゲートなし+state非汚染
    // ============================================================
    console.log("[7](a)(c) ゲート「スキップして生成」: 生成続行/同日は再ゲートなし/セッションフラグがstateへ漏れない");
    await seed({ blocks: [] });
    const sBeforeGate = await stateNow();
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(() => !!document.querySelector('[data-action="km-gate-skip"]'));
    await page.click('[data-action="km-gate-skip"]');
    await page.waitForFunction(({ KEY, TODAY }) => !!JSON.parse(localStorage.getItem(KEY)).reports?.[TODAY], { KEY: STATE_KEY, TODAY });
    const sAfterSkip = await stateNow();
    check("スキップして生成続行(reports[TODAY]が生成される)", !!sAfterSkip.reports[TODAY]);
    check("モーダルが閉じる", await page.locator("#modalRoot.open").count() === 0);
    // Codexレビュー指摘2(major): セッションフラグ(_writeMeditationGateSkippedDate)がstateの
    // どこにも漏れていないことを、reports更新のみを期待差分として除いた深い比較で検証する。
    // 少なくとも(a)state直下のキー集合が増えていない=新規stateキーとして漏れていない、
    // (b)settings/journalMeta/journals/writeMeditationsが不変、の2点を独立に確認する。
    const beforeKeys = Object.keys(sBeforeGate).sort();
    const afterKeys = Object.keys(sAfterSkip).sort();
    check("state直下のキー集合が増えていない(セッションフラグが新規stateキーとして漏れていない)",
      JSON.stringify(afterKeys) === JSON.stringify(beforeKeys),
      `追加=${JSON.stringify(afterKeys.filter((k) => !beforeKeys.includes(k)))} 消失=${JSON.stringify(beforeKeys.filter((k) => !afterKeys.includes(k)))}`);
    check("settingsはゲート操作で変化しない(セッションフラグの漏れなし)",
      JSON.stringify(sAfterSkip.settings) === JSON.stringify(sBeforeGate.settings));
    check("journalMetaはゲート操作で変化しない(セッションフラグの漏れなし)",
      JSON.stringify(sAfterSkip.journalMeta) === JSON.stringify(sBeforeGate.journalMeta));
    check("journalsはゲート操作で変化しない(セッションフラグの漏れなし)",
      JSON.stringify(sAfterSkip.journals) === JSON.stringify(sBeforeGate.journals));
    check("writeMeditationsはゲート操作前後で不変のまま(ゲートは代筆しない・セッションフラグの漏れなし)",
      JSON.stringify(sAfterSkip.writeMeditations) === JSON.stringify(sBeforeGate.writeMeditations));

    console.log("[8](a) 同日中に「日報を生成」を再度押してもゲートは再度出ない(セッション内フラグ)");
    // clock固定(page.clock.setFixedTime)のため2回目の生成内容・トーストのタイムスタンプは
    // 前回と字面が同一になりうる。「生成された」ことをcontent差分ではなく、いったんtoastを
    // 空にしてから再度同文言が立つこと(=generateReport()が実際にもう一度走った証跡)で見る。
    await page.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.textContent = ""; });
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "日報を生成しました");
    check("2回目はゲートモーダルが出ない(即再生成される)", (await page.locator('[data-action="km-gate-skip"]').count()) === 0);
    check("2回目もreports[TODAY]は生成された状態のまま", !!(await stateNow()).reports?.[TODAY]);

    // ============================================================
    // [9](a) 保存済みなら非表示
    // ============================================================
    console.log("[9](a) 書く瞑想が保存済みならゲートは出ない");
    await seed({ writeMeditations: [{ id: `wm_${TODAY}`, date: TODAY, discharge: [{ id: "d1", text: "会議ラッシュ" }], charge: [], dischargeTalk: "", chargeTalk: "", updatedAt: `${TODAY}T18:00:00`, deleted: false }], blocks: [] });
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(({ KEY, TODAY }) => !!JSON.parse(localStorage.getItem(KEY)).reports?.[TODAY], { KEY: STATE_KEY, TODAY });
    check("保存済みならゲートを経ずに即生成される", (await page.locator('[data-action="km-gate-skip"]').count()) === 0);
    check("reports[TODAY]が生成される", !!(await stateNow()).reports[TODAY]);

    // ============================================================
    // [10](b) 選択日が今日でなければゲート対象外
    // ============================================================
    // v85仕様(app.js起動処理)により、永続化したselectedDateは起動時に必ずtodayISO()へ
    // 強制される(過去日を見たまま離脱しても次回起動は today)。そのためseed()+reloadでは
    // 過去日を再現できず、起動後にアプリ内の「前日」ボタン(date-prev)で移動する。
    console.log("[10](b) 選択日が今日でなければ(=過去日の日報再生成)ゲート対象外");
    await seed({ blocks: [] });
    await page.click('[data-action="date-prev"]');
    await page.waitForFunction(({ KEY, YESTERDAY }) => JSON.parse(localStorage.getItem(KEY)).selectedDate === YESTERDAY, { KEY: STATE_KEY, YESTERDAY });
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(({ KEY, YESTERDAY }) => !!JSON.parse(localStorage.getItem(KEY)).reports?.[YESTERDAY], { KEY: STATE_KEY, YESTERDAY });
    check("過去日ではゲートを経ずに即生成される", (await page.locator('[data-action="km-gate-skip"]').count()) === 0);
    check("reports[前日]が生成される", !!(await stateNow()).reports[YESTERDAY]);

    // ============================================================
    // [11](d) 退行: 未完了理由チップモーダル→書く瞑想ゲートの順序
    // ============================================================
    console.log("[11](d) 退行: 未完了理由チップが残っている時は先にそちらが開き、解消後に書く瞑想ゲートが続く");
    await seed({ blocks: [makeBlock({ id: "blk1", title: "未完了A", completed: false })] });
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(() => !!document.querySelector('[data-action="incomplete-reason-skip"]'));
    check("先に未完了理由チップモーダルが開く(書く瞑想ゲートではない)",
      (await page.locator(".modal-title", { hasText: "未完了の理由" }).count()) === 1
        && (await page.locator('[data-action="km-gate-skip"]').count()) === 0);
    await page.click('[data-action="incomplete-reason-skip"]');
    await page.waitForFunction(() => !!document.querySelector('[data-action="km-gate-skip"]'));
    check("未完了理由を解消した直後に書く瞑想ゲートが続けて開く", (await page.locator('[data-action="km-gate-skip"]').count()) === 1);
    await dismissWriteMeditationGateIfOpen(page);

    console.log("[12](d) 390px: 候補チップ帯+dailyCloseゲートを含めても横スクロールが出ない");
    await seed({
      bodyScans: [{ id: "s1", dateTime: `${TODAY}T10:00:00`, fatigue: 4, recovery: null, part: "", pomodoroBlockId: "b1" }],
      blocks: [makeBlock({ id: "b1", title: "資料作成", completed: true })],
      eveningNote: "夕方の会議が続いて疲れた"
    });
    await openKm();
    const noHscrollCandidates = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check("候補チップ帯込みでも390px横スクロールなし", noHscrollCandidates);
    await page.click('[data-action="generate-report"]');
    await page.waitForFunction(() => !!document.querySelector('[data-action="km-gate-skip"]'));
    const noHscrollGate = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check("ゲートモーダル込みでも390px横スクロールなし", noHscrollGate);

    console.log(failures === 0 ? "\n✅ v296: 全テスト成功" : `\n❌ v296: ${failures} 件失敗`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
