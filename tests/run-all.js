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
const { spawn, spawnSync } = require("child_process");
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

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(__dirname, file)], {
      stdio: "inherit",
      detached: process.platform !== "win32"
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

(async () => {
  let failed = 0;
  for (const f of suites) {
    console.log(`\n===== ${f} =====`);
    const status = await runSuite(f);
    if (status !== 0) failed++;
  }
  console.log(failed ? `\n❌ ${failed} suite(s) failed` : "\n✅ All suites passed");
  process.exit(failed ? 1 : 0);
})();
