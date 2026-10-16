/* Tab pendamping menulis ke file pilihan; background tetap mencatat ketika tab ditutup. */
import { DATASET_KEY } from '../storage/dataset-collector.js';
import { rememberDatasetFile, recallDatasetFile, writeDatasetFile } from '../storage/dataset-file.js';

const $ = id => document.getElementById(id);
const { features } = await (await fetch('../rule/feature-contract-60.json')).json();
let handle = null;
let writes = Promise.resolve();
let fileError = '';

async function render() {
  const state = (await chrome.storage.local.get(DATASET_KEY))[DATASET_KEY];
  $('enabled').checked = state?.enabled ?? true;
  $('count').textContent = (state?.records || state?.pending || []).length;
  $('filename').textContent = handle?.name || 'Belum dipilih';
  $('resume').disabled = !handle;
  $('sync').disabled = !handle;
  $('status').textContent = !handle ? 'File belum terhubung. Pilih file JSON terlebih dahulu.'
    : $('enabled').checked ? 'Pencatatan aktif. Biarkan tab ini terbuka agar file ikut diperbarui.'
      : 'Pencatatan dihentikan. Catatan lama tetap disimpan.';
  $('error').textContent = fileError || state?.error || '';
  $('error').hidden = !$('error').textContent;
}

function syncFile() {
  const operation = writes.then(async () => {
    if (!handle) { await render(); return; }
    const selected = handle;
    const save = async () => {
      const state = (await chrome.storage.local.get(DATASET_KEY))[DATASET_KEY];
      const rows = (state?.records || state?.pending || []).map(item => item.row);
      const count = await writeDatasetFile(selected, rows, features);
      if (handle === selected) $('filecount').textContent = count;
    };
    try {
      // Tab pencatatan ganda tidak boleh saling menimpa hasil baca-tulis.
      await navigator.locks.request('heurishield-history-extract-write', save);
      fileError = '';
      await render();
      $('status').textContent = `File ${selected.name} tersinkron. Perbarui otomatis selama tab ini terbuka.`;
    } catch (error) {
      fileError = error.message;
      await render();
    }
  });
  writes = operation.catch(error => {
    $('error').textContent = error.message;
    $('error').hidden = false;
  });
  return writes;
}

$('choose').addEventListener('click', async () => {
  try {
    if (!window.showOpenFilePicker) throw new Error('Browser ini belum mendukung pemilihan file. Gunakan Chrome/Edge desktop.');
    const [selected] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Dataset JSON', accept: { 'application/json': ['.json'] } }]
    });
    if (await selected.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Izin menulis belum diberikan. File tidak diubah.');
    // Simpan handle, bukan path buatan: izin hanya berlaku untuk file pilihan pengguna.
    await rememberDatasetFile(selected);
    handle = selected;
    $('filecount').textContent = '-';
    await syncFile();
  } catch (error) {
    if (error.name === 'AbortError') return;
    fileError = error.message;
    await render();
  }
});

$('resume').addEventListener('click', async () => {
  try {
    if (!handle || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Izin menulis belum diberikan.');
    await syncFile();
  } catch (error) { fileError = error.message; await render(); }
});
$('create').addEventListener('click', async () => {
  try {
    if (!window.showSaveFilePicker) throw new Error('Browser ini belum mendukung pembuatan file. Gunakan Chrome/Edge desktop.');
    const selected = await window.showSaveFilePicker({
      suggestedName: 'hasil-ekstraksi.json',
      types: [{ description: 'Dataset JSON', accept: { 'application/json': ['.json'] } }]
    });
    await rememberDatasetFile(selected);
    handle = selected;
    $('filecount').textContent = '-';
    await syncFile();
  } catch (error) {
    if (error.name === 'AbortError') return;
    fileError = error.message;
    await render();
  }
});
$('sync').addEventListener('click', syncFile);
$('enabled').addEventListener('change', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'HEURISHIELD_DATASET', action: 'enable', enabled: $('enabled').checked });
    if (!response?.ok) throw new Error(response?.error || 'Tidak dapat mengubah pencatatan.');
    await syncFile();
  } catch (error) { fileError = error.message; await render(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[DATASET_KEY]) void syncFile();
});
try { handle = await recallDatasetFile(); }
catch (error) { fileError = `Tidak dapat memulihkan izin file: ${error.message}`; }
await syncFile();
