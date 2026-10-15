/*
 * Mengurangi panggilan API berulang melalui cache dan berbagi request yang sedang berjalan.
 * Hasil gagal tidak disimpan lama; refresh dapat meminta lookup baru.
 */
export function createBrandLookupCache({ lookup, getCache, updateCache, ttlMs, emptyTtlMs = 60000, now = Date.now }) {
  const pending = new Map();
  return async (query, { forceRefresh = false } = {}) => {
    const clean = String(query || "").trim();
    if (!clean) return { query: clean, candidates: [], lookup_success: false };
    const key = `brand:clearbit-first:v5:${clean.toLowerCase()}`;
    if (!forceRefresh) {
      const cached = (await getCache())[key];
      const successful = cached?.metadata?.lookup_success === true;
      const lifetime = cached?.metadata?.candidates?.length ? ttlMs : emptyTtlMs;
      const age = now() - Date.parse(cached?.cached_at || "");
      if (successful && age >= 0 && age < lifetime) return cached.metadata;
    }
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let result;
      try { result = await lookup(clean); }
      catch { result = { query: clean, candidates: [], lookup_success: false }; }
      await updateCache((cache) => {
        if (result?.lookup_success === true) {
          cache[key] = { metadata: result, cached_at: new Date(now()).toISOString() };
        } else {
          delete cache[key];
        }
      });
      return result;
    })();
    pending.set(key, task);
    try { return await task; }
    finally { pending.delete(key); }
  };
}
