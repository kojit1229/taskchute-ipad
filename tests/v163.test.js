// v163に残るService Workerキャッシュ更新契約の回帰テスト。
// v213で削除対象機能に固有のassertionだけを除去し、この独立した検証は維持する。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

check(
  "SW CACHE_NAMEはv163以降(後続リリースのバンプで更新。v163時点の検証意図はバンプ実施の確認)",
  /^const CACHE_NAME = "taskchute-journal-pwa-v(\d+)";/m.test(swSource)
    && Number(swSource.match(/^const CACHE_NAME = "taskchute-journal-pwa-v(\d+)";/m)[1]) >= 163
);

console.log(failures === 0 ? "\n✅ v163 ALL PASS" : `\n❌ v163: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
