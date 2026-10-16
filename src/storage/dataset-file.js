/* File System Access: izin dipilih pengguna, handle diingat di IndexedDB. */
export async function rememberDatasetFile(handle) {
  return withHandleStore('readwrite', store => store.put(handle, 'selected-file'));
}

export async function recallDatasetFile() {
  return withHandleStore('readonly', store => store.get('selected-file'));
}

async function withHandleStore(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('heurishield-history-extract', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const request = action(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Penyimpanan izin file dibatalkan.'));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function mergeDatasetRows(existing, incoming, features) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Isi file harus berupa array JSON. File tidak diubah.');
  const keys = ['url', ...features, 'label'];
  const merged = [];
  const seen = new Set();
  for (const row of [...existing, ...incoming]) {
    if (!row || Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) {
      throw new Error('File harus berisi URL, 60 fitur, dan label. File tidak diubah.');
    }
    if (!['phishing', 'legitimate'].includes(row.label) || !/^https?:$/.test(new URL(row.url).protocol)) {
      throw new Error('URL atau label tidak valid. File tidak diubah.');
    }
    if (features.some(key => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key])))) {
      throw new Error('Nilai fitur harus berupa angka atau null. File tidak diubah.');
    }
    const canonical = Object.fromEntries(keys.map(key => [key, row[key]]));
    const fingerprint = JSON.stringify(canonical);
    if (!seen.has(fingerprint)) { seen.add(fingerprint); merged.push(canonical); }
  }
  return merged;
}

export async function writeDatasetFile(handle, incoming, features) {
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Izin menulis file belum aktif. Klik Izinkan kembali.');
  }
  const text = await (await handle.getFile()).text();
  let existing;
  try { existing = text.trim() ? JSON.parse(text) : []; }
  catch { throw new Error('File JSON tidak valid. Data lama tidak ditimpa; perbaiki atau pilih file lain.'); }
  const rows = mergeDatasetRows(existing, incoming, features);
  // Baca ulang file sebelum menulis; jangan mengganti isi lama dengan snapshot browser saja.
  const content = JSON.stringify(rows, null, 2) + '\n';
  if (text !== content) {
    const writer = await handle.createWritable();
    try { await writer.write(content); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  return rows.length;
}
