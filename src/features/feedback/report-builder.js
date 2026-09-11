// Independent synchronous Markdown builder. Input comes from captureReportInput. No persistence or application imports.
function minutesOf(dateTime) {
  if (!dateTime) return 0;
  // v18: Date を経由せず、文字列から直接抽出(iOS Safari の TZ 解釈バグを回避)
  // "YYYY-MM-DDTHH:mm[:ss]" 形式から時:分を取り出す
  const m1 = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  // "HH:mm" 単独
  const m2 = /^(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return 0;
}

function timeFromDateTime(dateTime) {
  if (!dateTime) return "";
  // v18: Date を経由せず、文字列から直接抽出(TZ 解釈バグ回避)
  const m = /T(\d{1,2}):(\d{2})/.exec(dateTime);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  return "";
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function weekdayLabel(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][parseDate(date).getDay()];
}

function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function blockEverStarted(b) {
  return Boolean(b && (b.completed || b.actualStartAt || b.everStartedAt));
}

function hasIncompleteReason(block) {
  return Boolean(block && block.incompleteReason && block.incompleteReason.chip);
}

export function buildReportMarkdown(input) {
  const { state, date } = input;
  const blocks = input.blocks;
  const completed = blocks.filter((block) => block.completed);
  const charge = blocks.reduce((sum, block) => sum + Number(block.charge || 0), 0);
  const discharge = blocks.reduce((sum, block) => sum + Number(block.discharge || 0), 0);
  const morning = state.settings.morningEnergyLog[date] ?? 5;
  const net = morning + charge - discharge;

  // v61: 今日の理想ワンライナー(提案8)。達成/未達は判定しない(「翌日以降も残る」旨の文言は v230 のHome撤去で虚偽化したため単位11で削除)。
  const idealText = state.journalMeta[date]?.ideal || "";

  // v17: MIT(今日の主役)
  const mitBlocks = blocks.filter((b) => b.isMIT);
  const mitDone = mitBlocks.filter((b) => b.completed).length;

  // v17: ポモドーロ完了数
  const pomodoroCount = blocks.reduce((sum, b) => sum + Number(b.pomodoroCount || 0), 0);

  // v33: ホームの4つの達成率(スコアボードと同一ロジック)
  const rateTaskchute = input.derived.rateTaskchute;
  const rateMIT = {
    done: mitDone,
    total: mitBlocks.length,
    pct: mitBlocks.length ? Math.round((mitDone / mitBlocks.length) * 100) : 0
  };
  const rateRoutine = input.derived.rateRoutine;
  const rateCycleWeek = input.derived.rateCycleWeek;
  const cycleWeek = input.derived.cycleWeek;
  const rateDeferral = input.derived.rateDeferral;

  // v17: 計画 vs 実行
  const plannedMinutes = blocks.reduce((sum, b) => {
    if (b.plannedStartAt && b.plannedEndAt) {
      const s = minutesOf(b.plannedStartAt);
      const e = minutesOf(b.plannedEndAt);
      return sum + Math.max(0, e - s);
    }
    return sum;
  }, 0);
  const reportDurationMinutes = (b) => {
    if (b.actualStartAt && b.actualEndAt) {
      const actual = Math.max(0, minutesOf(b.actualEndAt) - minutesOf(b.actualStartAt));
      // v276(K指示2026-08-27): FLIGHT LOGは0分実績を保持し、日報集計だけ予定所要で補完する。
      if (actual > 0 || !b.plannedStartAt || !b.plannedEndAt) return actual;
    }
    if (!b.plannedStartAt || !b.plannedEndAt) return 0;
    return Math.max(0, minutesOf(b.plannedEndAt) - minutesOf(b.plannedStartAt));
  };
  const actualMinutes = blocks.filter((b) => b.completed)
    .reduce((sum, b) => sum + reportDurationMinutes(b), 0);
  const blockCompletionRate = blocks.length === 0 ? 0 : Math.round((completed.length / blocks.length) * 100);
  const timeCompletionRate = plannedMinutes === 0 ? 0 : Math.round((actualMinutes / plannedMinutes) * 100);
  const fmtMinutes = (m) => `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ""}`;

  // v17: カテゴリ別時間配分(完了 Block のみ)
  const catTime = {};
  completed.forEach((b) => {
    const dur = reportDurationMinutes(b);
    const cat = b.category || "未分類";
    catTime[cat] = (catTime[cat] || 0) + dur;
  });
  const catTimeRows = Object.entries(catTime)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, min]) => `- ${cat}: ${fmtMinutes(min)}`);

  // v17: 12WY プロジェクトの今日進んだこと(完了 Block を Project ごとに集約)
  const projectProgress = {};
  completed.forEach((b) => {
    if (!b.taskId) return;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task) return;
    const project = state.projects.find((p) => p.id === task.projectId);
    if (!project || project.kind === "wish") return;  // Wish は別セクション
    if (!project.twelveWeekStartDate) return;  // 12WY プロジェクトのみ
    projectProgress[project.title] = projectProgress[project.title] || [];
    projectProgress[project.title].push(b.title);
  });

  // v17: 進んだ Wish(完了したサブタスクの親 Wish)
  const wishProgress = {};
  completed.forEach((b) => {
    if (!b.taskId) return;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (!task || !task.parentTaskId) return;
    const wish = state.tasks.find((t) => t.id === task.parentTaskId);
    if (!wish) return;
    const wishProject = state.projects.find((p) => p.id === wish.projectId);
    if (!wishProject || wishProject.kind !== "wish") return;
    wishProgress[wish.title] = wishProgress[wish.title] || [];
    wishProgress[wish.title].push(b.title);
  });

  // v17: やり残し
  const incomplete = blocks.filter((b) => !b.completed);

  // v17: Block コメント抽出(comment があるもの)
  const commentedBlocks = blocks.filter((b) => b.comment && b.comment.trim());

  // v162 2系統レビュー対応(必須1・必須2): 未完了理由(state.blocksを直接見る。仕分けの
  // 手放す/延期はBlockをdeleted:true化するため、!deleted限定のblocksForDate=blocksからは
  // 既に外れている。それでも「その日なぜ完了しなかったか」の記録は残すため、deleted済みも
  // 含めて拾う)。対象日の条件は2つのORで判定する:
  //  (a) b.date === date — その日の予定だったBlock(日次締めで当日に理由記録した通常ケース)
  //  (b) incompleteReason.at がdate — 仕分け対象(carryableBlocks、前日Block)は b.date が
  //      前日のままなので(a)だけでは当日の日報に一切載らない(=台帳に永久に届かない)。
  //      記録した「その日」の日報に載せるため、記録時刻(at)の日付でも拾う。
  // (必須2): !b.completed も条件に加える。記録後にBlockが完了へ転じた場合、偽の「言い訳」を
  // 台帳へ流さないよう欄から除外する(incompleteReason自体は削除しない。履歴として残すが
  // 表示条件から外すだけ)。
  const incompleteReasonAtDate = (b) => String(b.incompleteReason?.at || "").slice(0, 10);
  const incompleteReasons = state.blocks.filter((b) =>
    hasIncompleteReason(b) && !b.completed && (b.date === date || incompleteReasonAtDate(b) === date));

  // v128: 体力予算。当日ログがある日のみ達成率表の後に1行出力する(データなし日は省略)。
  const conditionBudgetToday = input.derived.conditionBudget;

  const lines = [
    `# 日報 ${date} (${weekdayLabel(date)})`,
    "",
    // v61: 今日の理想ワンライナー(未入力日は行ごと出さない)
    ...(idealText ? [`> 🌱 今日の理想: ${idealText}`, ""] : []),
    "## 1. サマリ",
    "| 指標 | 値 |",
    "|---|---|",
    `| 朝の体調 | ${morning} / 10 |`,
    `| 充電収支 | +${charge} / -${discharge} = ${signed(net - morning)} (起点${morning}→終値${net}) |`,
    `| Block 実行 | ${completed.length} / ${blocks.length} (${blockCompletionRate}%) |`,
    `| 時間実行 | ${fmtMinutes(actualMinutes)} / ${fmtMinutes(plannedMinutes)} (${timeCompletionRate}%) |`,
    `| MIT 達成 | ${mitDone} / ${mitBlocks.length} |`,
    `| ポモドーロ | ${pomodoroCount} 回 |`,
    "",
    "### 達成率",
    "| 指標 | 達成 | 率 |",
    "|---|---|---|",
    `| タスクシュート着手率 | ${rateTaskchute.done} / ${rateTaskchute.total} | ${rateTaskchute.pct}% |`,
    `| 今日の主役 (MIT) | ${rateMIT.done} / ${rateMIT.total} | ${rateMIT.pct}% |`,
    `| ルーティン実行率 | ${rateRoutine.done} / ${rateRoutine.total} | ${rateRoutine.pct}% |`,
    `| 12週 今週の進捗(Week ${cycleWeek}/12) | ${rateCycleWeek.done} / ${rateCycleWeek.total} | ${rateCycleWeek.pct}% |`,
    `| 先送り | ${rateDeferral.pending}件 | ${rateDeferral.started} / ${rateDeferral.total} |`,
    "",
    ...(conditionBudgetToday.level !== "none"
      ? [`体力予算: ${input.derived.conditionLabel}${conditionBudgetToday.reason ? `(${conditionBudgetToday.reason})` : ""}`, ""]
      : []),
  ];

  // 修正フェーズ単位11(2026-09-04): v68の「## AIへの質問」節はK6裁定で撤去(#reportAskInput
  // 入力欄がv214で失われて以来、origin:"user"の問いが積まれる経路が無く節は永久に空だった)。

  // v34/v39: 0秒思考(その日に書いたもの、書いた順)。v39 で問い別にグルーピング。
  const ztToday = (state.zeroThinking?.entries || [])
    .filter((e) => e.date === date)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  if (ztToday.length) {
    lines.push("## 🧠 0秒思考");
    lines.push("");
    const underQuestion = ztToday.filter((e) => e.questionId);
    const standalone = ztToday.filter((e) => !e.questionId);
    // 問いに紐づくものは問いごとにまとめる
    const byQ = {};
    underQuestion.forEach((e) => { (byQ[e.questionId] ||= []).push(e); });
    Object.entries(byQ).forEach(([qid, entries]) => {
      const q = (state.questions || []).find((x) => x.id === qid);
      lines.push(`### 【問い】${q ? q.text : entries[0].theme}`);
      lines.push("");
      entries.forEach((e) => {
        if (e.theme && e.theme !== (q && q.text)) lines.push(`**${e.theme}**`);
        lines.push(e.body);
        lines.push("");
      });
    });
    standalone.forEach((e) => {
      lines.push(`### ${e.theme}`);
      lines.push("");
      lines.push(e.body);
      lines.push("");
    });
  }

  // MIT セクション
  if (mitBlocks.length > 0) {
    lines.push("## 2. 今日の主役 (MIT)");
    mitBlocks.forEach((b) => {
      lines.push(`- ${b.completed ? "✅" : "⬜"} ${b.title}`);
    });
    lines.push("");
  }

  // 12WY プロジェクト進捗
  if (Object.keys(projectProgress).length > 0) {
    lines.push("## 3. 12WY プロジェクトの進捗");
    Object.entries(projectProgress).forEach(([projectName, items]) => {
      lines.push(`### ${projectName}`);
      items.forEach((t) => lines.push(`- ${t}`));
    });
    lines.push("");
  }

  // 進んだ Wish
  if (Object.keys(wishProgress).length > 0) {
    lines.push("## 4. 今日進んだ Wish");
    Object.entries(wishProgress).forEach(([wishTitle, items]) => {
      lines.push(`### ${wishTitle}`);
      items.forEach((t) => lines.push(`- ${t}`));
    });
    lines.push("");
  }

  // 時間の使い方
  lines.push("## 5. 時間の使い方");
  if (catTimeRows.length > 0) {
    lines.push("### カテゴリ別配分");
    lines.push(...catTimeRows);
    lines.push("");
  }
  lines.push("### 実行 Block(時刻順)");
  lines.push("| 時刻 | 内容 | カテゴリ | 充電/放電 | コメント |");
  lines.push("|---|---|---|---|---|");
  const sortedBlocks = [...blocks].sort((a, b) => (a.plannedStartAt || "").localeCompare(b.plannedStartAt || ""));
  sortedBlocks.forEach((b) => {
    const time = b.plannedStartAt ? timeFromDateTime(b.plannedStartAt) : "—";
    const status = b.completed ? "✅" : (b.isMIT ? "★" : "⬜");
    const comment = (b.comment || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${time} | ${status} ${b.title} | ${b.category || "—"} | +${b.charge || 0}/-${b.discharge || 0} | ${comment} |`);
  });
  lines.push("");

  // v129/v295: 当日分の身体スキャン(Block完了時の疲労0-5+回復0-5+任意部位)。時刻順。
  // 1件も無い日は節ごと省略。recoveryが無い過去レコード(v295以前)は「—」表示(0と区別)。
  const bodyScansToday = (state.bodyScans || [])
    .filter((s) => (s.dateTime || "").startsWith(date))
    .sort((a, b) => (a.dateTime || "").localeCompare(b.dateTime || ""));
  if (bodyScansToday.length > 0) {
    lines.push("### 身体スキャン");
    lines.push("| 時刻 | 疲労 | 回復 | 部位 |");
    lines.push("|---|---|---|---|");
    bodyScansToday.forEach((s) => {
      const time = s.dateTime ? timeFromDateTime(s.dateTime) : "—";
      lines.push(`| ${time} | ${s.fatigue ?? "—"} | ${s.recovery ?? "—"} | ${s.part || "—"} |`);
    });
    lines.push("");
  }

  // やり残し
  if (incomplete.length > 0) {
    lines.push("## 6. やり残し");
    incomplete.forEach((b) => {
      lines.push(`- ${b.isMIT ? "★ " : ""}${b.title}${b.category ? ` (${b.category})` : ""}${blockEverStarted(b) ? "" : " (未着手)"}`);
    });
    lines.push("");
  }

  // Block コメント抜粋
  if (commentedBlocks.length > 0) {
    lines.push("## 7. Block 内のコメント");
    commentedBlocks.forEach((b) => {
      lines.push(`### ${b.title}`);
      lines.push(b.comment.trim());
      lines.push("");
    });
  }

  // v162: 未完了理由(理由が1件以上ある日のみ節を出す。excuse-ledger-extract.pyが
  // この節のみを機械パースする=FORMAT_CONTRACT.md参照。あえて番号を振らず既存の
  // 「## 6.」「## 7.」等の連番を崩さない=「## AIへの質問」等と同じ非番号見出しの型)
  if (incompleteReasons.length > 0) {
    lines.push("## 未完了理由");
    incompleteReasons.forEach((b) => {
      const note = (b.incompleteReason.note || "").replace(/\n/g, " ").trim();
      lines.push(`- [${b.title}] ${b.incompleteReason.chip}${note ? `: ${note}` : ""}`);
    });
    lines.push("");
  }

  // v294: 書く瞑想(充放電ログ改善R1a)。独立state(state.writeMeditations)を出力するだけで、
  // state.journals[date]には一切書き込まない(journal-anatomy.md §3のFREE NOTE二重上書き
  // リスクを回避する設計)。当日レコードが無い/全空の日は節ごと省略(bodyScans節と同じ作法)。
  const writeMeditationEntry = (state.writeMeditations || []).find((w) => w.date === date && !w.deleted);
  const wmDischarge = writeMeditationEntry?.discharge || [];
  const wmCharge = writeMeditationEntry?.charge || [];
  const wmDischargeTalk = (writeMeditationEntry?.dischargeTalk || "").trim();
  const wmChargeTalk = (writeMeditationEntry?.chargeTalk || "").trim();
  if (wmDischarge.length > 0 || wmCharge.length > 0 || wmDischargeTalk || wmChargeTalk) {
    lines.push("## 書く瞑想");
    if (wmDischarge.length > 0) {
      lines.push("### 放電");
      wmDischarge.forEach((c) => lines.push(`- ${c.text}`));
      lines.push("");
    }
    if (wmCharge.length > 0) {
      lines.push("### 充電");
      wmCharge.forEach((c) => lines.push(`- ${c.text}`));
      lines.push("");
    }
    if (wmDischargeTalk) lines.push("### 深掘り(放電)", wmDischargeTalk, "");
    if (wmChargeTalk) lines.push("### 深掘り(充電)", wmChargeTalk, "");
  }

  // Measured values are independent of the legacy planned-time fallback above.
  const actuals = input.actuals || [];
  const cell = value => String(value).replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
  lines.push("## 計測した実績", "", "| Block番号 | 帰属日 | 開始 | 終了 | 時間 | Task完了 |",
    "|---|---|---|---|---|---|");
  actuals.forEach(row => lines.push(`| ${cell(row.blockId)} | ${cell(row.date)} | ${cell(row.actualStartAt) || "未記録"} | ${cell(row.actualEndAt)} | ${row.minutes == null ? "未記録" : `${row.minutes}分`} | ${row.taskCompleted ? "完了" : "未完了"} |`));
  lines.push("", `計測合計: ${actuals.reduce((sum, row) => sum + (row.minutes ?? 0), 0)}分`,
    `予定時間を補った集計(従来): ${fmtMinutes(actualMinutes)}`, "");

  // ジャーナル
  lines.push("## 8. ジャーナル");
  lines.push(state.journals[date] || "(ジャーナル記載なし)");
  lines.push("");

  // 明日への接続
  lines.push("## 9. 明日への接続");
  // 修正フェーズ単位11(2026-09-04): 「明日・明後日もホームに小さく残ります…3日目に続けるか
  // 手放すか」の文言はv230のHome撤去で当該UI(3日リトライ)自体が無くなり虚偽記述と化していたため
  // 削除(2-H1裁定)。理想ワンライナー自体は冒頭`> 🌱 今日の理想:`行で引き続き表示する。
  lines.push("明日への一言:");
  lines.push("");
  lines.push("明日の MIT 候補:");
  lines.push("- ");
  lines.push("- ");
  lines.push("- ");
  lines.push("");

  // AI フィードバック用プロンプト(コピペ用)
  lines.push("---");
  lines.push("");
  lines.push("## 📋 AI へのコピペ用プロンプト");
  lines.push("```");
  lines.push("以下は今日の日報です。");
  lines.push("");
  lines.push("1. 客観事実から見える「良かった点・改善できる点」");
  lines.push("2. パターンとして気をつけたいこと");
  lines.push("3. 明日への具体的な提案(2〜3個)");
  lines.push("4. この日報を踏まえ、明日「0秒思考」で思考を深めるべきテーマ(2〜3個)");
  lines.push("   ※ 各テーマは1分で書き出せる問い形式で示すこと");
  lines.push("5. 明日の MIT 候補(最大3つ)");
  lines.push("   ※ 「明日のMIT候補」という見出しの下に「- 」の箇条書きで示すこと");
  // v39: 開いている問い(10x)を提示し、問いを一段深める明日のテーマを求める
  const openQuestions = (state.questions || []).filter((q) => !q.deleted && q.status !== "settled");
  if (openQuestions.length) {
    lines.push("");
    lines.push("いま持ち続けている「問い」:");
    openQuestions.slice(0, 5).forEach((q) => lines.push(`- ${q.text}`));
    lines.push("");
    lines.push("6. 上の各問いを一段深める明日のテーマを最大2つ提案せよ。");
    lines.push("   答えを出すのではなく、より良い問いへの分解を優先すること。");
  }
  lines.push("");
  lines.push("の観点で、簡潔にフィードバックをください。");
  lines.push("(辛口でも構いません、ただし行動に繋がる具体性を重視)");
  lines.push("");
  lines.push("レビュー結果は Markdown 形式の .md ファイルとして出力してください。");
  // v42: 出力フォーマットを固定(アプリのパーサ前提)。頑健性はプロンプト側で買う。
  lines.push("");
  lines.push("回答は必ず次の見出し構成で出力してください。各候補は「- 」で始まる箇条書き。");
  lines.push("## フィードバック");
  lines.push("## 明日の0秒思考テーマ");
  lines.push("## MIT候補");
  lines.push("## 問い候補");
  lines.push("該当がないセクションは見出しごと省略してください。");
  lines.push("```");

  const report = lines.join("\n");
  return report;
}
