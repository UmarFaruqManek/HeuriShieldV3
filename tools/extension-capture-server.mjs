/* Pola V4: server loopback menerima dataset extension dan menulis JSON lokal.
 * Tidak menerima lokasi file dari request dan tidak membuka akses ke jaringan LAN.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'history-extract', 'hasil-ekstraksi.json');
const MAX_BYTES = 16 * 1024 * 1024;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export async function createCaptureServer({ port = 3217, outputPath = DEFAULT_OUTPUT, allowedOrigins = null } = {}) {
  const { features } = JSON.parse(await readFile(path.join(ROOT, 'src/rule/feature-contract-60.json'), 'utf8'));
  const output = path.resolve(outputPath);
  const columns = ['url', ...features, 'label'];
  function normalize(row) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length || columns.some(key => !Object.hasOwn(row, key))) throw new Error('Baris harus berisi URL, 60 fitur, dan label.');
    if (!['phishing', 'legitimate'].includes(row.label)) throw new Error('Label tidak valid.');
    const url = new URL(row.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL harus HTTP/HTTPS.');
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    const clean = { url: url.href };
    for (const feature of features) {
      const value = row[feature];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Fitur harus berupa angka atau null.');
      clean[feature] = value;
    }
    return { ...clean, label: row.label };
  }
  let rows = [];
  try {
    const existing = JSON.parse(await readFile(output, 'utf8'));
    if (!Array.isArray(existing)) throw new Error('File dataset lama bukan array JSON.');
    rows = existing.map(normalize);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fingerprint = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
  let hashes = new Set(rows.map(fingerprint));
  let writes = Promise.resolve();
  async function persist(next) {
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
      await rename(temporary, output);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  // Jangan menimpa data lama saat mulai; hanya inisialisasi file yang belum ada.
  try { await readFile(output); } catch (error) { if (error.code === 'ENOENT') await persist(rows); else throw error; }
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const validOrigin = EXTENSION_ORIGIN.test(origin) && (!allowedOrigins || allowedOrigins.includes(origin));
    const localHost = /^127\.0\.0\.1:\d+$/.test(req.headers.host || '');
    if (!localHost) return send(res, 403, { ok: false, error: 'Host tidak diizinkan.' });
    if (validOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS' && req.url === '/capture' && validOrigin) { res.writeHead(204).end(); return; }
    if (req.method === 'GET' && req.url === '/health' && (!origin || validOrigin)) return send(res, 200, { ok: true, path: output, totalRows: rows.length });
    if (req.method !== 'POST' || req.url !== '/capture' || !validOrigin) return send(res, 403, { ok: false, error: 'Hanya request extension lokal yang diterima.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { ok: false, error: 'Content-Type harus JSON.' });
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('Payload terlalu besar.'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(payload.rows) || payload.rows.length > 2000) throw new Error('Maksimal 2000 baris per pengiriman.');
      const incoming = payload.rows.map(normalize);
      const operation = writes.then(async () => {
        const next = [...rows]; const nextHashes = new Set(hashes);
        for (const row of incoming) { const id = fingerprint(row); if (!nextHashes.has(id)) { nextHashes.add(id); next.push(row); } }
        if (next.length !== rows.length) await persist(next);
        const added = next.length - rows.length;
        rows = next; hashes = nextHashes;
        return { ok: true, path: output, added, totalRows: rows.length };
      });
      writes = operation.catch(() => {});
      const result = await operation;
      send(res, 200, result);
    } catch (error) { send(res, error.code ? 500 : 400, { ok: false, error: error.message }); }
  });
  server.requestTimeout = 15000;
  return {
    output,
    start: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address()); }); }),
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createCaptureServer().then(async capture => {
    const address = await capture.start();
    console.log(`HeuriShield capture: http://127.0.0.1:${address.port}`);
    console.log(`File: ${capture.output}`);
    console.log('Biarkan terminal ini berjalan. Ctrl+C untuk berhenti.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => capture.close().then(() => process.exit(0)));
  }).catch(error => { console.error(`Capture gagal: ${error.message}`); process.exitCode = 1; });
}
