/*
 * Menyusun maksimal tiga alasan berdasarkan temuan yang tersedia untuk panel dan halaman blokir.
 * Tidak mengubah keputusan model atau menganggap indikator tunggal sebagai bukti pasti phishing.
 */
// Explain observed evidence without replacing the classifier or inventing causes.
export function buildAnalysisExplanation(analysis = {}) {
  const brand = analysis.brand_features || {};
  const dom = analysis.dom_features || {};
  const url = analysis.url_features || {};
  const rdap = analysis.rdap_features || {};
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
    if (brand.brand_found && (brand.brand_matches_page === false || brand.brand_matches_page === 0) && brandDomain) {
      const activeDomain = url.final_registrable_domain || analysis.registrable_domain || domain;
      const brandLabel = brandDomain.split(".")[0]?.toLowerCase();
      const nameAppearsInHost = brandLabel && domain.toLowerCase().split(/[^a-z0-9]+/).includes(brandLabel);
      add(nameAppearsInHost
        ? `Alamat ${activeDomain} memakai nama ${brandName}, tetapi domain kandidat brand tersebut adalah ${brandDomain}. Perbedaan ini dapat menunjukkan peniruan identitas.`
        : `Halaman berkaitan dengan ${brandName}, tetapi alamatnya ${activeDomain}, berbeda dari domain kandidat brand ${brandDomain}. Pastikan hubungan keduanya sebelum memasukkan data.`);
    }
    if (url.final_domain_changed === true || url.final_domain_changed === 1 || Number(url.cross_domain_redirect_count) > 0) {
      add("Alamat yang dibuka berpindah ke domain lain. Pastikan tujuan akhirnya sesuai dengan situs yang Anda cari.");
    }
    if (/^https?[-_]|(?:^|[.-])www[-_]/i.test(domain)) {
      add(`Nama domain "${domain}" memuat teks seperti penulisan alamat web. Teks tersebut bagian nama domain, bukan tanda bahwa alamatnya resmi.`);
    }
    // Tampilkan hanya temuan yang mudah ditindaklanjuti dan benar-benar terbaca.
    // Hitungan aset, tautan, atau panjang URL tetap dipakai model, tetapi angka
    // itu tidak cukup jelas untuk disajikan sebagai alasan tersendiri.
    const age = recentObservedDomainAge(model, rdap);
    if (age !== null) {
      const ageDomain = url.final_registrable_domain || analysis.registrable_domain || domain;
      add(`Data pendaftaran menunjukkan domain ${ageDomain} berumur sekitar ${age} hari. Domain yang masih baru perlu diperiksa lebih cermat.`);
    }
    if (!reasons.length) {
      add(model.post_model_guard
        ? "Pemeriksaan tambahan menemukan kombinasi tanda risiko pada halaman ini. Pastikan identitas situs sebelum melanjutkan."
        : model.ready
          ? "Gabungan pola halaman melewati batas risiko model. Tidak ada satu tanda yang menjadi bukti tunggal phishing."
          : "Halaman ditandai berisiko, tetapi rincian pemeriksaannya belum tersedia.");
    }
  } else if (safe) {
    if (brand.brand_found && (brand.brand_matches_page === true || brand.brand_matches_page === 1) && brandDomain) {
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
  if (brand.brand_lookup_success === false || brand.brand_lookup_success === 0) limitations.push("Pencarian brand belum berhasil; identitas brand belum dapat dipastikan.");
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

function recentObservedDomainAge(model, rdap) {
  for (const [feature, available] of [
    ["page_domain_age_days", rdap.final_rdap_available],
    ["source_domain_age_days", rdap.original_rdap_available]
  ]) {
    if (!available) continue;
    const age = Number(rdap[feature]);
    if (!Number.isFinite(age) || age < 0 || age > 180) continue;
    const usedByRiskRule = (model.fired_rules || []).some(rule =>
      Number(rule.coefficient) > 0 && (rule.conditions || []).some(condition =>
        condition.feature === feature && condition.passed === true &&
        (condition.operator === "<=" || condition.operator === "<") &&
        typeof condition.value === "number" && Number.isFinite(condition.value) &&
        Math.abs(condition.value - age) < 1
      )
    );
    if (usedByRiskRule) return Math.round(age);
  }
  return null;
}

function hostname(value) {
  try { return new URL(value).hostname; } catch { return "domain halaman"; }
}
