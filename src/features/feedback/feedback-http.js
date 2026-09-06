// Explicit GitHub Contents transport. No production connection defaults or primary-state writer.
export function createFeedbackHttp({ connection, headers, fetch: request = globalThis.fetch,
  timeoutMs = 30000, maxBytes = 8 * 1024 * 1024, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof connection !== 'function' || typeof headers !== 'function' || typeof request !== 'function'
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('http_configuration_required');
  let previous = '', generation = 0;
  const active = new Set();
  function invalidate() { generation++; previous = ''; for (const controller of active) controller.abort(); }
  function session() {
    const cfg = connection();
    const key = cfg ? JSON.stringify([cfg.owner,cfg.repo,cfg.branch,cfg.token,cfg.path]) : '';
    if (key !== previous) { generation++; previous = key; for (const controller of active) controller.abort(); }
    return { cfg: cfg ? { ...cfg } : null, generation };
  }
  const identity = () => { const s = session(); return s.cfg ? s.generation : null; };
  function resolve(resource, cfg) {
    if (resource?.kind === 'canonical-index') return 'taskchute/report-index.json';
    if (resource?.kind === 'canonical-directory') return 'taskchute';
    if (resource?.kind === 'canonical-file' && /^AIフィードバック_\d{4}-\d{2}-\d{2}\.md$/.test(resource.name)) {
      const date=resource.name.slice('AIフィードバック_'.length,-3),[year,month,day]=date.split('-').map(Number),parsed=new Date(0);
      parsed.setUTCFullYear(year,month-1,day);
      if(!date.startsWith('0000')&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date)return 'taskchute/'+resource.name;
    }
    if (resource?.kind === 'primary-state') return cfg.path;
    if (resource?.kind === 'report' && /^\d{4}-\d{2}-\d{2}$/.test(resource.date)) return `taskchute/日報_${resource.date}.md`;
    if (typeof resource === 'string' && /^taskchute\/feedback-regeneration\/(\d{4}-\d{2}-\d{2})\/feedback-\1-[a-f0-9]{64}\/[1-9]\d*\.md$/.test(resource)) return resource;
    if (typeof resource === 'string' && /^taskchute\/requests\/feedback-regeneration\/(queue\.json|requests\/feedback-\d{4}-\d{2}-\d{2}-[a-f0-9]{64}\.json|results\/feedback-\d{4}-\d{2}-\d{2}-[a-f0-9]{64}\/[1-9]\d*\.json)$/.test(resource)) return resource;
    throw Error('http_path_rejected');
  }
  async function perform(method, resource, bytes, options = {}) {
    const s = session();
    if (!s.cfg || !['owner','repo','branch','token','path'].every(key => typeof s.cfg[key] === 'string' && s.cfg[key])) throw Error('http_not_connected');
    const path = resolve(resource, s.cfg);
    if ((path !== 'taskchute' || resource?.kind !== 'canonical-directory') && !path?.startsWith('taskchute/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error('http_path_rejected');
    if (method === 'PUT' && ['canonical-index','canonical-directory','canonical-file'].includes(resource?.kind)) throw Error('canonical_read_only');
    if (method === 'PUT' && (resource?.kind === 'primary-state' || path === s.cfg.path)) throw Error('primary_write_forbidden');
    if (method === 'PUT' && typeof resource === 'string' && resource.startsWith('taskchute/feedback-regeneration/')) throw Error('artifact_read_only');
    if (method === 'PUT' && typeof resource === 'string' && resource.includes('/results/')) throw Error('result_write_forbidden');
    if (method === 'PUT' && !(options.expectedSha === null || /^[a-f0-9]{40}$/i.test(options.expectedSha || ''))) throw Error('conditional_sha_required');
    const controller = new AbortController(); active.add(controller);
    const current = () => !controller.signal.aborted && session().generation === s.generation
      && (!options.context || typeof options.context.isCurrent === 'function' && options.context.isCurrent() === true);
    const guard = () => { if (!current()) throw Error('http_context_changed'); };
    let timer, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(Error('http_aborted')); controller.signal.addEventListener('abort', rejectAbort, {once:true}); });
    timer = setTimer(() => controller.abort(), timeoutMs);
    const work = async () => {
      guard();
      const base = `https://api.github.com/repos/${encodeURIComponent(s.cfg.owner)}/${encodeURIComponent(s.cfg.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
      const init = { method, signal: controller.signal, headers: { ...headers(s.cfg.token), Accept: 'application/vnd.github+json' } };
      if (method === 'PUT') {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw Error('http_payload_invalid');
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        init.body = JSON.stringify({ message: 'Update captured feedback input', content: btoa(binary), branch: s.cfg.branch,
          ...(options.expectedSha === null ? {} : {sha:options.expectedSha}) });
      }
      const response = await request(method === 'GET' ? `${base}?ref=${encodeURIComponent(s.cfg.branch)}` : base, init);
      guard();
      if (method === 'PUT') return { status: response.status };
      if (response.status === 404) return { status: 404 };
      if (response.status !== 200) throw Error('http_read_failed');
      if (Number(response.headers?.get('Content-Length') || 0) > maxBytes * 2) throw Error('http_payload_large');
      const raw = await response.text(); guard();
      if (raw.length > maxBytes * 2) throw Error('http_payload_large');
      let data; try { data = JSON.parse(raw); } catch { throw Error('http_invalid_json'); }
      if(resource?.kind === 'canonical-directory'){if(!Array.isArray(data)||data.length>10000)throw Error('canonical_directory_invalid');return {status:200,entries:data.map(entry=>({name:entry?.name,type:entry?.type,path:entry?.path}))};}
      if (data?.encoding !== 'base64' || typeof data.content !== 'string' || !/^[a-f0-9]{40}$/i.test(data.sha || '')) throw Error('http_invalid_content');
      let decoded; try { decoded = atob(data.content.replace(/\s/g, '')); } catch { throw Error('http_invalid_base64'); }
      if (decoded.length > maxBytes) throw Error('http_payload_large');
      const result = Uint8Array.from(decoded, ch => ch.charCodeAt(0));
      let text; try { text = new TextDecoder('utf-8',{fatal:true}).decode(result); } catch { throw Error('http_invalid_utf8'); }
      return { status: 200, sha: data.sha, bytes: result, text };
    };
    try { return await Promise.race([work(), aborted]); }
    finally { clearTimer(timer); controller.signal.removeEventListener('abort', rejectAbort); active.delete(controller); }
  }
  return {
    identity, invalidate, connectionKey: () => String(identity()),
    get: (resource, options) => perform('GET', resource, null, options),
    put: (resource, bytes, options) => perform('PUT', resource, bytes, options),
    putReport: (resource, text, options) => {
      if (resource?.kind !== 'report') throw Error('report_path_required');
      return perform('PUT', resource, new TextEncoder().encode(text), options);
    }
  };
}
