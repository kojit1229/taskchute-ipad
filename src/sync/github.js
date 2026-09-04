// src/sync/github.js — app.js分割・段階3(sync gateway抽出)。
//
// 契約(prep-stage3-gateway.md §4/§6、claude-review-result.md §2 Blocker-1/§7):
//   1. state の再代入はimportした setState() 経由のみ(このファイルはBlocker-1が指す
//      setState呼び出し元が集中する場所そのもの)。他はimportした state の読み取り・
//      プロパティ変更のみ行う。
//   2. src/配下からapp.jsをimportしない(循環import禁止)。このファイルの関数群は
//      normalizeState/nowDateTime/showToast等、多数のapp.js側の関数・定数に依存するため、
//      import ではなく configureGithubSync(deps) による依存注入で受け取る(下記参照)。
//      app.js はモジュール読み込み直後・stateの初期化直後に一度だけこれを呼ぶ。
//   3. src/**/*.js を追加したら sw.js の APP_SHELL へ必ず追加し、CACHE_NAME を +1 する。
//
// 抽出元: app.js(v165時点)の以下の関数・定数群。ロジックは一切変更していない
// (移動+依存注入化のみ。挙動は抽出前と完全に同一)。
//   - LAST_SYNCED_SHA_KEY/getLastSyncedSha/setLastSyncedSha
//   - LAST_SYNC_PUSH_KEY/LAST_SYNC_PULL_KEY/getLastSyncPushAt/recordSyncPushSuccess/
//     getLastSyncPullAt/recordSyncPullSuccess
//   - _githubSaveInFlight/saveToGitHub
//   - autoSaveTimer/AUTO_SAVE_DEBOUNCE_MS/scheduleAutoSave
//   - _autoSyncTimer/_lastPullCheckAt/_syncBanner/AUTO_SYNC_PUSH_MS/AUTO_SYNC_PULL_THROTTLE_MS/
//     autoSyncReady/scheduleAutoSync/runAutoSyncPush
//   - 0秒思考マージヘルパー群(mergeAppendOnlyLogByKey/swipeTriageLogKey/mergeZeroThinkingLists/
//     sameArrayByReference/zeroThinkingListsEqual/mergeZeroThinkingIntoLocal)
//   - 同期の双方向マージ本体(SYNC_CORE_COMPARE_KEYS/normalizedRemoteCopy/syncCoreEqual/
//     mergeDateStringMap/journalTemplateTextFor/mergeJournalMetaByWinners/
//     CONDITION_MORNING_FIELDS/CONDITION_EVENING_FIELDS/mergeConditionLogMaps/
//     mergeSleepLogMaps/mergeMorningEnergyLogs/mergeDailyDeclarationMaps/mergeWeeklyWishMaps/
//     mergeGardenLogMaps/mergeBlockLists/mergeTaskArrays/mergeProjectArrays/
//     pickCanonicalSingleton/reconcileSingletonDuplicates/computeSyncMerge/
//     applySyncMergeToLocal/applySyncMergeToRemote)
//   - runAutoSyncPull
//   - setSyncBanner/clearSyncBanner
//   - downloadGitHubStateText
//   - loadFromGitHub
//   - syncFromGitHubOnStartup
//
// 抽出しなかったもの(監督者確認事項。設計書の想定より精査した結果の絞り込み。完了報告に記載):
//   - _archiveCache/_archiveLoadState/_personalDataAuthError は、実際にこれらを再代入する
//     関数(runArchive/loadArchiveForSearch/fetchGitHubRawResult等)がいずれもこの5フロー+
//     computeSyncMergeの外側にあるapp.js側の別機能(アーカイブ・個人データ認証バナー)のため、
//     app.js側に残した(設計書の変数分類表はこの点で実体と食い違いがあった)。
//   - personalDataReady/personalDataFileConfig/requireGitHubConfig/fetchGitHubFileSHA/
//     gitHubContentsURL/githubHeaders/gitHubErrorMessage/fromBase64/toBase64/
//     sanitizedStateForGitHub/maybeWriteBackupSnapshot/updateAutoSaveStatus/updateSyncDot/
//     renderSyncBanner/pruneExpiredSuggestedThemes/normalizeState/nowDateTime/todayISO/addDays/
//     isTouchedBlock/showToast/maintainRecurrences/render/runDailyOpen/saveState は、
//     この5フロー以外からも広く使われる汎用ヘルパーのためapp.js側に残し、
//     configureGithubSync(deps) 経由で注入する。
//
// characterization test: tests/store-core.test.js。

import { state, setState } from "../state/store.js";
import {
  mergeById, mergeByIdPreferNewer, mergeGymSets, mergeTracksPreferNewer, mergeWeeklyCommitments
} from "../core/merge.js";
import { persistLocalNoSchedule } from "../storage/local.js";

// ---- 依存注入(configureGithubSync) ----
// app.jsが起動時に一度だけ呼ぶ。ここに列挙した識別子は元のapp.js側の関数・定数そのものへの
// 参照であり、下の抽出済みコード本体は元のapp.js内での書き方から一切変更していない
// (`normalizeState(...)` 等はそのままの形でこれらのモジュールスコープ変数を参照する)。
let normalizeState, nowDateTime, todayISO, addDays, isTouchedBlock;
let RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS, SWIPE_TRIAGE_LOG_MAX;
let showToast, maintainRecurrences, render, runDailyOpen, saveState;
let requireGitHubConfig, fetchGitHubFileSHA, personalDataReady, personalDataFileConfig;
let gitHubContentsURL, githubHeaders, gitHubErrorMessage, fromBase64, toBase64;
let sanitizedStateForGitHub, maybeWriteBackupSnapshot, writeBackupSnapshotBeforeLoad, updateAutoSaveStatus, updateSyncDot;
let renderSyncBanner, clearSyncBannerDismissal, clearPersonalDataAuthError, pruneExpiredSuggestedThemes;
let _startupDataModifiedAt;

function configureGithubSync(deps) {
  ({
    normalizeState, nowDateTime, todayISO, addDays, isTouchedBlock,
    RECURRENCE_KEEP_PAST_DAYS, RECURRENCE_FUTURE_DAYS, SWIPE_TRIAGE_LOG_MAX,
    showToast, maintainRecurrences, render, runDailyOpen, saveState,
    requireGitHubConfig, fetchGitHubFileSHA, personalDataReady, personalDataFileConfig,
    gitHubContentsURL, githubHeaders, gitHubErrorMessage, fromBase64, toBase64,
    sanitizedStateForGitHub, maybeWriteBackupSnapshot, writeBackupSnapshotBeforeLoad, updateAutoSaveStatus, updateSyncDot,
    renderSyncBanner, clearSyncBannerDismissal, clearPersonalDataAuthError, pruneExpiredSuggestedThemes,
    _startupDataModifiedAt
  } = deps);
}

// ---- ここから抽出したコード本体(app.js:v165時点から移動。ロジック無改変) ----

// v37: 端末ごとの「最後に同期したリモートSHA」。
//      state 本体には持たせない(ファイル内容は自分自身のSHAを含められないため、端末ローカルに持つ)。
const LAST_SYNCED_SHA_KEY = "taskchute-journal-last-synced-sha";
function getLastSyncedSha() {
  try { return localStorage.getItem(LAST_SYNCED_SHA_KEY) || ""; } catch { return ""; }
}
function setLastSyncedSha(sha) {
  try { localStorage.setItem(LAST_SYNCED_SHA_KEY, sha || ""); } catch { /* 保存できなくても致命的ではない */ }
}

// v134: 同期停止アラート。push/pull成功時刻は LAST_SYNCED_SHA_KEY と同じ理由で端末ローカルの
// localStorageに独立キーとして持つ(state.settings.lastPushedAt/lastPulledAtはstate本体の
// 一部として同期対象になり、他端末のpull/adoptで書き換わるため「この端末が最後にいつ成功したか」
// を表せない。事故2026-07-20〜21: 自動pushが約24時間無警告で停止した)。
const LAST_SYNC_PUSH_KEY = "taskchute-journal-last-sync-push-at";
const LAST_SYNC_PULL_KEY = "taskchute-journal-last-sync-pull-at";
function getLastSyncPushAt() {
  try { return localStorage.getItem(LAST_SYNC_PUSH_KEY) || ""; } catch { return ""; }
}
function recordSyncPushSuccess() {
  try { localStorage.setItem(LAST_SYNC_PUSH_KEY, nowDateTime()); } catch { /* 致命的ではない */ }
}
function getLastSyncPullAt() {
  try { return localStorage.getItem(LAST_SYNC_PULL_KEY) || ""; } catch { return ""; }
}
function recordSyncPullSuccess() {
  try { localStorage.setItem(LAST_SYNC_PULL_KEY, nowDateTime()); } catch { /* 致命的ではない */ }
}

// v37: 保存の同時実行ガード(自動保存と手動保存が同じSHAでPUTして409になるのを防ぐ)
let _githubSaveInFlight = false;

