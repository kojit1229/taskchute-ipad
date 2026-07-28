# releases

v164以降のリリース説明は `vNNN.json` を唯一の手書き正本とする。
`CHANGES_vNNN.md` と `../taskchute-notes/handoff.md` は次のコマンドで生成・検査する。

```bash
node scripts/release-record.js releases/vNNN.json --write
node scripts/release-record.js releases/vNNN.json --check
```

新規記録は `TEMPLATE.json` をコピーして作る。生成物は直接編集しない。
v163以前の既存記録は移行しない。
