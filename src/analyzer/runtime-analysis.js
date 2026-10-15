/*
 * Alur utama: ekstraksi URL/DOM + lookup RDAP/brand -> input model -> RuleFit -> guard.
 * Guard adalah aturan manual; urutan dan ambangnya tidak diubah oleh komentar ini.
 */
import { buildFeatureVector, summarizeFeatureCoverage } from "./feature-assembler.js";
import { extractBrandFeatureSet, searchBrand } from "./brand/brand-features.js";
import { extractRdapFeatureSet, lookupRdapDomain } from "./domain/rdap-features.js";
import { extractCrawlerUrlFeatureSet } from "./url/url-features.js";
import { evaluateRuleFitEngine } from "../rule/rulefit-engine.js";
import { PUBLIC_HOSTING_PLATFORM_DOMAINS, SHORTENER_DOMAINS } from "../utils/constants.js";

export const RUNTIME_ANALYSIS_VERSION = "rulefit60-clearbit-self-brand-guard-v4";

const EXTRA_SHORTENER_DOMAINS = new Set([
  "bitly.com",
  "bitly.cx",
  "g5.lu",
  "igit.me",
  "lnk.ink",
  "rbcode.net",
  "s4w.in",
  "uf1k29.s.gy"
]);

const HIGH_REPUTATION_REDIRECT_FINALS = new Set([
  "google.com",
  "wikipedia.org",
  "kleinanzeigen.de"
]);

const BRANDISH_REDIRECT_TOKENS = new Set([
  "allegro",
  "amazon",
  "apple",
  "coda",
  "codashop",
  "discord",
  "facebook",
  "fb",
  "instagram",
  "ledger",
  "meta",
  "metamask",
  "microsoft",
  "office",
  "outlook",
  "postoffice",
  "roblox",
  "santander",
  "spotify",
  "trezor",
  "usps",
  "whatsapp"
]);

export async function buildRuntimeFeatureAnalysis({
  originalUrl,
  finalUrl = originalUrl,
  redirectChain = [],
  title = "",
  domFeatures = null,
  httpStatusCode = null,
  featureContract,
  rulefitEngine,
  sensitiveKeywords = [],
  rdapLookup = lookupRdapDomain,
  brandLookup = searchBrand
} = {}) {
  // Ekstraksi tetap mengikuti definisi crawler agar fitur latih dan runtime sepadan.
  const urlFeatures = extractCrawlerUrlFeatureSet({
    originalUrl,
    finalUrl,
    redirectChain,
    sensitiveKeywords
  });

  // Lookup independen dijalankan bersamaan; kegagalan tetap ditandai sebagai missing.
  const [rdapFeatures, brandFeatures] = await Promise.all([
    extractRdapFeatureSet({
      originalDomain: urlFeatures.original_registrable_domain,
      finalDomain: urlFeatures.final_registrable_domain,
      originalSkip: urlFeatures.original_skip_domain_age_lookup,
      finalSkip: urlFeatures.final_skip_domain_age_lookup,
      lookup: rdapLookup
    }),
    extractBrandFeatureSet({
      originalUrl,
      finalUrl,
      title,
      lookup: brandLookup
    })
  ]);

  const statusFeatures = { http_status_code: httpStatusCode };
  const sources = domFeatures
    ? { url: urlFeatures, dom: domFeatures, rdap: rdapFeatures, brand: brandFeatures, status: statusFeatures }
    : { url: urlFeatures, rdap: rdapFeatures, brand: brandFeatures, status: statusFeatures };
  // Hanya fitur dalam kontrak aktif yang masuk model; sinyal lain tetap untuk guard/UI.
  const assembled = buildFeatureVector(featureContract.features, sources);
  const coverage = summarizeFeatureCoverage(assembled);
  const rulefitModel = rulefitEngine ? evaluateRuleFitEngine(rulefitEngine, assembled.vector) : null;
  const model = applyPostModelGuards(rulefitModel, {
    brandFeatures,
    urlFeatures,
    rdapFeatures,
    domFeatures,
    title,
    httpStatusCode
  });

  return {
    analyzer_version: RUNTIME_ANALYSIS_VERSION,
    final_url: finalUrl,
    sources,
    url_features: urlFeatures,
    dom_features: domFeatures,
    rdap_features: rdapFeatures,
    brand_features: brandFeatures,
    page_status_features: statusFeatures,
    feature_vector: assembled,
    feature_vector_coverage: coverage,
    model_result: model
  };
}

