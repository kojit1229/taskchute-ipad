// Display grouping only: input tasks and saved state are never changed.
function seriesKey(task) {
  const title = String(task.title || "");
  const numbered = /^(.*?)[\s　]*(\d+)(巻|話|章|回)$/.exec(title);
  const circled = numbered ? null : /^(.*?)([①②③④⑤⑥⑦⑧⑨⑩])/.exec(title);
  const match = numbered || circled;
  const name = match?.[1].trim();
  if (!name || /第$/.test(name)) return null;
  const n = numbered ? Number(match[2]) : "①②③④⑤⑥⑦⑧⑨⑩".indexOf(match[2]) + 1;
  return { key: `${task.projectId || ""}|${task.parentTaskId || ""}|${name}|${numbered ? match[3] : "○"}`, n };
}

function collapseSeries(tasks, { noCollapse = false } = {}) {
  const groups = new Map(), out = [];
  for (const task of tasks) {
    const series = noCollapse ? null : seriesKey(task);
    const group = series && groups.get(series.key);
    if (!group) {
      const entry = { task, hidden: 0, rest: [] };
      out.push(entry);
      if (series) groups.set(series.key, entry);
    } else {
      if (series.n < seriesKey(group.task).n) {
        group.rest.push(group.task);
        group.task = task;
      } else group.rest.push(task);
      group.hidden++;
    }
  }
  for (const group of out) group.rest.sort((a, b) => seriesKey(a).n - seriesKey(b).n);
  return out;
}

function nudgeKey(task) {
  const series = seriesKey(task);
  return series ? "s:" + series.key : task.id;
}

export { seriesKey, collapseSeries, nudgeKey };
