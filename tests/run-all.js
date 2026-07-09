// 全E2Eスイートを直列実行(各スイートは独立プロセス・独立ポート)。1つでも落ちたら exit 1。
//
// v60: 引数でスイートを絞り込めるようにした(開発中は関連スイート+最新スイートだけ回して
// 待ち時間を減らす運用のため)。引数なし = 従来通り全量(push前・CI用の安全網)。
//   node tests/run-all.js            → 全スイート
//   node tests/run-all.js v59 v60    → v59.test.js と v60.test.js のみ
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const all = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
const filters = process.argv.slice(2);
const suites = filters.length
  ? all.filter((f) => filters.some((token) => f === `${token}.test.js` || f.includes(token)))
  : all;

if (filters.length && !suites.length) {
  console.log(`指定されたスイートが見つかりません: ${filters.join(", ")}`);
  console.log(`利用可能: ${all.join(", ")}`);
  process.exit(1);
}
if (filters.length) console.log(`実行対象(絞り込み): ${suites.join(", ")}`);

let failed = 0;
for (const f of suites) {
  console.log(`\n===== ${f} =====`);
  const r = spawnSync("node", [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n❌ ${failed} suite(s) failed` : "\n✅ All suites passed");
process.exit(failed ? 1 : 0);