function applyPostModelGuards(model, { brandFeatures, urlFeatures, rdapFeatures, domFeatures, title, httpStatusCode } = {}) {
  // Aturan manual setelah model, bukan rule hasil pelatihan. Guard pertama menang.
  // Skor yang disesuaikan guard tidak lagi merupakan probabilitas murni RuleFit.
  if (!model?.ready) return model;
  const selfBrandGuard = detectSelfBrandLegitimateGuard(brandFeatures, urlFeatures, rdapFeatures, domFeatures, title, httpStatusCode);
  if (selfBrandGuard) {
    if (model.verdict !== "DANGEROUS") {
      return {
        ...model,
        post_model_guard: selfBrandGuard
      };
    }
    return {
      ...model,
      original_predicted_label: model.predicted_label,
      original_verdict: model.verdict,
      predicted_label: "legitimate",
      verdict: "SAFE",
      probability_phishing: Math.min(Number(model.probability_phishing) || 0, 0.42),
      post_model_guard: selfBrandGuard
    };
  }

  const redirectRiskGuard = detectRedirectRiskGuard(urlFeatures);
  if (redirectRiskGuard) {
    return {
      ...model,
      original_predicted_label: model.predicted_label,
      original_verdict: model.verdict,
      predicted_label: "phishing",
      verdict: "DANGEROUS",
      probability_phishing: Math.max(Number(model.probability_phishing) || 0, 0.86),
      post_model_guard: redirectRiskGuard
    };
  }

  const guard = detectBrandImpersonationGuard(brandFeatures, urlFeatures);
  if (!guard) return model;

  return {
    ...model,
    original_predicted_label: model.predicted_label,
    original_verdict: model.verdict,
    predicted_label: "phishing",
    verdict: "DANGEROUS",
    probability_phishing: Math.max(Number(model.probability_phishing) || 0, 0.86),
    post_model_guard: guard
  };
}

function detectSelfBrandLegitimateGuard(brandFeatures = {}, urlFeatures = {}, rdapFeatures = {}, domFeatures = {}, title = "", httpStatusCode = null) {
  // Kandidat direktori saja belum cukup: cocokkan identitas dan sinyal pendukung.
  if (!brandFeatures?.brand_candidate_found) return null;
  const isBrandfetchCandidate = brandFeatures.brand_top_candidate_source === "brandfetch";
  const isClearbitCandidate = brandFeatures.brand_top_candidate_source === "clearbit";
  if (!isBrandfetchCandidate && !isClearbitCandidate) return null;
  if (isBrandfetchCandidate) {
    if ((Number(brandFeatures.brand_top_candidate_quality_score) || 0) < 0.5) return null;
    if ((Number(brandFeatures.brand_top_candidate_search_score) || 0) < 10) return null;
  }

  const matchedOfficialDomain = Boolean(
    brandFeatures.brand_candidate_matches_original_domain ||
    brandFeatures.brand_candidate_matches_final_domain
  );

  const candidateLabel = domainLabel(brandFeatures.brand_top_candidate_domain) ||
    normalizeToken(brandFeatures.brand_top_candidate_name);
  if (isClearbitCandidate) {
    // Directory identity is not a quality score: require independent page evidence.
    if (!brandFeatures.brand_candidate_matches_original_domain || !brandFeatures.brand_candidate_matches_final_domain) return null;
    if (normalizeToken(brandFeatures.brand_top_candidate_query) !== candidateLabel) return null;
    if (!candidateLabel || !normalizeToken(title).includes(candidateLabel)) return null;
    if (Number(httpStatusCode) !== 200) return null;
    if (urlFeatures.original_uses_shared_hosting_domain || urlFeatures.final_uses_shared_hosting_domain) return null;
    if (!Number.isFinite(domFeatures?.external_credential_form_count) || !Number.isFinite(domFeatures?.ip_credential_form_count)) return null;
  }
  const activeLabels = [
    urlFeatures.original_registrable_domain,
    urlFeatures.final_registrable_domain,
    urlFeatures.registrable_domain
  ].map(domainLabel).filter(Boolean);
  const sameBrandLabelDifferentSuffix = Boolean(candidateLabel && activeLabels.includes(candidateLabel));
  if (!matchedOfficialDomain && !sameBrandLabelDifferentSuffix) return null;

  const age = Math.max(
    Number(rdapFeatures.original_domain_age_days) || 0,
    Number(rdapFeatures.final_domain_age_days) || 0
  );
  const rdapAvailable = Boolean(rdapFeatures.original_rdap_available || rdapFeatures.final_rdap_available);
  if (!rdapAvailable || age < 365) return null;

  const hasCrossDomainRedirect = Boolean(urlFeatures.final_domain_changed) ||
    Number(urlFeatures.cross_domain_redirect_count || 0) > 0;
  if (hasCrossDomainRedirect) return null;

  const externalCredentialForms = Number(domFeatures?.external_credential_form_count || 0);
  const ipCredentialForms = Number(domFeatures?.ip_credential_form_count || 0);
  if (externalCredentialForms > 0 || ipCredentialForms > 0) return null;

  const active = urlFeatures.final_registrable_domain || urlFeatures.original_registrable_domain || "domain aktif";
  const brand = brandFeatures.brand_top_candidate_name || domainLabel(brandFeatures.brand_top_candidate_domain) || active;
  return {
    id: matchedOfficialDomain ? "SELF_BRAND_DOMAIN_GUARD" : "SELF_BRAND_LABEL_GUARD",
    severity: "info",
    feature: "brand_domain_match",
    reason: matchedOfficialDomain
      ? `Brand ${brand} cocok dengan domain aktif ${active}, domain memiliki data RDAP, dan form kredensial tidak mengarah ke domain luar.`
      : `Brand ${brand} memiliki label yang sama dengan domain aktif ${active}, domain cukup tua, dan form kredensial tidak mengarah ke domain luar.`,
    brand,
    brand_source: brandFeatures.brand_top_candidate_source,
    active_domain: active,
    domain_age_days: age
  };
}

