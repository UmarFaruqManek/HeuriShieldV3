# Engine Aktif dan Fixture Regresi

- `feature-contract-60.json`: nama dan urutan 60 fitur input aktif.
- `rulefit-engine-60.json`: 150 rule, koefisien, median dan threshold 0.80.
- `rulefit-engine.js`: evaluator kondisi AND, penjumlahan koefisien dan sigmoid.

Rumus: `z = intercept + sum(coefficient * rule_active)`;
`p = 1 / (1 + exp(-z))`. Model memilih phishing jika `p >= threshold`.
Guard manual diterapkan sesudah evaluator di `../analyzer/runtime-analysis.js`.

Fixture 30 fitur berada di `../../tests/fixtures/`, bukan runtime.
`feature-name-map.json` dan `feature-names.js` memetakan nama historis ke nama
aktif agar catatan lama tetap terbaca; keduanya bukan model atau aturan tambahan.
Nama aktif menggunakan `source_` dan `page_`; lihat [PARAMETER.md](PARAMETER.md).

Kontrak fitur bukan kumpulan rule: kontrak menentukan nama/urutan input,
sedangkan engine menyimpan kondisi rule dan bobot. Keduanya diperlukan.
JSON tidak menerima komentar; gunakan README ini sebagai penjelasannya.
