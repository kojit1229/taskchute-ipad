const CACHE_NAME = "taskchute-journal-pwa-v134";
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
