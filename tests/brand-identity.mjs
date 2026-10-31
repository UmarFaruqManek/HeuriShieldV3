import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBrandIdentity, applyBrandIdentityGuard, brandIdentityQueries } from "../src/analyzer/brand/brand-identity.js";
import { lookupBrandByDomain } from "../src/analyzer/brand/brand-domain-api.js";
import { extractBrandFeatureSet } from "../src/analyzer/brand/brand-features.js";
import { buildRuntimeFeatureAnalysis } from "../src/analyzer/runtime-analysis.js";
import { buildFeatureVector } from "../src/analyzer/feature-assembler.js";
import { readFile } from "node:fs/promises";

const safe = { ready: true, verdict: "SAFE", predicted_label: "legitimate", probability_phishing: 0.2,
  raw_probability_phishing: 0.2, raw_verdict: "SAFE" };
const credential = { credential_form_count: 1, password_credential_field_count: 1 };

test("domain menempel: instagramid.com menemukan instagram tanpa daftar merek", async () => {
  assert.ok(brandIdentityQueries("instagramid").includes("instagram"));
  const queries = [];
  let domainCalls = 0;
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://instagramid.com/login",
    title: "Instagram masuk", domFeatures: credential,
    tokenLookup: async query => {
      queries.push(query);
      return { lookup_success: true, candidates: query === "instagram" ?
        [{ domain: "instagram.com", name: "Instagram", source: "clearbit", qualityScore: 0.96 }] : [] };
    },
    domainLookup: async () => { domainCalls++; return { lookup_success: true, found: false }; }
  });
  assert.equal(evidence.status, "possible_impersonation");
  assert.equal(evidence.candidate_domain, "instagram.com");
  assert.equal(domainCalls, 0);
  assert.equal(applyBrandIdentityGuard(safe, evidence).verdict, "DANGEROUS");
  assert.equal(applyBrandIdentityGuard(safe, evidence).raw_probability_phishing, 0.2);
});

test("tenant blogspot dibandingkan dengan domain brand, bukan blogspot.com", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://facebook-247-support.blogspot.com/",
    title: "Facebook login", domFeatures: credential,
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "facebook.com",
      brand_top_candidate_name: "Facebook", brand_top_candidate_source: "clearbit" },
    tokenLookup: async () => { throw Error("tidak perlu token tambahan"); },
    domainLookup: async () => { throw Error("tidak perlu fallback"); }
  });
  assert.equal(evidence.active_domain, "facebook-247-support.blogspot.com");
  assert.equal(evidence.platform_domain, "blogspot.com");
  assert.equal(evidence.status, "possible_impersonation");
});

test("subdomain legitimate dan nama mirip tanpa formulir tidak diblokir", async () => {
  const own = await analyzeBrandIdentity({ finalUrl: "https://app.dicoding.com/login",
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "dicoding.com",
      brand_top_candidate_name: "Dicoding", brand_top_candidate_source: "clearbit" },
    domainLookup: async () => { throw Error("tidak perlu"); }
  });
  assert.equal(own.status, "matched_candidate");
  assert.equal(applyBrandIdentityGuard(safe, own).verdict, "SAFE");
  const lookalike = await analyzeBrandIdentity({ finalUrl: "https://instagramid.com/",
    title: "Instagram fans", domFeatures: {},
    tokenLookup: async query => ({ lookup_success: true, candidates: query === "instagram" ?
      [{ domain: "instagram.com", name: "Instagram" }] : [] }) });
  assert.equal(lookalike.status, "possible_impersonation");
  assert.equal(applyBrandIdentityGuard(safe, lookalike).verdict, "SAFE");
});

test("nama mirip pada host dan judul perlu dukungan model untuk diblokir", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://www.robloxc.com.es/users/1/profile",
    title: "Profile - Roblox", domFeatures: {},
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "roblox.com",
      brand_top_candidate_name: "Roblox", brand_top_candidate_source: "clearbit" } });
  assert.equal(evidence.status, "possible_impersonation");
  assert.equal(applyBrandIdentityGuard({ ...safe, raw_probability_phishing: 0.4537 }, evidence).verdict, "DANGEROUS");
  assert.equal(applyBrandIdentityGuard({ ...safe, raw_probability_phishing: 0.20 }, evidence).verdict, "SAFE");
});

