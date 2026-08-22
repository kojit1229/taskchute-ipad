// v235 検証: 主観睡眠時間(condition.logs.sleepHours)の入力UI・書き込み経路だけを廃止し、
// 旧stateと、実測欠損時に旧主観値を読む日次結合の後方互換は維持する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");

const ROOT = path.join(__dirname, "..");
const journalSource = fs.readFileSync(path.join(ROOT, "src", "features", "journal.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

function functionSource(source, name) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const node = ast.body.find((entry) => entry.type === "FunctionDeclaration" && entry.id?.name === name);
  if (!node) throw new Error(`${name} declaration not found`);
  return source.slice(node.start, node.end);
}

console.log("[1] journalの主観睡眠入力UI・action・書き込み関数は廃止され、旧state既定形は残る");
check("睡眠プリセットUIが無い", !journalSource.includes('data-action="set-sleep"'));
check("set-sleep action登録が無い", !journalSource.includes('"set-sleep":'));
check("setConditionSleep書き込み関数が無い", !journalSource.includes("function setConditionSleep"));
check("睡眠プリセット定数が無い", !journalSource.includes("CONDITION_SLEEP_PRESETS"));
check("旧state互換のsleepHours:null既定形は温存", /sleepHours:\s*null/.test(journalSource));

console.log("[2] 日次結合は実測ありなら実測を優先し、旧主観値へフォールバックしない");
const sandbox = { state: { sleep: { logs: {} }, condition: { logs: {} }, blocks: [] } };
vm.createContext(sandbox);
vm.runInContext([
  functionSource(appSource, "toNumber"),
  functionSource(appSource, "computeDailyMetrics"),
  "this.computeDailyMetrics = computeDailyMetrics;"
].join("\n"), sandbox);

sandbox.state.sleep.logs["2026-08-20"] = { sleepH: 6.5, eff: 90 };
sandbox.state.condition.logs["2026-08-20"] = { sleepHours: 9 };
const measured = sandbox.computeDailyMetrics("2026-08-20");
check("実測あり日はsleepHFinal=6.5", measured.sleepHFinal === 6.5, JSON.stringify(measured));
check("実測あり日は主観フォールバック注釈なし", measured.sleepHIsSubjective === false, JSON.stringify(measured));

console.log("[3] 実測なし・旧主観ありなら従来どおり旧主観値へフォールバックする");
sandbox.state.condition.logs["2026-08-21"] = { sleepHours: 7 };
const legacy = sandbox.computeDailyMetrics("2026-08-21");
check("実測なし日はsleepHFinal=旧主観7", legacy.sleepHFinal === 7, JSON.stringify(legacy));
check("実測なし日は主観フォールバック注釈あり", legacy.sleepHIsSubjective === true, JSON.stringify(legacy));

if (failures) {
  console.error(`\n❌ v235: ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ v235: 全テストPASS");
