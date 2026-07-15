# CHANGES v100

## 概要

ROADMAP.md「週次抽象化(転用)由来の提案」提案A(2026-07-15 K承認)。0秒思考タブに
「AI提案お題」キューUI(候補の表示・採用・却下)を追加する。

SW `CACHE_NAME` を v99 → v100 に更新。

---

## 仕様

1. 新フィールド **`state.zeroThinking.suggestedThemes[]`**。スキーマ(監督者確定・変更禁止):
   `{ id, text, source: "daily"|"weekly", reason, createdAt, status: "pending"|"adopted"|"dismissed", adoptedThemeId? }`。
   生成は週次抽象化・日次コーチングのバッチ側の責務(`journal-requests.sh`と同じ「app-state.json
   へ追記する」経路)。アプリ側は**表示・採用・却下(status遷移)のみ**を担い、候補の生成・削除は
   一切しない。`normalizeState`で旧端末データ(配列自体が欠損)を`[]`補完する。
2. 0秒思考タブ・テーマタブの「テーマ一覧」パネル上部に「AI提案お題」セクションを新設
   (`renderZtSuggestions`)。pending候補ごとにお題文+提案理由(reasonがあるときのみ表示)+
   「採用」ボタン+「×」却下ボタン。**pending 0件のときはセクション自体を出さない**。
3. **採用**(`ztSuggestionAdopt`): 既存の手動テーマ追加(`ztAddSubmit`)と同じ経路でテーマ化する。
   初期配置は未分類(`groupId: null`)。候補側は削除せず`status: "adopted"` + `adoptedThemeId`
   へ遷移させる(履歴としてstateに残るのみ・アプリでは表示しない)。
4. **却下**(`ztSuggestionDismiss`): `status: "dismissed"`へ遷移させるのみ。テーマ化しない。
5. adopted/dismissedの履歴表示はしない(要件どおり)。stateに残り続ける件については下記6で
   ハウスキーピングを追加した。

## 追加指示(2026-07-15、K→監督者経由): 期限切れ候補の自動削除

6. 採用されないままキューが溜まり続けるのを防ぐため、`normalizeState`の読み込み時に
   **物理削除**するハウスキーピングを追加した:
   - `status: "pending"` かつ `createdAt` から**3日(72時間)**超過 → 削除
   - `status: "adopted"` / `"dismissed"` かつ`createdAt`から**7日**超過 → 削除
   日時比較は既存の `localDateTimeToMs`(`new Date(文字列)` を経由しない、iOS Safari TZ誤解釈
   回避パターン。`isWishStagnant`と同じ形)を再利用した。`createdAt`欠損・不正値は0扱いとなり
   即時削除対象になる(バッチ契約違反データを溜めない安全側の挙動)。
   - **設計判断の確認**: 既存の`decisions.md`(v86, 2026-07-11)に「AI由来テーマ削除時は
     `zeroSecThemeLog`のoutcome="skipped"を再利用」という決定があるが、これは`zeroThinking.themes`
     削除時の別ログ(学習シグナル)の話であり、本機能の`suggestedThemes`(提案キューそのもの)とは
     別データ構造。7日物理削除との矛盾は無いと判断した。採否ログとしての学習利用が将来必要に
     なった場合は、`zeroSecThemeLog`と同様の専用ログへ別途記録する設計を再検討すること
     (現状は`suggestedThemes`自体を学習に使っていないため、消してよいと判断)。

---

## テスト

`tests/v100.test.js`([1]〜[8]、全8ブロック・28チェック、ALL PASS):
- pending候補の表示/0件時非表示/reasonの表示
- adopted/dismissed候補は表示しない
- 採用→未分類テーマ追加+status遷移(adoptedThemeId含む)+候補UIから消える
- 却下→status遷移+候補UIから消える+テーマ化しない
- normalizeState後方互換(suggestedThemes/groupsキー自体が欠損した旧state)
- 390px幅で横スクロールが発生しない
- ハウスキーピング: pending 4日前は物理削除・2日前は残る、adopted 8日前は物理削除・
  dismissed 1日前は残る、削除後も既存テーマ等の他フィールドは無傷

`npm run test:core`(10スイート)ALL PASS。`node --check app.js` exit 0。

---

## 残る懸念・未対応

- バッチ側(週次抽象化/日次コーチング)の`suggestedThemes`への書き込み・重複防止・件数上限は
  別エージェント実装中の範囲でこのタスクのスコープ外(このコミット群はアプリ側のみ)。
- 採用後のテーマに「AI提案由来」であることを示すタグは付けていない(`ztRenderThemeItem`が
  `source === "ai-feedback"`のときだけ🤖バッジを出す既存経路とは別物として、既存の手動追加と
  完全に同じ形でテーマ化した。要件に明記が無かったため)。
