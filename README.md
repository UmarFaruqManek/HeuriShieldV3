# HeuriShieldV3

Extension pendeteksi indikasi phishing melalui analisis URL, DOM, metadata domain,
dan kandidat brand. Engine menggunakan RuleFit 60 fitur, 150 rule, threshold 0.80,
serta pemeriksaan heuristik tambahan. Nama repository V3 bukan nomor versi manifest.

## Instalasi Langsung

```sh
git clone https://github.com/UmarFaruqManek/HeuriShieldV3.git
```

1. Buka `chrome://extensions` (Chrome) atau `edge://extensions` (Edge).
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked** dan pilih folder `HeuriShieldV3` hasil clone,
   yaitu folder yang langsung berisi `manifest.json`.
4. Buka halaman HTTP/HTTPS. Panel HeuriShield menampilkan hasil pemeriksaan.

Tidak perlu npm install, Python, build, atau menjalankan server lokal.
Alternatif: unduh Code -> Download ZIP dari GitHub, ekstrak, lalu pilih folder
yang berisi `manifest.json`. Clone saja belum memasang extension ke browser.
Untuk memperbarui: jalankan `git pull`, lalu klik Reload pada halaman extensions.

## Browser

- Chrome/Chromium desktop: target pengujian utama.
- Microsoft Edge desktop: kandidat kompatibel Chromium, perlu verifikasi di Edge.
- Brave/Opera/Vivaldi desktop: mungkin kompatibel; belum diuji pada paket ini.
- Firefox/Safari: bukan paket siap pasang; memerlukan porting dan pengujian API.
- Browser mobile: tidak dinyatakan didukung oleh paket ini.

## Cara Kerja

URL/DOM -> metadata RDAP dan pencarian brand -> 60 nilai fitur -> RuleFit ->
guard manual -> keputusan, panel alasan, dan halaman blokir bila berisiko.
Keputusan bukan jaminan keamanan atau pemindai semua malware/ransomware.
Situs dibuka sebelum analisis selesai; jangan mengandalkan extension untuk
membuka situs berbahaya dengan aman.

Fitur memerlukan akses HTTP/HTTPS dan API pihak ketiga. Brand memakai Clearbit
sebagai sumber utama dan Brandfetch sebagai pendukung/fallback. RDAP mencoba
endpoint lokal opsional lalu layanan publik; endpoint lokal tidak wajib tersedia.
API dapat gagal, dibatasi, atau berubah; fitur yang tidak tersedia dapat diimputasi
dengan median model. Keluaran di perangkat berbeda dapat bervariasi.

## History Extract Otomatis

Setiap analisis selesai otomatis dicatat ke
`Downloads/history-extract/hasil-ekstraksi.json`, mengikuti lokasi Downloads browser.
Tidak perlu memilih file atau membiarkan tab khusus terbuka. Aktif secara default
pada instalasi baru. Pengaturan -> Pencatatan dataset JSON menyediakan toggle
**Simpan ekstraksi otomatis** untuk menghentikannya dan **Simpan ulang** untuk retry.
Pengaturan nonaktif dari versi lama tetap dihormati; aktifkan toggle bila perlu.

File adalah array objek: URL tanpa query/fragment/userinfo, seluruh 60 fitur,
dan `label` prediksi. Missing tetap null. Label bukan ground truth yang telah
diverifikasi; periksa sebelum dipakai untuk evaluasi/retraining.
Path dapat memuat informasi pribadi. Arsip utama disimpan lokal; file JSON adalah
snapshot yang diganti otomatis, bukan dibaca balik saat diedit. Jangan edit file aktif.
Batas 2000 catatan; pengumpulan berhenti saat penuh tanpa menghapus catatan lama.
Salin file sebelum menghapus data extension/uninstall. Instalasi baru tidak mengimpor
file lama dan dapat mengganti file pada path yang sama. Profil/browser berbeda
perlu Downloads terpisah agar file tidak saling menimpa. Pembaruan muncul sebagai
aktivitas unduhan browser; kebijakan organisasi/extension lain dapat memblokirnya.

## Struktur

- `manifest.json`: izin dan titik masuk browser.
- `src/background/`: koordinasi analisis dan proteksi.
- `src/analyzer/`: ekstraksi URL, DOM, RDAP dan brand.
- `src/rule/feature-contract-60.json`: kontrak input, bukan rule.
- `src/rule/rulefit-engine-60.json`: artefak model aktif.
- `src/rule/rulefit-engine.js`: evaluator rule, logit, sigmoid, threshold.
- `src/content/`, `src/warning/`: panel dan halaman blokir.
- `src/dataset/`: kontrol pencatatan otomatis tanpa pemilih file.
- `src/storage/`: pengaturan, riwayat lokal, dan antrean dataset.
- `assets/`: ikon extension.

Repository ini tidak menyertakan data latih, notebook, hasil evaluasi,
script pengujian lokal, atau riwayat penjelajahan pengguna.
Lihat [PRIVACY.md](PRIVACY.md) sebelum menggunakan atau membagikan dataset.