test("salah eja satu karakter pada domain dikonfirmasi lewat token judul", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://www.robiox.com.gr/users/1/profile",
    title: "Blox Fruits - Roblox", domFeatures: {}, tokenLookup: async query => ({
      lookup_success: true, candidates: query === "roblox" ?
        [{ domain: "roblox.com", name: "Roblox", source: "clearbit" }] : []
    }), domainLookup: async () => ({ lookup_success: true, found: false }) });
  assert.equal(evidence.candidate_domain, "roblox.com");
  assert.equal(evidence.discovery_method, "title_correlated_typo");
  assert.equal(applyBrandIdentityGuard({ ...safe, raw_probability_phishing: 0.47 }, evidence).verdict, "DANGEROUS");
});

test("brandfetch berkualitas tinggi dapat mengonfirmasi salah eja, TLD alternatif tidak diblokir hanya karena formulir", async () => {
  const typo = await analyzeBrandIdentity({ finalUrl: "https://robiox.com.gr/",
    title: "Roblox", tokenLookup: async query => ({ lookup_success: true,
      candidates: query === "roblox" ? [{ domain: "roblox.com", name: "Roblox",
        source: "brandfetch", qualityScore: 0.96 }] : [] }) });
  assert.equal(applyBrandIdentityGuard({ ...safe, raw_probability_phishing: 0.47 }, typo).verdict, "DANGEROUS");
  const alternate = await analyzeBrandIdentity({ finalUrl: "https://www.albemarle.edu/login",
    title: "Albemarle", domFeatures: credential,
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "albemarle.com",
      brand_top_candidate_name: "Albemarle", brand_top_candidate_source: "clearbit" } });
  assert.equal(alternate.status, "possible_impersonation");
  assert.equal(applyBrandIdentityGuard({ ...safe, raw_probability_phishing: 0.001 }, alternate).verdict, "SAFE");
});

test("identitas platform tidak dianggap identitas konten pengguna", async () => {
  const surge = await analyzeBrandIdentity({ finalUrl: "https://example.surge.sh/",
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "surge.sh",
      brand_top_candidate_name: "Surge", brand_top_candidate_source: "brandfetch" } });
  const bio = await analyzeBrandIdentity({ finalUrl: "https://bio.site/username",
    domainLookup: async domain => ({ lookup_success: true, found: true,
      domain, registrable_domain: domain, brand_name: "Bio Sites" }) });
  assert.equal(surge.status, "platform_candidate");
  assert.equal(bio.status, "platform_candidate");
  assert.equal(applyBrandIdentityGuard(safe, surge).verdict, "SAFE");
});

test("brand pada judul dicatat terpisah dari brand pemilik domain", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://reshmatex.com/log.php",
    title: "WeTransfer - Partage de document", domFeatures: credential,
    brandFeatures: { brand_found: true, brand_top_candidate_domain: "reshmatex.com",
      brand_top_candidate_name: "Reshma Tex", brand_top_candidate_source: "clearbit",
      brand_lookup_candidates: [{ query: "wetransfer", domain: "wetransfer.com",
        name: "WeTransfer", source: "clearbit" }] } });
  assert.equal(evidence.status, "matched_candidate");
  assert.equal(evidence.page_claim_candidate_domain, "wetransfer.com");
  assert.equal(applyBrandIdentityGuard(safe, evidence).verdict, "SAFE");
});

test("extractor mempertahankan kandidat judul walau kandidat utama milik domain", async () => {
  const features = await extractBrandFeatureSet({ originalUrl: "https://reshmatex.com/log.php",
    title: "WeTransfer - Partage de document", lookup: async query => ({ query,
      lookup_success: true, candidates: query === "reshmatex" ?
        [{ domain: "reshmatex.com", name: "Reshma Tex", source: "clearbit" }] :
        query === "wetransfer" ? [{ domain: "wetransfer.com", name: "WeTransfer", source: "clearbit" }] : [] }) });
  assert.equal(features.brand_top_candidate_domain, "reshmatex.com");
  assert.ok(features.brand_lookup_candidates.some(item => item.domain === "wetransfer.com"));
  const contract = JSON.parse(await readFile(new URL("../src/rule/feature-contract-60.json", import.meta.url)));
  const originalSources = { brand: { ...features } };
  delete originalSources.brand.brand_lookup_candidates;
  assert.deepEqual(buildFeatureVector(contract.features, { brand: features }).vector,
    buildFeatureVector(contract.features, originalSources).vector);
});

