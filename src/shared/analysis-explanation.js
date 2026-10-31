/* Penjelasan hanya menyebut guard atau kondisi RuleFit yang teramati. */
export function buildAnalysisExplanation(analysis = {}) {
  const brand = analysis.brand_features || {}, url = analysis.url_features || {};
  const model = analysis.model_result || {}, rdap = analysis.rdap_features || {};
  const dangerous = analysis.verdict === "DANGEROUS", safe = analysis.verdict === "SAFE";
  const manual = (analysis.matched_rules || []).some(rule => rule.id === "MANUAL_BLOCKLIST");
  const domain = analysis.hostname || analysis.domain || hostname(analysis.final_url || analysis.originalUrl || analysis.url);
  const reasons = [];
  const add = reason => { if (reason && !reasons.includes(reason)) reasons.push(reason); };
  if (manual) {
    add("Domain ini ada di daftar blokir yang Anda buat.");
  } else if (dangerous) {
    if (model.post_model_guard) add(guardReason(model.post_model_guard));
    if (model.ready && model.raw_verdict !== "SAFE") {
      add(brandRuleReason(model, brand, url, domain));
      add(ageRuleReason(model, rdap, url, domain));
      if (!reasons.length) add(sharedHostingRuleReason(model, brand));
    }
    if (!reasons.length) add(model.ready
      ? "Hasil gabungan aturan model melewati batas risiko. Belum ada satu temuan yang cukup jelas untuk dijadikan alasan khusus."
      : "Halaman ditandai berisiko, tetapi rincian pemeriksaannya belum tersedia.");
  } else if (safe) {
    const guard = model.post_model_guard;
    add(guard && /^SELF_BRAND_/.test(guard.id || "")
      ? model.raw_verdict === "DANGEROUS"
        ? `Pemeriksaan identitas menunjukkan alamat ${guard.active_domain || domain} sesuai dengan situs yang ditemukan. Hasil ini mengubah keputusan menjadi tidak diblokir.`
        : `Hasil model berada di bawah batas risiko. Pemeriksaan identitas juga menunjukkan alamat ${guard.active_domain || domain} sesuai dengan situs yang ditemukan.`
      : model.ready
        ? "Hasil gabungan aturan model berada di bawah batas risiko. Ini bukan jaminan bahwa situs sepenuhnya aman."
        : "Tidak ditemukan indikasi phishing kuat, tetapi rincian model belum tersedia.");
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
    domain, reasons: reasons.slice(0, 3),
    action: dangerous ? "Jangan masukkan kata sandi, OTP, atau data kartu sebelum memastikan identitas situs." : "Tetap periksa alamat situs sebelum memasukkan data pribadi.",
    limitation: limitations.join(" ")
  };
}

function guardReason(guard) {
  if (guard.id === "BRAND_IDENTITY_MISMATCH_GUARD" || guard.id === "BRAND_LOOKALIKE_MODEL_GUARD") return guard.reason;
  if (guard.id === "CORROBORATED_BRAND_CLAIM_MISMATCH" || guard.id === "CORROBORATED_BRAND_TYPO") return guard.reason;
  if (guard.id === "BRAND_IMPERSONATION_GUARD" && guard.active_domain && guard.official_domain)
    return `Alamat ${guard.active_domain} menggunakan identitas ${guard.brand || "merek yang ditemukan"}, tetapi domain rujukannya adalah ${guard.official_domain}. Periksa alamat sebelum memasukkan data.`;
  if (guard.id === "REDIRECT_RISK_GUARD" && guard.original_domain && guard.final_domain)
    return guard.cross_domain_redirect
      ? `Alamat awal ${guard.original_domain} mengalihkan Anda ke ${guard.final_domain}. Perubahan tujuan ini ikut menyebabkan halaman diblokir; periksa alamat akhirnya.`
      : `Alamat awal ${guard.original_domain} menyerupai nama layanan lain. Periksa apakah alamat itu benar milik layanan yang dituju.`;
  if (guard.id === "SHARED_HOSTING_BRAND_GUARD" && guard.original_domain)
    return `Alamat ${guard.original_domain} berada pada layanan hosting publik dan memuat nama layanan populer. Periksa apakah halaman itu benar milik layanan yang disebut.`;
  return "Pemeriksaan tambahan menemukan pola risiko yang memengaruhi keputusan pemblokiran. Periksa alamat situs sebelum melanjutkan.";
}
function riskRules(model) {
  return (model.fired_rules || []).filter(rule => Number(rule.coefficient) > 0);
}
function observed(rule, feature, operator) {
  return (rule.conditions || []).some(c => c.feature === feature && c.passed === true &&
    (!operator || c.operator === operator) && typeof c.value === "number" && Number.isFinite(c.value));
}
function brandRuleReason(model, brand, url, domain) {
  if (!brand.brand_found || !brand.brand_top_candidate_domain ||
      !(brand.brand_matches_page === false || brand.brand_matches_page === 0)) return null;
  const official = brand.brand_top_candidate_domain, label = official.split(".")[0]?.toLowerCase();
  if (!label || !String(domain).toLowerCase().split(/[^a-z0-9]+/).includes(label)) return null;
  if (!riskRules(model).some(rule => observed(rule, "brand_matches_page", "<="))) return null;
  return `Alamat ${url.final_registrable_domain || domain} memuat nama ${brand.brand_top_candidate_name || label}, tetapi domain rujukan yang ditemukan adalah ${official}. Ketidaksesuaian ini ikut menaikkan risiko; periksa alamat situs.`;
}
function ageRuleReason(model, rdap, url, domain) {
  for (const [feature, available, ageDomain] of [
    ["page_domain_age_days", rdap.final_rdap_available, url.final_registrable_domain || domain],
    ["source_domain_age_days", rdap.original_rdap_available, url.original_registrable_domain || domain]
  ]) {
    if (!available) continue;
    const age = Number(rdap[feature]);
    if (!Number.isFinite(age) || age < 0 || age > 180) continue;
    const used = riskRules(model).some(rule => (rule.conditions || []).some(c =>
      c.feature === feature && c.passed === true && (c.operator === "<=" || c.operator === "<") &&
      typeof c.value === "number" && Number.isFinite(c.value) && Math.abs(c.value - age) < 1));
    if (used) return `Data pendaftaran menunjukkan domain ${ageDomain} berumur sekitar ${Math.round(age)} hari. Umur domain ini ikut menaikkan risiko dalam aturan yang aktif.`;
  }
  return null;
}
function sharedHostingRuleReason(model, brand) {
  if (!brand.brand_found) return null;
  if (!riskRules(model).some(rule => (rule.conditions || []).some(c =>
      c.feature === "source_uses_shared_hosting_domain" && c.passed === true && c.value === 1) &&
      observed(rule, "brand_search_score") && observed(rule, "brand_quality_score"))) return null;
  return `Alamat berada pada layanan hosting bersama dan menunjukkan keterkaitan dengan ${brand.brand_top_candidate_name || "suatu merek"}. Kombinasi ini ikut menaikkan risiko; periksa identitas situsnya.`;
}
function hostname(value) {
  try { return new URL(value).hostname; } catch { return "domain halaman"; }
}
