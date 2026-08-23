// 12WYデータ契約のブラウザcharacterization: normalizeStateの3コレクション移行、
// settingsクランプ、端末ローカルの_trackToastLog、GitHub保存時サニタイズを固定する。
const { chromium, launchOptions, startServer, randomPort, openSettingsGroup } = require("./helpers");

const PORT = randomPort();
const KEY = "taskchute-journal-pwa-state-v1";
let failures = 0;

function check(name, condition, extra = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
}

(async () => {
  const server = startServer(PORT);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let resolvePut;
  const putReceived = new Promise((resolve) => { resolvePut = resolve; });

  await page.route((url) => url.hostname === "api.github.com", async (route) => {
    if (route.request().method() === "PUT") {
      const requestBody = JSON.parse(route.request().postData());
      const pushed = JSON.parse(Buffer.from(requestBody.content, "base64").toString("utf8"));
      resolvePut(pushed);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-v243" } }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  async function waitForState() {
    await page.waitForFunction((key) => {
      try { return !!JSON.parse(localStorage.getItem(key)); } catch { return false; }
    }, KEY);
  }

  async function stateNow() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await waitForState();

    console.log("[normalize-1] 欠損コレクションと設定下限を後方互換補完する");
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      delete s.tracks;
      delete s.trackMeasurements;
      delete s.weeklyCommitments;
      s.settings.twelveWeekScoreTarget = 69;
      s._trackToastLog = null;
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForFunction((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      return Array.isArray(s.tracks) && Array.isArray(s.trackMeasurements)
        && Array.isArray(s.weeklyCommitments) && s.settings.twelveWeekScoreTarget === 70;
    }, KEY);
    const missing = await stateNow();
    check("tracks欠損は[]", missing.tracks.length === 0);
    check("trackMeasurements欠損は[]", missing.trackMeasurements.length === 0);
    check("weeklyCommitments欠損は[]", missing.weeklyCommitments.length === 0);
    check("twelveWeekScoreTargetは下限70へクランプ", missing.settings.twelveWeekScoreTarget === 70);
    check("壊れた_trackToastLogは{}へ初期化", JSON.stringify(missing._trackToastLog) === "{}");

    console.log("[normalize-2] レコード既定値、id/createdAt個別フォールバック、updatedAt不変");
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.settings.twelveWeekScoreTarget = 101.4;
      s._trackToastLog = { trk_existing: "2026-08-23" };
      s.tracks = [{
        id: "", createdAt: "", updatedAt: "2026-08-20T01:02:03", name: "既存名",
        milestones: [{ id: "", updatedAt: "2026-08-20T04:05:06", label: "既存節目" }]
      }];
      s.trackMeasurements = [{
        id: "", createdAt: "", updatedAt: "2026-08-20T07:08:09", value: 13
      }];
      s.weeklyCommitments = [
        { recordType: "week", id: "", weekStart: "2026-08-22", createdAt: "", updatedAt: "2026-08-20T10:11:12" },
        { id: "", weekStart: "2026-08-22", blockId: "b1", createdAt: "", updatedAt: "" }
      ];
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).settings.twelveWeekScoreTarget === 100, KEY);
    const normalized = await stateNow();
    const track = normalized.tracks[0];
    const milestone = track.milestones[0];
    const measurement = normalized.trackMeasurements[0];
    const week = normalized.weeklyCommitments.find((r) => r.recordType === "week");
    const item = normalized.weeklyCommitments.find((r) => r.recordType === "item");
    check("track id/createdAtを生成し既定値を補完", track.id.startsWith("trk_") && !!track.createdAt
      && track.ownerType === "project" && track.kind === "numeric" && track.name === "既存名", JSON.stringify(track));
    check("milestone idを生成しcreatedAtは生やさない", milestone.id.startsWith("ms_")
      && !("createdAt" in milestone) && milestone.label === "既存節目", JSON.stringify(milestone));
    check("measurement id/createdAtを生成し既定値を補完", measurement.id.startsWith("trm_")
      && !!measurement.createdAt && measurement.sourceKind === "toast" && measurement.value === 13, JSON.stringify(measurement));
    check("weekは決定論idと週メタ既定値のみ", week.id === "wcw_2026-08-22" && !!week.createdAt
      && week.committedVia === "manual" && !("excused" in week), JSON.stringify(week));
    check("recordType欠損はitemとして決定論idとitem既定値のみ", item.id === "wci_2026-08-22_b1"
      && !!item.createdAt && item.lane === "cycle" && !("committedVia" in item), JSON.stringify(item));
    check("updatedAtは3コレクションと節目で進めない",
      track.updatedAt === "2026-08-20T01:02:03" && milestone.updatedAt === "2026-08-20T04:05:06"
      && measurement.updatedAt === "2026-08-20T07:08:09" && week.updatedAt === "2026-08-20T10:11:12"
      && item.updatedAt === "");
    check("twelveWeekScoreTargetは上限100へクランプ", normalized.settings.twelveWeekScoreTarget === 100);
    check("正常な_trackToastLogは端末ローカルstateで保持", normalized._trackToastLog.trk_existing === "2026-08-23");

    console.log("[normalize-3] 不正recordType・null要素・空キーidを安全に正規化する");
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.tracks = [null, { milestones: [null] }];
      s.trackMeasurements = [null];
      s.weeklyCommitments = [
        null,
        { id: "unknown_type", recordType: "unknown" },
        { id: "empty_type", recordType: "" },
        { recordType: "week", weekStart: "" },
        { recordType: "week", weekStart: "" },
        { weekStart: "", blockId: "same" },
        { weekStart: "", blockId: "same" }
      ];
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForFunction((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      return s.tracks.length === 2 && s.trackMeasurements.length === 1 && s.weeklyCommitments.length === 7;
    }, KEY);
    const hardened = await stateNow();
    check("3コレクションとmilestonesのnull要素は既定レコードへ正規化",
      hardened.tracks[0].id.startsWith("trk_") && hardened.tracks[1].milestones[0].id.startsWith("ms_")
      && hardened.trackMeasurements[0].id.startsWith("trm_")
      && hardened.weeklyCommitments[0].recordType === "item");
    check("unknownと空文字のrecordTypeはitemへ強制正規化",
      hardened.weeklyCommitments[1].recordType === "item"
      && hardened.weeklyCommitments[2].recordType === "item");
    const blankWeekIds = hardened.weeklyCommitments.slice(3, 5).map((r) => r.id);
    const blankItemIds = hardened.weeklyCommitments.slice(5, 7).map((r) => r.id);
    check("空weekStartのweek idはUUIDへ退避して衝突しない",
      blankWeekIds.every((id) => id.startsWith("wcw_")) && new Set(blankWeekIds).size === 2,
      JSON.stringify(blankWeekIds));
    check("itemの決定論キー欠損時もUUIDへ退避して衝突しない",
      blankItemIds.every((id) => id.startsWith("wci_")) && new Set(blankItemIds).size === 2,
      JSON.stringify(blankItemIds));

    console.log("[normalize-4] 不正設定値の既定化とGitHub送信サニタイズ");
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.settings.twelveWeekScoreTarget = "invalid";
      s.settings.github.token = "test-token-v243";
      s.settings.github.dataOwner = "kojit1229";
      s.settings.github.dataRepo = "personal-data";
      s.settings.autoSync = false;
      localStorage.setItem(key, JSON.stringify(s));
    }, KEY);
    await page.reload();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).settings.twelveWeekScoreTarget === 85, KEY);
    check("非数は既定85へ戻す", (await stateNow()).settings.twelveWeekScoreTarget === 85);
    await page.click('[data-action="nav"][data-view="settings"]');
    await openSettingsGroup(page, "settings-sync");
    await page.click('[data-action="save-github"]');
    const pushed = await Promise.race([
      putReceived,
      new Promise((_, reject) => setTimeout(() => reject(new Error("GitHub PUT timeout")), 5000))
    ]);
    check("sanitizedStateForGitHubは_trackToastLogを除去", !("_trackToastLog" in pushed), JSON.stringify(pushed._trackToastLog));
    check("既存サニタイズ契約も維持", pushed.settings.github.token === "" && pushed.modal === null);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\ntrack-normalize: 全件成功" : `\ntrack-normalize: ${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
