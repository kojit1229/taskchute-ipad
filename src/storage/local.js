// src/storage/local.js — app.js分割・段階3(storage層抽出)。
//
// 契約(prep-stage3-gateway.md §6-2/§6-4、claude-review-result.md §7):
//   1. state の再代入はここでは行わない。loadState()は値を返すだけで、呼び出し側(app.js)が
//      setState()で反映する(setStateはsrc/state/store.jsの唯一の再代入経路)。
//   2. 循環import回避のため、normalizeState/seedState(app.js側の関数)はここではimportせず、
//      loadState(normalizeState, seedState)の引数として受け取る(依存注入)。
//      src/配下からapp.jsをimportしない契約を守るための措置。
//   3. state自体はsrc/state/store.js(何もimportしない真の葉)からimportする一方向依存のみ
//      (store.js→storage/local.jsの逆流はなく、循環は発生しない)。
//   4. saveState()は本来この3関数と同じstorage層だが、scheduleAutoSave/scheduleAutoSync
//      (src/sync/github.js側)・showToast等アプリ全体の
//      多数の関数に依存しており、これらをすべて依存注入すると設計書のloadState(normalize, seed)
//      パターンをはるかに超える大きな注入面になる(呼び出し元は数百箇所あり、注入引数を
//      増やすと「6行の置換で済む」という設計方針そのものに反する)。そのため saveState() は
//      app.js側に残し、persistLocalNoSchedule()だけをここからimportして呼ぶ形にした
//      (設計書の「3関数をstorage/local.jsへ削除」という記載からの逸脱。詳細は完了報告に記載)。
//
// 抽出元: app.js:1320-1351 (loadState/persistLocalNoSchedule)。ロジックは一切変更していない
// (移動+依存注入化のみ)。_lastSaveErrorは移動先から読み取り専用でexportする(UIとsaveStateが
// import { _lastSaveError } で読む。再代入はpersistLocalNoSchedule内でのみ行う)。
// _quotaToastShownはsaveState()専用の変数のためapp.js側に残る(saveStateがapp.js側に残るため)。
//
// characterization test: tests/store-core.test.js。

import { state } from "../state/store.js";

const STORAGE_KEY = "taskchute-journal-pwa-state-v1";

function loadState(normalizeState, seedState) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeState(seedState());
  try {
    return normalizeState({ ...seedState(), ...JSON.parse(raw) });
  } catch {
    // v37: 壊れたデータを黙って捨てない。復旧用に退避してから初期状態で起動する。
    //      (そのまま自動保存が走ると、壊れる前のGitHub側データまで初期状態で上書きしかねない)
    try { localStorage.setItem(`${STORAGE_KEY}-corrupt-backup`, raw); } catch { /* 退避失敗はやむなし */ }
    console.error("保存データが壊れていたため初期状態で起動します(-corrupt-backup に退避済み)");
    const seeded = normalizeState(seedState());
    seeded.settings.github.autoSave = false;  // 事故防止: 自動保存は手動で入れ直してもらう
    // A3-H1(2026-09-04コードレビュー修正、修正フェーズ単位2独立レビューで是正): 現行の
    // normalizeState()はsettings.autoSyncが真偽値でなければ既定falseへ正規化する(app.js
    // 該当行参照)。seedState()はautoSyncを一切設定しないため、直後のnormalizeState(seedState())
    // が既にfalseへ倒しており、この1行は現状の挙動を変えないno-op(多重防御として残す。
    // 将来seedState()やnormalizeState()の既定値が変わってautoSync=trueが素通りするように
    // なった場合の保険)。「autoSync=falseでpush拡散を防いだ」という主張はしない
    // (現行コードでは元々起きえないシナリオのため、A3-H1後半の被害筋書きは現状成立しない)。
    seeded.settings.autoSync = false;
    return seeded;
  }
}

let _lastSaveError = null;

// localStorage への書き込みのみ(自動保存タイマーを再セットしない)。
// 保存ルーチン内部からの保存に使い、自動保存の無限ループを防ぐ。
function persistLocalNoSchedule() {
  // v40: _justStartedBlockId は非永続(modal と同様、シリアライズ時に落とす)
  // v153: _gardenJustGrewDate も同様に非永続(今日の芽のフェード演出フラグ)
  const persisted = { ...state, modal: null, _justStartedBlockId: null, _gardenJustGrewDate: null };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    _lastSaveError = null;
  } catch (error) {
    _lastSaveError = error;
    console.error("ローカル保存に失敗:", error);
  }
}

export { loadState, persistLocalNoSchedule, _lastSaveError };
