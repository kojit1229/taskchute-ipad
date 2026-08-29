// v299: AI関連機能整理(グループA削除)の静的契約。
// Test-Reduction: 削除済み機能を実行する旧テストに代えて、本体・action・一時stateの不存在と
// スコープ外(D/E/B-3)の維持を同時に固定する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const timelineSource = fs.readFileSync(path.join(ROOT, "src", "features", "timeline.js"), "utf8");
const syncSource = fs.readFileSync(path.join(ROOT, "src", "sync", "github.js"), "utf8");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const runtimeSource = [appSource, timelineSource, syncSource, swSource].join("\n");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log("[A-1] 朝プランaction・決定論配置経路");
check("ai-morning-plan actionなし", !appSource.includes('"ai-morning-plan"'));
check("runAiMorningPlan本体なし", !/\bfunction\s+runAiMorningPlan\b/.test(appSource));
check("fallbackMorningPlan本体なし", !/\bfunction\s+fallbackMorningPlan\b/.test(appSource));
check("aiScheduleCandidates本体なし", !/\bfunction\s+aiScheduleCandidates\b/.test(appSource));
check("_morningPlanInFlightなし", !appSource.includes("_morningPlanInFlight"));

console.log("[A-2] today再プラン依頼・ポーリング経路");
check("today-replan actionなし", !appSource.includes('"today-replan"'));
check("requestReplan本体なし", !/\bfunction\s+requestReplan\b/.test(appSource));
check("再プラン一時stateなし", !appSource.includes("_replanPending") && !appSource.includes("_replanUi"));
check("再プランポーリング定数なし", !/\bREPLAN_(?:POLL|TIMEOUT)/.test(appSource));
check("再プランrequest/response endpointなし", !/replan-(?:request|response)\.json/.test(appSource));

console.log("[A-3] AIプラン由来0秒思考テーマ選定UI");
check("zeroSecThemeBarHTMLなし", !runtimeSource.includes("zeroSecThemeBarHTML"));
check("zerosec-theme-add/skip actionなし", !/zerosec-theme-(?:add|skip)/.test(runtimeSource));
check("_zeroSecThemeDraftなし", !appSource.includes("_zeroSecThemeDraft"));
check("timelineから削除済みテーマバーを注入しない", !timelineSource.includes("zeroSecTheme"));

console.log("[A-4] aiPlanSkippedLog");
check("normalize補完・書き込みともなし", !appSource.includes("aiPlanSkippedLog"));
check("上限定数なし", !appSource.includes("AI_PLAN_SKIPPED_LOG_MAX"));

console.log("[A-5] AIプランschema取得・適用経路");
check("tryFetchAiPlan本体・コメントともなし", !runtimeSource.includes("tryFetchAiPlan"));
check("AIプランschemaのplan配列適用なし", !appSource.includes("data.plan.map"));

console.log("[D/E/B-3] スコープ外の維持");
check("ai-schedule actionを維持", appSource.includes('"ai-schedule": () => runAiSchedule()'));
check("runAiScheduleを維持", /\bfunction\s+runAiSchedule\b/.test(appSource));
check("_scheduleDraftを維持", appSource.includes("_scheduleDraft"));
check("timelineの下書きスケジュールボタンを維持", timelineSource.includes('data-action="ai-schedule"'));
check("AIフィードバック自動取り込みを維持", /\bfunction\s+autoIngestFeedback\b/.test(appSource));
check("FB由来0秒思考テーマ抽出を維持", /\bfunction\s+extractZeroSecThemesFromReport\b/.test(appSource));
check("aiWorkProcessedIdsを維持", appSource.includes("aiWorkProcessedIds"));
check("aiStepProcessedIds集合和とpending剪定を維持",
  syncSource.includes("mergeStringIdSet(state.aiStepProcessedIds") &&
  syncSource.includes("mergeAiStepPendingRequests(state.aiStepPendingRequests") &&
  syncSource.includes("aiStepSettledIds"));

console.log("[release] Service Worker");
const cacheVersion = swSource.match(/CACHE_NAME\s*=\s*"taskchute-journal-pwa-v(\d+)"/);
check("CACHE_NAMEがv299以上", cacheVersion && Number(cacheVersion[1]) >= 299);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nALL PASS");
