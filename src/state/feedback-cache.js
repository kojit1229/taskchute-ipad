// src/state/feedback-cache.js — app.js分割・段階4-1(ダッシュボード抽出に伴う共有キャッシュ切り出し)。
//
// cachedFeedbackはHomeタブ「AIから」カード(app.js残留)とsrc/features/dashboard.jsの両方が
// 読み書きする共有オブジェクト(prep-stage4-dashboard.md §4/§9 Must級)。再代入はせずプロパティの
// 追加・変更のみのため、store.jsのstateと同じくlive bindingのままで安全に共有できる。
//
// characterization test: tests/dashboard-core.test.js。

const cachedFeedback = {};  // { 'YYYY-MM-DD': '...md text...' }

export { cachedFeedback };
