// 全E2Eスイートを直列実行(各スイートは独立プロセス・独立ポート)。1つでも落ちたら exit 1。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const suites = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of suites) {
  console.log(`\n===== ${f} =====`);
  const r = spawnSync("node", [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n❌ ${failed} suite(s) failed` : "\n✅ All suites passed");
process.exit(failed ? 1 : 0);