async function saveToGitHub(silent = false) {
  if (_githubSaveInFlight) {
    if (!silent) showToast("GitHub保存が進行中です。少し待ってください");
    return;
  }
  _githubSaveInFlight = true;
  // 手動・自動どちらでも、これから保存するのだから待機中の自動保存は不要
  clearTimeout(autoSaveTimer);
  try {
    const config = requireGitHubConfig();
    const sha = await fetchGitHubFileSHA(config);
    const lastSynced = getLastSyncedSha();

    // v37: リモートが「この端末が最後に同期した状態」から進んでいる場合の保護。
    //      別端末の新しいデータを、この端末の古い全量で黙って上書きしない。
    // v136(Med-7、Codexレビュー指摘): 旧実装は `sha && sha !== lastSynced` で、sha が空
    // (リモートファイルが消失/404)だとガード自体が丸ごとスキップされていた。この端末が
    // 既に同期済み(lastSynced有り)なのにリモートが空になっているのは異常系(ファイル消失・
    // 権限喪失等)であり、初回セットアップ(lastSynced自体が空)と同列の「暗黙のSHAなしPUT
    // (=新規作成扱い)」で片付けてはいけないため、shaの真偽に関係なく`sha !== lastSynced`
    // で判定する(lastSynced/shaとも空の真の初回は従来どおり素通り)。
    if (sha !== lastSynced) {
      if (!lastSynced) {
        // この端末はまだ一度も読込/保存していない(初期設定直後・localStorage消去後など)
        if (silent) {
          updateAutoSaveStatus("GitHubに既存データあり — 一度「GitHubから読込」してください(自動保存を見送りました)");
          return;
        }
        const ok = window.confirm(
          "GitHub 上に既存のデータがあります。\nこの端末の内容で上書きしますか?\n\n(別端末のデータを引き継ぐ場合は、キャンセルして先に「GitHubから読込」を押してください)"
        );
        if (!ok) { showToast("保存を中止しました"); return; }
      } else {
        // v135: 読込以降にリモートが更新されている(sha!==lastSynced)。全体のdataModifiedAtの
        // 大小に関係なく、必ず一度マージを試みてから判断する。
        // 事故(2026-07-20〜21): 旧コードは「remoteの方が全体として新しい時だけ」合流しており、
        // 端末側で他の編集をして dataModifiedAt が先に進んでいると、リモートの外部修正
        // (dataModifiedAtの更新漏れがあれば尚更 — 2026-07-10実障害と同種)が合流されずに
        // ローカルの丸ごとpushで消えた。gitのblob SHAは内容が変われば必ず変わるため、
        // sha!==lastSynced を唯一の信頼できる「リモートが動いた」判定として使う。
        // v136(High-1、fail-closed、Codexレビュー指摘): 取得・マージのいずれかが失敗した場合、
        // 旧実装は何もせず素通りしてそのままpushしていた(読めなかったリモート変更を
        // ローカル全量で上書きできてしまうfail-open)。取得・マージが完了できなければ
        // 保存を中止し(fail-closed)、次回の保存で再試行される形にする。
        let remoteText = "";
        let fetchFailed = false;
        try {
          remoteText = (await downloadGitHubStateText(config)).text;
        } catch { fetchFailed = true; }
        const remoteNorm = (!fetchFailed && remoteText) ? normalizedRemoteCopy(remoteText) : null;
        // tieWinner="local": この経路は「ローカルを基準に残してpushする」経路のため、
        // updatedAt同値の場合はローカル優先(Codexレビュー High-2対応)。
        const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "local") : null;
        if (fetchFailed || !remoteText || !remoteNorm || !syncMerge) {
          const msg = "リモートの変更を取得できなかったため保存を保留しました。次回保存で再試行します";
          setSyncBanner(msg);
          if (silent) { updateAutoSaveStatus(`見送り: ${msg}`); return; }
          showToast(msg);
          return;
        }
        if (syncCoreEqual(remoteNorm)) {
          // マージ未対応のコア(recurrences等)は一致 → tasks/projects等の差分は
          // マージ可能コレクションとして合流させ、そのままpushしてよい。
          applySyncMergeToLocal(syncMerge);
          state.dataModifiedAt = nowDateTime();  // 和集合が最新であることを明示
        } else {
          const msg = "GitHub側にこの端末とは別の変更があります。「GitHubから読込」で取り込んでから保存してください";
          if (silent) { updateAutoSaveStatus(`見送り: ${msg}`); return; }
          showToast(`保存を中止: ${msg}`);
          return;
        }
      }
    }

    const content = JSON.stringify(sanitizedStateForGitHub(), null, 2);
    const response = await fetch(gitHubContentsURL(config), {
      method: "PUT",
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        message: `chore: update app state ${new Date().toISOString()}`,
        content: toBase64(content),
        branch: config.branch,
        ...(sha ? { sha } : {})
      })
    });

    if (!response.ok) {
      throw new Error(await gitHubErrorMessage(response));
    }
    const currentToken = requireGitHubConfig().token;
    if (!/[^\x00-\xFF]/.test(String(currentToken || "").trim())) {
      clearPersonalDataAuthError();  // v303: 現在のtokenが正常なpush成功時だけ過去の認証バナーを解除する
    }

    // 保存後のファイルSHAを記録(次回の競合判定に使う)
    try {
      const result = await response.json();
      if (result.content?.sha) setLastSyncedSha(result.content.sha);
    } catch { /* SHAが取れなくても次回の保存前チェックで補正される */ }

    recordSyncPushSuccess();  // v134: この端末の最終push成功時刻(localStorage、state非経由)
    // v136(Med-6、Codexレビュー指摘): 手動保存・legacy 30秒自動保存(autoSync=false)経路では
    // 従来lastPushedAtを更新していなかった。v134の同期停止アラート判定
    // (dataModifiedAt!==lastPushedAt)がこれを見ているため、変更が無くても
    // 「6時間後に赤帯」の偽陽性を招いていた。push経路を問わず、成功時は必ずlastPushedAtを
    // dataModifiedAtへ揃える(runAutoSyncPushもこの関数を経由するため、呼び出し元の
    // 個別更新と重複するが害はない)。
    state.settings.lastPushedAt = state.dataModifiedAt;
    state.settings.github.lastSavedAt = nowDateTime();
    clearSyncBanner({ clearDismissal: true });  // v136: fail-closed等で出したバナーが残っていれば、成功したので消す
    persistLocalNoSchedule();  // v25: 自動保存タイマーを再セットしない(無限保存ループ防止)
    if (!silent) showToast("GitHubへ保存しました");
    if (silent) updateAutoSaveStatus();
    maybeWriteBackupSnapshot();  // v49: 保存成功後、1日1回の世代スナップショット(await しない)
  } catch (error) {
    if (!silent) showToast(`GitHub保存失敗: ${error.message}`);
    else updateAutoSaveStatus(`失敗: ${error.message}`);
  } finally {
    _githubSaveInFlight = false;
  }
}

// v25: 自動保存先は GitHub。token + owner + repo 設定済み & autoSave ON のときのみ。
let autoSaveTimer = null;
const AUTO_SAVE_DEBOUNCE_MS = 30000;  // 変更後この時間で GitHub へ自動保存

function scheduleAutoSave() {
  const cfg = state.settings?.github || {};
  // v43: 自動同期 ON のときは legacy 30秒 autoSave をバイパス(二重push防止)
  if (state.settings.autoSync) { clearTimeout(autoSaveTimer); return; }
  // v37: OFF になったら予約済みのタイマーも解除する
  //      (OFF直前の変更で予約された保存が30秒後に飛ぶのを防ぐ)
  if (!cfg.autoSave) { clearTimeout(autoSaveTimer); return; }
  if (!personalDataReady(cfg)) return;
  clearTimeout(autoSaveTimer);
  updateAutoSaveStatus("変更を検知 — 30秒後に保存します");
  autoSaveTimer = setTimeout(() => {
    saveToGitHub(true);
  }, AUTO_SAVE_DEBOUNCE_MS);
}

// v43: =========================================================
//  GitHub 自動同期(既定OFF・保守的・既存の手動push/pull関数の上に載せる)
//  マージはしない。競合時は必ず人間判断に落とす。自動系が壊れても手動は生きている。
// =========================================================
let _autoSyncTimer = null;
let _lastPullCheckAt = 0;      // Date.now() ベース(スロットル)。非永続。
let _syncBanner = null;        // 競合バナー文言。非永続。
const AUTO_SYNC_PUSH_MS = 3 * 60 * 1000;   // 3分デバウンス
const AUTO_SYNC_PULL_THROTTLE_MS = 60 * 1000;

