// src/state/store.js — app.js分割・段階3(state store + setState契約)。
// 独立レビュー claude-review-result.md §2 Blocker-1 / §7 契約1の実装:
//   state の再代入はこのファイルの setState() 経由のみ。他モジュール・app.js側は
//   import { state } で読み取りとプロパティ変更のみ行う(ESM の import は read-only
//   live binding のため、他モジュールから `state = X` の再代入はできない)。
//
// 循環import回避(prep-stage3-gateway.md §6-2/§6-4): このファイルは何もimportしない、
// 真の葉(leaf)にする。初期状態(loadState()の呼び出し)はこのファイル自身の先頭では行わず、
// app.js側が明示的に `setState(loadState(normalizeState, seedState))` を呼んで反映する
// (store.js自身の先頭でloadStateを呼ぶ設計だと、loadStateが必要とするnormalizeState/
// seedStateはapp.js側の関数であり、importの評価順序に依存したTDZ相当のリスクを生むため、
// より安全な「明示呼び出し」を採用する)。
//
// characterization test: tests/store-core.test.js。

let state = null;

function setState(next) {
  state = next;
}

export { state, setState };
