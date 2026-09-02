// v316: 生活記録を種別単位で持ち出すためのDOM非依存変換。
const LIFE_EXPORT_COLUMNS = Object.freeze({
  gym: ["date", "at", "exercise", "weight", "reps", "kg", "blockId"],
  sleep: ["date", "bedTime", "wakeTime", "sleepMin", "efficiency", "deep", "hr", "hrv"],
  condition: ["date", "morningEnergy", "meds", "capacity", "eveningMood", "eveningNote"],
  store: ["date", "name", "note"],
  bodyScan: ["dateTime", "fatigue", "recovery", "part", "pomodoroBlockId"]
});

const valueOrEmpty = (value) => value ?? "";

function gymRows(state) {
  return Object.entries(state?.condition?.logs || {}).flatMap(([date, log]) =>
    (Array.isArray(log?.gym) ? log.gym : []).filter((item) => !item?.deleted).map((item) => {
      const weight = valueOrEmpty(item?.weight);
      const reps = valueOrEmpty(item?.reps);
      const numericWeight = Number(weight);
      const numericReps = Number(reps);
      return {
        date, at: valueOrEmpty(item?.at), exercise: valueOrEmpty(item?.exercise), weight, reps,
        kg: weight !== "" && reps !== "" && Number.isFinite(numericWeight) && Number.isFinite(numericReps)
          ? numericWeight * numericReps : "",
        blockId: valueOrEmpty(item?.blockId)
      };
    })
  );
}

function sleepRows(state) {
  return Object.entries(state?.sleep?.logs || {}).filter(([, log]) => !log?.deleted).map(([date, log]) => {
    const sleepH = Number(log?.sleepH);
    return {
      date,
      bedTime: valueOrEmpty(log?.bed),
      wakeTime: valueOrEmpty(log?.wake),
      sleepMin: log?.sleepH !== null && log?.sleepH !== undefined && log?.sleepH !== "" && Number.isFinite(sleepH)
        ? Math.round(sleepH * 60) : "",
      efficiency: valueOrEmpty(log?.eff),
      deep: valueOrEmpty(log?.deepH),
      hr: valueOrEmpty(log?.hrSleep),
      hrv: valueOrEmpty(log?.hrvSleep)
    };
  });
}

function conditionRows(state) {
  const logs = state?.condition?.logs || {};
  const morning = state?.settings?.morningEnergyLog || {};
  const dates = new Set([
    ...Object.entries(logs).filter(([, log]) => !log?.deleted).map(([date]) => date),
    ...Object.keys(morning)
  ]);
  return [...dates].map((date) => {
    const log = logs[date]?.deleted ? {} : (logs[date] || {});
    return {
      date, morningEnergy: valueOrEmpty(morning[date]), meds: valueOrEmpty(log.meds),
      capacity: valueOrEmpty(log.capacity), eveningMood: valueOrEmpty(log.eveningMood),
      eveningNote: valueOrEmpty(log.eveningNote)
    };
  });
}

const exporters = {
  gym: gymRows,
  sleep: sleepRows,
  condition: conditionRows,
  store: (state) => (state?.storeVisits || []).filter((item) => !item?.deleted)
    .map((item) => ({ date: valueOrEmpty(item?.date), name: valueOrEmpty(item?.name), note: valueOrEmpty(item?.comment) })),
  bodyScan: (state) => (state?.bodyScans || []).filter((item) => !item?.deleted)
    .map((item) => ({
      dateTime: valueOrEmpty(item?.dateTime), fatigue: valueOrEmpty(item?.fatigue),
      recovery: valueOrEmpty(item?.recovery), part: valueOrEmpty(item?.part),
      pomodoroBlockId: valueOrEmpty(item?.pomodoroBlockId)
    })),
  writeMeditation: (state) => (state?.writeMeditations || []).filter((item) => !item?.deleted)
};

function exportRows(state, kind) {
  const rows = exporters[kind]?.(state) || [];
  return [...rows].sort((a, b) => String(a?.dateTime || a?.date || "").localeCompare(String(b?.dateTime || b?.date || "")));
}

function toCSV(rows, columns) {
  const cell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `\uFEFF${[columns, ...rows.map((row) => columns.map((column) => row?.[column]))]
    .map((line) => line.map(cell).join(",")).join("\r\n")}`;
}

export { LIFE_EXPORT_COLUMNS, exportRows, toCSV };
