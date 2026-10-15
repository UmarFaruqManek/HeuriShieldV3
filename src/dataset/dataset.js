/* Halaman ini memegang izin File System Access; worker hanya mengantrekan baris. */
import { DATASET_KEY } from "../storage/dataset-collector.js";
const $ = id => document.getElementById(id);
const contract = await fetch("../rule/feature-contract-60.json").then(r => r.json());
const columns = ["url", ...contract.features, "label"];
let handle = null, rows = [], busy = false, releaseLock = null, active = false;
const committed = new Set();
const message = async payload => {
  const result = await chrome.runtime.sendMessage({ type: "HEURISHIELD_DATASET", ...payload });
  if (!result?.ok) throw new Error(result?.error || "Penyimpanan dataset gagal.");
};
function showError(error) { $("error").textContent = error.message || String(error); $("error").hidden = false; }

$("choose").addEventListener("click", async () => {
  $("error").hidden = true;
  try {
    if (!window.showSaveFilePicker) throw new Error("Pencatatan file memerlukan Chrome/Edge desktop dengan File System Access.");
    const selected = await showSaveFilePicker({ suggestedName: "HeuriShield_Dataset.json", types: [{ description: "Dataset JSON", accept: { "application/json": [".json"] } }] });
    // Satu penulis dalam profil extension untuk mencegah dua tab saling menimpa.
    const locked = await new Promise(resolve => navigator.locks.request("heurishield-dataset-writer", { ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return; }
      return new Promise(release => { releaseLock = release; resolve(true); });
    }));
    if (!locked) throw new Error("Halaman pencatatan lain masih aktif. Hentikan halaman tersebut dahulu.");
    handle = selected;
    const text = await (await handle.getFile()).text();
    const saved = text.trim() ? JSON.parse(text) : [];
    if (!Array.isArray(saved) || saved.some(row => !row || Object.keys(row).length !== columns.length || columns.some(key => !Object.hasOwn(row, key)) || !["phishing", "legitimate"].includes(row.label))) {
      throw new Error("File bukan dataset dengan URL, 60 fitur dan label yang sesuai. Pilih file baru.");
    }
    rows = saved; committed.clear();
    // Tulis array kosong juga agar file baru langsung valid sebelum analisis pertama.
    const writer = await handle.createWritable();
    await writer.write(JSON.stringify(rows, null, 2)); await writer.close();
    await message({ action: "enable", enabled: true });
    active = true; $("choose").disabled = true; $("stop").disabled = false;
    $("filename").textContent = handle.name;
    $("status").textContent = "Pencatatan aktif. Biarkan tab ini terbuka.";
    await flush();
  } catch (error) {
    if (error.name !== "AbortError") showError(error);
    if (!active && releaseLock) { releaseLock(); releaseLock = null; handle = null; }
  }
});

$("stop").addEventListener("click", async () => {
  try {
    await message({ action: "enable", enabled: false });
    // Tunggu penulisan yang sedang berlangsung sebelum melepaskan izin penulis.
    while (busy) await new Promise(resolve => setTimeout(resolve, 50));
    await flush(); active = false;
    if (releaseLock) releaseLock(); releaseLock = null; handle = null;
    $("choose").disabled = false; $("stop").disabled = true;
    $("status").textContent = "Pencatatan dihentikan. File tetap tersimpan.";
  } catch (error) { showError(error); }
});

async function flush() {
  if (busy) return;
  busy = true;
  try {
    do {
      const state = (await chrome.storage.local.get(DATASET_KEY))[DATASET_KEY];
      const pending = state?.pending || [];
      $("pending").textContent = pending.length;
      if (state?.error) showError(new Error(state.error));
      if (!handle || !pending.length) break;
      const next = [...rows, ...pending.filter(item => !committed.has(item.id)).map(item => item.row)];
      // createWritable mengganti file saat close; ACK hanya sesudah penulisan berhasil.
      const writer = await handle.createWritable();
      try { await writer.write(JSON.stringify(next, null, 2)); await writer.close(); }
      catch (error) { await writer.abort().catch(() => {}); throw error; }
      rows = next; pending.forEach(item => committed.add(item.id));
      $("count").textContent = rows.length;
      await message({ action: "acknowledge", ids: pending.map(item => item.id) });
    } while (handle);
    $("count").textContent = rows.length;
  } catch (error) { showError(error); $("status").textContent = "Penulisan tertunda. Catatan tetap dalam antrean; hentikan dan pilih file lagi untuk mencoba ulang."; }
  finally { busy = false; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[DATASET_KEY]) flush(); });
await flush();
