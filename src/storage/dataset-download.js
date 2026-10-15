/* File tetap dalam Downloads. Snapshot selalu dari arsip lokal, bukan membaca balik file. */
import { DATASET_FILENAME } from "./dataset-collector.js";

export async function saveDatasetDownload(rows, downloads = chrome.downloads) {
  const id = await downloads.download({
    url: "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rows, null, 2)),
    filename: DATASET_FILENAME,
    conflictAction: "overwrite",
    saveAs: false
  });
  // download() hanya berarti diterima browser; tunggu file selesai sebelum menandai tersimpan.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const [item] = await downloads.search({ id });
    if (item?.state === "complete") return;
    if (!item || item.state === "interrupted") throw new Error(item?.error || "Unduhan terhenti.");
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await downloads.cancel(id).catch(() => {});
  throw new Error("Penulisan file melewati batas waktu; coba Simpan ulang.");
}
