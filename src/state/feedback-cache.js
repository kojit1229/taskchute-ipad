// src/state/feedback-cache.js — Homeタブ「AIから」カードのフィードバックキャッシュ。
//
// 再代入はせずプロパティの追加・変更のみのため、store.jsのstateと同じくlive bindingのままで
// 安全に共有できる。

const cachedFeedback = {};  // { 'YYYY-MM-DD': '...md text...' }

export { cachedFeedback };