function detectRedirectRiskGuard(urlFeatures = {}) {
  // Daftar pola redirect merupakan heuristik manual dan tetap dapat salah klasifikasi.
  const originalDomain = String(urlFeatures.original_registrable_domain || "").toLowerCase();
  const finalDomain = String(urlFeatures.final_registrable_domain || "").toLowerCase();
  if (!originalDomain || !finalDomain) return null;

  const crossDomainRedirect = Boolean(urlFeatures.final_domain_changed) ||
    Number(urlFeatures.cross_domain_redirect_count || 0) > 0 ||
    originalDomain !== finalDomain;
  const originalUrl = String(urlFeatures.original_url || "");
  const isShortenerOriginal = hasDomainSuffix(originalDomain, SHORTENER_DOMAINS) ||
    hasDomainSuffix(originalDomain, EXTRA_SHORTENER_DOMAINS);
  const isHighReputationFinal = HIGH_REPUTATION_REDIRECT_FINALS.has(finalDomain);
  const isSharedPlatformOriginal = hasDomainSuffix(originalDomain, PUBLIC_HOSTING_PLATFORM_DOMAINS);
  const isSharedPlatformFinal = hasDomainSuffix(finalDomain, PUBLIC_HOSTING_PLATFORM_DOMAINS);
  const brandishInitial = hasBrandishToken(originalUrl || originalDomain);
  const brandTldVariant = domainLabel(originalDomain) !== domainLabel(finalDomain) &&
    [...BRANDISH_REDIRECT_TOKENS].some((token) => normalizeToken(originalDomain).includes(token));

  let reason = "";
  if (isShortenerOriginal && crossDomainRedirect) {
    reason = `Alamat awal memakai shortener ${originalDomain} lalu berpindah ke domain lain (${finalDomain}). Pola ini sering dipakai untuk menyembunyikan tujuan asli.`;
  } else if (isHighReputationFinal && crossDomainRedirect) {
    reason = `Alamat awal ${originalDomain} berpindah ke domain reputasi tinggi ${finalDomain}. Redirect seperti ini bisa dipakai untuk menyamarkan halaman phishing setelah URL diperiksa.`;
  } else if (brandishInitial && crossDomainRedirect) {
    reason = `Alamat awal memuat nama layanan populer lalu berpindah ke domain berbeda (${finalDomain}). Perubahan domain ini meningkatkan risiko phishing.`;
  } else if (brandTldVariant) {
    reason = `Alamat awal terlihat seperti variasi domain brand (${originalDomain}), tetapi tujuan akhirnya berbeda.`;
  } else if (isSharedPlatformOriginal && brandishInitial) {
    reason = `Alamat awal berada di platform hosting publik dan memuat nama layanan populer. Pola ini sering muncul pada halaman phishing siap pakai.`;
  }

  if (!reason) return null;
  return {
    id: "REDIRECT_RISK_GUARD",
    severity: "high",
    feature: "initial_final_redirect_risk",
    reason,
    original_domain: originalDomain,
    final_domain: finalDomain,
    cross_domain_redirect: crossDomainRedirect,
    shortener_original: isShortenerOriginal,
    high_reputation_final: isHighReputationFinal,
    shared_platform_original: isSharedPlatformOriginal,
    shared_platform_final: isSharedPlatformFinal,
    brandish_initial_url: brandishInitial,
    brand_tld_variant: brandTldVariant
  };
}

