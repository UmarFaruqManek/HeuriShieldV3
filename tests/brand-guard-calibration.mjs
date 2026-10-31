import assert from 'node:assert/strict';
import { applyPostModelGuards, detectBrandImpersonationGuard } from '../src/analyzer/runtime-analysis.js';
import { applyBrandClaimGuard } from '../src/shared/brand-claim-guard.js';
import { extractCrawlerUrlFeatureSet } from '../src/analyzer/url/url-features.js';
import { buildAnalysisExplanation } from '../src/shared/analysis-explanation.js';

const raw = (risk) => ({ ready: true, verdict: 'SAFE', predicted_label: 'legitimate', probability_phishing: risk });
const emptyDom = { credential_form_count: 0, password_credential_field_count: 0,
  external_credential_form_count: 0, ip_credential_form_count: 0 };

function decision(url, official, risk, dom = emptyDom) {
  const urlFeatures = extractCrawlerUrlFeatureSet({ originalUrl: url, finalUrl: url });
  const brandFeatures = { brand_found: true, brand_top_candidate_name: official.split('.')[0],
    brand_top_candidate_domain: official, brand_matches_source: false,
    brand_matches_page: false, brand_in_source_subdomain: 1 };
  assert.ok(detectBrandImpersonationGuard(brandFeatures, urlFeatures));
  return applyPostModelGuards(raw(risk), { brandFeatures, urlFeatures, domFeatures: dom });
}

assert.equal(decision('https://eportal.mru.ac.ug/apply/', 'eportal.id', 0.02).verdict, 'SAFE');
assert.equal(decision('https://roblox.evil.example/login', 'roblox.com', 0.02,
  { ...emptyDom, credential_form_count: 1, password_credential_field_count: 1 }).verdict, 'DANGEROUS');
assert.equal(decision('https://www.roblox.com.evil.example/login', 'roblox.com', 0.02).verdict, 'DANGEROUS');
assert.equal(decision('https://roblox.evil.example/login', 'roblox.com', 0.72).verdict, 'DANGEROUS');

const sharedUrl = 'https://roblox-login.pages.dev/';
const sharedGuardResult = applyPostModelGuards(raw(0.05), {
  urlFeatures: extractCrawlerUrlFeatureSet({ originalUrl: sharedUrl, finalUrl: sharedUrl })
});
assert.equal(sharedGuardResult.post_model_guard?.id, 'SHARED_HOSTING_BRAND_GUARD');
assert.equal(sharedGuardResult.post_model_guard?.cross_domain_redirect, false);
const sharedExplanation = buildAnalysisExplanation({
  verdict: sharedGuardResult.verdict, final_url: sharedUrl,
  model_result: sharedGuardResult
});
assert.match(sharedExplanation.reasons[0], /hosting publik/);
assert.doesNotMatch(sharedExplanation.reasons[0], /mengalihkan/);

const lookup = async () => ({ lookup_success: true, candidates: [
  { domain: 'tutors.com', name: 'Tutors', qualityScore: 0.99 }
] });
const site = 'https://www.professionaltutors.com/about/';
const siteBrand = { brand_top_candidate_domain: 'professionaltutors.com',
  brand_top_candidate_name: 'Professional Tutors of America',
  brand_top_candidate_source: 'clearbit', brand_matches_source: true,
  brand_matches_page: true };
const accepted = await applyBrandClaimGuard(raw(0.01), {
  originalUrl: site, finalUrl: site, title: 'About | Professional Tutors of America',
  domFeatures: emptyDom, brandFeatures: siteBrand,
  rdapFeatures: { page_domain_age_days: 10696 }, lookup
});
assert.equal(accepted.verdict, 'SAFE');

const spoofed = await applyBrandClaimGuard(raw(0.01), {
  originalUrl: 'https://roblox.com.evil.com/', finalUrl: 'https://roblox.com.evil.com/',
  title: 'Roblox', domFeatures: emptyDom,
  brandFeatures: { ...siteBrand, brand_top_candidate_domain: 'evil.com',
    brand_top_candidate_name: 'Evil', brand_matches_source: true, brand_matches_page: true },
  rdapFeatures: { page_domain_age_days: 1000 },
  lookup: async () => ({ lookup_success: true, candidates: [
    { domain: 'roblox.com', name: 'Roblox', qualityScore: 0.99 }
  ] })
});
assert.equal(spoofed.verdict, 'DANGEROUS');

const credentialLookup = async (domain, name) => ({ lookup_success: true, candidates: [
  { domain, name, qualityScore: 0.96 }
] });
const whatsappClaim = await applyBrandClaimGuard(raw(0.05), {
  originalUrl: 'https://whatsapp.viewclass.com/login',
  finalUrl: 'https://whatsapp.viewclass.com/login', title: 'WhatsApp',
  domFeatures: { ...emptyDom, credential_form_count: 1, password_credential_field_count: 1 },
  brandFeatures: { brand_top_candidate_domain: 'viewclass.com',
    brand_top_candidate_name: 'viewclass', brand_top_candidate_source: 'clearbit',
    brand_matches_source: true, brand_matches_page: true },
  rdapFeatures: { page_domain_age_days: 6166 },
  lookup: () => credentialLookup('whatsapp.com', 'WhatsApp')
});
assert.equal(whatsappClaim.verdict, 'DANGEROUS');

const robloxTypo = await applyBrandClaimGuard(raw(0.19), {
  originalUrl: 'https://robloxc.com.es/login', finalUrl: 'https://robloxc.com.es/login',
  title: 'Roblox',
  domFeatures: { ...emptyDom, credential_form_count: 5, password_credential_field_count: 5 },
  brandFeatures: { brand_top_candidate_domain: 'roblox.com',
    brand_top_candidate_name: 'Roblox', brand_top_candidate_source: 'clearbit',
    brand_quality_score: 0.96, brand_matches_source: false, brand_matches_page: false },
  rdapFeatures: {}, lookup: () => credentialLookup('roblox.com', 'Roblox')
});
assert.equal(robloxTypo.verdict, 'DANGEROUS');

const ownInstitutionLogin = await applyBrandClaimGuard(raw(0.01), {
  originalUrl: 'https://www.hmt-rostock.de/login-intranet/',
  finalUrl: 'https://www.hmt-rostock.de/login-intranet/',
  title: 'Login Intranet - hmt Hochschule für Musik und Theater Rostock',
  domFeatures: { ...emptyDom, credential_form_count: 1, password_credential_field_count: 1 },
  brandFeatures: { brand_top_candidate_domain: 'hmt-rostock.de',
    brand_top_candidate_name: 'Hochschule für Musik und Theater Rostock',
    brand_top_candidate_source: 'clearbit', brand_matches_source: true,
    brand_matches_page: true },
  rdapFeatures: {}, lookup: () => credentialLookup('rostock.de', 'Rostock')
});
assert.equal(ownInstitutionLogin.verdict, 'SAFE');
console.log('Brand guard calibration checks passed');
