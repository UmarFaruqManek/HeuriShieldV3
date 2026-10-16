/* Halaman ini hanya mengatur pencatatan; file ditulis worker meski tab ditutup. */
import { DATASET_KEY } from "../storage/dataset-collector.js";
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
  $("saved").textContent = state?.fileCount ?? Math.max(0, state?.savedCount || 0);
  $("filepath").textContent = state?.filePath || "Heurisield/history-extract/hasil-ekstraksi.json";
  $("status").textContent = $("enabled").checked ? "Pencatatan otomatis aktif. Tab ini boleh ditutup." : "Pencatatan dihentikan. Catatan yang ada tetap disimpan.";
  $("error").hidden = !state?.error;
  $("error").textContent = state?.error || "";
}
$("enabled").addEventListener("change", async () => {
  try { await command({ action: "enable", enabled: $("enabled").checked }); await render(); }
  catch (error) { showError(error); }
});
$("sync").addEventListener("click", async () => {
  $("sync").disabled = true;
  try { await command({ action: "sync" }); await render(); }
  catch (error) { showError(error); }
  finally { $("sync").disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[DATASET_KEY]) render(); });
await render();