function autoSyncReady() {
  const cfg = state.settings.github || {};
  if (!state.settings.autoSync || !personalDataReady(cfg)) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

// 自動 push(3分デバウンス)
function scheduleAutoSync() {
  if (!state.settings.autoSync) return;
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(runAutoSyncPush, AUTO_SYNC_PUSH_MS);
}
async function runAutoSyncPush() {
  if (!autoSyncReady()) return;
  const cfg = state.settings.github;
  if (!(state.dataModifiedAt && state.dataModifiedAt > (state.settings.lastPushedAt || ""))) return;  // 未変更
  try {
    // push前ガード: remote の dataModifiedAt を確認(別端末が進めていたら中止)
    const remoteText = (await downloadGitHubStateText(personalDataFileConfig(cfg))).text;
    const remoteT = (JSON.parse(remoteText).dataModifiedAt) || "";
    if (remoteT && remoteT > (state.settings.lastPushedAt || "")) {
      // v106: コア(tasks等)が両端末で一致していれば、リモートの進み分はマージ可能
      // コレクションだけ。合流させてそのままpushする(バナー待ちでiPhone分が届かない事故対策)。
      let resolved = false;
      const remoteNorm = normalizedRemoteCopy(remoteText);
      if (remoteNorm && syncCoreEqual(remoteNorm)) {
        // tieWinner="local": ここもapplySyncMergeToLocal(ローカルを基準に残す)経路。
        const syncMerge = computeSyncMerge(remoteNorm, "local");
        if (syncMerge) {
          applySyncMergeToLocal(syncMerge);
          state.settings.lastPushedAt = remoteT;   // リモート分は取り込み済み
          state.dataModifiedAt = nowDateTime();    // 和集合を今回のpushで届ける
          persistLocalNoSchedule();
          resolved = true;
        }
      }
      if (!resolved) {
        setSyncBanner("リモートに新しいデータがあります。設定から pull を確認してください");
        return;
      }
    }
    const before = state.settings.github.lastSavedAt;
    await saveToGitHub(true);  // 既存の手動push経路(SHAガード付き)を共用
    if (state.settings.github.lastSavedAt !== before) {  // 成功
      // v135: pushedはsaveToGitHub呼び出し後のdataModifiedAtを見る(呼び出し前の値をここで
      // 変数に控えておく旧実装だと、saveToGitHub内部のv135マージでdataModifiedAtが
      // さらに進んだ場合に古い値をlastPushedAtへ記録してしまい、未push判定が消えなくなる)。
      state.settings.lastPushedAt = state.dataModifiedAt;
      clearSyncBanner({ clearDismissal: true });
      persistLocalNoSchedule();
    }
    updateSyncDot();
  } catch { /* オフライン/APIエラー: 次のデバウンスで再試行(演出なし) */ }
}

// v103: ===============================================================
//  0秒思考の双方向マージ(entries[]/suggestedThemes[]のみ。idキーで和集合)。
//  背景: pullは従来「新しい方の全量を採用/スキップ」の二択で、iPhoneで書いた0秒思考entryが
//  サーバーへ到達済みでもPC側のdataModifiedAtの方が新しいと「remoteは古い」と判定して
//  スキップし、iPhoneの記録がPCから見えなくなる事故が起きた(2026-07-15 K報告)。このまま
//  PCが保存するとサーバー側のiPhone分ごと上書きされ消えるリスクがある。
//  themesは対象外(ユーザーが削除できるフィールドで、和集合にすると削除済みテーマが復活して
//  しまう。tombstone設計はスコープ外。K指示2026-07-15)。tasks/projects/journals等の他
//  コレクションも対象外(review.mdの全体設計課題=TCJ-R01系は別途、本対応の範囲外)。
// ===============================================================

// idキー配列の和集合マージ。同一idはupdatedAt(無ければcreatedAt)の新しい方を採用する。
// nowDateTime()の形式("YYYY-MM-DDTHH:mm:ss"、ゼロ埋め固定長)は文字列比較で新旧判定できる
// (既存のdataModifiedAt比較 remoteT > localT と同じ規約)。片方にしか無いidはそのまま合流する。
// id欠損の壊れた要素は無視する(マージ不能なものを取りこぼしても安全側に倒す)。
// v152レビュー対応(Codex指摘): swipeTriageLogのような「追記オンリー・上書き不要」の軽量ログ
// 配列を端末間でマージする汎用ヘルパー。updatedAt比較(mergeById)ではなく、複合キー
// (呼び出し側が指定。swipeTriageLogは at+targetId+action)で重複だけを排除した和集合を返す
// (新フィールド追加なし。既存スキーマそのまま)。at昇順に整列し、trimは呼び出し側の責務。
function mergeAppendOnlyLogByKey(localList, remoteList, keyFn) {
  const seen = new Map();
  for (const item of [...(Array.isArray(localList) ? localList : []), ...(Array.isArray(remoteList) ? remoteList : [])]) {
    if (!item) continue;
    const key = keyFn(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values()).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}
const swipeTriageLogKey = (l) => `${l.at || ""}|${l.targetId || ""}|${l.action || ""}`;

// mergeById: src/core/merge.js へ抽出済み(v164)。冒頭のimportを参照。

// entries[]/suggestedThemes[]だけをマージした結果を返す。失敗(想定外の型など)はcatchして
// nullを返し、呼び出し側は従来動作(マージなし)へフォールバックする(データ消失ガード)。
function mergeZeroThinkingLists(localZt, remoteZt) {
  try {
    return {
      entries: mergeById(localZt?.entries, remoteZt?.entries),
      suggestedThemes: mergeById(localZt?.suggestedThemes, remoteZt?.suggestedThemes)
    };
  } catch (error) {
    console.warn("zeroThinkingマージをスキップ:", error.message);
    return null;
  }
}

// 配列参照の内容一致判定(同じ要素が同じ順序で並んでいるか)。mergeByIdは変更しなかった項目を
// 同一参照で返すため、これで「実際に変化したか」を安く判定できる。
function sameArrayByReference(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// mergedLists(mergeZeroThinkingListsの戻り値)が比較対象baseZtと実質同じ内容かどうか。
function zeroThinkingListsEqual(mergedLists, baseZt) {
  return sameArrayByReference(mergedLists.entries, (baseZt && baseZt.entries) || [])
    && sameArrayByReference(mergedLists.suggestedThemes, (baseZt && baseZt.suggestedThemes) || []);
}

// (b) リモートを採用しない(ローカルの方が新しい/同じ)場合の合流。リモートにしか無いid の
// entries/suggestedThemesをローカルへ合流させる(今回のPC症状はこの経路で治る)。合流後に
// suggestedThemesのTTLを再剪定する(期限切れ候補が合流してもnormalizeStateと同じ基準で
// 即座に消える)。実際に内容が変化した場合だけtrueを返す(呼び出し側はdataModifiedAtを
// 更新して保存する=次回pushでサーバーにも和集合が届く)。
function mergeZeroThinkingIntoLocal(remoteZt) {
  const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZt);
  if (!merged) return false;
  const prunedSuggested = pruneExpiredSuggestedThemes(merged.suggestedThemes);
  const changed =
    !sameArrayByReference(merged.entries, state.zeroThinking.entries || []) ||
    !sameArrayByReference(prunedSuggested, state.zeroThinking.suggestedThemes || []);
  if (!changed) return false;
  state.zeroThinking.entries = merged.entries;
  state.zeroThinking.suggestedThemes = prunedSuggested;
  return true;
}

// v106: ===============================================================
//  同期の双方向マージ(K報告 2026-07-15: iPhoneで入力したジャーナル/ルーティン実績が
//  PC側で見えない)。v103の0秒思考マージを、非破壊に合流できるコレクション全体へ一般化する。
//  「全量の新旧二択」の枠組みは維持しつつ、採用/スキップのどちらの経路でも以下を和集合マージする:
//   - journals / feedback       … 日付キー文字列。journalMeta[date].textUpdatedAt(本版で追加。
//                                 ジャーナル本文の編集時に更新)の新しい方。無ければ長い方
//                                 (自動生成テンプレより書かれた本文が勝つ)
//   - journalMeta               … 本文で勝った側を採用(片側にしか無ければ合流)
//   - condition.logs            … 日付キー。朝グループ/夜グループを各recordedAtで独立採択、
//                                 gym[]はid和集合(idは端末別UUIDで衝突しない)
//   - sleep.logs                … 日付キー。importedAtの新しい方
//   - settings.morningEnergyLog … 日付キー数値。片側にしか無い日付だけ合流
//   - blocks                    … idキー和集合(updatedAtの新しい方)。繰り返し実体のidは
//                                 rec_<ruleId>_<date> で端末間決定論なので重複しない。
//                                 リモートにしか無い「期間外・未編集の繰り返し実体」は
//                                 パージ済みの蘇生になるため合流させない
//   - zeroThinking              … v103の既存マージ(mergeById)をそのまま使用
//   - storeVisits               … v141。idキー和集合(updatedAtの新しい方、同値時tombstone優先)。
//                                 削除操作があるためtasks/projectsと同じmergeByIdPreferNewerを使用
//   - tracks                    … v243。親trackはid+updatedAt、milestonesは節目単位の特殊マージ
//   - trackMeasurements         … v243。idキー和集合(updatedAtの新しい方、同値時tombstone優先)
//   - weeklyCommitments         … v243。week/item別の競合規則を持つidキー特殊マージ
//   - tasks / projects          … v135。idキー和集合(updatedAtの新しい方)。事故対策の本体
//                                 (下のv135セクション参照)。シングルトン(wish/other Project、
//                                 other Task)の重複はマージ後にreconcileSingletonDuplicates
//                                 でガードする(v136で汎用化)
//  さらにマージ対象「以外」のコア(SYNC_CORE_COMPARE_KEYS)が両端末で一致していれば、
//  「両方に未反映の変更」の競合を人間判断を待たず和集合で自動解消し、pushの見送りも解除する
//  (ジャーナル・ルーティン・体調・睡眠の日常記録だけなら同期が全自動で収束する)。
//  recurrences/declarations/questions/experiments等、マージ未対応のコアが両側で動いていた
//  場合は従来どおりバナー/見送りで人間判断に落とす(tasks/projectsはv135でマージ対応した
//  ため、v134まではこの一覧に含まれていたが除外した)。
//  マージ計算はnormalizeState済みのリモートコピーに対して行うこと(生JSONはフィールド欠損があり、
//  そのままstateへ合流させると既定値補完を素通りするため)。
// ===============================================================

// v280: habitPinHistoryはid+updatedAtでマージできない追記専用ツリーのため、earlyBird/habitStreaksと同じfail-close比較に置く。
// unit14(D-1): マージ対象外のまま「変更なし」と誤判定されていたstate直下9キーのうち、
// aiScheduleHistoryはfail-close比較のまま残し、settingsの一次データ12キー
// (avoidList/categories/lifeAreas/vision/affirmation/journalTemplate/twelveWeekStartDate/
// twelveWeekScoreTarget/birthDate/battery/gymExerciseList/visionDirectCategories)を追加した。
// settings.*はドット区切りパスで指定し、getByPathで解決する(UI状態キーはD-K7により対象外)。
// unit14b(独立レビュー2026-09-04、A1-M1拡大の救済): 2端末で独立に追記されるだけの
// reports/chainRuns/zeroSecThemeLog/migrationRitualLog/feedbackFiles/feedbackIngestedDates/
// aiWorkProcessedIds(+zeroThinking.groups)は、fail-close比較のままだと日常的な追記だけで
// 毎日「不一致」になり自動保存・自動pullが止まる。computeSyncMergeの和集合マージ対象へ
// 昇格させたため、ここからは外した(下記computeSyncMerge内のunit14bコメント参照)。
// ironImportはIRON LOG移行の一度きりの端末ローカルな進捗マーカー(派生状態。他端末の値を
// 持ち込む意味が無い)のため、比較対象からも和集合マージ対象からも外した(unit14b)。
const SYNC_CORE_COMPARE_KEYS = [
  "recurrences", "declarations", "questions", "experiments", "earlyBird", "habitStreaks", "habitPinHistory",
  "aiScheduleHistory",
  "settings.avoidList", "settings.categories", "settings.lifeAreas", "settings.vision",
  "settings.affirmation", "settings.journalTemplate", "settings.twelveWeekStartDate",
  "settings.twelveWeekScoreTarget", "settings.birthDate", "settings.battery",
  "settings.gymExerciseList", "settings.visionDirectCategories"
];

// リモート生テキストからマージ・比較用のnormalize済みコピーを作る(失敗はnullで従来動作へ)
function normalizedRemoteCopy(text) {
  try { return normalizeState(JSON.parse(text)); } catch { return null; }
}

// ドット区切りパスでネストした値を取り出す(SYNC_CORE_COMPARE_KEYSの"settings.xxx"用)。
function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function syncCoreEqual(remoteNorm) {
  if (!remoteNorm) return false;
  try {
    return SYNC_CORE_COMPARE_KEYS.every((k) =>
      JSON.stringify(getByPath(remoteNorm, k) ?? null) === JSON.stringify(getByPath(state, k) ?? null));
  } catch { return false; }
}

// 日付キー文字列マップの和集合。競合時の優先順: ①未記入テンプレでない方(pristineOf指定時。
// ensureJournalが当日分のテンプレを自動生成するため、「テンプレ vs 書かれた本文」の競合は
// 日常的に発生する) → ②tsOf(side, date)の新しい方 → ③長い方。
function mergeDateStringMap(localMap, remoteMap, tsOf, pristineOf) {
  const out = {};
  const winners = {};
  let changedVsLocal = false, changedVsRemote = false;
  const dates = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const d of dates) {
    const l = (localMap || {})[d];
    const r = (remoteMap || {})[d];
    let win;
    if (r == null) { win = "L"; changedVsRemote = true; }
    else if (l == null) { win = "R"; changedVsLocal = true; }
    else if (l === r) { win = "L"; }
    else {
      const lp = pristineOf ? pristineOf(l, d) : false;
      const rp = pristineOf ? pristineOf(r, d) : false;
      if (lp !== rp) {
        win = lp ? "R" : "L";
      } else {
        const lt = tsOf("L", d), rt = tsOf("R", d);
        win = lt !== rt ? (lt > rt ? "L" : "R") : (String(r).length > String(l).length ? "R" : "L");
      }
      if (win === "R") changedVsLocal = true; else changedVsRemote = true;
    }
    winners[d] = win;
    out[d] = win === "L" ? l : r;
  }
  return { map: out, winners, changedVsLocal, changedVsRemote };
}

// ジャーナルテンプレの日付ヘッダをその日の日付へ置換した「未記入本文」(ensureJournalと同じ変換)
function journalTemplateTextFor(tplSetting, date) {
  if (!tplSetting) return "";
  return tplSetting.replace(/^# \d{4}-\d{2}-\d{2} のジャーナル/m, `# ${date} のジャーナル`).trim();
}

// journalMeta: 本文マージの勝者側のメタを採用(片側にしか無ければそのまま合流)
function mergeJournalMetaByWinners(localMeta, remoteMeta, winners) {
  const out = {};
  const dates = new Set([
    ...Object.keys(localMeta || {}), ...Object.keys(remoteMeta || {}), ...Object.keys(winners || {})
  ]);
  for (const d of dates) {
    const l = (localMeta || {})[d];
    const r = (remoteMeta || {})[d];
    const v = winners[d] === "R" ? (r || l) : (l || r);
    if (v != null) out[d] = v;
  }
  return out;
}

const CONDITION_MORNING_FIELDS = ["sleepHours", "meds", "capacity", "morningRecordedAt"];
const CONDITION_EVENING_FIELDS = ["eveningMood", "eveningNote", "eveningRecordedAt"];

function mergeConditionLogMaps(localLogs, remoteLogs) {
  const out = {};
  const dates = new Set([...Object.keys(localLogs || {}), ...Object.keys(remoteLogs || {})]);
  for (const d of dates) {
    const l = (localLogs || {})[d];
    const r = (remoteLogs || {})[d];
    if (!r) { out[d] = l; continue; }
    if (!l) { out[d] = r; continue; }
    const merged = { ...l };
    if ((r.morningRecordedAt || "") > (l.morningRecordedAt || "")) {
      CONDITION_MORNING_FIELDS.forEach((k) => { merged[k] = r[k]; });
    }
    if ((r.eveningRecordedAt || "") > (l.eveningRecordedAt || "")) {
      CONDITION_EVENING_FIELDS.forEach((k) => { merged[k] = r[k]; });
    }
    merged.gym = mergeGymSets(l.gym, r.gym);
    out[d] = merged;
  }
  return out;
}

function mergeSleepLogMaps(localLogs, remoteLogs) {
  const out = {};
  const dates = new Set([...Object.keys(localLogs || {}), ...Object.keys(remoteLogs || {})]);
  for (const d of dates) {
    const l = (localLogs || {})[d];
    const r = (remoteLogs || {})[d];
    if (!l) { out[d] = r; continue; }
    if (!r) { out[d] = l; continue; }
    out[d] = (r.importedAt || "") > (l.importedAt || "") ? r : l;
  }
  return out;
}

// 片側にしか無い日付だけ合流(両方にあればローカル優先。朝の体調は1日1回タップの運用)
function mergeMorningEnergyLogs(localLog, remoteLog) {
  return { ...(remoteLog || {}), ...(localLog || {}) };
}

// v117(A): 今日の宣言(dailyDeclarations)。日付キー{text,updatedAt}。v106のsleep.logsマージ
// (タイムスタンプ比較)と同じパターンをそのまま踏襲する。
function mergeDailyDeclarationMaps(localMap, remoteMap) {
  const out = {};
  const dates = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const d of dates) {
    const l = (localMap || {})[d];
    const r = (remoteMap || {})[d];
    if (!l) { out[d] = r; continue; }
    if (!r) { out[d] = l; continue; }
    out[d] = (r.updatedAt || "") > (l.updatedAt || "") ? r : l;
  }
  return out;
}

// v121: 今週のやりたいこと(weeklyWishes)。週キー{taskIds,updatedAt}。
// mergeDailyDeclarationMapsと同じupdatedAt比較パターンをそのまま踏襲する。
function mergeWeeklyWishMaps(localMap, remoteMap) {
  const out = {};
  const weeks = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const w of weeks) {
    const l = (localMap || {})[w];
    const r = (remoteMap || {})[w];
    if (!l) { out[w] = r; continue; }
    if (!r) { out[w] = l; continue; }
    out[w] = (r.updatedAt || "") > (l.updatedAt || "") ? r : l;
  }
  return out;
}

