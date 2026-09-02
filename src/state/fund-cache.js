// FUND表示用の非永続キャッシュ。再代入せず、live bindingのプロパティだけを更新する。
const fundCache = { fetchedAt: 0, data: undefined, lastError: "", lastAttemptAt: 0 };

export { fundCache };
