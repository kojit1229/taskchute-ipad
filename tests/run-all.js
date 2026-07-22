// 全E2Eスイートを直列実行(各スイートは独立プロセス・独立ポート)。1つでも落ちたら exit 1。
//
// v60: 引数でスイートを絞り込めるようにした(開発中は関連スイート+最新スイートだけ回して
// 待ち時間を減らす運用のため)。引数なし = 従来通り全量(push前・CI用の安全網)。
//   node tests/run-all.js            → 全スイート
//   node tests/run-all.js v59 v60    → v59.test.js と v60.test.js のみ
//
// v137(review.md:34): 親プロセス(このrun-all.js)がtimeout/Ctrl+C等で中断された際、
// spawnSyncの直接killだけでは各スイートが起動したChromiumの孫プロセスが残留していた。
// spawn(非同期)+スイートごとのtimeout+プロセスツリー単位のkillに変更する
// (テストランナーのみの変更。各tests/vNN.test.js自体の検証内容は一切変えていない)。
//
// v137追加調査(2026-07-22、K指示): CIで全量実行中にEADDRINUSEでスイートが1件クラッシュする
// 事象を観測した。本ファイルは逐次実行(1スイート完全終了後に次を起動)であり、タイムアウト/
// kill(上記)も発生していなかったことをCIログで確認済みのため、本ファイル自体の並行実行バグ
// ではない。原因を問わず「単一run内で異なるスイートが同じport番号を引く」ケースを数学的に
// ゼロにするため、各スイートへ環境変数TEST_PORT_INDEXで一意な連番を渡す
// (tests/helpers.jsのrandomPort()がこれを見てスイートごとの専用帯から採番する)。
//
// v140(Codexレビュー Med-4): 上記TEST_PORT_INDEXの帯(1スイートあたり10番)は、この
// run-all.js自身の起動ごとに常に同じ基底(20000)から割り当てていたため、v93が本来防ぎたかった
// シナリオ(2ターミナルでの同時実行、CIとローカルpush前ゲートが重なる等)に対しては退行していた
// (並行run同士は依然として同じport帯を使い衝突しうる)。run-all.js起動ごとにランダムな基底
// (20000〜38000の1000刻み、19通り)を選び、環境変数TEST_PORT_BASEとしてスイートへ渡す
// (tests/helpers.jsのrandomPort()がbase+index×10で採番する)。並行run間の衝突確率は
// 1/19以下(基底が偶然一致した場合のみ)に下がり、それでも衝突すればstartServer()の
// EADDRINUSEリトライ(v137で追加済み)で自己回復する。単一run内の衝突は従来どおり
// (同じbaseを共有する限り)数学的にゼロのまま。
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEST_PORT_BASE_MIN = 20000;
const TEST_PORT_BASE_MAX = 38000;
const TEST_PORT_BASE_STEP = 1000;
const _basePickCount = (TEST_PORT_BASE_MAX - TEST_PORT_BASE_MIN) / TEST_PORT_BASE_STEP + 1;  // 19通り
const runPortBase = TEST_PORT_BASE_MIN + Math.floor(Math.random() * _basePickCount) * TEST_PORT_BASE_STEP;

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

// 1スイートあたりの上限。通常は数十秒〜1分程度で終わる想定のため、ハングしたスイートを
// 検知するには十分大きく、CI全体を無駄に長時間ブロックしない程度の値にしている。
const SUITE_TIMEOUT_MS = 3 * 60 * 1000;

// 子(node tests/vNN.test.js)とその孫(Chromium)をまとめて確実に終了させる。
// POSIX: spawn時にdetached:trueでプロセスグループのリーダーにしておき、負のpidを
//        killすることでグループ全体(=孫プロセス含む)へシグナルを送る。
// Windows: taskkill /T がプロセスツリーを辿って終了させる(detachedである必要はない)。
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch {}
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

let currentChild = null;

// run-all.js自体がCtrl+Cや外部のtimeoutラッパーで中断された場合も、実行中の子(と
// そのChromium孫)を道連れにしてから終了する(残留防止)。
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    if (currentChild) killProcessTree(currentChild.pid);
    process.exit(1);
  });
});

function runSuite(file, index) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(__dirname, file)], {
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: { ...process.env, TEST_PORT_INDEX: String(index), TEST_PORT_BASE: String(runPortBase) }
    });
    currentChild = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.log(`\n⏱ ${file} が${SUITE_TIMEOUT_MS / 1000}秒でタイムアウトしたため、プロセスツリーを強制終了します`);
      killProcessTree(child.pid);
    }, SUITE_TIMEOUT_MS);
    const finish = (status) => {
      clearTimeout(timer);
      if (currentChild === child) currentChild = null;
      resolve(timedOut ? 1 : status);
    };
    child.on("exit", (code) => finish(code === 0 ? 0 : 1));
    child.on("error", () => finish(1));
  });
}

console.log(`ポート帯基底(TEST_PORT_BASE): ${runPortBase}(並行run間の衝突回避、v140)`);

(async () => {
  let failed = 0;
  for (let i = 0; i < suites.length; i++) {
    const f = suites[i];
    console.log(`\n===== ${f} =====`);
    const status = await runSuite(f, i);
    if (status !== 0) failed++;
  }
  console.log(failed ? `\n❌ ${failed} suite(s) failed` : "\n✅ All suites passed");
  process.exit(failed ? 1 : 0);
})();
