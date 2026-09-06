// Read-only display contract. A due date is never a scheduled date.
const text = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase();
function workListRows({ tasks = [], projects = [], blocks = [] }, { scope, date, mode = "today", dueDate = item => item.dueDate || "" }) {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const projectById = new Map(projects.map(project => [project.id, project]));
  function row(kind, item) {
    const task = kind === "block" ? taskById.get(item.taskId) : kind === "task" ? item : null;
    const project = kind === "project" ? item : projectById.get(task?.projectId);
    const status = kind === "block" ? (item.completed ? "completed" : item.actualEndAt ? "ended" : item.actualStartAt ? "running" : "open")
      : item.status === "completed" ? "completed" : ["suspended", "cancelled"].includes(item.status) ? "suspended" : "open";
    return { key: `${kind}:${item.id}`, kind, id: item.id, item, task, project, status,
      title: item.title || "", date: kind === "block" ? item.date : "", time: kind === "block" ? item.plannedStartAt || "" : "",
      projectId: project?.id || "", category: item.category || project?.category || "", due: dueDate(task || item),
      search: text([item.title, item.description, item.comment, item.doneCriteria, task?.title, task?.description, task?.doneCriteria, project?.title, project?.description].filter(Boolean).join("\n")) };
  }
  if (scope === "wbs") return [
    ...projects.filter(item => !item.deleted).map(item => row("project", item)),
    ...tasks.filter(item => !item.deleted).map(item => row("task", item))
  ];
  // Task has no independent calendar placement in the existing schema. Multiple Blocks
  // for the same Task remain separate occurrences; never deduplicate by taskId.
  return blocks.filter(item => !item.deleted && item.date &&
    (mode === "upcoming" ? item.date > date || item.date === date && !item.completed : item.date === date))
    .map(item => row("block", item))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || a.key.localeCompare(b.key));
}
function filterWorkList(rows, { query = "", status = "", project = "", category = "", due = "" }, date) {
  const words = text(query).trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => words.every(word => row.search.includes(word))
    && (!status || (status === "open" ? row.status !== "completed" && row.status !== "suspended" : row.status === status))
    && (!project || (project === "__none__" ? !row.projectId : row.projectId === project))
    && (!category || row.category === category)
    && (!due || (due === "none" ? !row.due : due === "overdue" ? Boolean(row.due) && row.due < date : row.due === date)));
}
export { workListRows, filterWorkList };
