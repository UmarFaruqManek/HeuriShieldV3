# Privasi dan Pencatatan

- URL dan snapshot struktur halaman dibaca untuk analisis. Riwayat/arsip internal di browser dapat memuat URL lengkap dan judul; dataset history-extract adalah catatan terpisah.
- Query brand dari judul/hostname/path dikirim ke Clearbit dan Brandfetch. Lookup domain memakai api-check-beryl-beta.vercel.app, localhost:3000 opsional, whois-api-dun.vercel.app, lalu who-dat.as93.net. Penyedia mempunyai kebijakan sendiri.
- Ekstraksi aktif secara default pada instalasi baru dan dapat dihentikan melalui Pengaturan. Catatan disimpan otomatis di storage browser, tidak dikirim ke server pencatatan.
- Dataset berisi URL tersamarkan, 60 nilai fitur dan label prediksi. Tidak menyimpan isi form, password/OTP atau HTML lengkap. Path masih dapat mengandung data pribadi; periksa sebelum dibagikan.
- Maksimal 2.000 catatan dengan kuota storage browser. Catatan tetap ada setelah browser ditutup, tetapi dapat hilang jika data extension dihapus/uninstall. Label prediksi harus diverifikasi sebelum dipakai sebagai ground truth.
- Tombol Unduh JSON membuat satu file di `history-extract` dalam direktori unduhan browser, bukan folder instalasi extension. Tidak ada unduhan otomatis setiap analisis; file lama tidak ditimpa.
- Izin storage menyimpan data lokal; downloads hanya untuk pengambilan JSON atas permintaan; tabs/webNavigation menghubungkan hasil dengan tab; scripting membaca snapshot; webRequest mengamati status HTTP. Tidak memakai Native Messaging.
