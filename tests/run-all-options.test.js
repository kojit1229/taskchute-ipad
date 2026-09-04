"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const runner = path.join(__dirname, "run-all.js");

function list(...args) {
  const result = spawnSync(process.execPath, [runner, "--list", ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  // 行全体がsuiteファイル名だけの行を拾う(endsWithだけだと、絞り込み指定時に出る
  // 「実行対象(絞り込み): x.test.js」のような案内行も.test.jsで終わるため誤って
  // suite扱いしてしまう。単体名フィルタのテスト追加(H-4対応)で顕在化)。
  return result.stdout.split(/\r?\n/).filter((line) => /^[\w.-]+\.test\.js$/.test(line));
}

const all = list();
const fast = list("--group=fast-node");
const smoke = list("--group=smoke");
const domain = list("--group=domain-e2e");

assert(all.includes("run-all-options.test.js"), "runner自身の高速Nodeテストが一覧に含まれる");
assert(fast.includes("release-record.test.js"), "release記録テストはfast-node");
assert(fast.includes("v163.test.js"), "ブラウザ不要のv163契約テストはfast-node");
assert(smoke.includes("v72.test.js"), "同期ゲートの代表をsmokeに含める");
assert.strictEqual(fast.filter((file) => domain.includes(file)).length, 0, "fast-nodeとdomain-e2eは重複しない");
assert.deepStrictEqual([...fast, ...domain].sort(), [...all].sort(), "fast-nodeとdomain-e2eの和集合が全スイート");
assert(smoke.every((file) => domain.includes(file)), "smokeはdomain-e2eの部分集合");

const shards = [1, 2, 3, 4].flatMap((index) => list(`--shard=${index}/4`));
assert.strictEqual(new Set(shards).size, shards.length, "4シャード間に重複がない");
assert.deepStrictEqual([...shards].sort(), [...all].sort(), "4シャードの和集合が全スイート");

const invalidWorkers = spawnSync(process.execPath, [runner, "--list", "--workers=0"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert.notStrictEqual(invalidWorkers.status, 0, "不正なworkers指定は失敗する");

const runnerSource = fs.readFileSync(runner, "utf8");
const baseMax = Number(runnerSource.match(/TEST_PORT_BASE_MAX = (\d+)/)?.[1]);
const baseStep = Number(runnerSource.match(/TEST_PORT_BASE_STEP = (\d+)/)?.[1]);
assert(baseStep >= 200 * 10, "最大200スイート分のport帯が隣接baseと重ならない");
assert(baseMax + baseStep - 10 < 65536, "最大baseのport帯がTCP上限内");

// S3-4/H-4: 0本実行ガード(絞り込み・シャードの組み合わせで対象0本になっても
// exit 0で緑になっていた穴)。tests/run-all.js側の該当変更と対で追加。

// (a) 存在しない名前指定 → exit 1 + 見つからない旨のメッセージ
const missing = spawnSync(process.execPath, [runner, "zzz-nonexistent-suite"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert.notStrictEqual(missing.status, 0, "存在しないsuite名の指定はexit非0");
assert(missing.stdout.includes("見つかりません"), "見つからない旨のメッセージが出る");

// (b) 正常な単体名指定 → 従来どおり絞り込みが効く(一覧で確認)
const single = list("run-all-options");
assert.deepStrictEqual(single, ["run-all-options.test.js"], "単体名指定の絞り込みは従来通り");

// (c) --list はシャードで対象0本になっても影響なし(一覧表示のみ・exit 0)
const shardEmptyList = list("v50", "--shard=2/4");
assert.deepStrictEqual(shardEmptyList, [], "--listはsuiteが0件でも従来通り一覧表示のみでexit 0");

// (d) 絞り込み+シャードで対象0本 → 既定はexit 1、--allow-empty指定時のみexit 0
const shardEmpty = spawnSync(process.execPath, [runner, "v50", "--shard=2/4"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert.strictEqual(shardEmpty.status, 1, "フィルタ+シャードで0件になったら既定でexit 1(H-4の再現ケース)");
assert(shardEmpty.stdout.includes("0件"), "0件である旨のメッセージが出る");

const shardEmptyAllowed = spawnSync(process.execPath, [runner, "v50", "--shard=2/4", "--allow-empty"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert.strictEqual(shardEmptyAllowed.status, 0, "--allow-empty指定時は0件でもexit 0");
assert(shardEmptyAllowed.stdout.includes("All suites passed"), "--allow-empty時も完走メッセージが出る");

console.log("PASS: run-all groups/shards/options");
