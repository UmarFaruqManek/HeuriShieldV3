/* Seperti V4: kirim ke server lokal, tanpa Downloads atau Native Messaging. */
export const CAPTURE_URL = 'http://127.0.0.1:3217/capture';
export async function saveDatasetCapture(rows) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(CAPTURE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }), signal: controller.signal
    });
    if (!response.ok) throw new Error(`Server capture HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Server gagal menyimpan dataset.');
    return result;
  } catch (error) {
    throw new Error(`Jalankan Jalankan_Pencatatan.ps1 di folder extension, lalu klik Simpan ulang. Data tetap lokal. (${error.name === 'AbortError' ? 'timeout' : error.message})`);
  } finally { clearTimeout(timeout); }
}