test("klaim brand pada judul dicatat walau API domain tidak menemukan identitas pemilik", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://example-new-domain.com/",
    title: "TikTok", brandFeatures: { brand_found: false,
      brand_lookup_candidates: [{ query: "tiktok", domain: "tiktok.com",
        name: "TikTok", source: "clearbit" }] },
    domainLookup: async () => ({ lookup_success: true, found: false }) });
  assert.equal(evidence.status, "title_brand_mismatch");
  assert.equal(evidence.page_claim_candidate_domain, "tiktok.com");
  assert.equal(applyBrandIdentityGuard(safe, evidence).verdict, "SAFE");
});

test("nama brand pendek pada tenant tetap tercatat sebagai bukti", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://ebay-phone-number.blogspot.com/",
    title: "Ebay Phone Number", brandFeatures: { brand_found: true,
      brand_top_candidate_domain: "ebay.com", brand_top_candidate_name: "eBay",
      brand_top_candidate_source: "clearbit" } });
  assert.equal(evidence.status, "possible_impersonation");
  assert.equal(evidence.candidate_domain, "ebay.com");
  assert.equal(applyBrandIdentityGuard(safe, evidence).verdict, "SAFE");
});

test("fallback domain dicatat sebagai kandidat, bukan verifikasi resmi", async () => {
  const evidence = await analyzeBrandIdentity({ finalUrl: "https://claude.com/",
    tokenLookup: async () => ({ lookup_success: true, candidates: [] }),
    domainLookup: async domain => ({ lookup_success: true, found: true,
      domain, registrable_domain: domain, brand_name: "Claude",
      verification_status: "candidate", brand_verified: false })
  });
  assert.equal(evidence.status, "matched_candidate");
  assert.equal(evidence.discovery_method, "domain_fallback");
  assert.equal(evidence.candidate_brand_verified, false);
  assert.equal(applyBrandIdentityGuard(safe, evidence).verdict, "SAFE");
});

test("API domain menolak jawaban domain lain dan memisahkan tidak ditemukan dari gagal", async () => {
  const fake = async () => ({ ok: true, json: async () => ({ found: true,
    registrable_domain: "different.com", brand_name: "X" }) });
  const wrong = await lookupBrandByDomain("example.com", { fetchImpl: fake });
  assert.equal(wrong.lookup_success, false);
  assert.equal(wrong.error, "domain_mismatch");
  const missing = await lookupBrandByDomain("example.com", { fetchImpl: async () => ({
    ok: true, json: async () => ({ found: false }) }) });
  assert.equal(missing.lookup_success, true);
  assert.equal(missing.found, false);
});

test("fallback identitas tidak mengubah 60 nilai fitur dan skor RuleFit", async () => {
  const contract = JSON.parse(await readFile(new URL("../src/rule/feature-contract-60.json", import.meta.url)));
  const engine = JSON.parse(await readFile(new URL("../src/rule/rulefit-engine-60.json", import.meta.url)));
  const options = { originalUrl: "https://claude.com/", title: "Claude",
    featureContract: contract, rulefitEngine: engine,
    brandLookup: async query => ({ query, candidates: [], lookup_success: true }),
    rdapLookup: async () => ({ available: false }) };
  const unknown = await buildRuntimeFeatureAnalysis({ ...options,
    brandDomainLookup: async () => ({ lookup_success: true, found: false }) });
  const found = await buildRuntimeFeatureAnalysis({ ...options,
    brandDomainLookup: async domain => ({ lookup_success: true, found: true,
      domain, registrable_domain: domain, brand_name: "Claude", brand_verified: false }) });
  assert.equal(Object.keys(found.feature_vector.vector).length, 60);
  assert.deepEqual(found.feature_vector.vector, unknown.feature_vector.vector);
  assert.equal(found.model_result.raw_probability_phishing, unknown.model_result.raw_probability_phishing);
  assert.equal(found.brand_identity.status, "matched_candidate");
});