function detectBrandImpersonationGuard(brandFeatures = {}, urlFeatures = {}) {
  // Domain berbeda saja tidak cukup; cari penyebutan brand atau kemiripan tambahan.
  if (!brandFeatures?.brand_candidate_found) return null;

  const matchedOfficialDomain = Boolean(
    brandFeatures.brand_candidate_matches_original_domain ||
    brandFeatures.brand_candidate_matches_final_domain
  );
  if (matchedOfficialDomain) return null;

  const brandLabel = domainLabel(brandFeatures.brand_top_candidate_domain) ||
    normalizeToken(brandFeatures.brand_top_candidate_name);
  if (!brandLabel || brandLabel.length < 4) return null;

  const registrableHosts = [
    urlFeatures.original_registrable_domain,
    urlFeatures.final_registrable_domain,
    urlFeatures.registrable_domain
  ].map(normalizeToken).filter(Boolean);
  const activeLabels = [
    urlFeatures.original_registrable_domain,
    urlFeatures.final_registrable_domain,
    urlFeatures.registrable_domain
  ].map(domainLabel).filter(Boolean);

  const brandMentionedInHost = registrableHosts.some((host) => host.includes(brandLabel));
  const brandMentionedInUrlPart = Boolean(
    brandFeatures.brand_candidate_in_original_subdomain ||
    brandFeatures.brand_candidate_in_original_path ||
    brandFeatures.brand_candidate_in_original_query
  );
  const similarity = Math.max(
    Number(brandFeatures.brand_candidate_original_domain_similarity) || 0,
    Number(brandFeatures.brand_candidate_final_domain_similarity) || 0
  );

  const sameLabelDifferentSuffix = activeLabels.some((label) => label === brandLabel);
  if (sameLabelDifferentSuffix && !brandMentionedInUrlPart) {
    const hasAdditionalRisk = Boolean(urlFeatures.final_domain_changed) ||
      Number(urlFeatures.cross_domain_redirect_count || 0) > 0 ||
      Boolean(urlFeatures.original_uses_shared_hosting_domain || urlFeatures.final_uses_shared_hosting_domain) ||
      Number(urlFeatures.original_sensitive_word_count || 0) > 0 ||
      Number(urlFeatures.final_sensitive_word_count || 0) > 0 ||
      Number(urlFeatures.sensitive_word_count || 0) > 0;
    if (!hasAdditionalRisk) return null;
  }

  if (
    brandFeatures.brand_top_candidate_source === "brandfetch" &&
    sameLabelDifferentSuffix &&
    !brandMentionedInUrlPart &&
    (Number(brandFeatures.brand_top_candidate_quality_score) || 0) < 0.5
  ) {
    return null;
  }

  if (!brandMentionedInHost && !brandMentionedInUrlPart && similarity < 0.45) return null;

  const official = brandFeatures.brand_top_candidate_domain || "domain resmi";
  const active = urlFeatures.final_registrable_domain || urlFeatures.original_registrable_domain || "domain aktif";
  return {
    id: "BRAND_IMPERSONATION_GUARD",
    severity: "high",
    feature: "brand_domain_mismatch",
    reason: `Brand ${brandFeatures.brand_top_candidate_name || brandLabel} terdeteksi, tetapi domain aktif ${active} tidak sama dengan domain resmi ${official}.`,
    brand: brandFeatures.brand_top_candidate_name || brandLabel,
    official_domain: official,
    active_domain: active,
    similarity
  };
}

function domainLabel(domain) {
  return normalizeToken(String(domain || "").split(".")[0] || "");
}

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hasDomainSuffix(domain, suffixes) {
  const clean = String(domain || "").toLowerCase();
  for (const suffix of suffixes || []) {
    const normalized = String(suffix || "").toLowerCase();
    if (clean === normalized || clean.endsWith(`.${normalized}`)) return true;
  }
  return false;
}

function hasBrandishToken(value) {
  const text = normalizeToken(value);
  for (const token of BRANDISH_REDIRECT_TOKENS) {
    if (text.includes(token)) return true;
  }
  return false;
}
