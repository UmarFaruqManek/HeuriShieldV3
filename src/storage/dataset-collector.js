/* Dataset evaluasi terpisah dari riwayat. Label adalah prediksi, bukan ground truth. */
export const DATASET_KEY = "evaluationDataset";
export function datasetRow(analysis, featureNames) {
  if (!analysis?.model_result?.ready || !["SAFE", "DANGEROUS"].includes(analysis.verdict)) return null;
  if (!analysis.feature_vector?.vector) return null;
  // Jangan simpan query/fragment/userinfo yang mungkin mengandung token pribadi.
  const url = new URL(analysis.final_url || analysis.url);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  const row = { url: url.href };
  for (const name of featureNames) {
    const value = analysis.feature_vector.vector[name];
    row[name] = typeof value === "boolean" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  row.label = analysis.verdict === "DANGEROUS" ? "phishing" : "legitimate";
  return row;
}

export function createDatasetCollector(storage, featureNames, makeId = () => crypto.randomUUID()) {
  let writes = Promise.resolve();
  // Semua perubahan antrean diserialkan, termasuk ACK saat tab lain selesai dianalisis.
  const mutate = fn => {
    const operation = writes.then(async () => {
      const saved = await storage.get(DATASET_KEY);
      const state = saved[DATASET_KEY] || { enabled: false, pending: [], error: "" };
      const result = await fn(state);
      await storage.set({ [DATASET_KEY]: state });
      return result;
    });
    writes = operation.catch(() => {});
    return operation;
  };
  return {
    enable: enabled => mutate(state => { state.enabled = Boolean(enabled); state.error = ""; }),
    acknowledge: ids => mutate(state => { const done = new Set(ids); state.pending = state.pending.filter(item => !done.has(item.id)); }),
    record: analysis => mutate(state => {
      if (!state.enabled) return;
      const row = datasetRow(analysis, featureNames);
      if (!row) return;
      if (state.pending.length >= 2000) {
        state.enabled = false;
        state.error = "Antrean mencapai 2000 catatan. Buka halaman pencatatan untuk menyimpan sebelum melanjutkan.";
        return;
      }
      state.pending.push({ id: makeId(), row });
    })
  };
}
