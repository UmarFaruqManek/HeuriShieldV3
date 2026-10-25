# Nama Resmi 60 Parameter

Nama kode berbahasa Inggris. `source_` berarti alamat sumber yang diterima
analyzer; `page_` berarti alamat halaman akhir saat snapshot. Nilai dan urutan
60 fitur, 150 rule, koefisien, median serta threshold 0.80 tidak berubah.
Penggantian nama bukan retraining. Jika rantai redirect tidak tersedia, alamat
sumber belum tentu alamat pertama yang diklik pengguna.

## URL dan Domain (25)

| Nama kode | Nama untuk laporan |
|---|---|
| `source_domain_age_days` | Umur domain sumber |
| `page_domain_age_days` | Umur domain halaman |
| `source_path_length` | Panjang path sumber |
| `source_url_token_count` | Jumlah token URL sumber |
| `source_special_char_ratio` | Rasio karakter khusus sumber |
| `page_subdomain_count` | Jumlah subdomain halaman |
| `source_subdomain_count` | Jumlah subdomain sumber |
| `page_dot_count` | Jumlah titik hostname halaman |
| `dot_count` | Jumlah titik hostname aktif |
| `hostname_length` | Panjang hostname aktif |
| `source_hostname_length` | Panjang hostname sumber |
| `page_hostname_length` | Panjang hostname halaman |
| `page_url_entropy` | Keacakan URL halaman |
| `source_query_length` | Panjang query sumber |
| `source_uses_shared_hosting_domain` | Hosting bersama pada sumber |
| `source_skip_domain_age_lookup` | Pemeriksaan umur domain sumber dilewati |
| `page_path_length` | Panjang path halaman |
| `source_special_char_count` | Jumlah karakter khusus sumber |
| `page_url_token_count` | Jumlah token URL halaman |
| `source_url_entropy` | Keacakan URL sumber |
| `source_url_length` | Panjang URL sumber |
| `redirect_count` | Jumlah pengalihan teramati |
| `page_url_length` | Panjang URL halaman |
| `sensitive_word_count` | Jumlah kata sensitif URL halaman |
| `source_embedded_domain_count` | Jumlah domain tertanam pada URL sumber |

`dot_count` dan `hostname_length` tetap alias pengukuran halaman akhir.
Kolom tidak digabung karena itu akan mengubah kontrak model. Jumlah pengalihan
adalah hasil yang teramati, bukan jaminan seluruh hop jaringan tertangkap.

## DOM (24)

| Nama kode | Nama untuk laporan |
|---|---|
| `resource_count` | Jumlah resource |
| `anchor_count` | Jumlah tautan |
| `script_count` | Jumlah script |
| `internal_anchor_count` | Jumlah tautan internal |
| `external_anchor_count` | Jumlah tautan eksternal |
| `external_anchor_ratio` | Rasio tautan eksternal |
| `visible_text_length` | Panjang teks halaman |
| `dom_node_count` | Jumlah elemen halaman |
| `html_length` | Panjang HTML |
| `external_script_ratio` | Rasio script lintas domain |
| `external_resource_count` | Jumlah resource eksternal |
| `external_resource_ratio` | Rasio resource eksternal |
| `inline_script_count` | Jumlah script inline |
| `external_script_count` | Jumlah script lintas domain |
| `unique_external_domain_count` | Jumlah domain eksternal unik pada tautan |
| `image_count` | Jumlah gambar |
| `external_image_ratio` | Rasio gambar eksternal |
| `credential_form_count` | Jumlah form kredensial |
| `input_count` | Jumlah kolom masukan |
| `email_input_count` | Jumlah kolom email |
| `password_input_count` | Jumlah kolom kata sandi |
| `otp_mfa_field_count` | Jumlah kolom OTP/MFA |
| `form_action_same_domain_count` | Jumlah form tujuan domain sendiri |
| `form_action_https_count` | Jumlah form tujuan HTTPS |

Resource dihitung dari elemen DOM, bukan seluruh request jaringan. Panjang teks
bukan jaminan hanya teks yang lolos pemeriksaan visibilitas CSS.

## Brand (11)

| Nama kode | Nama untuk laporan |
|---|---|
| `brand_search_score` | Skor pencarian brand |
| `brand_quality_score` | Skor kualitas brand |
| `brand_source_similarity` | Kemiripan brand dengan domain sumber |
| `brand_page_similarity` | Kemiripan brand dengan domain halaman |
| `brand_matches_page` | Kecocokan brand dengan domain halaman |
| `brand_matches_source` | Kecocokan brand dengan domain sumber |
| `brand_in_source_subdomain` | Brand pada subdomain sumber |
| `brand_found` | Kandidat brand ditemukan |
| `brand_lookup_success` | Pencarian brand berhasil |
| `brand_in_source_path` | Brand pada path sumber |
| `brand_in_source_query` | Brand pada query sumber |

Skor direktori brand bukan probabilitas phishing. Similarity label tidak sama
dengan bukti kepemilikan domain. Boolean dinormalisasi menjadi 0/1; missing tetap
null sebelum imputasi. Sebanyak 35 fitur unik muncul dalam kondisi model saat ini.

## Kompatibilitas Data Lama

`feature-name-map.json` menyimpan pemetaan historis, bukan model baru. Catatan JSON
lama dikonversi namanya saat dibaca/disinkronkan tanpa mengganti nilai atau label.
Arsip pengujian dan sumber data historis tidak ditulis ulang. Nama properti metadata
URL di luar 60 fitur tidak termasuk penggantian ini.
