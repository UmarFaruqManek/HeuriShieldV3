# Catatan Privasi HeuriShield

Extension membaca URL dan snapshot struktur halaman untuk mengekstrak fitur.
Hasil analisis, metadata cache, riwayat dan arsip fitur disimpan lokal di profil
browser. Riwayat/arsip internal dapat memuat URL lengkap beserta query, serta
metadata seperti judul halaman, meskipun dataset JSON menggunakan URL tersamarkan.

Lookup domain menghubungi API RDAP/whois dan lookup brand menghubungi Clearbit
serta Brandfetch. Query brand diturunkan dari judul, hostname, dan path URL;
ini berarti informasi turunan halaman dikirim ke pihak ketiga. Operator API
memiliki kebijakan sendiri. Tidak ada backend pengumpulan dataset terpusat
yang disertakan di repository ini.

History-extract aktif secara default pada instalasi baru dan dapat dihentikan
melalui Pengaturan -> Pencatatan dataset JSON. Arsip lokal otomatis ditulis ke
`Downloads/history-extract/hasil-ekstraksi.json` melalui izin downloads.
Dataset berisi URL tanpa userinfo/query/fragment, 60 nilai fitur,
dan label prediksi. Path tetap dapat mengandung data pribadi. Jangan membagikan
file tanpa memeriksa isinya dan mendapat persetujuan pemilik data.
Dataset ini tidak menyimpan isi form, nilai password/OTP atau HTML lengkap.
Hentikan pencatatan melalui toggle Simpan ekstraksi otomatis setelah selesai.

Izin HTTP/HTTPS luas diperlukan untuk menganalisis situs yang dibuka; izin
storage menyimpan data lokal, downloads menulis snapshot JSON otomatis,
tabs/webNavigation menghubungkan hasil dengan tab,
scripting membaca snapshot, dan webRequest mengamati status respons.
Paket tidak dirancang sebagai pengganti antivirus atau perlindungan malware.
