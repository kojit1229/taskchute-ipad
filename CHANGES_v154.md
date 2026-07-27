# v154 ADHD支援「①仕分けモード S2(スワイプ)」

v152の三択ボタン仕分けモードに、Pointer Events統一のスワイプ操作を追加する
(designs/03-task-swipe.md §⑤S2、K承認事項2026-07-27)。三択ボタンは変更せず併存させる
(設計書§③「必ずボタンでも実行可能」)。データモデル・キュー構築(`triageQueue`)・
三択それぞれの状態遷移ロジック自体はv152からの変更なし。Undoトースト・ホームバナーは
後続ステップ(S3)。

**本ファイルは初回実装+2系統レビュー(FAIL判定)対応後の最終版**。初回実装からの設計変更
(スワイプの方向割当)と、多指誤操作・連続スワイプの飲み込み・縦スクロールとの競合という
3件の実バグ修正を含む。

## 1. 設計変更(2026-07-28、監督者裁定): スワイプは左右のみ、延期はボタン専用

初回実装は「右=今日やる/左=手放す/上=延期」の三方向スワイプだったが、2系統レビューで
**仕分けビューは実測で全ビューポートにおいて縦スクロールが発生している**(コンテンツ高さが
ビューポートを+113〜350px超える)ことが指摘された。初回実装の`touch-action: none`はカード上の
縦方向操作をすべてジェスチャとして奪っていたため、**上フリック(縦スクロールの意図)が
「取り消せない延期」として誤確定する事故**があった。

対応(裁定): **スワイプは左右(今日やる/手放す)のみとし、延期はボタン専用に戻した**。
`touch-action`は`none`→**`pan-y`**に変更し、縦方向はブラウザのネイティブスクロールへ譲る
(横方向のみ`pointermove`中の`event.preventDefault()`でジェスチャとして奪う)。
`triageSwipeCandidate(dx, dy)`は縦優位(`absX < absY`)の移動を候補なし(`null`)として扱う
(=ネイティブスクロールに委ねる。上でも下でも同じ)。設計書
(`workbench/out/2026-07-27-appidea-designs/03-task-swipe.md`)の§③表・§③-3・§⑤S2行も
この変更に合わせて改訂した。

| 操作 | 意味 |
|---|---|
| 右スワイプ / ✅ボタン | 今日やる |
| 左スワイプ / 🕊ボタン | 手放す |
| (スワイプなし) / 🌙ボタン | 延期(来月)。ボタン専用 |

確定閾値`TRIAGE_SWIPE_CONFIRM_PX = 70px`(設計書「横60〜80px」の中間値、水平方向のみに適用)は
変更なし。

## 2. 多指の誤確定防止(2系統レビュー両方が指摘)

初回実装は`pointerId`を一切見ておらず、2本目の指で操作しても(iPadでの誤タッチ・意図しない
マルチタッチ)そのままドラッグとして処理・確定してしまう欠陥があった。修正:

- `pointerdown`は`event.isPrimary`が`true`の場合のみ受け付ける(2本目以降の指は無視)。
  ドラッグ中に新たな`pointerdown`が来ても`_triageSwipe`が既にあれば無視する(二重防御)。
- `_triageSwipe`に`pointerId`を保持し、`pointermove`/`pointerup`/`pointercancel`は
  この`pointerId`と一致するイベントのみ処理する(一致しなければ無視して`_triageSwipe`も
  変更しない)。
- `card.setPointerCapture(event.pointerId)`は`try/catch`で保護した(`NotFoundError`が
  観測されたため。ポインタが既にリリース済み等の状況でも例外で処理全体を止めない)。

`tests/v154.test.js`に、1本目の指でドラッグ中に2本目の指が触れてすぐ離れても(閾値を大きく
超える位置で)確定しないことを検証するテストを追加した(`page.mouse`は単一ポインタしか
表現できないため、`document`へ合成`PointerEvent`列を直接dispatchして検証している)。

## 3. 連続スワイプの飲み込み(2系統レビュー両方が指摘)、クールダウンを`via`で分岐