// v153レビュー対応(2026-07-28、両レビュー一致・データ消失クラス指摘): 今日の庭(gardenLog)。
// 日付キー{done,total}にはupdatedAtが無いため、他の日付マップ(dailyDeclarations等)と同じ
// タイムスタンプ比較ではなく、「フィールド別max」で端末間もマージする
// (設計書§③「競合時はキーごとにdoneの大きい方を採用(加点式マージ)」をtotalにも適用)。
// 片方にしか無い日付キーもそのまま合流するため、端末Aだけが記録したエントリがリモート採用後も
// 消えない。
function mergeGardenLogMaps(localMap, remoteMap) {
  const out = {};
  const dates = new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]);
  for (const d of dates) {
    const l = (localMap || {})[d];
    const r = (remoteMap || {})[d];
    out[d] = {
      done: Math.max(l?.done || 0, r?.done || 0),
      total: Math.max(l?.total || 0, r?.total || 0)
    };
  }
  return out;
}

// v197(第3弾3d, S-3): 文字列配列の単純な集合和マージ(aiStepProcessedIds/aiStepDismissedIds用)。
// aiWorkProcessedIds自体は同期マージ対象外の既知の欠陥を持つが、それを直すのは本設計の
// 対象外(3dでは触らない)。順序は決定論になるようソートで固定する(端末間で結果を一致させる)。
function mergeStringIdSet(localArr, remoteArr) {
  const set = new Set([...(Array.isArray(localArr) ? localArr : []), ...(Array.isArray(remoteArr) ? remoteArr : [])]);
  return Array.from(set).sort();
}

// v197(第3弾3d, C-4): 保留中request台帳(aiStepPendingRequests、要素{requestId,taskId,requestedAt})。
// requestIdをキーにした和集合マージ。順序はrequestId昇順で固定する(端末間で結果を一致させる)。
// 剪定(processed/dismissed済みの除去)はcomputeSyncMerge側でも即時に行う(下記参照)。
function mergeAiStepPendingRequests(localArr, remoteArr) {
  const byId = new Map();
  for (const item of [...(Array.isArray(localArr) ? localArr : []), ...(Array.isArray(remoteArr) ? remoteArr : [])]) {
    if (!item || !item.requestId) continue;
    const current = byId.get(item.requestId);
    if (!current || aiStepPendingRequestWins(item, current)) byId.set(item.requestId, item);
  }
  return Array.from(byId.values()).sort((a, b) => (a.requestId || "").localeCompare(b.requestId || ""));
}

// v198(堅牢性レビュー修正1): 同一requestIdのエントリが両端末で内容違いになる異常系(通常は
// requestId発行後に内容が変わらない前提だが、防御的に決定論を保証する)でも、どちらの端末で
// マージを計算しても同じ結果になるよう、引数順(local-first)に依存しないタイブレークで
// 採用エントリを一意に決める: requestedAt昇順(先に発行された方)→同値ならtaskId辞書順。
function aiStepPendingRequestWins(candidate, current) {
  const candidateAt = candidate.requestedAt || "";
  const currentAt = current.requestedAt || "";
  if (candidateAt !== currentAt) return candidateAt < currentAt;
  return (candidate.taskId || "") < (current.taskId || "");
}

function mergeBlockLists(localBlocks, remoteBlocks) {
  const localIds = new Set((localBlocks || []).map((b) => b && b.id).filter(Boolean));
  const today = todayISO();
  const from = addDays(today, -RECURRENCE_KEEP_PAST_DAYS);
  const to = addDays(today, RECURRENCE_FUTURE_DAYS);
  const addable = (remoteBlocks || []).filter((b) => {
    if (!b || !b.id || localIds.has(b.id)) return true;  // 既知idは mergeById の新旧判定に任せる
    // リモートにしか無いblockのうち、maintainRecurrencesのパージ対象(期間外・未編集の
    // 繰り返し実体)は合流させない(パージ→合流→パージの往復と蘇生を防ぐ)
    if (b.recurrenceGroupId && (b.date < from || b.date > to) && !isTouchedBlock(b)) return false;
    return true;
  });
  return mergeById(localBlocks, addable);
}

// mergeByIdPreferNewer: src/core/merge.js へ抽出済み(v164。tasks/projectsマージ保護の
// 契約コメント・v135/v136の経緯も同ファイルへ移動した)。冒頭のimportを参照。

function mergeTaskArrays(localTasks, remoteTasks, tieWinner) {
  return mergeByIdPreferNewer(localTasks, remoteTasks, tieWinner);
}
function mergeProjectArrays(localProjects, remoteProjects, tieWinner) {
  return mergeByIdPreferNewer(localProjects, remoteProjects, tieWinner);
}

// シングルトン群(kind:"wish"のProject、kind:"other"のProject、kind:"other"のTask)の重複防止。
// 両端末が同期前に別々にシングルトンを作っていた場合、id和集合だけでは複数並存してしまう
// (normalizeStateの「1つも無ければ作る」保証は「複数ある」を検知しないため、マージ後に
// ここで踏み込んでガードする)。対象はWish Project(getWishProject)だけでなく、その他Project
// (タスクシュート直接追加Blockの受け皿)・その他Task(getOtherTask、Blockのtaskid受け皿)も
// 同じ`.find()`先勝ち方式で参照されており、同じ重複リスクを持つ(Codexレビュー指摘)。
// 正本の選定は最も古いcreatedAtの1つ。createdAtも同値・欠損の場合はid辞書順で決定する
// (v136: 端末非依存の決定性を保証。Codexレビュー指摘)。他は論理削除(tombstone、updatedAt更新)。
// 参照側(Task.projectId、Block.taskId)は正本へ付け替える(単純deleteだと子が迷子になるため)。
function pickCanonicalSingleton(candidates) {
  return candidates.slice().sort((a, b) => {
    const ac = a.createdAt || "", bc = b.createdAt || "";
    if (ac !== bc) return ac < bc ? -1 : 1;
    const ai = a.id || "", bi = b.id || "";
    return ai < bi ? -1 : (ai > bi ? 1 : 0);
  })[0];
}
function reconcileSingletonDuplicates(mergedTasks, mergedProjects, mergedBlocks) {
  let tasks = mergedTasks, projects = mergedProjects;
  const now = nowDateTime();
  // Project側シングルトン(wish, other)。子Task(projectId参照)を正本へ付け替える。
  for (const kind of ["wish", "other"]) {
    const live = projects.filter((p) => p.kind === kind && !p.deleted);
    if (live.length <= 1) continue;
    const canonical = pickCanonicalSingleton(live);
    const dupIds = new Set(live.filter((p) => p.id !== canonical.id).map((p) => p.id));
    projects = projects.map((p) => dupIds.has(p.id) ? { ...p, deleted: true, updatedAt: now } : p);
    tasks = tasks.map((t) => dupIds.has(t.projectId) ? { ...t, projectId: canonical.id, updatedAt: now } : t);
  }
  // Task側シングルトン(その他Task、getOtherTask)。Block.taskid参照を正本へ付け替える。
  let blocks = mergedBlocks;
  const liveOtherTasks = tasks.filter((t) => t.kind === "other" && !t.deleted);
  if (liveOtherTasks.length > 1) {
    const canonical = pickCanonicalSingleton(liveOtherTasks);
    const dupIds = new Set(liveOtherTasks.filter((t) => t.id !== canonical.id).map((t) => t.id));
    tasks = tasks.map((t) => dupIds.has(t.id) ? { ...t, deleted: true, updatedAt: now } : t);
    blocks = blocks.map((b) => dupIds.has(b.taskId) ? { ...b, taskId: canonical.id, updatedAt: now } : b);
  }
  return { tasks, projects, blocks };
}

