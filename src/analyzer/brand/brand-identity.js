import { parse } from "../../shared/tldts.js";
import { lookupBrandByDomain } from "./brand-domain-api.js";

const clean = value => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function candidateDomain(value) {
  const hostname = String(value || "").toLowerCase().replace(/^www\./, "");
  return parse(hostname, { allowPrivateDomains: true }).domain || null;
}

function siteParts(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const privateParts = parse(hostname, { allowPrivateDomains: true });
    const publicParts = parse(hostname, { allowPrivateDomains: false });
    return { hostname, siteDomain: privateParts.domain || null,
      siteLabel: privateParts.domainWithoutSuffix || "",
      tenantSuffix: privateParts.isPrivate ? privateParts.publicSuffix : null,
      publicDomain: publicParts.domain || null };
  } catch { return null; }
}

function exactCandidate(item, query) {
  const domain = candidateDomain(item?.domain);
  if (!domain) return null;
  const label = clean(parse(domain, { allowPrivateDomains: true }).domainWithoutSuffix);
  if (label !== clean(query)) return null;
  return { domain, name: item.name || null, source: item.source || "directory",
    quality_score: Number.isFinite(Number(item.qualityScore)) ? Number(item.qualityScore) : null };
}

// Potong nama domain tanpa kamus merek: instagramid -> instagram (hapus 2 huruf).
// Tiap tebakan harus dikonfirmasi oleh label domain kandidat API yang persis sama.
export function brandIdentityQueries(label) {
  const parts = String(label || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const queries = [];
  // Token yang dipisahkan tanda hubung sudah dicari oleh extractor lama.
  // Fokus tambahan ini pada nama brand yang menempel tanpa pemisah.
  const full = clean(label);
  if (parts.length === 1 && full.length >= 9) {
    for (const size of [2, 1]) {
      if (full.length - size >= 6) queries.push(full.slice(0, -size));
    }
  }
  return [...new Set(queries)];
}

export async function analyzeBrandIdentity({ finalUrl, title = "", domFeatures = null,
  brandFeatures = {}, tokenLookup, domainLookup = lookupBrandByDomain } = {}) {
  const site = siteParts(finalUrl);
  if (!site?.siteDomain) return { status: "unknown", reason: "invalid_url" };
  const base = { status: "unknown", active_domain: site.siteDomain,
    hostname: site.hostname, platform_domain: site.tenantSuffix || null,
    candidate_domain: null, candidate_name: null, discovery_method: null,
    hostname_claim: false, title_claim: false, credential_form_observed: false,
    domain_fallback_status: "not_queried" };

  const credential = Boolean(domFeatures && (
    Number(domFeatures.credential_form_count || 0) > 0 ||
    Number(domFeatures.password_credential_field_count || 0) > 0 ||
    Number(domFeatures.external_credential_form_count || 0) > 0));
  const fromFeatures = brandFeatures?.brand_found ? candidateDomain(brandFeatures.brand_top_candidate_domain) : null;
  const featureLabel = fromFeatures ? clean(parse(fromFeatures, { allowPrivateDomains: true }).domainWithoutSuffix) : "";
  const siteText = clean(site.hostname.replace(site.tenantSuffix || "", ""));
  let candidate = null;
  let method = null;
  if (fromFeatures && (fromFeatures === site.siteDomain ||
      (featureLabel.length >= 5 && siteText.includes(featureLabel)))) {
    candidate = { domain: fromFeatures, name: brandFeatures.brand_top_candidate_name,
      source: brandFeatures.brand_top_candidate_source, quality_score: brandFeatures.brand_quality_score };
    method = "existing_token_search";
  }

  if ((!candidate || candidate.domain === site.siteDomain) && typeof tokenLookup === "function") {
    // Dua pencarian dibatasi waktu bersama agar halaman tidak tertahan lama.
    const queries = brandIdentityQueries(site.siteLabel);
    let timer;
    const results = queries.length ? await Promise.race([
      Promise.all(queries.map(async query => {
        try { return { query, response: await tokenLookup(query) }; }
        catch { return { query, response: null }; }
      })),
      new Promise(resolve => { timer = setTimeout(() => resolve([]), 6500); })
    ]).finally(() => clearTimeout(timer)) : [];
    for (const { query, response } of results) {
      if (response?.lookup_success !== true) continue;
      const matches = (response.candidates || []).map(item => exactCandidate(item, query)).filter(Boolean);
      const found = matches.find(item => item.domain === site.siteDomain) || matches[0];
      if (found && found.domain !== site.siteDomain) {
        candidate = found; method = "domain_fragment"; break;
      }
    }
  }

  if (!candidate && typeof domainLookup === "function") {
    let response;
    try { response = await domainLookup(site.siteDomain); } catch { response = null; }
    base.domain_fallback_status = response?.lookup_success !== true ? "unavailable" :
      response.found === true ? "found" : "not_found";
    if (response?.lookup_success === true && response.found === true && response.brand_name) {
      candidate = { domain: site.siteDomain, name: response.brand_name,
        source: "brnad_heuri", verification_status: response.verification_status || "candidate",
        brand_verified: response.brand_verified === true };
      method = "domain_fallback";
    }
  }
  if (!candidate) return base;

  const brandLabel = clean(parse(candidate.domain, { allowPrivateDomains: true }).domainWithoutSuffix);
  const hostnameClaim = brandLabel.length >= 5 && siteText.includes(brandLabel);
  const titleClaim = brandLabel.length >= 5 && clean(title).includes(brandLabel);
  return { ...base,
    status: candidate.domain === site.siteDomain ? "matched_candidate" : hostnameClaim ? "possible_impersonation" : "unknown",
    candidate_domain: candidate.domain, candidate_name: candidate.name,
    candidate_source: candidate.source, candidate_quality_score: candidate.quality_score ?? null,
    candidate_verification_status: candidate.verification_status || null,
    candidate_brand_verified: candidate.brand_verified === true,
    discovery_method: method, hostname_claim: hostnameClaim, title_claim: titleClaim,
    credential_form_observed: credential };
}

export function applyBrandIdentityGuard(model, evidence) {
  if (!model?.ready || model.verdict !== "SAFE" ||
      evidence?.status !== "possible_impersonation" ||
      !evidence.hostname_claim || !evidence.credential_form_observed || !evidence.title_claim) return model;
  // Tiga sinyal harus ada sekaligus. Nama mirip saja tidak mengubah putusan.
  const guard = { id: "BRAND_IDENTITY_MISMATCH_GUARD", feature: "brand_identity_evidence",
    severity: "high", brand: evidence.candidate_name,
    active_domain: evidence.active_domain, reference_domain: evidence.candidate_domain,
    reason: `Alamat ${evidence.active_domain} menyebut ${evidence.candidate_name || "brand tersebut"} dan meminta data akun, sedangkan kandidat domain brand yang ditemukan adalah ${evidence.candidate_domain}.` };
  return { ...model, original_predicted_label: model.predicted_label,
    original_verdict: model.verdict, predicted_label: "phishing", verdict: "DANGEROUS",
    probability_phishing: Math.max(Number(model.probability_phishing) || 0, 0.86),
    post_model_guard: guard };
}
