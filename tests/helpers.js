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

module.exports = { chromium, ROOT, launchOptions, startServer };
