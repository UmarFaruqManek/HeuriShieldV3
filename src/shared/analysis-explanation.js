/*
 * Menyusun maksimal tiga alasan berdasarkan temuan yang tersedia untuk panel dan halaman blokir.
 * Tidak mengubah keputusan model atau menganggap indikator tunggal sebagai bukti pasti phishing.
 */
// Explain observed evidence without replacing the classifier or inventing causes.
export function buildAnalysisExplanation(analysis = {}) {
  const brand = analysis.brand_features || {};
  const dom = analysis.dom_features || {};
  const url = analysis.url_features || {};
  const model = analysis.model_result || {};
  const dangerous = analysis.verdict === "DANGEROUS";
  const safe = analysis.verdict === "SAFE";
  const manual = (analysis.matched_rules || []).some(rule => rule.id === "MANUAL_BLOCKLIST");
  const domain = analysis.hostname || analysis.domain || hostname(analysis.final_url || analysis.originalUrl || analysis.url);
  const brandName = brand.brand_top_candidate_name || brand.brand_top_candidate_domain || "brand yang ditemukan";
  const brandDomain = brand.brand_top_candidate_domain;
  const reasons = [];
  const add = text => { if (!reasons.includes(text)) reasons.push(text); };
  const hasCount = key => typeof dom[key] === "number" && Number.isFinite(dom[key]);

  if (manual) {
    add("Domain ini ada di daftar blokir yang Anda buat.");
  } else if (dangerous) {
    if (hasCount("ip_credential_form_count") && dom.ip_credential_form_count > 0) {
      add("Ada form data akun yang mengarah ke alamat IP, bukan nama domain. Periksa tujuan pengirimannya.");
    } else if (hasCount("external_credential_form_count") && dom.external_credential_form_count > 0) {
      add("Ada form data akun yang mengarah ke domain lain. Tujuan tersebut perlu diperiksa sebelum mengisi data.");
    }
    if (brand.brand_candidate_found && (brand.brand_candidate_matches_final_domain === false || brand.brand_candidate_matches_final_domain === 0) && brandDomain) {
      add(`Kandidat brand ${brandName} ditemukan dengan domain ${brandDomain}, berbeda dari ${domain}. Perbedaan ini perlu diperiksa, bukan bukti tunggal penipuan.`);
    }
    if (url.final_domain_changed === true || url.final_domain_changed === 1 || Number(url.cross_domain_redirect_count) > 0) {
      add("Alamat yang dibuka berpindah ke domain lain. Pastikan tujuan akhirnya sesuai dengan situs yang Anda cari.");
    }
    if (!reasons.length) {
      add(model.post_model_guard
        ? "Pemeriksaan tambahan menemukan kombinasi tanda risiko pada halaman ini. Pastikan identitas situs sebelum melanjutkan."
        : model.ready
          ? "Gabungan pola halaman melewati batas risiko model. Tidak ada satu tanda yang menjadi bukti tunggal phishing."
          : "Halaman ditandai berisiko, tetapi rincian pemeriksaannya belum tersedia.");
    }
  } else if (safe) {
    if (brand.brand_candidate_found && (brand.brand_candidate_matches_final_domain === true || brand.brand_candidate_matches_final_domain === 1) && brandDomain) {
      add(`Domain halaman cocok dengan domain kandidat ${brandName}: ${brandDomain}.`);
    }
    if (!analysis.dom_error && hasCount("external_credential_form_count") && hasCount("ip_credential_form_count") &&
        dom.external_credential_form_count === 0 && dom.ip_credential_form_count === 0) {
      add("Tidak terdeteksi form data akun yang mengarah ke domain lain atau alamat IP pada saat pemeriksaan.");
    }
    add("Hasil pemeriksaan berada di bawah batas risiko. Ini bukan jaminan bahwa situs sepenuhnya aman.");
  } else {
    add("Data pemeriksaan belum cukup untuk menyimpulkan keamanan halaman.");
  }

  const limitations = [];
  if (analysis.dom_error) limitations.push("Struktur halaman belum berhasil dibaca lengkap.");
  if (brand.brand_lookup_status === false || brand.brand_lookup_status === 0) limitations.push("Pencarian brand belum berhasil; identitas brand belum dapat dipastikan.");
  else if (Number(brand.brand_lookup_failed_queries) > 0) limitations.push("Sebagian pencarian brand gagal; informasi brand mungkin belum lengkap.");
  return {
    title: manual ? "Diblokir oleh daftar Anda" : dangerous ? "Terindikasi phishing" : safe ? "Tidak ditemukan indikasi phishing kuat" : "Pemeriksaan belum lengkap",
    summary: manual ? "Situs dihentikan sesuai pengaturan daftar blokir Anda." : dangerous ? "Halaman dihentikan karena hasil pemeriksaan menunjukkan risiko phishing." : safe ? "Tidak ditemukan indikasi phishing kuat pada pemeriksaan ini." : "Keamanan halaman belum dapat dipastikan.",
    domain,
    reasons: reasons.slice(0, 3),
    action: dangerous ? "Jangan masukkan kata sandi, OTP, atau data kartu sebelum memastikan identitas situs." : "Tetap periksa alamat situs sebelum memasukkan data pribadi.",
    limitation: limitations.join(" ")
  };
}

function hostname(value) {
  try { return new URL(value).hostname; } catch { return "domain halaman"; }
}