初回実装の`triageAction`は「直前の成功からTRIAGE_ACTION_COOLDOWN_MS(350ms)未満の呼び出しは
**カードidを問わず**無視する」という単純な一律クールダウンだった。スワイプは退場アニメ
(180ms)を挟んで確定するため、**異なる2枚を210ms程度の間隔でテンポよく連続スワイプすると、
2枚目の確定呼び出しが1枚目の確定から350ms以内に発生し、無関係な別カードの操作なのに
無視されてしまう**バグがあった。

**時間ベースの閾値だけでは解決できなかった経緯**: 当初「直前の成功からの経過時間が短ければ
via(ボタン/スワイプ)を問わず一律ブロックする」閾値(150ms)を試したが、`tests/v152.test.js`の
既存二重タップガードテスト([3]、`await click(); await click();`を待機なしで連打)を8回中
最大3回失敗させてしまった。原因を計測したところ、Playwrightの`locator.click()`は対象要素の
安定性待機を挟むため、**待機なしの連続クリックの実測間隔が41ms〜362msまで大きくばらつく**
ことが判明した(`page.evaluate`内で`element.click()`を直接呼ぶ場合はこの限りではない)。
この分布は210ms間隔の意図的な連続スワイプの想定間隔と重なってしまい、**どんな閾値を選んでも
どちらかを誤検知する**(ちなみにv154以前の元の350ms一律クールダウンでも、同じ二重タップ
ガードテストを8回中1回失敗させることを確認した=これはv154が作り込んだ回帰ではなく、
`locator.click()`の待機時間のばらつきに起因する既存のテストの潜在的な不安定性である)。

対応: 閾値を時間ではなく**呼び出し経路(`via`)という構造的な条件**で分岐させた。

```js
const withinCooldown = now - _triageLastActionAt < TRIAGE_ACTION_COOLDOWN_MS;
if (withinCooldown && id === _triageLastActionId) return false;      // 同一idの二重発火(via問わず)
if (withinCooldown && via === "button") return false;                // 別カードへの操作はボタン限定でブロック
```

- **同一idへの二重発火**は`via`を問わず従来どおり350msブロックする(スワイプとボタンを
  取り違えて同じカードを2回処理してしまう事故等)。
- **別カードへの操作のブロックはボタン経由(`via==="button"`)に限定**する。タップは指が
  触れた瞬間に完了する動作のため、新しく表示されたカードへ指の勢いでそのまま反射的に
  触れてしまう事故(v152の「二重タップガード」テストが検出していた事故そのもの)が起こり
  うるが、**スワイプは閾値超(70px)のドラッグという物理的コストを伴う別ジェスチャ**のため、
  直前の確定直後でも別カードへの正当な連続スワイプが妨げられない。この判定は`Date.now()`の
  比較に依存しないため、テスト環境のディスパッチ遅延のばらつきに影響されず決定論的に動く。

`triageAction`は成否を`boolean`で返すよう変更した(成立=`true`/不成立=`false`)。呼び出し元
(ボタンの`click`ハンドラは戻り値を見ない。スワイプの退場アニメ確定処理は下記4.参照)。

## 4. triageActionの成否と、退場アニメ済みカードの原状復帰(2系統レビュー両方が指摘)

初回実装はスワイプの退場アニメ(180ms)が完了した後に無条件で`triageAction`を呼んでいたため、
**クールダウン等でブロックされた場合、カードは画面外へ消えたまま(見た目は確定した風)なのに
実際のstateは変化していない**という食い違いが起きうる欠陥があった(例: 退場アニメ待機中に
別経路〈ボタン〉で同じカードが先に処理された場合)。

対応: `endTriageSwipe`のスワイプ確定処理(reduced-motion時の即時確定・通常時の180ms後の
確定の両方)で`triageAction`の戻り値を見て、`false`(不成立)なら`resetTriageCardVisual(el)`を
呼びカードのtransform/opacity/pointerEventsとヒント表示を初期状態へ戻す(state変更なしで
見た目だけ消えたままになる状態を解消する)。`resetTriageCardVisual`はスナップバック・
pointercancel・この原状復帰の3箇所で共通利用している。

`tests/v154.test.js`に、スワイプの退場アニメ待機中(180ms未満)に同じカードをボタンで先に
処理した場合、(a)ボタン側の操作だけが成立し二重処理が起きないこと、(b)保留中だった
スワイプ側の呼び出しはfalseで拒否されswipeTriageLogに記録されないこと、(c)拒否された
スワイプの古いカード要素(退場アニメで画面外へ動いていたもの)がtransform/opacityとも
原状復帰することを検証するテストを追加した(`locator.click()`のactionability待機は
180msの窓に対して不安定に遅延することがあったため、`page.evaluate`内で`element.click()`を
直接呼びテスト側のレイテンシを排除して決定論的に検証した)。

