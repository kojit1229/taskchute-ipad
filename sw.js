const CACHE_NAME = "taskchute-journal-pwa-v152";
// v152: ADHD支援「①仕分けモード S1(ボタン版)」— Wishタブに第3の表示モード「🃏 仕分け」を追加。
//   対象は前日先送りBlock(carryableBlocks)+未実現Wish(updatedAt昇順)。1枚ずつ大きく表示し
//   「今日やる/手放す/延期(来月)」の三択ボタンで処理する(スワイプ操作はS2で追加予定)。
//   既存関数(carryOverBlock/moveBlockToWish/wishSubtaskToTasks/logMigrationRitual/
//   nextStepOf/getSubtasksOf)を再利用し、tasks/blocks/projectsへの新フィールド追加はゼロ。
//   追加はUI状態(wishViewMode新値"triage")とログ(swipeTriageLog、上限200件)のみ。
//   詳細: CHANGES_v152.md、設計書 workbench/out/2026-07-27-appidea-designs/03-task-swipe.md §⑤S1。
// v150: UI改善計画Phase4b(残る構造課題・K指定2026-07-27)— (1)完了作法の統一: すべての
//   完了導線(ホーム今日タブのドット/タスクシュートの✓/タイムラインの○/ながれのチェック)を
//   toggle-block(即完了。実績開始/終了時刻を未設定なら現在時刻で自動記録、充放電は
//   prefillEnergyで自動補完)に一本化。完了直後のトーストへ「実績を編集」ボタンを添え、
//   既存の実績登録モーダル(complete-block-with-actual)を編集導線として残した(ポモドーロ
//   完了経路は現行維持)。(2)タイポ/余白トークン(--text-xs〜lg、--space-1〜5)を新設し、
//   ホーム/今日タブ・ジャーナルのCSS(段階移行の第1弾、既存値の一致箇所のみ)へ適用。
//   (3)回復候補ドラフト(v145)の再構築: PWA破棄で「冪等マーカーは残るがdraftは消える」状態を
//   起動時に検知し、新規stateフィールド無しで候補計算を再実行する(maybeRebuildRecoveryDraft)。
//   (4)タイムライン短時間Block(min-height補正で物理的に重なる問題)を、既存の横レーン分割
//   (段差配置)の判定にmin-height換算の実効終了時刻を織り込むことで解消(top=開始時刻の絶対配置は
//   不変。分割対象は実所要20分未満のBlockに限定=監督者裁定)。
//   2系統レビュー対応: トースト消滅後の透明当たり判定残留(pointer-events)を修正、
//   実績開始時刻はplannedStartAt優先+開始>終了の丸め込みで0分実績を防止、prefillEnergyは
//   手入力済み充放電を上書きしない、完了解除で自動記録値をセッション内復元、回復候補マーカーを
//   {date,titles}へ拡張し次点候補の繰り上げ提案を防止。詳細はCHANGES_v150.md参照。
// v149: UI改善計画Phase4a(基盤・K指定2026-07-27)— ホームを「今日」(行動系。既定タブ)/
//   「ホーム」(内省・参照系: 三つの信条・寿命・アファメーション・80歳ビジョン導線・AIから・
//   長い弧をたしかめる。信条/寿命はタブを開くたび既定展開)の2タブへ分割(タブ選択は非永続、
//   起動時は常に「今日」)。前日/日付/翌日/今日へ/検索の日付ナビをヘッダー領域へ統合し独立行を
//   廃止(375px幅でヘッダー〜heroが196px、v148の224pxより縮小)。2系統レビュー対応で
//   毎分再描画抑制・スクロールアンカー・宣言保存の全再描画回避等も修正。詳細はCHANGES_v149.md参照。
// v148: UI改善計画Phase3(導線の再編)— 「その他」12項目を目的別4群(計画/思考/振り返り/
//   ツール)へグループ化+その他配下の現在地表示、設定13パネルを4群アコーディオン化(既定
//   全閉・同期異常時のみ初期open)、計器盤を「常時表示(ヒント+着手率+睡眠1行要約)→詳細
//   details」の2層化、ジャーナル当日パネルを朝/夜/本文の3detailsへ再編(現在時刻で自動open)、
//   タイムラインのエネルギー/バッテリー線を切替式に(別スケール2線の重ね描き廃止)。
//   CHANGES_v148.md参照。
// v147: UI改善計画Phase2(数字と警告の信頼回復)— 12週サイクル残り日数の基準日統一、
//   ホーム「今日のタスクシュート」見出しに(Project紐づき)を明示、警告チップ4種の
//   「今日の状態」1枚化(未対応0件+正常なら非表示)、orange/green/tealの文字色AA対応+
//   10pxラベルの11.5px化、Block編集モーダルのレバレッジ3問クイズ判定結果表示+
//   削除ボタンの左端分離。CHANGES_v147.md参照。
// v146: UI改善計画Phase1(毎日の摩擦を消す)— ホームの並び替え+折りたたみ既定値変更、
//   ホーム/タスクシュートの着手中Blockへの自動スクロール、🏁(タスク完了)のBlock編集
//   モーダルへの移設+主要タップ対象の44px化、バッファ残量帯の画面限定、ジャーナルの
//   当日優先表示、設定画面のvNNN表記削除+回復候補ラベル整備。CHANGES_v146.md参照。
// v145: エネルギーバッテリー「行動接続」— 残量が閾値を下回った朝に、実績で回復効果(充電−放電)の
//   高いBlockを1〜2件、既存の下書きスケジュール(_scheduleDraft)へ静かに提案するopt-in機能(既定OFF)。
//   新規UI・通知は追加せず既存の下書きバー操作をそのまま使う。CHANGES_v145.md参照。
// v144: エネルギーバッテリーモデル(computeBatteryLevel+ホーム電池チップ+タイムライン実カーブの
//   重ね描き)を追加。通知・アラートは出さず表示のみ(静かな計器)。CHANGES_v144.md参照。
// v143: 計器盤の最上部に「今週のヒント」(computeInsights、決定論ルールエンジン+該当Block一覧への
//   ドリルダウン)を追加。あわせてv141で到達不能になっていたAIフィードバック手動取込系の死コード
//   を削除。CHANGES_v143.md参照。
// v142: 日次結合ヘルパー computeDailyMetrics を新設し、計器盤(統計)に「睡眠」セクション
//   (就寝起床の帯グラフ/中央値ベースライントレンド/睡眠帯別の実績比較)を追加。CHANGES_v142.md参照。
// v141: ジャーナルタブのAIフィードバック列(未使用)を撤去し残り2列を拡幅+「今日行ったお店」
//   ログ(店名/URL/感想、年間一覧付き)を追加。CHANGES_v141.md参照。
// v132: Codexレビュー指摘対応(身体スキャン背景タップのゲート飛ばし/丸め不一致等)。CHANGES_v132.md参照。
// v131: 体力予算・睡眠カードに鮮度フォールバック(AutoSleep 21:00確定対策)。CHANGES_v131.md参照。
// v130: 睡眠CSV取込の失敗メッセージを空CSV/全件パース失敗で区別。CHANGES_v130.md参照。
// v129: ポモドーロ身体スキャン(完了時に疲労1-5+任意部位を2タップで記録)。CHANGES_v129.md参照。
// v128: 体力予算(朝の睡眠心拍データから疲労を先取り判定)。CHANGES_v128.md参照。
// v127: apple-design全体ポリッシュ(角丸+2層シャドウ/ヘッダのマテリアル化/余白のリズム/
//   ボタン階層/見出しの磨き)。styles.cssのみ、app.js無変更。CHANGES_v127.md参照。
// v126: 「やりたいこと」をWBSのProject+Taskとして扱い、期日駆動で朝プラン候補に載せられるように。v122の週次選定ルートは撤去。CHANGES_v126.md参照。
// v125: ビジョンボードPDFをページ画像(JPEG)化して同一画面内に表示。別タブに飛ばさず閲覧可能に。CHANGES_v125.md参照。
// v124: apple-design(HIG)反映②押下フィードバック+モーション磨き+reduced-motion対応。CHANGES_v124.md参照。
// v123: apple-design(HIG)のタイポグラフィ+マテリアル(半透明チローム)をUIへ反映。CHANGES_v123.md参照。
// v122: 「今週のやりたいこと」を朝の一括プランニング候補+ホームカード「今日へ」から登録可能に。CHANGES_v122.md参照。
// v120: AutoSleep CSVのロケール差・同一ファイル再選択・部分取込警告を修正。CHANGES_v120.md参照。
// v119: 0秒思考テーマに重要度「高」ラベルを追加(バッジ表示・トグル・グループ内先頭ソート)。CHANGES_v119.md参照。
// v118: 起動時pull(autoSync=false旧経路)のGET待ち中編集ロスト競合を修正。CHANGES_v118.md参照。
// v117: 今日の宣言(A)+自己締切の自動前倒し(B)+過集中ブレーカーのゲート化(C)。
//       CHANGES_v117.md参照。
// v115: 縮退版+連続ルーティン(ハビットスタック、ROADMAP提案G)。①保護系ルーティンの
//       縮退版(fallbackTitle/fallbackMinutes)ワンタップ実行、②連続ルーティン(チェーン、
//       state.routineChains[])の順次進行UI、③アンカー(習慣スタッキングの自動配置)。
//       CHANGES_v115.md参照。
// v114: 保護系ルーティンの連続欠落表示(繰り返しルールにprotection属性・
//       連続欠落日数バッジ・block編集モーダルのチェックボックス)。CHANGES_v114.md参照。
// v104: 0秒思考「書く画面」の入力時間(書き始め→保存の実経過秒数)を計測し、
//       entries[].durationSecとして保存(参考情報、既存データはnull)。
//       CHANGES_v104.md参照。
// v102: 0秒思考の「過去のテーマ」から回答済みentryを開いて追記・編集できるようにした。
//       CHANGES_v102.md参照。
// v101: ビジョンボードPDFの自動インライン埋め込み(<object>)をやめ、明示クリックでの
//       fetch+別タブ表示に変更(PCブラウザでのフリーズ対策)。CHANGES_v101.md参照。
// v100: 0秒思考タブに「AI提案お題」キューUI(候補の表示・採用・却下)を追加。CHANGES_v100.md参照。
// v99: WBSタブのタスク行に「翌朝のAI処理を依頼する」チェックUI(criteriaRequest)を追加。CHANGES_v99.md参照。
// v97: タスクシュート画面「未完了タスク」の表示範囲を当日〜7日後+期日超過に絞り、
//      8日後以降はトグルで折りたたみ(データは消さない)。CHANGES_v97.md参照。
// v96: Taskに「完了条件」「スモールステップ」欄を新設(doneCriteria/firstStep)。編集モーダル入力
//      +タスクシュート画面の一覧行に行内サブテキストで表示。CHANGES_v96.md参照。
// v95: WBSにTask進捗(分子/分母)入力+バー、Project進捗率(Σ分子/Σ分母)集計を追加。CHANGES_v95.md参照。
// v93: 0秒思考タブがiPhone表示(狭幅)で崩れる不具合を修正(styles.css)。CHANGES_v93.md参照。
// v92(SW実番号): AIレポートビューア(その他 > AIレポート)を追加。
// 注: taskchute-notes/ROADMAP.md の論理番号v92「過集中ブレーカー」はloop側(自宅PC常駐)の
// 実装であり、本アプリ(taskchute-ipad)のSWバージョン番号とは別カウンタ・別内容。詳細はCHANGES_v92.md。
// v85: Vision.md / Daily_Affirmation.md / *_vision.pdf は v72の個人データ分離で
// personal-dataリポジトリ(GitHub Contents API経由)へ移った同一オリジンには存在しないファイル群。
// ここに残っていても cache.add() が個別に404失敗するだけ(無視される)で実害は無いが、
// 「ビジョンボードが見れない」原因調査で見つかった同根の残骸なので合わせて削除する。
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./marked.min.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            // 取得できなかったファイルは無視
          })
        )
      )
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // v24/v38: 同一オリジン以外(Google API・外部CDN等)は SW を経由させない。
  //          marked はリポジトリ同梱にしたため CDN の特別扱いは廃止。
  if (url.origin !== self.location.origin) {
    return;
  }
  // GitHub API はキャッシュしない(常に最新)
  if (url.hostname === "api.github.com") {
    return;
  }
  // v12: 動画ファイルはレンジリクエストが使われるので SW を経由させない
  // (ブラウザのストリーミング機構に任せる)
  if (url.pathname.endsWith(".mp4") || url.pathname.endsWith(".webm")) {
    return;
  }
  // MD/JSON ファイルは network-first(編集が反映されるように)。
  // v62(m5): AIプラン_*.json(バッチ生成物の日次fetch)もmd/htmlと同じ扱いに統一する
  // (cache-firstだと当日分が来ても端末に旧キャッシュが居座り、下書きに反映されなくなるため)。
  if (url.pathname.endsWith(".md") || url.pathname.endsWith(".json")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // v37: 正常応答のみキャッシュ(500等のエラーで正常キャッシュを潰さない)
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }
  // v23: アプリ本体(HTML/JS/CSS/manifest)も network-first にする。
  // cache-first だとデプロイしても端末側の旧キャッシュが居座り続けるため。
  // オンライン時は常に最新を取得し、オフライン時のみキャッシュにフォールバック。
  if (
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith("/")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // v37: 正常応答のみキャッシュ。サーバーが一時的に 500/404 を返しても
          //      オフライン用の正常なキャッシュを上書きしない(上書きするとオフライン起動が壊れる)
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        // v37: ignoreSearch — "?utm=..." 等のクエリ付きURLでもキャッシュ済みシェルを返す
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }
  // 他は cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // v37: 正常応答のみ永続キャッシュ(初回404/500を永遠に配り続けない)。
        //      v38: marked 同梱でクロスオリジンは SW を通らなくなったため opaque の考慮は不要。
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
