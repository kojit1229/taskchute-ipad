"use strict";

const assert = require("assert");

// 独立レビュー Must-3 対応: 旧実装は `scripts/code-index.js --check`(生成物のバイト完全一致)を
// このテスト自体が実行しており、app.js に1行足すだけで全関数の行番号がずれて生成物が不一致になり
// CIが必ず落ちる構成になっていた。`--check` は release-gate.js の push前ゲートに既に組み込まれて
// いるため(二重に持つ必要がない)、ここでは索引の**不変条件**(関数数・一意性・必須関数・
// area分類の固定点)だけを検証する。生成物自体は `node scripts/code-index.js --write` で
// 事前に最新化しておくこと。
const index = require("../docs/code-index.generated.json");
const names = index.functions.map((fn) => fn.name);

// v167: app.js分割プロジェクト(v164〜)でapp.jsは段階的に縮小するため、下限は
// 「パーサが黙って空振りしていないこと」を検知できる水準に留める(分割完了後に
// 索引がsrc/**を覆う設計へ変わる際に見直す)。
assert(index.sourceLines > 5000, "app.js全体を索引化");
assert(index.functions.length > 300, "top-level関数を広く索引化");
assert.strictEqual(new Set(names).size, names.length, "top-level関数名は一意");

const nameLineKeys = index.functions.map((fn) => `${fn.name}@${fn.startLine}`);
assert.strictEqual(new Set(nameLineKeys).size, nameLineKeys.length, "関数名+開始行の組は一意");

// v166: syncFromGitHubOnStartup等の同期フローはsrc/sync/github.jsへ抽出済みのため、
// app.js残留が確定している関数だけを必須として要求する(fetchGitHubRawResultはapp.js側の
// sync+fetch境界の代表として残留)。
for (const required of ["normalizeState", "saveState", "render", "fetchGitHubRawResult"]) {
  assert(names.includes(required), `${required}を索引に含める`);
}

assert(
  index.functions.every((fn) => Array.isArray(fn.area) && fn.area.length > 0),
  "areaは非空の配列(独立レビュー Must-2: 単一値から配列へ変更)"
);

assert(index.functions.some((fn) => fn.area.includes("sync") && fn.effects.includes("fetch")),
  "同期I/O境界を識別");
assert(index.functions.some((fn) => fn.area.includes("ui") && fn.effects.includes("render")),
  "描画境界を識別");
const clickDispatcher = index.functions.find((fn) => fn.name.startsWith("event:click@"));
const changeDispatcher = index.functions.find((fn) => fn.name.startsWith("event:change@"));
assert(clickDispatcher?.lines > 500, "巨大click dispatcherを索引化");
assert(changeDispatcher?.lines > 150, "巨大change dispatcherを索引化");

// --- 固定点(独立レビュー Must-2 対応): area分類の負検証 ---
// 旧実装は「関数名+本文全文」に正規表現を当てており、`.push(`(Array.prototype.push)や
// コメント中の語をsyncと誤判定していた(area="sync"の228関数中100関数、43.9%が誤判定)。
// 以下は実際に app.js を確認して選んだ固定点(該当行は claude-review-result.md Must-2 参照)。
function areaOf(name) {
  const fn = index.functions.find((f) => f.name === name);
  assert(fn, `固定点検証対象の関数が索引に見つからない: ${name}`);
  return fn.area;
}

// computeFreeGaps(app.js:4471-4498): blocksForDate/clamp/minutesOfを呼ぶ純粋な空き時間計算。
// `merged.push(...)`/`gaps.push(...)` はArray.prototype.pushでGitHub同期と無関係。
assert(!areaOf("computeFreeGaps").includes("sync"),
  "computeFreeGaps(空き時間計算)はsyncを含まない");
assert(areaOf("computeFreeGaps").includes("execution"),
  "computeFreeGaps はblocksForDate呼び出しによりexecutionを含む");

// v166: computeSyncMerge/runAutoSyncPull/syncFromGitHubOnStartup/mergeZeroThinkingListsは
// src/sync/github.jsへ抽出済み。app.jsの索引に残っていたら二重定義の疑い(mergeByIdと同じ扱い)。
for (const moved of ["computeSyncMerge", "runAutoSyncPull", "syncFromGitHubOnStartup", "mergeZeroThinkingLists"]) {
  assert(!names.includes(moved),
    `${moved}はsrc/sync/github.jsへ抽出済みのためapp.jsの索引には現れない(v166)`);
}

// fetchGitHubRawResult: app.js残留のGitHub Raw取得ヘルパー。sync+fetch境界の代表固定点。
assert(areaOf("fetchGitHubRawResult").includes("sync") &&
  index.functions.find((f) => f.name === "fetchGitHubRawResult").effects.includes("fetch"),
  "fetchGitHubRawResult(GitHub Raw取得)はsync+fetch境界");

// homeZone2Summary(app.js:4123-): ホーム集計テキスト生成。`parts.push(...)`はArray.push。
assert(!areaOf("homeZone2Summary").includes("sync"),
  "homeZone2Summary(ホーム集計)はsyncを含まない");

// addTaskToToday(app.js:4324-): `state.blocks.push(block)`はArray.pushでGitHub同期と無関係。
assert(!areaOf("addTaskToToday").includes("sync"),
  "addTaskToToday(タスク追加)はsyncを含まない");

// v170: gardenPixelCalendarHTML/completeRoutineForToday/ensureChainRunはsrc/features/routine.js
// へ抽出済み(app.js分割・段階4-4)。これらの旧area固定点(sync非該当の検証)は
// tests/routine-core.test.jsのNode特性テストへ引き継いだ(chainStepComplete経由でensureChainRun/
// completeRoutineForTodayの副作用を検証、routine.js冒頭のgardenPixelCalendarHTMLはDOM非依存の
// 純粋render)。code-index.jsはapp.jsしか走査しないため、抽出後は索引から消えるのが正しい
// (v166のcomputeSyncMerge等、v164のmergeByIdと同じ扱い)。
for (const moved of ["gardenPixelCalendarHTML", "completeRoutineForToday", "ensureChainRun"]) {
  assert(!names.includes(moved),
    `${moved}はsrc/features/routine.jsへ抽出済みのためapp.jsの索引には現れない(v170)`);
}

// v164: mergeByIdはapp.js分割・段階1でsrc/core/merge.jsへ抽出済み。code-index.jsはapp.js
// しか走査しないため、抽出後は索引から消えるのが正しい(indexに残っていたら二重定義の疑い)。
assert(!names.includes("mergeById"),
  "mergeByIdはsrc/core/merge.jsへ抽出済みのためapp.jsの索引には現れない(v164)");

console.log(`PASS: code index invariants (${index.functions.length} functions)`);
