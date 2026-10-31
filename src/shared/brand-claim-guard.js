import { parse } from "./tldts.js";

const GENERIC = new Set(["account", "app", "auth", "clone", "home", "index", "login", "page", "portal", "secure", "sign", "signin", "to", "verify", "web", "welcome", "www"]);

const clean = value => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function domainOf(value) {
  try {
    const host = new URL(String(value).includes("://") ? value : `https://${value}`).hostname;
    return parse(host, { allowPrivateDomains: true }).domain || null;
  } catch { return null; }
}

function hostnameOf(value) {
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return ""; }
}

function titleTokens(title) {
  const parts = String(title || "").split(/[^a-zA-Z0-9]+/).map(clean)
    .filter(token => token.length >= 4 && !GENERIC.has(token) && !/^\d+$/.test(token));
  return [...new Set(parts.reverse())];
}

export function hostnameBrandParts(hostname) {
  // Nama tenant hosting (misalnya abc.pages.dev) diperlakukan sebagai identitas
  // tersendiri; suffix privat pages.dev tidak dicari sebagai token brand.
  const parsed = parse(String(hostname || "").toLowerCase(), { allowPrivateDomains: true });
  return {
    subdomain: parsed.subdomain || "",
    registrableDomain: parsed.domain || null,
    publicSuffix: parsed.publicSuffix || null,
    domainLabel: parsed.domainWithoutSuffix || ""
  };
}

// Subdomain dan nama domain dicari; public suffix seperti com atau ac.id tidak.
export function hostnameBrandQueries(hostname) {
  const parts = hostnameBrandParts(hostname);
  const labels = [...parts.subdomain.split(".").filter(Boolean), parts.domainLabel];
  return [...new Set(labels.flatMap(label => [label, ...label.split(/[^a-z0-9]+/i)]
    .map(clean).filter(token => token.length >= 2 && token !== "www" && !/^\d+$/.test(token))))];
}

function exactCandidate(item, token) {
  const domain = domainOf(item?.domain);
  const label = domain ? clean(parse(domain, { allowPrivateDomains: true }).domainWithoutSuffix) : "";
  return domain && (label === token || clean(item?.name) === token)
    ? { domain, labelMatch: label === token, qualityScore: Number(item?.qualityScore) || 0 } : null;
}

function differsByOneCharacter(a, b) {
  if (!a || !b || Math.abs(a.length - b.length) > 1 || a === b) return false;
  if (a.length === b.length) return [...a].filter((ch, i) => ch !== b[i]).length === 1;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < longer.length; i++) {
    if (shorter === longer.slice(0, i) + longer.slice(i + 1)) return true;
  }
  return false;
}

