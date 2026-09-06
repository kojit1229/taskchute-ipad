// Optional private content. Public code contains no personal prose or image assets.
export function validateVisionOverview(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.themes) || value.themes.length !== 3) throw new Error("invalid overview");
  const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
  for (const [index, theme] of value.themes.entries()) {
    if (!theme || theme.id !== ["A", "B", "C"][index]) throw new Error("invalid theme order");
    for (const field of ["title", "core", "question"]) if (!text(theme[field], 2000)) throw new Error("invalid theme text");
    if (!text(theme.detailMarkdown, 100000)) throw new Error("missing full text");
    if (typeof theme.imageFile !== "string" || !/^vision-overview\/[a-z0-9][a-z0-9_-]*\.(?:png|jpe?g|webp)$/i.test(theme.imageFile)) throw new Error("invalid image path");
  }
  if (!text(value.affirmationMarkdown, 100000)) throw new Error("missing affirmation");
  return value;
}

export function createVisionOverview({ read, connectionKey, escape, markdown, urls = URL }) {
  let key = "", generation = 0, data = null, images = {}, stale = false;
  const pendingUrls = new Set();
  function discardPending() {
    for (const url of pendingUrls) urls.revokeObjectURL(url);
    pendingUrls.clear();
  }
  function revokeIncoming(incoming) {
    for (const url of Object.values(incoming)) {
      if (pendingUrls.delete(url)) urls.revokeObjectURL(url);
    }
  }
  function clear() {
    discardPending();
    Object.values(images).forEach(url => urls.revokeObjectURL(url));
    data = null; images = {}; stale = false; generation++;
  }
  function current() {
    const next = connectionKey();
    if (next !== key) { clear(); key = next; }
    return key;
  }
  return {
    reset() { clear(); key = ""; },
    async hydrate() {
      const startedKey = current(), ticket = ++generation;
      discardPending();
      if (!startedKey) return false;
      const incomingImages = {};
      try {
        const result = await read("content/vision-overview.json", "text");
        if (ticket !== generation || current() !== startedKey) return false;
        if (!result.ok) throw new Error("unavailable");
        const next = validateVisionOverview(JSON.parse(result.text));
        await Promise.all(next.themes.map(async theme => {
          let image;
          try { image = await read(`content/${theme.imageFile}`, "blob"); } catch { return; }
          if (ticket !== generation || current() !== startedKey) return;
          if (image.ok && image.blob && image.blob.size <= 10 * 1024 * 1024
              && /^(?:image\/(?:png|jpeg|webp)|application\/octet-stream)?$/.test(image.blob.type)) {
            incomingImages[theme.id] = urls.createObjectURL(image.blob);
            pendingUrls.add(incomingImages[theme.id]);
          }
        }));
        if (ticket !== generation || current() !== startedKey) {
          revokeIncoming(incomingImages);
          return false;
        }
        Object.values(images).forEach(url => urls.revokeObjectURL(url));
        Object.values(incomingImages).forEach(url => pendingUrls.delete(url));
        data = next; images = incomingImages; stale = false;
        return true;
      } catch {
        revokeIncoming(incomingImages);
        if (ticket !== generation || current() !== startedKey) return false;
        stale = Boolean(data);
        return true; // Also redraw a retained previous version's stale label.
      }
    },
    render(kind) {
      if (!current() || !data) return "";
      const status = stale ? '<p class="vision-overview-status" role="status">更新できないため、前回取得した内容を表示しています。</p>' : "";
      if (kind === "affirmation") return `${status}<article class="panel vision-overview-affirmation md-render">${markdown(data.affirmationMarkdown)}</article>`;
      return `${status}<section class="vision-overview-grid" aria-label="3つのビジョン">${data.themes.map(theme => `
        <article class="panel vision-theme" data-vision-theme="${theme.id}">
          ${images[theme.id] ? `<img src="${escape(images[theme.id])}" alt="${escape(theme.title)}" width="1774" height="887">` : '<div class="vision-image-missing" role="status">画像を取得できませんでした</div>'}
          <div class="vision-theme-copy"><h2>${escape(theme.title)}</h2><p class="vision-theme-core">${escape(theme.core)}</p>
          <p class="vision-theme-question"><span>今日の問い</span>${escape(theme.question)}</p>
          <details><summary>全文・判断ガイドを読む</summary><div class="md-render">${markdown(theme.detailMarkdown)}</div></details></div>
        </article>`).join("")}</section>`;
    }
  };
}
