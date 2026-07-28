// src/state/journal-fold.js — app.js分割・段階4-3(ジャーナル抽出に伴う共有開閉状態の切り出し)。
//
// _journalSegmentOverrideは、click dispatcher(app.js残留・"toggle-journal-segment"分岐)と
// src/features/journal.jsのrenderJournal()の両方が読み書きする共有オブジェクト
// (prep-stage4-journal.md §2/§7、src/state/feedback-cache.js冒頭コメントと同じ理由・同じ形)。
// 再代入はせずプロパティの追加・変更のみのため、store.jsのstateと同じくlive bindingのままで
// 安全に共有できる。
//
// v148: 「動的にopen既定が変わるdetails」(ジャーナル朝/夜)の手動開閉オーバーライド
// (セッション内のみ、非永続 = リロードで消える)。詳細な設計意図はapp.js側の元コメント
// (v148コメント、click dispatcher直前)を参照。
//
// characterization test: tests/journal-core.test.js。

const _journalSegmentOverride = {};  // { morning: bool, evening: bool, body: bool }

export { _journalSegmentOverride };
