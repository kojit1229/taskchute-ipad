// v300: AI関連機能整理(グループBのB-1/B-2/B-4 + グループC)の静的境界契約。
// 削除対象の不存在を固定し、実動作は既存のv59/v60/v62/v67/v75/v77/v86/v199が
// real-browser E2Eのまま検証する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const timelineSource = fs.readFileSync(path.join(ROOT, "src", "features", "timeline.js"), "utf8");
const syncSource = fs.readFileSync(path.join(ROOT, "src", "sync", "github.js"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log("[B-1] aiScheduleHistoryへの新規書き込みだけを削除");
check("recordScheduleHistory本体・呼び出しなし", !appSource.includes("recordScheduleHistory"));
check("aiScheduleHistoryへのpush/spliceなし", !/aiScheduleHistory\s*\.\s*(?:push|splice)\s*\(/.test(appSource));
check("旧履歴のnormalize互換は維持", appSource.includes("value.aiScheduleHistory = value.aiScheduleHistory.map"));

console.log("[B-2] aiLinkFreshness補完・更新経路を削除");
check("aiLinkFreshness参照なし", !appSource.includes("aiLinkFreshness"));
check("feedbackAt/planAt参照なし", !/\b(?:feedbackAt|planAt)\b/.test(appSource));
check("AIプラン鮮度専用fetchなし", !appSource.includes("fetchAiPlanFreshnessDate"));

console.log("[B-4] aiMitCandidates初期化残骸を削除");
check("aiMitCandidates参照なし", !appSource.includes("aiMitCandidates"));

console.log("[C] AIタスク候補を書かず、0秒思考テーマ自動取り込みは維持");
check("aiTaskCandidatesへのpushなし", !/aiTaskCandidates\s*\.\s*push\s*\(/.test(appSource));
check("廃止済み候補UIへの誘導トーストなし", !appSource.includes("AIの提案でタスク候補"));
check("autoIngestFeedback本体を維持", /\bfunction\s+autoIngestFeedback\b/.test(appSource));
check("0秒思考テーマ抽出・追加を維持",
  /\bfunction\s+extractZeroSecThemesFromReport\b/.test(appSource)
  && appSource.includes("state.zeroThinking.themes.push"));

console.log("[D/E/B-3] 明示的スコープ外を維持");
check("ai-schedule action/runAiSchedule/_scheduleDraftを維持",
  appSource.includes('"ai-schedule": () => runAiSchedule()')
  && /\bfunction\s+runAiSchedule\b/.test(appSource)
  && appSource.includes("_scheduleDraft")
  && timelineSource.includes('data-action="ai-schedule"'));
check("plan-step/AI引き継ぎ/AIインサイトを維持",
  appSource.includes('"plan-step-request"')
  && /\bfunction\s+putAiStepRequest\b/.test(appSource)
  && /\bfunction\s+aiInsightsPanelHTML\b/.test(appSource));
check("AIレポート・週次レビュー登録を維持",
  /\bfunction\s+renderAiReports\b/.test(appSource)
  && /\bfunction\s+addWeeklySuggestedTask\b/.test(appSource));
check("B-3の処理済みIDとpending復活防止を維持",
  appSource.includes("aiWorkProcessedIds")
  && appSource.includes("aiStepProcessedIds")
  && syncSource.includes("mergeStringIdSet(state.aiStepProcessedIds")
  && syncSource.includes("mergeAiStepPendingRequests(state.aiStepPendingRequests"));

console.log("[release] Service Worker");
const cacheVersion = Number(/CACHE_NAME\s*=\s*"taskchute-journal-pwa-v(\d+)"/.exec(swSource)?.[1]);
check("CACHE_NAMEがv300以上へ単調増加", cacheVersion >= 300, String(cacheVersion));

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nALL PASS");
