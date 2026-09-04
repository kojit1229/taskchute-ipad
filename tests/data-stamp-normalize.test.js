// 修正フェーズ 単位18(アプリ側): A2-H3対応のcharacterization test。
//
// 外部バッチ(loop apply.py)が dataModifiedAt に日付のみ(YYYY-MM-DD、10文字)を書くと、
// アプリ側 nowDateTime()(19文字)との辞書順比較で常に「古い」と誤判定される
// ("2026-09-04" < "2026-09-04T00:00:00" が真)。src/sync/github.js に追加した
// normalizeDataStamp(value) が10文字なら当日の最終時刻(T23:59:59)を補い、19文字は不変、
// 空・不正値は素通しすることを固定する([A])。あわせて、この関数がリモート抽出3箇所
// (runAutoSyncPush/runAutoSyncPull/syncFromGitHubOnStartupのremoteT)と
// normalizeState(app.js、value.dataModifiedAt)の双方から同じ実装を参照している前提で、
// 完了条件1のシナリオ(10文字dataModifiedAtが19文字lastPushedAtより新しいと判定される)を
// 比較演算子レベルで固定する([B])。
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const SYNC_PATH = path.join(ROOT, "src", "sync", "github.js");

// [C] 静的検査で使うヘルパー(tests/code-index.test.jsと同じく、ビルド成果物ではなく
// ソース文字列を直接検査する手法)。runAutoSyncPush/runAutoSyncPull/syncFromGitHubOnStartupの
// 3コールサイトはいずれも `const remoteT = ...;` の形で生JSONからdataModifiedAtを抽出する
// (github.js実装を参照)。この行が必ずnormalizeDataStamp(...)を経由しているかを見る。
function findRemoteTAssignmentLines(src) {
  return src.split("\n").filter((line) => /const remoteT\s*=/.test(line));
}
function allRemoteTLinesNormalized(src) {
  const lines = findRemoteTAssignmentLines(src);
  return lines.length > 0 && lines.every((line) => line.includes("normalizeDataStamp("));
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const syncMod = await import(pathToFileURL(SYNC_PATH).href);
  const { normalizeDataStamp } = syncMod;

  console.log("[A] normalizeDataStamp: 10文字/19文字/空/不正値の判定行列");
  {
    check("10文字はT23:59:59を補って19文字にする",
      normalizeDataStamp("2026-09-04") === "2026-09-04T23:59:59",
      normalizeDataStamp("2026-09-04"));
    check("19文字(既存のnowDateTime()形式)は不変",
      normalizeDataStamp("2026-09-04T10:30:00") === "2026-09-04T10:30:00",
      normalizeDataStamp("2026-09-04T10:30:00"));
    check("空文字は空文字のまま(従来どおり「無い」扱い)",
      normalizeDataStamp("") === "" && normalizeDataStamp(undefined) === "" && normalizeDataStamp(null) === "",
      JSON.stringify([normalizeDataStamp(""), normalizeDataStamp(undefined), normalizeDataStamp(null)]));
    check("10/19文字以外の不正値は素通し(長さを変えない)",
      normalizeDataStamp("bogus") === "bogus" && normalizeDataStamp("2026-09-04T10:30:00.123Z") === "2026-09-04T10:30:00.123Z",
      JSON.stringify([normalizeDataStamp("bogus"), normalizeDataStamp("2026-09-04T10:30:00.123Z")]));
  }

  console.log("[B] 完了条件1: 10文字dataModifiedAtが19文字lastPushedAtより新しいと判定される");
  {
    // A2-H3の再現条件そのもの: 外部バッチが書いた10文字の remote.dataModifiedAt を、
    // runAutoSyncPush/runAutoSyncPull/syncFromGitHubOnStartupが実際に行うのと同じ形で
    // (remote.dataModifiedAt || "") → normalizeDataStamp() の順に抽出する。
    const lastPushedAt = "2026-09-04T00:00:00";  // 同日にアプリが書いた既存のlastPushedAt
    const rawRemoteDataModifiedAt = "2026-09-04";  // loop apply.pyが書いた10文字の日付のみ
    const remoteT = normalizeDataStamp(rawRemoteDataModifiedAt || "");
    check("正規化前は誤って「古い」と判定されていたはず(辞書順比較の事実確認)",
      rawRemoteDataModifiedAt < lastPushedAt);
    check("正規化後は「新しい」と正しく判定され、push対象(取り込み対象)になる",
      remoteT > lastPushedAt, `remoteT=${remoteT}`);

    // normalizeState側(app.js value.dataModifiedAt = normalizeDataStamp(...))も同一関数を
    // 参照する前提のため、ここでは「normalizeStateがしていたはずの処理」を同じ関数で再現し、
    // 採用後の state.dataModifiedAt が lastPushedAt より新しくなることを確認する
    // (app.js自体はDOM依存のためNode importできない。呼び出し側は1行の委譲のみで、
    // その委譲先である本関数の契約をここで固定する)。
    const adoptedDataModifiedAt = normalizeDataStamp(rawRemoteDataModifiedAt || "");
    check("normalizeState経由で採用したstate.dataModifiedAtもlastPushedAtより新しい",
      adoptedDataModifiedAt > lastPushedAt, adoptedDataModifiedAt);
  }

  console.log("[C] 静的検査: 3コールサイトがremote.dataModifiedAtを生で比較に使っていない");
  {
    const githubSrc = fs.readFileSync(SYNC_PATH, "utf8");
    const remoteTLines = findRemoteTAssignmentLines(githubSrc);
    check("remoteT抽出コールサイトを3箇所検出(runAutoSyncPush/runAutoSyncPull/syncFromGitHubOnStartup)",
      remoteTLines.length === 3, JSON.stringify(remoteTLines));
    check("3箇所すべてnormalizeDataStamp(...)を経由している",
      allRemoteTLinesNormalized(githubSrc), JSON.stringify(remoteTLines));

    // mutation-check: normalizeDataStamp(...)のラップだけを剥がした「生に戻した」コピーで
    // 同じ検査が確実に落ちることを確認する(検査自体が空振りしていないことの確認)。
    const rawCopy = githubSrc
      .replace(/normalizeDataStamp\(\(JSON\.parse\(remoteText\)\.dataModifiedAt\) \|\| ""\)/g, '(JSON.parse(remoteText).dataModifiedAt) || ""')
      .replace(/normalizeDataStamp\(remote\.dataModifiedAt \|\| ""\)/g, 'remote.dataModifiedAt || ""');
    const rawLines = findRemoteTAssignmentLines(rawCopy);
    check("生に戻したコピーは3箇所とも検出されるがラップは失われている(前提の健全性確認)",
      rawLines.length === 3 && rawLines.every((line) => !line.includes("normalizeDataStamp(")),
      JSON.stringify(rawLines));
    check("生に戻したコピーは静的検査に落ちる",
      !allRemoteTLinesNormalized(rawCopy), JSON.stringify(rawLines));
  }

  console.log(failures ? `❌ ${failures} 件失敗` : "✅ All checks passed");
  process.exit(failures ? 1 : 0);
})();
