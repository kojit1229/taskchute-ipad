// v93: push前のローカルゲート用「コアセット」。
// npm test(全量、CIも同じ)は変更しない。これは push 前にローカルで毎回回す既定を
// 「速いが実質的にカバー範囲の広い」サブセットへ絞るための入口。
//
// 構成 = 直近5バージョン(動的: tests/のvNN.test.jsを番号降順で上位5、
//         新しいスイートが増えるたびに自動で追従する)
//       + 固定の横断コア5本(選定理由はCHANGES_test-infra.md参照。要約:)
//   - v72: privacy/同期ゲート(GitHub Contents APIへの移行と起動時ゲート)を
//          唯一直接検証しているスイート(helpers.jsのpassGithubGateを意図的に使わない)
//   - v59: 朝の一括プランニング=下書き(_scheduleDraft)機構。draft承認/却下/確定の代表
//   - v67: normalizeStateの新フィールド移行を最も広く踏む(4箇所参照+後方互換ケースを含む)
//   - v50: タイムライン上のスケジュール下書きD&D。タイムライン描画とdraft操作の複合
//   - v70: タイムラインカードの実行接点(いま開始/いま終了ボタン)描画
// 削除・スキップ・弱体化は一切していない — 対象は「pushのたびにローカルで何を回すか」の
// 既定だけで、npm test(全量)・CIは無改変。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DIR = __dirname;
const RECENT_COUNT = 5;
const FIXED_CORE = ["v72", "v59", "v67", "v50", "v70"];

const all = fs.readdirSync(DIR).filter((f) => /^v\d+\.test\.js$/.test(f));
const byVersionDesc = all
  .map((f) => ({ f, n: parseInt(f.match(/^v(\d+)/)[1], 10) }))
  .sort((a, b) => b.n - a.n);

const recentTokens = byVersionDesc.slice(0, RECENT_COUNT).map(({ f }) => f.replace(/\.test\.js$/, ""));
const tokens = [...new Set([...recentTokens, ...FIXED_CORE])];

console.log(`test:core 実行対象(直近${RECENT_COUNT}件 + 固定横断コア${FIXED_CORE.length}件、重複除き計${tokens.length}件): ${tokens.join(", ")}`);
console.log("※ push前ローカルゲートの既定。CI・npm test(全量)はこのファイルの影響を受けない。");

const started = Date.now();
const r = spawnSync("node", [path.join(DIR, "run-all.js"), ...tokens], { stdio: "inherit" });
const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
console.log(`test:core 所要時間: ${elapsedSec}s`);
process.exit(r.status === null ? 1 : r.status);
