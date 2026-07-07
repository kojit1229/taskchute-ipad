const CACHE_NAME = "taskchute-journal-pwa-v50";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./marked.min.js",
  "./manifest.webmanifest",
  "./Vision.md",
  "./Daily_Affirmation.md",
  "./now_vision.pdf",
  "./45_vision.pdf",
  "./80_vision.pdf"
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
  // MD ファイルは network-first(編集が反映されるように)
  if (url.pathname.endsWith(".md")) {
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
