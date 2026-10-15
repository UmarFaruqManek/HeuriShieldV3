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
    if (/^https?[-_]|(?:^|[.-])www[-_]/i.test(domain)) {
      add(`Nama domain "${domain}" memuat teks seperti penulisan alamat web. Teks tersebut bagian nama domain, bukan tanda bahwa alamatnya resmi.`);
    }
    // Jelaskan nilai yang benar-benar terbaca pada rule positif. Bukan semua
    // fitur halaman, bukan nilai median, dan bukan klaim penyebab tunggal.
    for (const reason of observedRuleReasons(model)) add(reason);
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

function observedRuleReasons(model) {
  const labels = {
    domain_age_days: ["Pendaftaran domain", "umur domain", "hari"],
    registration_lifetime_days: ["Pendaftaran domain", "masa pendaftaran", "hari"],
    nameserver_count: ["Pendaftaran domain", "nameserver", ""],
    hostname_length: ["Struktur alamat", "panjang nama host", "karakter"],
    path_length: ["Struktur alamat", "panjang path", "karakter"],
    url_length: ["Struktur alamat", "panjang URL", "karakter"],
    query_length: ["Struktur alamat", "panjang query", "karakter"],
    subdomain_count: ["Struktur alamat", "jumlah subdomain", ""],
    dot_count: ["Struktur alamat", "jumlah titik pada host", ""],
    url_token_count: ["Struktur alamat", "jumlah potongan kata/angka URL", ""],
    special_char_ratio: ["Struktur alamat", "rasio karakter khusus", "ratio"],
    url_entropy: ["Struktur alamat", "entropi karakter URL", ""],
    anchor_count: ["Struktur halaman", "tautan", ""],
    internal_anchor_count: ["Struktur halaman", "tautan internal", ""],
    external_anchor_count: ["Struktur halaman", "tautan eksternal", ""],
    external_anchor_ratio: ["Struktur halaman", "rasio tautan eksternal", "ratio"],
    resource_count: ["Struktur halaman", "jumlah aset halaman", ""],
    script_count: ["Struktur halaman", "script", ""],
    visible_text_length: ["Struktur halaman", "panjang teks terlihat", "karakter"],
    html_length: ["Struktur halaman", "panjang HTML", "karakter"],
    form_count: ["Struktur halaman", "form", ""],
    credential_form_count: ["Struktur halaman", "form data akun", ""],
    password_input_count: ["Struktur halaman", "kolom password", ""]
  };
  const groups = new Map();
  const seen = new Set();
  const rules = [...(model.fired_rules || [])].filter(rule => Number(rule.coefficient) > 0)
    .sort((a, b) => Number(b.coefficient) - Number(a.coefficient));
  for (const rule of rules) {
    for (const condition of rule.conditions || []) {
      if (condition.passed !== true || typeof condition.value !== "number" || !Number.isFinite(condition.value)) continue;
      const name = condition.feature || "";
      const base = name.replace(/^(original_|final_)/, "");
      const descriptor = labels[base];
      if (!descriptor || seen.has(base)) continue;
      seen.add(base);
      const [group, label, unit] = descriptor;
      const side = name.startsWith("original_") ? " pada alamat awal" : name.startsWith("final_") ? " pada alamat akhir" : "";
      const value = unit === "ratio" ? `${(condition.value * 100).toFixed(1)}%` : `${Number(condition.value.toFixed(2))}${unit ? ` ${unit}` : ""}`;
      if (!groups.has(group)) groups.set(group, []);
      if (groups.get(group).length < 2) groups.get(group).push(`${label}${side}: ${value}`);
    }
  }
  return [...groups].map(([group, observations]) => `${group} yang ikut menaikkan risiko dalam kombinasi aturan model: ${observations.join("; ")}.`);
}

function hostname(value) {
  try { return new URL(value).hostname; } catch { return "domain halaman"; }
}