// Bukti halaman terpisah dari fitur model agar definisi data latih tidak berubah.
export async function applyBrandClaimGuard(model, { originalUrl, finalUrl, title, domFeatures, brandFeatures, rdapFeatures, lookup } = {}) {
  if (!model?.ready || model.verdict !== "SAFE" || !domFeatures) return model;
  const host = hostnameOf(finalUrl);
  const currentDomain = domainOf(finalUrl);
  if (!host || !currentDomain) return model;
  // Nama organisasi sering dipakai oleh entitas berbeda, terutama instansi publik.
  // Hasil direktori brand sendiri belum dapat membatalkan identitas situs tersebut.
  const publicEntity = /\.(?:gov|edu|mil|go\.id|ac\.id|sch\.id)$/.test(currentDomain);
  const hostText = clean(host.replace(/^www\./, ""));
  const hasCredentialField = Number(domFeatures.password_credential_field_count || 0) > 0 ||
    Number(domFeatures.credential_form_count || 0) > 0;
  const candidateResults = [{
    domain: brandFeatures?.brand_top_candidate_domain,
    name: brandFeatures?.brand_top_candidate_name
  }];
  // Pencarian mengikuti bagian host: subdomain dahulu, lalu nama domain terdaftar.
  // Respons API ini hanya bukti tambahan; 32/60 nilai fitur model tidak diubah.
  if (typeof lookup === "function") {
    const results = await Promise.all(hostnameBrandQueries(host).slice(0, 5).map(async query => {
      try {
        return await lookup(query);
      } catch { return null; }
    }));
    for (const result of results) if (result?.lookup_success === true || result?.status === "ok")
      candidateResults.push(...(result.candidates || []));
  }
  if (publicEntity) return model;
  let claim = null;
  for (const token of titleTokens(title).slice(0, 5)) {
    const inHostname = hostText.includes(token);
    const domainLabel = clean(hostnameBrandParts(host).domainLabel);
    // Direktori dapat mencantumkan domain tiruan sebagai kandidat brand itu sendiri.
    // Untuk dugaan salah eja, minta nama yang sama pada judul dan kandidat resmi
    // berkualitas tinggi dari pencarian terpisah sebelum mengubah keputusan.
    const selfCandidate = domainOf(brandFeatures?.brand_top_candidate_domain) === currentDomain &&
      clean(brandFeatures?.brand_top_candidate_name) === token &&
      brandFeatures?.brand_top_candidate_source === "brandfetch" &&
      Number(brandFeatures?.brand_quality_score) > 0 &&
      Number(brandFeatures?.brand_quality_score) < 0.5;
    const possibleTypo = selfCandidate && differsByOneCharacter(domainLabel, token);
    if (!inHostname && !hasCredentialField && !possibleTypo) continue;
    let matches = candidateResults.map(item => exactCandidate(item, token)).filter(Boolean);
    // Kandidat domain aktif dapat muncul lebih dulu; untuk salah eja, cari
    // juga token pada judul agar domain pembanding tidak tertutup kandidat itu.
    if ((possibleTypo || !matches.length) && typeof lookup === "function") {
      let result = null;
      try { result = await lookup(token); } catch { continue; }
      if (result?.lookup_success !== true && result?.status !== "ok") continue;
      matches.push(...(result.candidates || []).map(item => exactCandidate(item, token)).filter(Boolean));
    }
    // Kecocokan nama saja dapat menunjuk perusahaan lain; nama domain brand
    // yang persis sama dengan token judul lebih kuat daripada urutan respons API.
    matches.sort((a,b) => Number(b.labelMatch) - Number(a.labelMatch) || b.qualityScore - a.qualityScore);
    const official = matches[0]?.domain;
    if (!official || official === currentDomain) continue;
    const officialEmbedded = hostText.includes(clean(official));
    const brandAffix = domainLabel !== token && domainLabel.startsWith(token) &&
      ["id", "login", "secure", "support", "verify"].includes(domainLabel.slice(token.length));
    const corroboratedTypo = possibleTypo && matches[0].labelMatch && matches[0].qualityScore >= 0.8;
    const ageRaw = rdapFeatures?.page_domain_age_days ?? rdapFeatures?.source_domain_age_days;
    const age = ageRaw == null || ageRaw === "" ? NaN : Number(ageRaw);
    const recentlyRegistered = Number.isFinite(age) && age >= 0 && age <= 365;
    // Nama yang kebetulan sama tidak cukup. Minta peniruan alamat resmi, atau
    // klaim brand pada host+judul disertai domain yang baru terdaftar.
    if (!officialEmbedded && !brandAffix && !(inHostname && recentlyRegistered) && !corroboratedTypo) continue;
    // Domain akhir resmi tidak boleh ditandai hanya karena URL awal mengarah ke sana.
    const originalDomain = domainOf(originalUrl);
    if (originalDomain === official && currentDomain === official) continue;
    claim = { token, official, inHostname, corroboratedTypo };
    break;
  }
  if (!claim) return model;
  const guard = {
    id: claim.corroboratedTypo ? "CORROBORATED_BRAND_TYPO" : "CORROBORATED_BRAND_CLAIM_MISMATCH",
    feature: "visible_brand_domain_mismatch",
    severity: "high",
    brand: claim.token,
    official_domain: claim.official,
    active_domain: currentDomain,
    reason: claim.corroboratedTypo
      ? `Nama domain ${currentDomain} berbeda satu karakter dari nama ${claim.token} pada halaman; domain brand yang ditemukan adalah ${claim.official}.`
      : `Halaman menyebut ${claim.token}, tetapi dibuka pada ${currentDomain}; domain brand yang ditemukan adalah ${claim.official}.`
  };
  return {
    ...model,
    raw_probability_phishing: model.raw_probability_phishing ?? model.probability_phishing,
    raw_verdict: model.raw_verdict ?? model.verdict,
    original_verdict: model.verdict,
    original_predicted_label: model.predicted_label,
    verdict: "DANGEROUS",
    predicted_label: "phishing",
    // Nilai model tetap disimpan secara terpisah; angka ini adalah skor keputusan.
    probability_phishing: Math.max(Number(model.probability_phishing) || 0, 0.86),
    post_model_guard: guard
  };
}
