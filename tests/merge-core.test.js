// merge-core.test.js — 段階1抽出(mergeByIdPreferNewer/mergeById)のcharacterization test。
// 抽出前はapp.jsから関数本体を切り出しvmで評価していた(v163.test.js:1-28のsourceBetween+vm
// パターンを踏襲、赤→緑を確認済み)。抽出後の現在はsrc/core/merge.jsをdynamic importして
// 同じassertionが通ることを確認する(claude-review-result.md §9)。
//
// 固定する7挙動(いずれも抽出前のapp.js:14972-14996 mergeByIdPreferNewer /
// app.js:14686-14700 mergeById の実装から導出。「こうあるべき」ではなく実挙動を固定する):
// 1. 片側にしかないidは必ず残る(和集合)
// 2. updatedAtが新しい側が勝つ
// 3. updatedAt同値でtieWinner="local"/"remote"がそれぞれ期待側を返す(mergeByIdPreferNewerのみ)
// 4. updatedAt同値で片側がtombstone(削除)ならtombstoneが勝つ(app.js移動前:14764の契約。mergeByIdPreferNewerのみ)
// 5. updatedAt欠損(undefined)は「不明=古い扱い」になる
// 6. 入力配列を破壊しない
// 7. null/undefined/空配列の入力で例外を投げない
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const MODULE_PATH = path.join(ROOT, "src", "core", "merge.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

async function loadMergeFns() {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  return { mergeById: mod.mergeById, mergeByIdPreferNewer: mod.mergeByIdPreferNewer };
}

(async () => {
  const { mergeById, mergeByIdPreferNewer } = await loadMergeFns();

  // --- 1. 片側にしかないidは必ず残る(和集合) ---
  console.log("[1] 片側にしかないidは必ず残る(和集合)");
  {
    const local = [{ id: "a", updatedAt: "2026-07-01T00:00" }];
    const remote = [{ id: "b", updatedAt: "2026-07-01T00:00" }];
    const resultPreferNewer = mergeByIdPreferNewer(local, remote, "local");
    check(
      "mergeByIdPreferNewer: 和集合になる",
      new Set(resultPreferNewer.map((x) => x.id)).size === 2
        && resultPreferNewer.some((x) => x.id === "a")
        && resultPreferNewer.some((x) => x.id === "b"),
      JSON.stringify(resultPreferNewer)
    );
    const resultById = mergeById(local, remote);
    check(
      "mergeById: 和集合になる",
      new Set(resultById.map((x) => x.id)).size === 2
        && resultById.some((x) => x.id === "a")
        && resultById.some((x) => x.id === "b"),
      JSON.stringify(resultById)
    );
  }

  // --- 2. updatedAtが新しい側が勝つ ---
  console.log("[2] updatedAtが新しい側が勝つ");
  {
    const local = [{ id: "x", updatedAt: "2026-07-01T00:00", from: "local" }];
    const remoteNewer = [{ id: "x", updatedAt: "2026-07-02T00:00", from: "remote" }];
    const r1 = mergeByIdPreferNewer(local, remoteNewer, "local");
    check("mergeByIdPreferNewer: remoteが新しければremoteが勝つ", r1[0].from === "remote", JSON.stringify(r1));

    const remoteOlder = [{ id: "x", updatedAt: "2026-06-01T00:00", from: "remote" }];
    const r2 = mergeByIdPreferNewer(local, remoteOlder, "remote");
    check(
      "mergeByIdPreferNewer: localが新しければtieWinnerに関わらずlocalが勝つ",
      r2[0].from === "local",
      JSON.stringify(r2)
    );

    const r3 = mergeById(local, remoteNewer);
    check("mergeById: remoteが新しければremoteが勝つ", r3[0].from === "remote", JSON.stringify(r3));
    const r4 = mergeById(local, remoteOlder);
    check("mergeById: localが新しければlocalが勝つ", r4[0].from === "local", JSON.stringify(r4));
  }

  // --- 3. updatedAt同値でtieWinnerがそれぞれ期待側を返す(mergeByIdPreferNewerのみ) ---
  console.log('[3] updatedAt同値でtieWinner="local"/"remote"がそれぞれ期待側を返す');
  {
    const local = [{ id: "x", updatedAt: "2026-07-01T00:00", from: "local" }];
    const remote = [{ id: "x", updatedAt: "2026-07-01T00:00", from: "remote" }];
    const rLocal = mergeByIdPreferNewer(local, remote, "local");
    check('tieWinner="local"はlocalを返す', rLocal[0].from === "local", JSON.stringify(rLocal));
    const rRemote = mergeByIdPreferNewer(local, remote, "remote");
    check('tieWinner="remote"はremoteを返す', rRemote[0].from === "remote", JSON.stringify(rRemote));
    const rDefault = mergeByIdPreferNewer(local, remote, undefined);
    check("tieWinner未指定はlocal扱い(既定)", rDefault[0].from === "local", JSON.stringify(rDefault));
  }

  // --- 4. updatedAt同値で片側がtombstoneならtombstoneが勝つ(mergeByIdPreferNewerのみ) ---
  console.log("[4] updatedAt同値で片側がtombstone(削除)ならtombstoneが勝つ");
  {
    const localAlive = [{ id: "x", updatedAt: "2026-07-01T00:00", deleted: false, from: "local" }];
    const remoteDeleted = [{ id: "x", updatedAt: "2026-07-01T00:00", deleted: true, from: "remote" }];
    // tieWinner="local"であってもtombstone(remote)が優先される
    const r1 = mergeByIdPreferNewer(localAlive, remoteDeleted, "local");
    check(
      "remote側がtombstoneならtieWinner=localでもtombstoneが勝つ",
      r1[0].deleted === true && r1[0].from === "remote",
      JSON.stringify(r1)
    );

    const localDeleted = [{ id: "x", updatedAt: "2026-07-01T00:00", deleted: true, from: "local" }];
    const remoteAlive = [{ id: "x", updatedAt: "2026-07-01T00:00", deleted: false, from: "remote" }];
    // tieWinner="remote"であってもtombstone(local)が優先される
    const r2 = mergeByIdPreferNewer(localDeleted, remoteAlive, "remote");
    check(
      "local側がtombstoneならtieWinner=remoteでもtombstoneが勝つ",
      r2[0].deleted === true && r2[0].from === "local",
      JSON.stringify(r2)
    );
  }

  // --- 5. updatedAt欠損(undefined)は「不明=古い扱い」になる ---
  console.log("[5] updatedAt欠損(undefined)は「不明=古い扱い」になる");
  {
    // mergeByIdPreferNewer: local側updatedAt欠損 → ""扱いでremoteの有効な日時に必ず負ける
    const localMissing = [{ id: "x", from: "local" }];
    const remoteHas = [{ id: "x", updatedAt: "2026-07-01T00:00", from: "remote" }];
    const r1 = mergeByIdPreferNewer(localMissing, remoteHas, "local");
    check(
      "mergeByIdPreferNewer: local側updatedAt欠損はremoteの実日時に負ける",
      r1[0].from === "remote",
      JSON.stringify(r1)
    );
    // remote側updatedAt欠損 → ""扱いでlocalの実日時を上書きしない
    const localHas = [{ id: "x", updatedAt: "2026-07-01T00:00", from: "local" }];
    const remoteMissing = [{ id: "x", from: "remote" }];
    const r2 = mergeByIdPreferNewer(localHas, remoteMissing, "remote");
    check(
      "mergeByIdPreferNewer: remote側updatedAt欠損はlocalの実日時を上書きしない",
      r2[0].from === "local",
      JSON.stringify(r2)
    );

    // mergeById: updatedAt欠損時はcreatedAtへフォールバックし、両方欠損なら""扱い
    const r3 = mergeById(localMissing, remoteHas);
    check(
      "mergeById: local側updatedAt/createdAt欠損はremoteの実日時に負ける",
      r3[0].from === "remote",
      JSON.stringify(r3)
    );
    const r4 = mergeById(localHas, remoteMissing);
    check(
      "mergeById: remote側updatedAt/createdAt欠損はlocalの実日時を上書きしない",
      r4[0].from === "local",
      JSON.stringify(r4)
    );
  }

  // --- 6. 入力配列を破壊しない ---
  console.log("[6] 入力配列を破壊しない");
  {
    const local = [{ id: "x", updatedAt: "2026-07-01T00:00" }];
    const remote = [{ id: "x", updatedAt: "2026-07-02T00:00" }];
    const localSnapshot = JSON.stringify(local);
    const remoteSnapshot = JSON.stringify(remote);
    mergeByIdPreferNewer(local, remote, "local");
    check(
      "mergeByIdPreferNewer: local配列を破壊しない",
      JSON.stringify(local) === localSnapshot,
      JSON.stringify(local)
    );
    check(
      "mergeByIdPreferNewer: remote配列を破壊しない",
      JSON.stringify(remote) === remoteSnapshot,
      JSON.stringify(remote)
    );
    mergeById(local, remote);
    check("mergeById: local配列を破壊しない", JSON.stringify(local) === localSnapshot, JSON.stringify(local));
    check("mergeById: remote配列を破壊しない", JSON.stringify(remote) === remoteSnapshot, JSON.stringify(remote));
  }

  // --- 7. null/undefined/空配列の入力で例外を投げない ---
  console.log("[7] null/undefined/空配列の入力で例外を投げない");
  {
    const cases = [
      [null, null],
      [undefined, undefined],
      [[], []],
      [null, [{ id: "a", updatedAt: "2026-07-01T00:00" }]],
      [[{ id: "a", updatedAt: "2026-07-01T00:00" }], undefined]
    ];
    for (const [l, r] of cases) {
      let threwPreferNewer = false;
      let resultPreferNewer;
      try { resultPreferNewer = mergeByIdPreferNewer(l, r, "local"); } catch { threwPreferNewer = true; }
      check(
        `mergeByIdPreferNewer(${JSON.stringify(l)}, ${JSON.stringify(r)})は例外を投げない`,
        !threwPreferNewer && Array.isArray(resultPreferNewer)
      );

      let threwById = false;
      let resultById;
      try { resultById = mergeById(l, r); } catch { threwById = true; }
      check(
        `mergeById(${JSON.stringify(l)}, ${JSON.stringify(r)})は例外を投げない`,
        !threwById && Array.isArray(resultById)
      );
    }
  }

  console.log(failures === 0 ? "\nmerge-core: 全件成功" : `\nmerge-core: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})();
