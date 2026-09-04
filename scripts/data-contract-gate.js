"use strict";
// scripts/data-contract-gate.js
// 単位13(S-K2, 5-C1, S3-1): アプリ(app.js/src/**)が読む personal-data 内パスの契約表と、
// (a) 書き手(loop/*.sh)の出力先文字列、(b) ローカルにclone済みなら実ファイル存在、を突合する。
// どちらかが不一致ならexit 1。personal-data未clone環境(CI)では(a)のみで判定しその旨をログへ出す。
// 過去(v314〜v327)は「モックが誤パスに固定」されていたためこのゲートが無くても6版DONE通過して
// いた(第3回領域3指摘)。実配置(loop出力先)を正として突合することでこれを防ぐ。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..", "..");
const DEFAULT_LOOP_DIR = process.env.DATA_CONTRACT_LOOP_DIR || path.join(WORKSPACE_ROOT, "loop");
const DEFAULT_PERSONAL_DATA_DIR = process.env.DATA_CONTRACT_PERSONAL_DATA_DIR
  || path.join(WORKSPACE_ROOT, "repos", "personal-data");

// 契約表: アプリが実際に読みに行くpersonal-data内パス(taskchute/前置後の実パス)。
// requiredPatterns は writer スクリプト全文に対し「すべて」マッチが必要な正規表現群
// (変数間接参照を1本のregexで追わず、値の連鎖を複数行の証跡として要求する)。
const CONTRACT = [
  {
    resolvedPath: "karada/health-daily.json",
    consumer: "src/features/health.js: fetchGitHubRawTextAtRoot(\"karada/health-daily.json\")",
    writerScript: "karada-daily.sh",
    requiredPatterns: [/\$REPO\/karada\/health-daily\.json/]
  },
  {
    resolvedPath: "taskchute/dashboard/ai-insights.json",
    consumer: "app.js: fetchGitHubRawText(\"dashboard/ai-insights.json\")",
    writerScript: "taskchute-insights.sh",
    requiredPatterns: [
      /PDATA="\$PERSONAL_REPO\/taskchute"/,
      /DASHBOARD_DIR="\$PDATA\/dashboard"/,
      /OUT_PATH="\$DASHBOARD_DIR\/ai-insights\.json"/
    ]
  },
  {
    resolvedPath: "taskchute/dashboard/fund.json",
    consumer: "src/features/fund.js: fetchGitHubRawText(\"dashboard/fund.json\")",
    // 対照実装(producer/consumer/実配置が一致、レビューで既に確認済み)。writer側の定常監視は
    // fund生成バッチが別体系(paper-trade/)のためこのゲートの対象外とし、(b)のみで検査する。
    writerScript: null,
    requiredPatterns: []
  }
];

function readIfExists(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return null; }
}

// contract/loopDir/personalDataDirを引数化し、テストからも呼べる純粋寄りの検査関数。
// 戻り値: { failures, personalDataCloned }。ログはlog()経由(既定console.log、テストは差し替え可)。
function runGate(contract, loopDir, personalDataDir, log = console.log) {
  let failures = 0;
  const personalDataCloned = fs.existsSync(personalDataDir);
  log(`[data-contract-gate] personal-data clone: ${personalDataCloned ? personalDataDir : "無し(CI想定・(a)のみで判定)"}`);

  for (const entry of contract) {
    log(`\n[data-contract-gate] ${entry.resolvedPath}`);
    log(`  consumer: ${entry.consumer}`);

    if (entry.writerScript) {
      const scriptPath = path.join(loopDir, entry.writerScript);
      const text = readIfExists(scriptPath);
      if (text === null) {
        failures++;
        log(`  NG (a) writerスクリプトが見つからない: ${scriptPath}`);
      } else {
        const missing = entry.requiredPatterns.filter((re) => !re.test(text));
        if (missing.length) {
          failures++;
          log(`  NG (a) ${entry.writerScript} に期待する出力先パターンが無い: ${missing.map(String).join(", ")}`);
        } else {
          log(`  OK  (a) ${entry.writerScript} の出力先パターンと一致`);
        }
      }
    } else {
      log("  -   (a) writer検証は対象外(対照実装)");
    }

    if (personalDataCloned) {
      const filePath = path.join(personalDataDir, entry.resolvedPath);
      if (fs.existsSync(filePath)) {
        log(`  OK  (b) 実ファイル存在: ${entry.resolvedPath}`);
      } else {
        failures++;
        log(`  NG (b) 実ファイルが無い: ${filePath}`);
      }
    } else {
      log("  -   (b) personal-data未cloneのためスキップ");
    }
  }
  return { failures, personalDataCloned };
}

if (require.main === module) {
  const { failures } = runGate(CONTRACT, DEFAULT_LOOP_DIR, DEFAULT_PERSONAL_DATA_DIR);
  if (failures) {
    console.error(`\n❌ data-contract-gate: ${failures} 件の不一致`);
    process.exit(1);
  }
  console.log("\n✅ data-contract-gate: すべて一致");
}

module.exports = { CONTRACT, runGate };
