# Engine Aktif dan Fixture Regresi

- `feature-contract-60.json`: nama dan urutan 60 fitur input aktif.
- `rulefit-engine-60.json`: 150 rule, koefisien, median dan threshold 0.80.
- `rulefit-engine.js`: evaluator kondisi AND, penjumlahan koefisien dan sigmoid.

Rumus: `z = intercept + sum(coefficient * rule_active)`;
`p = 1 / (1 + exp(-z))`. Model memilih phishing jika `p >= threshold`.
Guard manual diterapkan sesudah evaluator di `../analyzer/runtime-analysis.js`.

Fixture 30 fitur sudah dipindahkan ke `../../tests/fixtures/` agar tidak
bercampur dengan runtime. Folder ini hanya menyimpan dua JSON model aktif.

Kontrak fitur bukan kumpulan rule: kontrak menentukan nama/urutan input,
sedangkan engine menyimpan kondisi rule dan bobot. Keduanya diperlukan.
JSON tidak menerima komentar; gunakan README ini sebagai penjelasannya.
