# Analyzer Aktif

`runtime-analysis.js` mengoordinasikan ekstraksi URL, DOM, RDAP dan brand.
`feature-assembler.js` menyusun input sesuai `../rule/feature-contract-60.json`.
Model aktif menggunakan 60 fitur dan 150 rule, dengan threshold 0.80.

- `url/url-features.js`: struktur URL awal/akhir dan konteks redirect.
- `dom/dom-features.js`: hitungan elemen, resource, form dan tujuan form.
- `domain/rdap-features.js`: metadata domain dan status lookup.
- `brand/brand-features.js`: Clearbit utama, Brandfetch pendukung/fallback.
- `brand/brand-lookup-cache.js`: cache, deduplikasi request dan refresh.

Extractor menghasilkan sinyal tambahan di luar 60 fitur untuk guard, UI dan
audit. Sinyal ini tidak boleh dihapus hanya karena tidak menjadi input model.
Guard merupakan aturan manual setelah RuleFit, bukan rule hasil pelatihan.
Data missing menjadi null; evaluator memakai median engine. Nilai imputasi
bukan hasil pengamatan halaman.
