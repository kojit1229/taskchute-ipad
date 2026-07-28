// 全テストスイートを独立プロセス・独立ポートで実行する。既定は直列、--workers で安全に並列化できる。
//
// v60: 引数でスイートを絞り込めるようにした(開発中は関連スイート+最新スイートだけ回して
// 待ち時間を減らす運用のため)。引数なし = 従来通り全量(push前・CI用の安全網)。
//   node tests/run-all.js            → 全スイート
//   node tests/run-all.js v59 v60    → v59.test.js と v60.test.js のみ
//   node tests/run-all.js --shard=1/4 → 全スイートを4分割した第1シャード
//   node tests/run-all.js --list --shard=1/4 → 実行せず対象一覧だけ表示
//   node tests/run-all.js --group=fast-node → ブラウザ不要の高速スイート
//   node tests/run-all.js --group=smoke → 重要導線の固定スモーク
//   node tests/run-all.js --workers=2 → 2スイートを並列実行
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
// (20000〜62000の2000刻み、22通り)を選び、環境変数TEST_PORT_BASEとしてスイートへ渡す。
// 1スイート10ポートの帯を最大200スイートまで重ならない幅にする
// (tests/helpers.jsのrandomPort()がbase+index×10で採番する)。並行run間の衝突確率は
// 1/22以下(基底が偶然一致した場合のみ)に下がり、それでも衝突すればstartServer()の
// EADDRINUSEリトライ(v137で追加済み)で自己回復する。単一run内の衝突は従来どおり
// (同じbaseを共有する限り)数学的にゼロのまま。
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TEST_PORT_BASE_MIN = 20000;
const TEST_PORT_BASE_MAX = 62000;
const TEST_PORT_BASE_STEP = 2000;
const _basePickCount = (TEST_PORT_BASE_MAX - TEST_PORT_BASE_MIN) / TEST_PORT_BASE_STEP + 1;  // 22通り
const runPortBase = TEST_PORT_BASE_MIN + Math.floor(Math.random() * _basePickCount) * TEST_PORT_BASE_STEP;

const all = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const shardArg = args.find((arg) => arg.startsWith("--shard="));
const groupArg = args.find((arg) => arg.startsWith("--group="));
const workersArg = args.find((arg) => arg.startsWith("--workers="));
const filters = args.filter((arg) =>
  arg !== "--list"
  && !arg.startsWith("--shard=")
  && !arg.startsWith("--group=")
  && !arg.startsWith("--workers=")
);
let shard = null;
const group = groupArg ? groupArg.slice("--group=".length) : null;
const workers = workersArg ? Number(workersArg.slice("--workers=".length)) : 1;
const validGroups = new Set(["fast-node", "domain-e2e", "smoke"]);
const manifestPath = path.join(__dirname, "suite-manifest.json");
let suiteMetadata;

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  suiteMetadata = new Map(manifest.suites.map((suite) => [suite.file, suite]));
} catch (error) {
  console.log(`test manifestを読めません: ${error.message}`);
  process.exit(1);
}
const missingMetadata = all.filter((file) => !suiteMetadata.has(file));
const removedSuites = [...suiteMetadata.keys()].filter((file) => !all.includes(file));
// Must-3-1: staleness判定を二段階にする。missingMetadata(manifestに無いファイル)と
// removedSuites(消えたファイル)は分類漏れ=安全に関わるため従来どおりexit 1。
// staleSuites(sourceHash不一致のみ、ファイル自体はmanifestに存在)はテストを編集した
// 直後に必ず起きる無害な状態なので、警告表示に留めて実行を続行する
// (レビュー指摘 Must-3-1/Must-3: `app.js`やテストを1行直すだけで実行不能になる問題の是正)。
const staleSuites = all.filter((file) => {
  if (!suiteMetadata.has(file)) return false;
  const currentHash = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(__dirname, file), "utf8"))
    .digest("hex")
    .slice(0, 16);
  return suiteMetadata.get(file).sourceHash !== currentHash;
});
if (missingMetadata.length || removedSuites.length) {
  console.log("test manifestがtests/*.test.jsと一致しません(未分類/削除されたスイートがあります)。node scripts/test-manifest.js --writeを実行してください");
  if (missingMetadata.length) console.log(`manifestに無いsuite: ${missingMetadata.join(", ")}`);
  if (removedSuites.length) console.log(`manifestにだけ存在するsuite(実ファイルが無い): ${removedSuites.join(", ")}`);
  process.exit(1);
}
if (staleSuites.length) {
  // stderrへ出す(--listの出力をパースする側 = run-all-options.test.js等がstdoutを
  // ".test.js"終端フィルタで読んでいるため、警告行がstdoutに混じるとsuite名と誤認される)。
  console.error(`⚠ sourceHashが古いsuiteがあります(内容変更後、索引が未更新): ${staleSuites.join(", ")}`);
  console.error("  実行は続行します。push前に node scripts/test-manifest.js --write を実行してください。");
}

