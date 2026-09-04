"use strict";

// unit6: release-gateにCACHE_NAME増分チェックを追加するための純関数。
// CLAUDE.md「絶対に守るiOS Safariルール」第4条(SW更新時は必ずCACHE_NAMEをv+1)を機械検知する。
// release-gate.js から呼ばれるほか、fixtureディレクトリを渡すだけで単体テストできるよう
// トップレベル副作用なしのモジュールとして分離した(release-gate.jsはrequire時に即実行される
// スクリプトのため、そのままrequireするとテストプロセスが道連れでprocess.exitしてしまう)。

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CACHE_NAME_PATTERN = /^const CACHE_NAME = "taskchute-journal-pwa-v(\d+)";/m;

function extractCacheVersion(swSource) {
  const match = CACHE_NAME_PATTERN.exec(swSource || "");
  return match ? Number(match[1]) : null;
}

function readManifestVersion(repoRoot, manifestPath) {
  const resolved = path.isAbsolute(manifestPath) ? manifestPath : path.join(repoRoot, manifestPath);
  const data = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Number(data.version);
}

// 「直前値」の比較元は呼び出し側(release-gate.js)がimpact-regression.jsのresolveBaseRef()と
// 揃えて渡すbaseRef(既定"HEAD")から取る。
// unit6差し戻し#1: 以前はHEAD固定だったため、bumpとリリース記録を同一コミットに含めるこのリポでは
// コミット直後の再実行時にHEAD:sw.js=作業ツリー=最新版となり、増分チェックが常にFAILしていた
// (実証: release-gate.js releases/v334.json --dry-run --impact-base=origin/main)。
// 影響選定と同じ比較元(--impact-base → @{upstream} → origin/main、最後はHEAD)を渡すことで解消する。
// gitが使えない/baseRefにsw.jsが無い場合は増分チェックのみskipする。
function previousCacheVersion(repoRoot, baseRef = "HEAD") {
  const result = spawnSync("git", ["show", `${baseRef}:sw.js`], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return { available: false, version: null };
  return { available: true, version: extractCacheVersion(result.stdout) };
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.manifestPath - release-gateに渡されたreleases/vNNN.jsonのパス
 * @param {boolean} options.hasRuntimeDiff - app.js/sw.js/src配下/styles.css/index.html等に実行差分があるか
 * @param {string} [options.baseRef] - 直前値の比較元ref(release-gate.jsがimpact選定と揃えて渡す。既定HEAD)
 * @returns {{ ok: boolean, message: string }}
 */
function checkCacheNameIncrement({ repoRoot, manifestPath, hasRuntimeDiff, baseRef = "HEAD" }) {
  // app.js/sw.js/src配下/styles.css/index.html等に実行差分が無ければ、このリリースで
  // PWAキャッシュを配り直す理由自体が無いため検査対象外とする(「差分なし→CACHE_NAME不問」)。
  // これによりCLIの引数プランだけを見る既存のdry-runテストが、実際のCACHE_NAMEとは無関係な
  // 過去のreleases/vNNN.jsonを渡しても影響を受けない。
  if (!hasRuntimeDiff) {
    return { ok: true, message: "cache-name-increment (実行差分なしのためCACHE_NAMEチェックは不問)" };
  }

  const swPath = path.join(repoRoot, "sw.js");
  const swSource = fs.existsSync(swPath) ? fs.readFileSync(swPath, "utf8") : "";
  const cacheVersion = extractCacheVersion(swSource);
  if (cacheVersion === null) {
    return { ok: false, message: "sw.jsからCACHE_NAMEを検出できません" };
  }

  let manifestVersion;
  try {
    manifestVersion = readManifestVersion(repoRoot, manifestPath);
  } catch (error) {
    return { ok: false, message: `${manifestPath}のversionを読めません: ${error.message}` };
  }
  if (!Number.isFinite(manifestVersion)) {
    return { ok: false, message: `${manifestPath}のversionが数値ではありません` };
  }
  if (cacheVersion !== manifestVersion) {
    return {
      ok: false,
      message: `CACHE_NAME(v${cacheVersion})がrelease記録のversion(v${manifestVersion})と不一致です`
    };
  }

  const prev = previousCacheVersion(repoRoot, baseRef);
  if (!prev.available) {
    return { ok: true, message: `cache-name-increment (比較元${baseRef}のsw.jsを取得できないため増分チェックをskip)` };
  }
  if (prev.version === null) {
    return { ok: true, message: `cache-name-increment (比較元${baseRef}のsw.jsからCACHE_NAMEを検出できないため増分チェックをskip)` };
  }
  if (cacheVersion <= prev.version) {
    return {
      ok: false,
      message: `CACHE_NAME(v${cacheVersion})が比較元${baseRef}(v${prev.version})から増分していません`
        + `(実行差分ありのため+1以上が必須)`
    };
  }
  const jump = cacheVersion - prev.version;
  return {
    ok: true,
    message: jump === 1
      ? `cache-name-increment (v${prev.version} → v${cacheVersion})`
      : `cache-name-increment (v${prev.version} → v${cacheVersion}, +${jump}。+1超の飛びだが増分自体は満たすため警告のみ)`
  };
}

module.exports = { checkCacheNameIncrement, extractCacheVersion };