// マージ結果一式を計算する(stateはまだ書き換えない)。remoteNormはnormalizedRemoteCopy()の戻り値。
// 失敗時はnullを返し、呼び出し側はv103相当(0秒思考のみ)へフォールバックする。
// tieWinner("local"|"remote"、v136): tasks/projectsのupdatedAt同値時の優先側。呼び出し元が
// 「ローカルを基準に残す経路(applySyncMergeToLocal)」か「リモートを採用する経路
// (applySyncMergeToRemote)」かに応じて明示する(Codexレビュー指摘。誤った側を指定すると、
// 同値のレガシーデータで採用ブランチと逆側の内容が紛れ込む)。
function computeSyncMerge(remoteNorm, tieWinner) {
  try {
    const jt = (side, d) => side === "L"
      ? ((state.journalMeta[d] || {}).textUpdatedAt || "")
      : (((remoteNorm.journalMeta || {})[d] || {}).textUpdatedAt || "");
    // どちらの端末のテンプレとも一致する本文は「未記入」= 書かれた本文が常に勝つ
    const tplL = state.settings.journalTemplate || "";
    const tplR = (remoteNorm.settings || {}).journalTemplate || "";
    const journalPristine = (text, d) => {
      const t = String(text || "").trim();
      return t === "" || t === journalTemplateTextFor(tplL, d) || t === journalTemplateTextFor(tplR, d);
    };
    const journals = mergeDateStringMap(state.journals, remoteNorm.journals, jt, journalPristine);
    const journalMeta = mergeJournalMetaByWinners(state.journalMeta, remoteNorm.journalMeta, journals.winners);
    const feedback = mergeDateStringMap(state.feedback, remoteNorm.feedback, () => "");
    const conditionLogs = mergeConditionLogMaps(state.condition.logs, (remoteNorm.condition || {}).logs);
    const sleepLogs = mergeSleepLogMaps(state.sleep.logs, (remoteNorm.sleep || {}).logs);
    const morningEnergyLog = mergeMorningEnergyLogs(state.settings.morningEnergyLog, (remoteNorm.settings || {}).morningEnergyLog);
    const blocksRaw = mergeBlockLists(state.blocks, remoteNorm.blocks);
    const zeroThinking = mergeZeroThinkingLists(state.zeroThinking, remoteNorm.zeroThinking);
    // v117(A): 今日の宣言もマージ可能コレクションへ追加
    const dailyDeclarations = mergeDailyDeclarationMaps(state.dailyDeclarations, remoteNorm.dailyDeclarations);
    // v121: 今週のやりたいことも同じくマージ可能コレクションへ追加
    const weeklyWishes = mergeWeeklyWishMaps(state.weeklyWishes, remoteNorm.weeklyWishes);
    // v129: ポモドーロ身体スキャンもidキー和集合マージ(blocks/zeroThinking entriesと同じ扱い)
    const bodyScans = mergeById(state.bodyScans, remoteNorm.bodyScans);
    // v294: 書く瞑想(充放電ログ改善R1a)もbodyScansと同じmergeById(idキー和集合、updatedAtが
    // 新しい方が勝つ)。1日1レコード(id=`wm_${date}`)のため日単位の編集競合はこれで解決する。
    const writeMeditations = mergeById(state.writeMeditations, remoteNorm.writeMeditations);
    // v135: tasks/projectsもidキー和集合マージ(updatedAtの新しい方)。
    // v136: シングルトン(wish/other Project、other Task)の重複はここでガードする
    // (reconcileSingletonDuplicates)。other Task統合に伴うBlock.taskid付け替えもあるため
    // blocksもここで最終化する。
    const tasksRaw = mergeTaskArrays(state.tasks, remoteNorm.tasks, tieWinner);
    const projectsRaw = mergeProjectArrays(state.projects, remoteNorm.projects, tieWinner);
    const { tasks, projects, blocks } = reconcileSingletonDuplicates(tasksRaw, projectsRaw, blocksRaw);
    // v141: 「今日行ったお店」ログ。ユーザーが削除できる(tombstone)ため、mergeByIdと違い
    // tasks/projectsと同じupdatedAt優先+同値時tombstone優先のmergeByIdPreferNewerを使う。
    const storeVisits = mergeByIdPreferNewer(state.storeVisits, remoteNorm.storeVisits, tieWinner);
    // v243: normalizeState未通過のstateが渡っても例外化しないよう、両側とも || [] で防御する
    // (remoteNorm側のchangedVsRemoteガードと同じ思想。CI v197のような素のfixture直呼びにも耐える)
    const tracks = mergeTracksPreferNewer(state.tracks || [], remoteNorm.tracks || [], tieWinner);
    const trackMeasurements = mergeByIdPreferNewer(
      state.trackMeasurements || [], remoteNorm.trackMeasurements || [], tieWinner
    );
    const weeklyCommitments = mergeWeeklyCommitments(
      state.weeklyCommitments || [], remoteNorm.weeklyCommitments || [], tieWinner
    );
    // v152レビュー対応(Codex指摘): swipeTriageLogも端末間で和集合マージする(複合キー重複排除)。
    // 上限は他の軽量ログと同じ思想(SWIPE_TRIAGE_LOG_MAX、末尾優先で切り詰め)。
    const swipeTriageLog = mergeAppendOnlyLogByKey(state.swipeTriageLog, remoteNorm.swipeTriageLog, swipeTriageLogKey)
      .slice(-SWIPE_TRIAGE_LOG_MAX);
    // v153レビュー対応(2026-07-28): gardenLogも同期対象に追加(このヘルパーが無いと
    // ローカル限定のスナップショットがリモート採用で消えるデータ消失クラスの不具合になる)。
    const gardenLog = mergeGardenLogMaps(state.gardenLog, remoteNorm.gardenLog);
    // v201(AIコーチ1aレビュー対応): 食事ログは取消tombstoneを含むため、updatedAtの新しい
    // レコードを優先し、同値ならdeletedを優先するmergeByIdPreferNewerで端末間のid和集合にする。
    // coachLog.settingsは1aでは全端末で固定値2278かつ変更UIが無いため同期対象外とする。
    // 設定UIを追加するときに端末間競合の意味論を含めて再設計する。
    const coachMeals = mergeByIdPreferNewer(
      state.coachLog?.meals, remoteNorm.coachLog?.meals, tieWinner
    ).sort((a, b) => {
      // マージ直後は「ローカル全件+リモート残り」の連結順になるため時系列へ整列し直す
      // (renderの逆順表示と、刈り込みの「末尾=新しい方を残す」前提を守る)
      const ka = `${a?.date || ""} ${a?.time || ""} ${a?.updatedAt || ""}`;
      const kb = `${b?.date || ""} ${b?.time || ""} ${b?.updatedAt || ""}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    // v197(第3弾3d, S-3/C-4): AIステップの処理済み/取消済みrequestId集合+保留台帳もマージ対象へ追加。
    const aiStepProcessedIds = mergeStringIdSet(state.aiStepProcessedIds, remoteNorm.aiStepProcessedIds);
    const aiStepDismissedIds = mergeStringIdSet(state.aiStepDismissedIds, remoteNorm.aiStepDismissedIds);
    const aiReportReadIds = mergeStringIdSet(state.aiReportReadIds, remoteNorm.aiReportReadIds);
    // v198(堅牢性レビュー修正2): 剪定をnormalizeStateだけに任せると、マージ適用直後〜次回
    // normalizeStateまでの間、処理済み/取消済みのrequestIdが台帳に一時復活する。剪定条件は
    // 従来どおり「processed∪dismissedから再導出」のまま、マージ適用の時点でも同じ規則を通す
    // (全端末で同じ結果になる決定論は崩さない)。
    const aiStepSettledIds = new Set([...aiStepProcessedIds, ...aiStepDismissedIds]);
    const aiStepPendingRequests = mergeAiStepPendingRequests(state.aiStepPendingRequests, remoteNorm.aiStepPendingRequests)
      .filter((entry) => !aiStepSettledIds.has(entry.requestId));
    // unit14b(独立レビュー2026-09-04、A1-M1拡大の救済): 単位14でfail-close比較に入れた
    // state直下キーのうち、2端末で独立に追記されるだけの7キー+zeroThinking.groupsを
    // 和集合マージへ昇格させる(fail-closeのままだと日常的な追記だけで毎日「不一致」になり
    // 自動保存・自動pullが止まる、D-1指摘)。
    //   reports: 日付キーのMarkdown本文 → journals/feedbackと同じmergeDateStringMap
    //   chainRuns: id(`${chainId}_${date}`)+updatedAtを持つ → 他コレクションと同じmergeById
    //   zeroSecThemeLog/migrationRitualLog: idを持たない追記専用ログ → 複合キー重複排除の
    //     mergeAppendOnlyLogByKey(swipeTriageLogと同じ思想)
    //   feedbackFiles/feedbackIngestedDates/aiWorkProcessedIds: 文字列idの集合
    //     → aiStepProcessedIds等と同じmergeStringIdSet
    //   zeroThinking.groups: id+createdAtを持つ小テーマ → mergeById(entries/suggestedThemes
    //     とは別のmergeZeroThinkingListsの外で個別に計算し、値だけzeroThinkingGroupsとして返す)
    const reports = mergeDateStringMap(state.reports, remoteNorm.reports, () => "");
    const chainRuns = mergeById(state.chainRuns, remoteNorm.chainRuns);
    const zeroSecThemeLog = mergeAppendOnlyLogByKey(
      state.zeroSecThemeLog, remoteNorm.zeroSecThemeLog,
      (e) => `${e.at || ""}|${e.date || ""}|${e.theme || ""}`
    );
    const migrationRitualLog = mergeAppendOnlyLogByKey(
      state.migrationRitualLog, remoteNorm.migrationRitualLog,
      (e) => `${e.at || ""}|${e.blockId || ""}|${e.choice || ""}`
    );
    const feedbackFiles = mergeStringIdSet(state.feedbackFiles, remoteNorm.feedbackFiles);
    const feedbackIngestedDates = mergeStringIdSet(state.feedbackIngestedDates, remoteNorm.feedbackIngestedDates);
    const aiWorkProcessedIds = mergeStringIdSet(state.aiWorkProcessedIds, remoteNorm.aiWorkProcessedIds);
    const zeroThinkingGroups = mergeById(state.zeroThinking?.groups, remoteNorm.zeroThinking?.groups);
    const jsonChanged = (obj, base) => JSON.stringify(obj) !== JSON.stringify(base || {});
    const changedVsLocal =
      journals.changedVsLocal ||
      jsonChanged(journalMeta, state.journalMeta) ||
      feedback.changedVsLocal ||
      jsonChanged(conditionLogs, state.condition.logs) ||
      jsonChanged(sleepLogs, state.sleep.logs) ||
      jsonChanged(morningEnergyLog, state.settings.morningEnergyLog) ||
      jsonChanged(dailyDeclarations, state.dailyDeclarations) ||
      jsonChanged(weeklyWishes, state.weeklyWishes) ||
      !sameArrayByReference(blocks, state.blocks) ||
      !sameArrayByReference(bodyScans, state.bodyScans) ||
      // v294: bodyScansと違い || [] で両側防御する(tracks等のv243と同じ理由。既存の
      // Node特性テスト群がbodyScansのように全fixtureへ本フィールドを追記済みではないため、
      // normalizeState未通過のstateでも例外化しないようにする。mergeByIdのロジック自体は
      // bodyScansと完全に同一で、この防御はfail-close側の安全弁にすぎない)。
      !sameArrayByReference(writeMeditations, state.writeMeditations || []) ||
      !sameArrayByReference(tasks, state.tasks) ||
      !sameArrayByReference(projects, state.projects) ||
      !sameArrayByReference(storeVisits, state.storeVisits) ||
      !sameArrayByReference(tracks, state.tracks || []) ||
      !sameArrayByReference(trackMeasurements, state.trackMeasurements || []) ||
      !sameArrayByReference(weeklyCommitments, state.weeklyCommitments || []) ||
      !sameArrayByReference(swipeTriageLog, state.swipeTriageLog) ||
      jsonChanged(gardenLog, state.gardenLog) ||
      !sameArrayByReference(coachMeals, state.coachLog?.meals || []) ||
      !sameArrayByReference(aiStepProcessedIds, state.aiStepProcessedIds) ||
      !sameArrayByReference(aiStepDismissedIds, state.aiStepDismissedIds) ||
      !sameArrayByReference(aiReportReadIds, state.aiReportReadIds || []) ||
      !sameArrayByReference(aiStepPendingRequests, state.aiStepPendingRequests) ||
      (zeroThinking ? !zeroThinkingListsEqual(zeroThinking, state.zeroThinking) : false) ||
      // unit14b追加分
      reports.changedVsLocal ||
      !sameArrayByReference(chainRuns, state.chainRuns || []) ||
      !sameArrayByReference(zeroSecThemeLog, state.zeroSecThemeLog || []) ||
      !sameArrayByReference(migrationRitualLog, state.migrationRitualLog || []) ||
      !sameArrayByReference(feedbackFiles, state.feedbackFiles || []) ||
      !sameArrayByReference(feedbackIngestedDates, state.feedbackIngestedDates || []) ||
      !sameArrayByReference(aiWorkProcessedIds, state.aiWorkProcessedIds || []) ||
      !sameArrayByReference(zeroThinkingGroups, state.zeroThinking?.groups || []);
    const changedVsRemote =
      journals.changedVsRemote ||
      jsonChanged(journalMeta, remoteNorm.journalMeta) ||
      feedback.changedVsRemote ||
      jsonChanged(conditionLogs, (remoteNorm.condition || {}).logs) ||
      jsonChanged(sleepLogs, (remoteNorm.sleep || {}).logs) ||
      jsonChanged(morningEnergyLog, (remoteNorm.settings || {}).morningEnergyLog) ||
      jsonChanged(dailyDeclarations, remoteNorm.dailyDeclarations) ||
      jsonChanged(weeklyWishes, remoteNorm.weeklyWishes) ||
      !sameArrayByReference(blocks, remoteNorm.blocks || []) ||
      !sameArrayByReference(bodyScans, remoteNorm.bodyScans || []) ||
      !sameArrayByReference(writeMeditations, remoteNorm.writeMeditations || []) ||
      !sameArrayByReference(tasks, remoteNorm.tasks || []) ||
      !sameArrayByReference(projects, remoteNorm.projects || []) ||
      !sameArrayByReference(storeVisits, remoteNorm.storeVisits || []) ||
      !sameArrayByReference(tracks, remoteNorm.tracks || []) ||
      !sameArrayByReference(trackMeasurements, remoteNorm.trackMeasurements || []) ||
      !sameArrayByReference(weeklyCommitments, remoteNorm.weeklyCommitments || []) ||
      !sameArrayByReference(swipeTriageLog, remoteNorm.swipeTriageLog || []) ||
      jsonChanged(gardenLog, remoteNorm.gardenLog) ||
      !sameArrayByReference(coachMeals, remoteNorm.coachLog?.meals || []) ||
      !sameArrayByReference(aiStepProcessedIds, remoteNorm.aiStepProcessedIds || []) ||
      !sameArrayByReference(aiStepDismissedIds, remoteNorm.aiStepDismissedIds || []) ||
      !sameArrayByReference(aiReportReadIds, remoteNorm.aiReportReadIds || []) ||
      !sameArrayByReference(aiStepPendingRequests, remoteNorm.aiStepPendingRequests || []) ||
      (zeroThinking ? !zeroThinkingListsEqual(zeroThinking, remoteNorm.zeroThinking) : false) ||
      // unit14b追加分
      reports.changedVsRemote ||
      !sameArrayByReference(chainRuns, remoteNorm.chainRuns || []) ||
      !sameArrayByReference(zeroSecThemeLog, remoteNorm.zeroSecThemeLog || []) ||
      !sameArrayByReference(migrationRitualLog, remoteNorm.migrationRitualLog || []) ||
      !sameArrayByReference(feedbackFiles, remoteNorm.feedbackFiles || []) ||
      !sameArrayByReference(feedbackIngestedDates, remoteNorm.feedbackIngestedDates || []) ||
      !sameArrayByReference(aiWorkProcessedIds, remoteNorm.aiWorkProcessedIds || []) ||
      !sameArrayByReference(zeroThinkingGroups, remoteNorm.zeroThinking?.groups || []);
    return {
      values: {
        journals: journals.map, journalMeta, feedback: feedback.map, conditionLogs, sleepLogs, morningEnergyLog, blocks, zeroThinking, dailyDeclarations, weeklyWishes, bodyScans, writeMeditations, tasks, projects, storeVisits, tracks, trackMeasurements, weeklyCommitments, swipeTriageLog, gardenLog, coachMeals, aiStepProcessedIds, aiStepDismissedIds, aiReportReadIds, aiStepPendingRequests,
        // unit14b追加分
        reports: reports.map, chainRuns, zeroSecThemeLog, migrationRitualLog, feedbackFiles, feedbackIngestedDates, aiWorkProcessedIds, zeroThinkingGroups
      },
      changedVsLocal, changedVsRemote
    };
  } catch (error) {
    console.warn("同期マージをスキップ:", error.message);
    return null;
  }
}

// マージ結果をローカルstateへ適用(「ローカルを基準に残す」経路用)。変化があればtrue。
function applySyncMergeToLocal(merged) {
  if (!merged || !merged.changedVsLocal) return false;
  const v = merged.values;
  state.journals = v.journals;
  state.journalMeta = v.journalMeta;
  state.feedback = v.feedback;
  state.condition.logs = v.conditionLogs;
  state.sleep.logs = v.sleepLogs;
  state.settings.morningEnergyLog = v.morningEnergyLog;
  state.blocks = v.blocks;
  state.dailyDeclarations = v.dailyDeclarations;  // v117(A)
  state.weeklyWishes = v.weeklyWishes;  // v121
  state.bodyScans = v.bodyScans;  // v129
  state.writeMeditations = v.writeMeditations;  // v294
  state.tasks = v.tasks;  // v135
  state.projects = v.projects;  // v135
  state.storeVisits = v.storeVisits;  // v141
  state.tracks = v.tracks;  // v243
  state.trackMeasurements = v.trackMeasurements;  // v243
  state.weeklyCommitments = v.weeklyCommitments;  // v243
  state.swipeTriageLog = v.swipeTriageLog;  // v152
  state.gardenLog = v.gardenLog;  // v153
  // v201 AIコーチ1a: coachLog未初期化のstate(normalizeState前の経路)でも落ちないよう
  // オブジェクトごと再構成する(settingsは同期対象外の方針を維持しローカル値を温存)
  state.coachLog = { ...(state.coachLog || {}), meals: v.coachMeals };
  state.aiStepProcessedIds = v.aiStepProcessedIds;  // v197
  state.aiStepDismissedIds = v.aiStepDismissedIds;  // v197
  state.aiReportReadIds = v.aiReportReadIds;  // v283
  state.aiStepPendingRequests = v.aiStepPendingRequests;  // v197
  if (v.zeroThinking) {
    state.zeroThinking.entries = v.zeroThinking.entries;
    state.zeroThinking.suggestedThemes = pruneExpiredSuggestedThemes(v.zeroThinking.suggestedThemes);
  }
  // unit14b(独立レビュー2026-09-04): 和集合マージへ昇格させたstate直下7キー+zeroThinking.groups
  state.reports = v.reports;
  state.chainRuns = v.chainRuns;
  state.zeroSecThemeLog = v.zeroSecThemeLog;
  state.migrationRitualLog = v.migrationRitualLog;
  state.feedbackFiles = v.feedbackFiles;
  state.feedbackIngestedDates = v.feedbackIngestedDates;
  state.aiWorkProcessedIds = v.aiWorkProcessedIds;
  state.zeroThinking.groups = v.zeroThinkingGroups;
  return true;
}

// マージ結果をリモート(採用予定のremoteNorm)へ適用(「リモートを採用する」経路用)。
// ローカル限定の記録が採用で消えないようにする。remoteNormから乖離があればtrue
// (呼び出し側はdataModifiedAtを進めて次回pushで和集合を届ける)。
function applySyncMergeToRemote(merged, remoteNorm) {
  if (!merged || !merged.changedVsRemote) return false;
  const v = merged.values;
  remoteNorm.journals = v.journals;
  remoteNorm.journalMeta = v.journalMeta;
  remoteNorm.feedback = v.feedback;
  remoteNorm.condition.logs = v.conditionLogs;
  remoteNorm.sleep.logs = v.sleepLogs;
  remoteNorm.settings.morningEnergyLog = v.morningEnergyLog;
  remoteNorm.blocks = v.blocks;
  remoteNorm.dailyDeclarations = v.dailyDeclarations;  // v117(A)
  remoteNorm.weeklyWishes = v.weeklyWishes;  // v121
  remoteNorm.bodyScans = v.bodyScans;  // v129
  remoteNorm.writeMeditations = v.writeMeditations;  // v294
  remoteNorm.tasks = v.tasks;  // v135
  remoteNorm.projects = v.projects;  // v135
  remoteNorm.storeVisits = v.storeVisits;  // v141
  remoteNorm.tracks = v.tracks;  // v243
  remoteNorm.trackMeasurements = v.trackMeasurements;  // v243
  remoteNorm.weeklyCommitments = v.weeklyCommitments;  // v243
  remoteNorm.swipeTriageLog = v.swipeTriageLog;  // v152
  remoteNorm.gardenLog = v.gardenLog;  // v153
  // v201 AIコーチ1a: 上のapplySyncMergeToLocalと同じ理由でオブジェクトごと再構成
  remoteNorm.coachLog = { ...(remoteNorm.coachLog || {}), meals: v.coachMeals };
  remoteNorm.aiStepProcessedIds = v.aiStepProcessedIds;  // v197
  remoteNorm.aiStepDismissedIds = v.aiStepDismissedIds;  // v197
  remoteNorm.aiReportReadIds = v.aiReportReadIds;  // v283
  remoteNorm.aiStepPendingRequests = v.aiStepPendingRequests;  // v197
  if (v.zeroThinking) {
    remoteNorm.zeroThinking.entries = v.zeroThinking.entries;
    remoteNorm.zeroThinking.suggestedThemes = pruneExpiredSuggestedThemes(v.zeroThinking.suggestedThemes);
  }
  // unit14b(独立レビュー2026-09-04): 和集合マージへ昇格させたstate直下7キー+zeroThinking.groups
  remoteNorm.reports = v.reports;
  remoteNorm.chainRuns = v.chainRuns;
  remoteNorm.zeroSecThemeLog = v.zeroSecThemeLog;
  remoteNorm.migrationRitualLog = v.migrationRitualLog;
  remoteNorm.feedbackFiles = v.feedbackFiles;
  remoteNorm.feedbackIngestedDates = v.feedbackIngestedDates;
  remoteNorm.aiWorkProcessedIds = v.aiWorkProcessedIds;
  remoteNorm.zeroThinking.groups = v.zeroThinkingGroups;
  return true;
}

// 自動 pull(起動 + visibilitychange、60秒スロットル)
async function runAutoSyncPull() {
  if (!autoSyncReady()) return;
  const now = Date.now();
  if (now - _lastPullCheckAt < AUTO_SYNC_PULL_THROTTLE_MS) return;
  _lastPullCheckAt = now;
  const cfg = state.settings.github;
  try {
    const { text, sha } = await downloadGitHubStateText(personalDataFileConfig(cfg));
    recordSyncPullSuccess();  // v134: この端末の最終pull成功時刻(localStorage、state非経由)
    const remote = JSON.parse(text);
    const remoteT = remote.dataModifiedAt || "";
    const localT = state.dataModifiedAt || "";
    // v106: マージ計算はnormalize済みの別コピーで行う(remoteは採用フォールバック用に生のまま)
    // v136(High-2): computeSyncMergeは分岐ごとに(適用先に応じたtieWinnerで)個別に呼ぶ
    // (以前は1回だけ計算した結果を全分岐で使い回しており、tieWinnerを分岐ごとに変えられなかった)。
    const remoteNorm = normalizedRemoteCopy(text);
    if (!remoteT || remoteT <= localT) {
      // remote 古い/同じ。それでもリモート限定の記録は合流させる(v103の0秒思考対策を
      // v106でジャーナル/blocks/体調/睡眠へ一般化。PC側が新しくてもiPhone分が見える)。
      // tieWinner="local": ローカルを基準に残す経路。
      const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "local") : null;
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (changed) saveState();
      if (changed || runDailyOpen()) render();
      return;
    }
    const hasUnpushed = localT !== (state.settings.lastPushedAt || "");
    if (hasUnpushed) {
      // 両方に未反映の変更。マージ可能コレクションは合流させたうえで、
      // v106: コア(tasks等)が両端末で一致していれば差分はマージ済み分だけなので、
      // 人間判断を待たず「和集合を正」として自動解消する(push見送りも解除)。
      // tieWinner="local": ここもapplySyncMergeToLocal(ローカルを基準に残す)経路。
      const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "local") : null;
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (syncMerge && syncCoreEqual(remoteNorm)) {
        state.settings.lastPushedAt = remoteT;   // リモート分は取り込み済み
        setLastSyncedSha(sha);
        state.dataModifiedAt = nowDateTime();    // 和集合を次のpushで届ける
        persistLocalNoSchedule();
        scheduleAutoSync();
        clearSyncBanner({ clearDismissal: true });
        runDailyOpen();
        render();
        showToast("他端末の記録を取り込みました");
        return;
      }
      if (changed) saveState();
      setSyncBanner("リモートに新しいデータ。ローカルにも未pushの変更があります。設定から手動で確認してください");
      if (changed || runDailyOpen()) render();
      return;
    }
    // 自動適用(ローカルに未push変更なし & remote が新しい)。tieWinner="remote": リモートを
    // 基準に採用する経路(applySyncMergeToRemote)。
    const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "remote") : null;
    clearTimeout(autoSaveTimer);
    const token = cfg.token;
    // 採用前に、ローカルにしか無い記録を採用予定のリモートへ合流させる(採用で消さないため)。
    let addedLocal = false;
    let adopted;
    if (remoteNorm && syncMerge) {
      addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
      adopted = remoteNorm;
    } else {
      // フォールバック(v103相当: 0秒思考のみ合流)
      const remoteZtBefore = remote.zeroThinking || {};
      const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
      addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
      if (merged) remote.zeroThinking = { ...remoteZtBefore, ...merged };
      adopted = normalizeState(remote);
    }
    setState(adopted);
    state.settings.github = { ...cfg, token };
    state.settings.lastPushedAt = remoteT;   // 取り込んだ = リモートと一致
    state.settings.lastPulledAt = nowDateTime();
    setLastSyncedSha(sha);
    maintainRecurrences({ purge: true });
    runDailyOpen();  // §2: pull 後に日次オープン(古いstate展開→pullで消える事故を防ぐ)
    clearSyncBanner({ clearDismissal: true });
    if (addedLocal) {
      // 合流分はリモートの元スナップショットに無かった変更 → 次回pushで届くようにする
      // (lastPushedAtより新しいdataModifiedAtにして「未push」を成立させる)。
      state.dataModifiedAt = nowDateTime();
      scheduleAutoSave();
      scheduleAutoSync();
    }
    persistLocalNoSchedule();
    render();
    showToast("最新データを取り込みました");
  } catch { if (runDailyOpen()) render(); }
}

function setSyncBanner(msg) { _syncBanner = msg; renderSyncBanner(); updateSyncDot(); }
function clearSyncBanner({ clearDismissal = false } = {}) {
  _syncBanner = null;
  if (clearDismissal) clearSyncBannerDismissal?.();
  renderSyncBanner();
  updateSyncDot();
}

// GitHub から app-state を取得し { text, sha } を返す(1MB 超は Blob API 経由)
async function downloadGitHubStateText(config) {
  const response = await fetch(`${gitHubContentsURL(config)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token)
  });
  if (!response.ok) throw new Error(await gitHubErrorMessage(response));
  const payload = await response.json();
  // v22: Contents API は 1MB 超のファイルの content を返さない → Blob API を使う
  let jsonText;
  if (payload.content && payload.encoding === "base64") {
    jsonText = fromBase64(payload.content);
  } else {
    if (!payload.sha) throw new Error("ファイル情報を取得できませんでした");
    const blobURL = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs/${payload.sha}`;
    const blobResp = await fetch(blobURL, { headers: githubHeaders(config.token) });
    if (!blobResp.ok) throw new Error(await gitHubErrorMessage(blobResp));
    const blob = await blobResp.json();
    jsonText = fromBase64(blob.content || "");
  }
  if (!jsonText.trim()) throw new Error("ファイルが空です");
  const currentToken = requireGitHubConfig().token;
  if (!/[^\x00-\xFF]/.test(String(currentToken || "").trim())) {
    clearPersonalDataAuthError();  // v303: 現在のtokenが正常なpull成功時だけ解除する
  }
  return { text: jsonText, sha: payload.sha || "" };
}

// 手動「GitHubから読込」: リモートを採用(dataModifiedAt はリモートの値を維持)
async function loadFromGitHub() {
  try {
    const config = requireGitHubConfig();
    const { text, sha } = await downloadGitHubStateText(config);
    recordSyncPullSuccess();  // v134: この端末の最終pull成功時刻(localStorage、state非経由)
    const loaded = JSON.parse(text);
    // v37: 読込前の編集で予約された自動保存を取り消す(読込直後の無意味なpush防止)
    clearTimeout(autoSaveTimer);
    // v94: state.settings.github の復元には requireGitHubConfig() の変換済み形状(config。
    // owner/repo キー・personalDataPath()でtaskchute/付与済みのpath)ではなく、この端末の
    // 生の設定(rawSettings。dataOwner/dataRepo・taskchute/無しのpath)を使う。
    // 変換済みconfigをそのまま流し込むと dataOwner/dataRepo が失われ、path が
    // taskchute/taskchute/... の二重プレフィックスになる不具合があった(K報告 2026-07-14)。
    // syncFromGitHubOnStartup()/runAutoSyncPull()/restoreBackup() は元から生の設定を
    // 使っており対象外(state上書き前に cfg/currentGithubSettings として退避済み)。
    const rawSettings = state.settings.github;
    // v103→v106: リモート採用前に、ローカルにしか無い記録(0秒思考/ジャーナル/blocks/体調/睡眠)を
    // 合流させる(採用でローカル限定の記録を消さないため)。
    // tieWinner="remote": この関数は常にremoteを採用する経路(applySyncMergeToRemote)。
    const remoteNorm = normalizedRemoteCopy(text);
    // unit15差し戻し(独立レビュー2026-09-04、A2-M11の偽警告根治とセット):
    // 「未pushフラグ」(dataModifiedAt !== lastPushedAt)だけでconfirmを出すと、実際には
    // コア(SYNC_CORE_COMPARE_KEYS)が一致しているのに毎回警告する偽陽性が起きる
    // (旧実装はloadFromGitHubがlastPushedAtを更新しなかったため特に起きやすかった。(d)参照)。
    // ここでは実際に破棄されるコア差分の件数(diffCount)を先に数え、0件なら確認もスナップショットも
    // 出さず従来どおり読み込む。
    const diffCount = remoteNorm
      ? SYNC_CORE_COMPARE_KEYS.filter((k) =>
          JSON.stringify(getByPath(remoteNorm, k) ?? null) !== JSON.stringify(getByPath(state, k) ?? null)
        ).length
      : 0;
    if (diffCount > 0) {
      const lastEdited = state.dataModifiedAt || "不明";
      const ok = window.confirm(
        `この端末には未pushの変更があります(最終編集: ${lastEdited}、GitHub側と異なるコア項目 ${diffCount}件)。\n` +
        `GitHubの内容で読み込むと、これらのローカル変更は破棄されます。読み込みますか?`
      );
      if (!ok) { showToast("読み込みを中止しました(ローカルの変更は保持されています)"); return; }
      // 採用直前の自動スナップショット(既存の世代バックアップ機構=backups/を再利用。ファイル名は
      // 通常の日次世代とは別名にして1回目の控えを上書きしない。writeBackupSnapshotBeforeLoad参照)。
      // fail-close: 控えを保存できなければ採用せず読込そのものを中止する(無音のfail-openにしない)。
      let snapshotOk = false;
      try { snapshotOk = await writeBackupSnapshotBeforeLoad(); }
      catch (error) { console.warn("読込前スナップショットに失敗:", error.message); }
      if (!snapshotOk) {
        showToast("控えを保存できなかったため読込を中止しました(ローカルの変更は保持されています)");
        return;
      }
    }
    const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "remote") : null;
    let addedLocal = false;
    let adopted;
    if (remoteNorm && syncMerge) {
      addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
      adopted = remoteNorm;
    } else {
      // フォールバック(v103相当: 0秒思考のみ合流)
      const remoteZtBefore = loaded.zeroThinking || {};
      const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
      addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
      if (merged) loaded.zeroThinking = { ...remoteZtBefore, ...merged };
      adopted = normalizeState(loaded);
    }
    setState(adopted);
    state.settings.github = { ...rawSettings };
    // unit15差し戻し(d): runAutoSyncPullの自動採用経路と同じパターンで、採用した内容の
    // dataModifiedAtにlastPushedAtを揃える。これをしないと採用直後もhasUnpushed相当の状態が
    // 残り続け、実際にはコアが一致しているのに次の読込でも偽の「未push警告」が出る
    // (独立レビュー指摘のA2-M11偽警告の根治)。addedLocal(ローカル限定データの合流)がある
    // 場合は直後にdataModifiedAtがnowへ進むため、その分だけは正しく「未push」のまま残る
    // (合流分を次回pushで届けるため。runAutoSyncPullと同じ考え方、下記参照)。
    state.settings.lastPushedAt = adopted.dataModifiedAt || "";
    maintainRecurrences({ purge: true });
    if (addedLocal) {
      // 合流で内容がリモートの元スナップショットから乖離した場合だけ例外的にdataModifiedAtを
      // 進める(通常の手動読込は「採用のためdataModifiedAtは更新しない」が原則。合流分を
      // 次回pushで届けるための例外)。
      state.dataModifiedAt = nowDateTime();
      scheduleAutoSave();
      scheduleAutoSync();
    }
    persistLocalNoSchedule();  // 採用のため dataModifiedAt は更新しない(合流時を除く。上記参照)
    setLastSyncedSha(sha);     // v37: この端末はこのリモート状態と同期済み
    render();
    showToast("GitHubから読み込みました");
  } catch (error) {
    showToast(`GitHub読込失敗: ${error.message}`);
  }
}

// v25: 起動時、GitHub 側がローカルより新しければ取り込む(ローカルファースト)。
// ローカルを即描画した後にバックグラウンドで実行される。
async function syncFromGitHubOnStartup() {
  const cfg = state.settings.github || {};
  if (!personalDataReady(cfg)) return;  // 未設定なら何もしない
  // v118: 下のGET(await)を待つ間にユーザーが編集すると、_startupDataModifiedAt(起動時点の
  // 古い比較用スナップショット、v37)は動かないため「remoteが新しい」という古い比較結果のまま
  // remote全量採用(state = adopted)へ進み、待ち中の編集を消してしまう競合があった
  // (taskchute-notes/review.md severity: high)。fetch開始直前の値を別途控えておき、
  // 採用直前に現在値と比較して「待ち中に編集されていないか」を再確認する。
  const preFetchDataModifiedAt = state.dataModifiedAt || "";
  try {
    const { text, sha } = await downloadGitHubStateText(personalDataFileConfig(cfg));
    recordSyncPullSuccess();  // v134: この端末の最終pull成功時刻(localStorage、state非経由)
    const remote = JSON.parse(text);
    // v37: 比較は「起動時点のローカル更新時刻」と行う。
    //      fetch中にユーザーがタブを触るなどして saveState が走ると localT が進み、
    //      本来取り込むべき新しいリモートを永遠に取りこぼす問題への対策。
    const localT = _startupDataModifiedAt || "";
    const remoteT = remote.dataModifiedAt || "";
    // リモートが新しいときだけ採用(ISO 文字列なので辞書順比較でよい)
    // v106: どちらの分岐でもマージ可能コレクション(ジャーナル/blocks/体調/睡眠/0秒思考)は
    // 和集合で合流させる(iPhone分がPC起動pullで見えなくなる事故対策の一般化)。
    // v136(High-2): computeSyncMergeは分岐ごとに(適用先に応じたtieWinnerで)個別に呼ぶ
    // (以前は1回だけ計算した結果を全分岐で使い回しており、tieWinnerを分岐ごとに変えられなかった)。
    const remoteNorm = normalizedRemoteCopy(text);
    if (remoteT && remoteT > localT) {
      // v118: 採用直前の不変確認。GET待ち中に編集されていたら、remote全量採用は中止し
      // runAutoSyncPull()のhasUnpushed分岐(既存の競合バナー/自動和集合解消フロー)と
      // 同じ考え方で処理する — マージ可能コレクションだけ先に合流させ、コア(tasks等)まで
      // 一致していれば人間判断なしで解消、そうでなければ既存の競合バナーへ送る
      // (新しいUIは作らない・ローカルの編集を破棄しない)。
      if ((state.dataModifiedAt || "") !== preFetchDataModifiedAt) {
        // tieWinner="local": ここはapplySyncMergeToLocal(ローカルを基準に残す)経路。
        const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "local") : null;
        const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
        if (syncMerge && syncCoreEqual(remoteNorm)) {
          state.settings.lastPushedAt = remoteT;
          setLastSyncedSha(sha);
          state.dataModifiedAt = nowDateTime();
          persistLocalNoSchedule();
          clearSyncBanner({ clearDismissal: true });
          render();
          showToast("他端末の記録を取り込みました");
          return;
        }
        if (changed) { saveState(); render(); }
        setSyncBanner("リモートに新しいデータがあります。編集中に取得したため自動取込を中止しました。設定から手動で確認してください");
        return;
      }
      clearTimeout(autoSaveTimer);
      const token = state.settings.github.token;
      // tieWinner="remote": ここはapplySyncMergeToRemote(リモートを基準に採用する)経路。
      const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "remote") : null;
      // リモート採用前に、ローカルにしか無い記録を合流させてから採用する(採用で消さないため)。
      let addedLocal = false;
      let adopted;
      if (remoteNorm && syncMerge) {
        addedLocal = applySyncMergeToRemote(syncMerge, remoteNorm);
        adopted = remoteNorm;
      } else {
        // フォールバック(v103相当: 0秒思考のみ合流)
        const remoteZtBefore = remote.zeroThinking || {};
        const merged = mergeZeroThinkingLists(state.zeroThinking, remoteZtBefore);
        addedLocal = merged && !zeroThinkingListsEqual(merged, remoteZtBefore);
        if (merged) remote.zeroThinking = { ...remoteZtBefore, ...merged };
        adopted = normalizeState(remote);
      }
      setState(adopted);
      state.settings.github = { ...cfg, token };
      maintainRecurrences({ purge: true });
      if (addedLocal) {
        // 合流分はリモートの元スナップショットに無かった変更 → 次回pushで届くようにする
        state.dataModifiedAt = nowDateTime();
        scheduleAutoSave();
        scheduleAutoSync();
      }
      persistLocalNoSchedule();
      setLastSyncedSha(sha);   // v37: この端末はこのリモート状態と同期済み
      render();
      showToast("最新データを取り込みました");
    } else {
      // ローカルが新しい/同じ → 他フィールドは変更しない(次回保存で GitHub へ反映される)。
      // v38: リモートの現状は確認済みなので「同期済みSHA」だけ記録する。
      //      これが無いと、稼働中の既存端末が(SHA未記録のため)一度手動で
      //      「GitHubから読込」するまで自動保存を見送り続けてしまう。
      // v103→v106: リモートにしか無い記録(0秒思考に加えジャーナル/blocks/体調/睡眠)を
      // ローカルへ合流させる(iPhoneで書いた記録がPC起動pullで見えなくなる事故対策)。
      // tieWinner="local": ここもapplySyncMergeToLocal(ローカルを基準に残す)経路。
      const syncMerge = remoteNorm ? computeSyncMerge(remoteNorm, "local") : null;
      const changed = syncMerge ? applySyncMergeToLocal(syncMerge) : mergeZeroThinkingIntoLocal(remote.zeroThinking);
      if (changed) { saveState(); render(); }
      setLastSyncedSha(sha);
    }
  } catch (error) {
    // 起動時の同期失敗は致命的でない(ローカルで動作継続)
    console.warn("起動時の GitHub 同期をスキップ:", error.message);
  }
}

// ---- ここまで抽出したコード本体 ----

export {
  configureGithubSync,
  saveToGitHub, runAutoSyncPush, runAutoSyncPull, loadFromGitHub, syncFromGitHubOnStartup,
  scheduleAutoSave, scheduleAutoSync, autoSyncReady,
  computeSyncMerge, syncCoreEqual, normalizedRemoteCopy,
  applySyncMergeToLocal, applySyncMergeToRemote,
  setSyncBanner, clearSyncBanner, _syncBanner,
  autoSaveTimer, _autoSyncTimer,
  getLastSyncedSha, setLastSyncedSha,
  getLastSyncPushAt, recordSyncPushSuccess, getLastSyncPullAt, recordSyncPullSuccess,
  downloadGitHubStateText
};