if (group && !validGroups.has(group)) {
  console.log(`不正なグループ指定です: ${group}(fast-node|domain-e2e|smoke)`);
  process.exit(1);
}
if (!Number.isInteger(workers) || workers < 1 || workers > 8) {
  console.log(`workersは1〜8の整数にしてください: ${workersArg}`);
  process.exit(1);
}

function isBrowserSuite(file) {
  return suiteMetadata.get(file).kind === "e2e";
}

function inGroup(file) {
  if (!group) return true;
  if (group === "fast-node") return !isBrowserSuite(file);
  if (group === "smoke") return suiteMetadata.get(file).tier === "smoke";
  return isBrowserSuite(file);
}

if (shardArg) {
  const match = shardArg.match(/^--shard=(\d+)\/(\d+)$/);
  if (!match) {
    console.log(`不正なシャード指定です: ${shardArg}(例: --shard=1/4)`);
    process.exit(1);
  }
  shard = { index: Number(match[1]), total: Number(match[2]) };
  if (shard.total < 1 || shard.index < 1 || shard.index > shard.total) {
    console.log(`シャード範囲が不正です: ${shardArg}`);
    process.exit(1);
  }
}

const grouped = all.filter(inGroup);
const filtered = filters.length
  ? grouped.filter((f) => filters.some((token) => f === `${token}.test.js` || f.includes(token)))
  : grouped;
const suites = shard
  ? filtered.filter((_, index) => index % shard.total === shard.index - 1)
  : filtered;

if ((filters.length || group) && !filtered.length) {
  console.log(`指定されたスイートが見つかりません: ${filters.join(", ")}`);
  console.log(`利用可能: ${all.join(", ")}`);
  process.exit(1);
}
if (filters.length) console.log(`実行対象(絞り込み): ${suites.join(", ")}`);
if (group) console.log(`実行対象(グループ ${group}): ${suites.length} suites`);
if (shard) console.log(`実行対象(シャード ${shard.index}/${shard.total}): ${suites.length}/${filtered.length} suites`);
if (listOnly) {
  suites.forEach((suite) => console.log(suite));
  process.exit(0);
}

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

const activeChildren = new Set();

// run-all.js自体がCtrl+Cや外部のtimeoutラッパーで中断された場合も、実行中の子(と
// そのChromium孫)を道連れにしてから終了する(残留防止)。
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    for (const child of activeChildren) killProcessTree(child.pid);
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
    activeChildren.add(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.log(`\n⏱ ${file} が${SUITE_TIMEOUT_MS / 1000}秒でタイムアウトしたため、プロセスツリーを強制終了します`);
      killProcessTree(child.pid);
    }, SUITE_TIMEOUT_MS);
    const finish = (status) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve(timedOut ? 1 : status);
    };
    child.on("exit", (code) => finish(code === 0 ? 0 : 1));
    child.on("error", () => finish(1));
  });
}

console.log(`ポート帯基底(TEST_PORT_BASE): ${runPortBase}(並行run間の衝突回避、v140)`);
console.log(`並列数: ${Math.min(workers, Math.max(suites.length, 1))}`);

(async () => {
  let failed = 0;
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < suites.length) {
      const index = nextIndex++;
      const file = suites[index];
      console.log(`\n===== ${file} =====`);
      const status = await runSuite(file, index);
      if (status !== 0) failed++;
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(workers, suites.length) },
    () => runWorker()
  ));
  console.log(failed ? `\n❌ ${failed} suite(s) failed` : "\n✅ All suites passed");
  process.exit(failed ? 1 : 0);
})();
