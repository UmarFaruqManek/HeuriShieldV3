# Privasi dan Pencatatan

- URL dan snapshot struktur halaman dibaca untuk analisis. Riwayat/arsip internal di browser dapat memuat URL lengkap dan judul; dataset history-extract adalah catatan terpisah.
- Query brand dari judul/hostname/path dikirim ke Clearbit dan Brandfetch. Lookup domain memakai api-check-beryl-beta.vercel.app, localhost:3000 opsional, whois-api-dun.vercel.app, lalu who-dat.as93.net. Penyedia mempunyai kebijakan sendiri.
- Ekstraksi aktif secara default pada instalasi baru dan dapat dihentikan melalui Pengaturan. Data dikirim hanya ke **server pencatatan lokal 127.0.0.1:3217** yang dijalankan pengguna, bukan server pengumpulan publik.
- Server menyimpan URL tersamarkan, 60 nilai fitur dan label prediksi ke `history-extract/hasil-ekstraksi.json`. Tidak menyimpan isi form, password/OTP atau HTML lengkap. Path masih dapat mengandung data pribadi; periksa sebelum dibagikan.
- Tanpa server, data menunggu di storage browser, maksimal 2.000 catatan. File lama dipertahankan dan baris identik dideduplikasi. Label prediksi harus diverifikasi sebelum dipakai sebagai ground truth.
- Izin storage menyimpan data lokal; tabs/webNavigation menghubungkan hasil dengan tab; scripting membaca snapshot; webRequest mengamati status HTTP. Izin HTTP/HTTPS dipakai untuk analisis, API dan capture loopback. Tidak ada izin downloads atau nativeMessaging.