reduced-motion経路(`triagePrefersReducedMotion()`が`true`の場合)にも同じ`if (!ok)
resetTriageCardVisual(el);`を配線した。ただしこの経路は確定が完全に同期的(退場アニメの
待機自体が無い)であるため、既存の合成・実操作の組み合わせでは`false`を返す競合状態を
再現する現実的な手段が無く、この分岐については独立した統合テストを追加できていない
(コードは対称に実装済み。「対応できなかった項目」参照)。

## 5. `overscroll-behavior`を不採用に変更(2系統レビュー指摘)

初回実装は`.triage-panel`に`overscroll-behavior: none`を付与していたが、`overscroll-behavior`は
**それ自身がスクロールコンテナである要素に付けなければ効果がない**。このアプリのスクロールは
`.main-pane`ではなくページ(`document`/`html`)側で発生する構造(styles.css既存コメント参照)の
ため、`.triage-panel`(スクロールしない要素)への指定は無意味だった。

対応: `.triage-panel`から`overscroll-behavior: none`を削除した(body等スクロールコンテナ側への
付け替えは行わなかった。今回の設計変更で縦スクロールを積極的に許容する方針になったため、
ラバーバンド抑止自体の優先度が下がったと判断。必要になれば別途、仕分けモード表示中のみ
`body`へクラス付与する形で追加できる)。

## 6. Pointer Events実装(app.js、既存`_draftDrag`/`_wishDrag`と同じ流儀)

既存コードにtouchstart/touchmove/touchend/touchcancelは1件も存在しない(朝プランD&Dと
Wish月間ボードD&DがすべてPointer Events)。スワイプも同じ「documentレベル委譲+移動量が
`TRIAGE_SWIPE_MOVE_THRESHOLD`(8px)を超えるまでドラッグ扱いにしない」流儀で実装した。

- **pointerdown**: 1・2節の多指ガードに加え、`[data-action]`要素上は無視する(`_wishDrag`踏襲。
  現状カード内に該当要素は無いが将来「開く」リンク等が増えても壊れないようにしておく)。
- **pointermove**: 閾値未満は何もしない。閾値を超えたら`is-dragging`クラスを付けて
  transitionを止め(スナップバック用transitionと競合させず1:1追従させるため)、
  `translate(dx,dy) rotate(dx*0.05deg)`を直接styleへ適用(描画はCSS transformのみ、
  レイアウト再計算を起こさない)。同時に方向ヒント(`updateTriageSwipeHint`)を更新し、
  横方向ジェスチャ確定時のみ`event.preventDefault()`を呼ぶ(`touch-action:pan-y`により
  縦方向はブラウザのネイティブスクロールに譲る)。
- **pointerup**(`endTriageSwipe`): 確定は指を離した時のみ(スワイプ中に発火しない)。
  閾値未満・候補なし(縦優位含む)ならスナップバックのみでstateには一切触れない。確定した
  場合は下記7.の退場アニメ後(または`prefers-reduced-motion:reduce`時は即座に)
  `triageAction(kind, id, candidate, "swipe")`を呼ぶ。**三択の意味・成立条件はtriageAction側に
  一切追加せず**、ボタン経由(`data-action="triage-choice"`)と完全に同じ関数を呼ぶだけ
  (ロジックの二重化はしていない)。
- **pointercancel**: 該当`pointerId`と一致すれば`_triageSwipe`を破棄し、
  `resetTriageCardVisual`で初期状態へ戻す。state・triageActionには一切触れない。

`triageAction`は第4引数`via`(既定`"button"`)を新設し、スワイプ確定時は`"swipe"`を渡す。
`logSwipeTriage`もこれをそのまま`swipeTriageLog`の`via`フィールドへ記録する(スキーマは
v152で既に`via`を持っていたが、S1時点ではボタンのみのため実質固定値だった。判定ロジック自体は
`via`に依存させていない=ボタン/スワイプで挙動を分岐しない)。

