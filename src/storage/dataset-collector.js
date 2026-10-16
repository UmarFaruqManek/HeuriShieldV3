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

export const DATASET_FILENAME = "history-extract/hasil-ekstraksi.json";

export function createDatasetCollector(storage, featureNames, makeId = () => crypto.randomUUID()) {
  let writes = Promise.resolve();
  // Serialisasi menjaga beberapa tab tidak saling menimpa catatan.
  const mutate = fn => {
    const operation = writes.then(async () => {
      const saved = await storage.get(DATASET_KEY);
      const state = saved[DATASET_KEY] || { enabled: true, records: [], savedCount: 0, error: "" };
      // Migrasi antrean lama tanpa menghapus catatan yang belum sempat ditulis.
      if (!state.records) { state.records = state.pending || []; state.savedCount = 0; delete state.pending; }
      // Hapus status penulis file lama, bukan hasil ekstraksi yang sudah terkumpul.
      if (state.writerVersion !== "browser-local-v1") {
        state.writerVersion = "browser-local-v1";
        state.error = "";
        delete state.filePath;
        delete state.fileCount;
        delete state.savedCount;
        delete state.savedAt;
      }
      const result = await fn(state);
      await storage.set({ [DATASET_KEY]: state });
      return result;
    });
    writes = operation.catch(() => {});
    return operation;
  };
  return {
    enable: enabled => mutate(state => { state.enabled = Boolean(enabled); state.error = ""; }),
    sync: () => mutate(() => {}),
    record: analysis => mutate(state => {
      if (!state.enabled) return;
      const row = datasetRow(analysis, featureNames);
      if (!row) return;
      if (state.records.length >= 2000) {
        state.enabled = false;
        state.error = "Batas 2000 catatan tercapai. Pencatatan dihentikan; data lokal tetap dipertahankan.";
        return;
      }
      state.records.push({ id: makeId(), row });
    })
  };
}
