// v53: E2Eテスト共通ヘルパ。
// アプリ本体(app.js)は無改変のままブラウザで動かし、fetch をページ内でモックして検証する。
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".md": "text/markdown", ".pdf": "application/pdf"
};

// Chromium 実行パスの解決: 環境変数 → playwright-core 既定 → /opt/pw-browsers(この開発環境)
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 未インストールなら次へ */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dir = fs.readdirSync(base).find((d) => d.startsWith("chromium-"));
    if (dir) {
      const p = path.join(base, dir, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 無ければ launch の既定に任せる */ }
  return null;
}

function launchOptions() {
  const exe = resolveChrome();
  return { ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox"] };
}

// リポジトリルートを配信する使い捨て静的サーバ
function startServer(port) {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  }).listen(port);
}

// v72: 個人データはGitHub Contents API(private リポジトリ)経由になり、token+個人データ
// リポジトリ(dataOwner/dataRepo)未設定の端末は起動時セットアップ画面(トークンゲート)で
// 止まるようになった。既存スイートは「設定済み」state前提のため、この2つのヘルパーで
// 影響を1箇所に吸収する:
//   (1) blockGithubApiByDefault: api.github.com への予期しない実ネットワーク呼び出しを
//       既定404で塞ぐ(個別スイートが後からより具体的な page.route を追加登録すれば、
//       Playwrightは後発ハンドラを優先するのでそちらが勝つ)。goto前、他のpage.route
//       登録より先に呼ぶこと。
//   (2) passGithubGate: 初回goto(+waitForTimeout)で永続化済みのフルstateへ
//       token/dataOwner/dataRepoを追加してreloadする(他フィールドは一切壊さない)。
//       各スイートは初回goto直後に1回呼ぶだけでよい。
const STATE_KEY = "taskchute-journal-pwa-state-v1";
const GITHUB_API_HOST = "api.github.com";

async function blockGithubApiByDefault(page) {
  await page.route((url) => url.hostname === GITHUB_API_HOST, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

async function passGithubGate(page, keyName = STATE_KEY) {
  await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    s.settings.github.token = s.settings.github.token || "test-token-v72";
    s.settings.github.dataOwner = s.settings.github.dataOwner || "kojit1229";
    s.settings.github.dataRepo = s.settings.github.dataRepo || "personal-data";
    localStorage.setItem(KEY, JSON.stringify(s));
  }, keyName);
  await page.reload();
  await page.waitForTimeout(500);
}

module.exports = {
  chromium, ROOT, launchOptions, startServer,
  blockGithubApiByDefault, passGithubGate, GITHUB_API_HOST, STATE_KEY
};
