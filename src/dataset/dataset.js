/* Catatan tersimpan otomatis di browser; JSON hanya diunduh atas permintaan. */
import { DATASET_KEY, DATASET_FILENAME } from "../storage/dataset-collector.js";
const $ = id => document.getElementById(id);
async function command(payload) {
  const response = await chrome.runtime.sendMessage({ type: "HEURISHIELD_DATASET", ...payload });
  if (!response?.ok) throw new Error(response?.error || "Pencatatan gagal.");
}
function showError(error) { $("error").textContent = error.message; $("error").hidden = false; }
async function render() {
  const state = (await chrome.storage.local.get(DATASET_KEY))[DATASET_KEY];
  $("enabled").checked = state?.enabled ?? true;
  $("count").textContent = (state?.records || state?.pending || []).length;
  $("status").textContent = $("enabled").checked ? "Pencatatan otomatis aktif. Tab ini boleh ditutup." : "Pencatatan dihentikan. Catatan yang ada tetap disimpan.";
  $("error").hidden = !state?.error;
  $("error").textContent = state?.error || "";
}
$("enabled").addEventListener("change", async () => {
  try { await command({ action: "enable", enabled: $("enabled").checked }); await render(); }
  catch (error) { showError(error); }
});
$("download").addEventListener("click", async () => {
  $("download").disabled = true;
  let objectUrl;
  try {
    const state = (await chrome.storage.local.get(DATASET_KEY))[DATASET_KEY];
    const rows = (state?.records || state?.pending || []).map(item => item.row);
    objectUrl = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2) + "\n"], { type: "application/json" }));
    // Chrome hanya mengizinkan path relatif terhadap direktori unduhan.
    await chrome.downloads.download({ url: objectUrl, filename: DATASET_FILENAME, conflictAction: "uniquify", saveAs: false });
    $("status").textContent = "Unduhan JSON dimulai. Catatan di browser tetap disimpan.";
  }
  catch (error) { showError(error); }
  finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    $("download").disabled = false;
  }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[DATASET_KEY]) render(); });
await render();
