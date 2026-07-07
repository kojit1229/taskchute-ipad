// 開発用ミニサーバ(npm run dev)。依存ゼロでリポジトリルートを配信する。
const { startServer } = require("./helpers");
const PORT = Number(process.env.PORT || 4173);
startServer(PORT);
console.log(`TaskChute Journal PWA: http://localhost:${PORT} (Ctrl+C で停止)`);
