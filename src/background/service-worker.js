/*
 * Pusat koordinasi extension: menerima pesan/tab, mengumpulkan fitur dan menjalankan analisis.
 * Menyimpan hasil sebelum menampilkan panel atau mengalihkan tab berisiko ke halaman blokir.
 */
import { searchBrand } from "../analyzer/brand/brand-features.js";
import { createBrandLookupCache } from "../analyzer/brand/brand-lookup-cache.js";
import { lookupRdapDomain } from "../analyzer/domain/rdap-features.js";
import { buildRuntimeFeatureAnalysis } from "../analyzer/runtime-analysis.js";
import { flattenSensitiveKeywordConfig } from "../analyzer/url/url-features.js";
import {
  getAnalysisByTab,
  getAllowlist,
  getBlacklist,
  addToAllowlist,
  addToBlacklist,
  removeFromAllowlist,
  removeFromBlacklist,
  isProtectionEnabled,
  saveAnalysisForTab,
  saveUrlHistoryEntry,
  saveWarningContext,
  getWarningContext
} from "../storage/settings.js";
import { STORAGE_KEYS } from "../utils/constants.js";
import { buildAnalysisExplanation } from "../shared/analysis-explanation.js";
import { createDatasetCollector } from "../storage/dataset-collector.js";

const ANALYSIS_VERSION = "v5-rulefit60-source-page-schema-v7";
const METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let runtimeResourcesPromise = null;
const datasetCollectorPromise = fetch(chrome.runtime.getURL("src/rule/feature-contract-60.json"))
  .then(response => response.json())
  .then(contract => createDatasetCollector(chrome.storage.local, contract.features));
// Migrasi catatan lokal tanpa server, unduhan otomatis, atau tab khusus.
datasetCollectorPromise.then(collector => collector.sync()).catch(error => console.warn("Dataset:", error.message));
let metadataCacheWrites = Promise.resolve();
const cachedBrandLookup = createBrandLookupCache({
  lookup: searchBrand,
  getCache: getMetadataCache,
  updateCache: updateMetadataCache,
  ttlMs: METADATA_CACHE_TTL_MS
});
const httpStatusByTab = new Map();
const autoAnalysisInFlight = new Set();
const temporaryBypassByTab = new Map();

ensureRuntimeStateVersion().catch((error) => {
  console.warn("HeuriShield runtime state migration failed:", error?.message || error);
});

if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.tabId >= 0 && details.type === "main_frame") {
        httpStatusByTab.set(details.tabId, {
          url: details.url,
          statusCode: details.statusCode,
          observedAt: Date.now()
        });
      }
    },
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    [STORAGE_KEYS.ENABLED]: true,
    [STORAGE_KEYS.URL_HISTORY]: [],
    [STORAGE_KEYS.ANALYSIS_BY_TAB]: {}
  };
  const current = await chrome.storage.local.get(Object.keys(defaults));
  const patch = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await clearStaleRuntimeState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "HEURISHIELD_DATASET") {
    if (!_sender?.url?.startsWith(chrome.runtime.getURL("src/dataset/dataset.html"))) {
      sendResponse({ ok: false, error: "Hanya halaman pencatatan yang dapat mengelola dataset." });
      return false;
    }
    datasetCollectorPromise.then(collector => {
      if (message.action === "enable") return collector.enable(message.enabled);
      if (message.action === "sync") return collector.sync(true);
      throw new Error("Perintah dataset tidak dikenal.");
    }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "ANALYZE_ACTIVE_TAB") {
    analyzeActiveTab(message)
      .then(async (analysis) => {
        if (analysis?.verdict === "DANGEROUS" && await isProtectionEnabled()) {
          await redirectToWarningPage(Number(message.tabId), analysis);
        }
        sendResponse({ ok: true, analysis });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Analisis gagal." }));
    return true;
  }

  if (message?.type === "HEURISHIELD_ANALYZE_PAGE") {
    const tabId = Number(_sender?.tab?.id);
    const url = String(message.url || _sender?.tab?.url || "");
    analyzeActiveTab({ tabId, url, source: "content_overlay", forceRefresh: message.forceRefresh === true })
      .then((analysis) => sendResponse({ ok: true, analysis }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Analisis gagal." }));
    return true;
  }

  if (message?.type === "HEURISHIELD_OPEN_WARNING_PAGE") {
    const tabId = Number(_sender?.tab?.id || message.tabId);
    getAnalysisByTab(tabId)
      .then((analysis) => redirectToWarningPage(tabId, analysis))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Tidak dapat membuka halaman blokir." }));
    return true;
  }

  if (message?.type === "HEURISHIELD_OPEN_HISTORY_PAGE") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/history/history.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Tidak dapat membuka riwayat." }));
    return true;
  }

  if (message?.type === "HEURISHIELD_OPEN_OPTIONS_PAGE") {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Tidak dapat membuka pengaturan." }));
    return true;
  }

  if (message?.type === "HEURISHIELD_TOGGLE_ALLOWLIST" || message?.type === "HEURISHIELD_TOGGLE_BLOCKLIST") {
    toggleManualDomain(message, _sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Tidak dapat memperbarui daftar manual." }));
    return true;
  }

  if (message?.type === "TEMPORARY_BYPASS_URL") {
    const tabId = Number(message.tabId || _sender?.tab?.id);
    const url = String(message.url || "");
    if (tabId >= 0 && isHttpUrl(url)) {
      temporaryBypassByTab.set(tabId, {
        url: normalizeComparableUrl(url),
        expiresAt: Date.now() + 2 * 60 * 1000
      });
      sendResponse({ ok: true });
      return false;
    }
    sendResponse({ ok: false, error: "Bypass URL tidak valid." });
    return false;
  }

  sendResponse({ ok: false, error: "Unsupported V5 message." });
  return false;
});

async function toggleManualDomain(message, sender) {
  const url = String(message.url || sender?.tab?.url || "");
  const domain = safeUrl(url)?.hostname;
  if (!domain) throw new Error("Domain tidak valid.");

  if (message.type === "HEURISHIELD_TOGGLE_ALLOWLIST") {
    const allowlist = await getAllowlist();
    const listed = allowlist.includes(domain);
    if (listed) {
      await removeFromAllowlist(domain);
      return { domain, list: "allowlist", listed: false };
    }
    await addToAllowlist(domain);
    return { domain, list: "allowlist", listed: true };
  }

  const blacklist = await getBlacklist();
  const listed = blacklist.includes(domain);
  if (listed) {
    await removeFromBlacklist(domain);
    return { domain, list: "blocklist", listed: false };
  }
  await addToBlacklist(domain);
  return { domain, list: "blocklist", listed: true };
}

if (chrome.webNavigation?.onCompleted) {
  chrome.webNavigation.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0 || details.tabId < 0 || !isHttpUrl(details.url)) return;
      autoAnalyzeAndBlock(details.tabId, details.url).catch((error) => {
        console.warn("HeuriShield auto analysis failed:", error?.message || error);
      });
    },
    { url: [{ schemes: ["http", "https"] }] }
  );
}

async function analyzeActiveTab(message) {
  const tabId = Number(message.tabId);
  const url = String(message.url || "");
  // Refresh/panel pada block page mengembalikan snapshot situs, bukan DOM extension.
  const blocked = await warningAnalysisForTab(tabId);
  if (blocked) return blocked;
  const base = buildBaseAnalysis(url, tabId);

  if (!tabId || !isHttpUrl(url)) {
    return {
      ...base,
      dom_error: "Halaman ini tidak dapat dianalisis.",
      model_result: { ready: false, error: "Unsupported URL." }
    };
  }

  // Ambil fitur halaman sebelum keputusan dapat mengalihkan tab ke halaman blokir.
  const domSnapshot = await collectDomSnapshot(tabId, url);
  if (domSnapshot.url && !isHttpUrl(domSnapshot.url)) {
    const previous = await warningAnalysisForTab(tabId);
    if (previous) return previous;
    throw new Error("Halaman sudah berpindah; snapshot bukan situs HTTP/HTTPS.");
  }
  const finalUrl = domSnapshot.url || url;
  const resources = await getRuntimeResources();
  const runtime = await buildRuntimeFeatureAnalysis({
    originalUrl: url,
    finalUrl,
    redirectChain: url === finalUrl ? [] : [url, finalUrl],
    title: domSnapshot.title || "",
    domFeatures: domSnapshot.ok ? domSnapshot.domFeatures : null,
    httpStatusCode: getObservedHttpStatus(tabId, finalUrl),
    featureContract: resources.featureContract,
    rulefitEngine: resources.rulefitEngine,
    sensitiveKeywords: resources.sensitiveKeywords,
    rdapLookup: cachedRdapLookup,
    brandLookup: (query) => cachedBrandLookup(query, { forceRefresh: message.forceRefresh === true })
  });
  const coverage = runtime.feature_vector_coverage;
  const model = runtime.model_result;

  const analysis = {
    ...base,
    final_url: finalUrl,
    verdict: model.verdict,
    score: Math.round(model.probability_phishing * 100),
    url_score: Math.round(model.probability_phishing * 100),
    dom_score: domSnapshot.ok ? domScore(domSnapshot.domFeatures) : 0,
    evidence: buildEvidence(domSnapshot.domFeatures, runtime.rdap_features, runtime.brand_features),
    evidence_trace: [],
    matched_rules: buildMatchedRules(model),
    decision_checklist: {
      mode: "rulefit_model",
      compatibilityScore: coverage.coverage_percent
    },
    model_result: {
      ...model,
      targetLabel: model.predicted_label,
      feature_coverage: coverage,
      features: {
        provided_features: coverage.provided_features,
        missing_features: coverage.missing_features,
        coverage_percent: coverage.coverage_percent
      }
    },
    feature_vector_coverage: coverage,
    feature_vector: runtime.feature_vector,
    dom_features: domSnapshot.ok ? domSnapshot.domFeatures : null,
    rdap_features: runtime.rdap_features,
    brand_features: runtime.brand_features,
    url_features: runtime.url_features,
    page_status_features: runtime.page_status_features,
    dom_analysis: domSnapshot.ok ? domSnapshot.domAnalysis : null,
    dom_error: domSnapshot.ok ? null : domSnapshot.error
  };

  // Penjelasan ringkas untuk UI; fitur dan rule lengkap tetap tersimpan untuk audit.
  const blockedDuringAnalysis = await warningAnalysisForTab(tabId);
  if (blockedDuringAnalysis) return blockedDuringAnalysis;
  analysis.explanation = buildAnalysisExplanation(analysis);
  await saveAnalysisForTab(tabId, analysis);
  await saveUrlHistoryEntry(tabId, analysis);
  await saveFeatureJsonArchive(analysis);
  // Kegagalan pencatatan tidak boleh membatalkan keputusan proteksi halaman.
  datasetCollectorPromise.then(collector => collector.record(analysis)).catch(error => {
    console.warn("Pencatatan dataset gagal:", error.message);
  });
  return analysis;
}

function buildMatchedRules(model) {
  const guardRule = model?.post_model_guard ? [{
    id: model.post_model_guard.id || "POST_MODEL_GUARD",
    reason: model.post_model_guard.reason || "Post-model guard menaikkan risiko halaman.",
    source: "Brand impersonation guard",
    severity: model.post_model_guard.severity || "high",
    feature: model.post_model_guard.feature || "post_model_guard"
  }] : [];

  const ruleFitRules = (model?.fired_rules || []).slice(0, 6).map((rule) => ({
    id: `RULEFIT_${rule.id}`,
    reason: ruleToReason(rule),
    source: "RuleFit",
    severity: Math.abs(Number(rule.coefficient || 0)) >= 1 ? "medium" : "low",
    coefficient: rule.coefficient,
    direction: rule.direction,
    feature: rule.conditions?.[0]?.feature || "rulefit_rule"
  }));

  return [...guardRule, ...ruleFitRules];
}

async function autoAnalyzeAndBlock(tabId, url) {
  // Hormati status proteksi/daftar pengguna sebelum analisis dan pengalihan otomatis.
  if (!(await isProtectionEnabled())) return;
  if (consumeTemporaryBypass(tabId, url)) return;

  const parsed = safeUrl(url);
  const hostname = parsed?.hostname || "";
  if (!hostname) return;

  const allowlist = await getAllowlist();
  if (allowlist.includes(hostname)) return;

  const inFlightKey = `${tabId}:${normalizeComparableUrl(url)}`;
  if (autoAnalysisInFlight.has(inFlightKey)) return;

  autoAnalysisInFlight.add(inFlightKey);
  try {
    const blacklist = await getBlacklist();
    if (blacklist.includes(hostname)) {
      await redirectToWarningPage(tabId, {
        ...buildBaseAnalysis(url, tabId),
        verdict: "DANGEROUS",
        score: 100,
        matched_rules: [{
          id: "MANUAL_BLOCKLIST",
          reason: "Domain ada di daftar blokir manual.",
          source: "Manual blocklist",
          severity: "high"
        }]
      });
      return;
    }

    const analysis = await analyzeActiveTab({ tabId, url, source: "auto" });
    if (analysis?.verdict === "DANGEROUS") {
      await redirectToWarningPage(tabId, analysis);
      return;
    }

    await notifyTabAnalysis(tabId, analysis);
  } finally {
    autoAnalysisInFlight.delete(inFlightKey);
  }
}

async function notifyTabAnalysis(tabId, analysis) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "HEURISHIELD_ANALYSIS_UPDATED",
      analysis
    });
  } catch {
    // Content script may not be available on restricted pages.
  }
}

async function redirectToWarningPage(tabId, analysis) {
  // Simpan konteks sebelum redirect supaya alasan berasal dari situs, bukan halaman blokir.
  if (!analysis || consumeTemporaryBypass(tabId, analysis.final_url || analysis.url)) return;
  const targetUrl = analysis.final_url || analysis.normalized_url || analysis.url;
  if (!isHttpUrl(targetUrl)) return;
  // Hindari redirect kedua dari permintaan analisis paralel pada tab yang sama.
  if (await warningAnalysisForTab(tabId)) return;
  const contextId = `warn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await saveWarningContext(contextId, {
    analysis: { ...analysis, explanation: buildAnalysisExplanation(analysis) },
    explanation: buildAnalysisExplanation(analysis),
    originalUrl: targetUrl,
    sourceUrl: analysis.url || targetUrl,
    domain: safeUrl(targetUrl)?.hostname || "",
    registrable_domain: analysis.registrable_domain || "",
    verdict: analysis.verdict || "DANGEROUS",
    score: analysis.score ?? null,
    matched_rules: Array.isArray(analysis.matched_rules) ? analysis.matched_rules.slice(0, 8) : [],
    redirect_source_warning: analysis.redirect_source_warning || null,
    analyzer_version: analysis.analyzer_version || ANALYSIS_VERSION,
    document_id: analysis.document_id || null
  });

  const warningUrl = chrome.runtime.getURL(`src/warning/warning.html?id=${encodeURIComponent(contextId)}`);
  await chrome.tabs.update(tabId, { url: warningUrl });
}

async function warningAnalysisForTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return null; }
  const internal = chrome.runtime.getURL("src/warning/warning.html");
  if (!tab.url?.startsWith(internal)) return null;
  const id = new URL(tab.url).searchParams.get("id");
  const context = id ? await getWarningContext(id) : null;
  let prior = context?.analysis || await getAnalysisByTab(tabId);
  const target = context?.originalUrl || prior?.final_url || prior?.url;
  if (!isHttpUrl(target)) throw new Error("Hasil situs asal tidak tersedia. Block page tidak dianalisis ulang.");
  if (prior && normalizeComparableUrl(prior.final_url || prior.url) !== normalizeComparableUrl(target)) prior = null;
  return {
    ...(prior || {}),
    url: context?.sourceUrl || prior?.url || target,
    final_url: target,
    normalized_url: target,
    registrable_domain: prior?.url_features?.final_registrable_domain || safeUrl(target).hostname,
    hostname: safeUrl(target).hostname,
    verdict: context?.verdict || prior?.verdict || "LIMITED",
    explanation: prior ? buildAnalysisExplanation(prior) : context?.explanation,
    is_warning_snapshot: true
  };
}

function consumeTemporaryBypass(tabId, url) {
  const bypass = temporaryBypassByTab.get(Number(tabId));
  if (!bypass) return false;
  if (Date.now() > bypass.expiresAt) {
    temporaryBypassByTab.delete(Number(tabId));
    return false;
  }
  const matches = normalizeComparableUrl(url) === bypass.url;
  if (matches) temporaryBypassByTab.delete(Number(tabId));
  return matches;
}

async function collectDomSnapshot(tabId, finalUrl) {
  try {
    let response = await requestDomSnapshot(tabId, finalUrl);
    if (!response?.ok) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content/page-dom-snapshot.js"]
      });
      response = await requestDomSnapshot(tabId, finalUrl);
    }

    if (!response?.ok) {
      return { ok: false, error: response?.error || "Content script tidak mengembalikan DOM." };
    }

    return {
      ok: true,
      url: response.url,
      title: response.title,
      domFeatures: response.domFeatures,
      domAnalysis: response.domAnalysis
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Tidak dapat membaca DOM halaman."
    };
  }
}

async function requestDomSnapshot(tabId, finalUrl) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "HEURISHIELD_V5_COLLECT_DOM",
      finalUrl
    });
  } catch {
    return null;
  }
}

function buildBaseAnalysis(url, tabId) {
  const parsed = safeUrl(url);
  const hostname = parsed?.hostname || "";
  const registrable = hostname.replace(/^www\./i, "");

  return {
    analyzer_version: ANALYSIS_VERSION,
    document_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tab_id: tabId || null,
    url,
    original_url: url,
    final_url: url,
    normalized_url: url,
    hostname,
    registrable_domain: registrable,
    verdict: "LIMITED",
    score: 0
  };
}

async function getRuntimeResources() {
  // Hanya dua JSON 60 fitur ini yang dimuat untuk klasifikasi; fixture tes tidak dimuat.
  if (!runtimeResourcesPromise) {
    runtimeResourcesPromise = Promise.all([
      fetchJson("src/rule/feature-contract-60.json"),
      fetchJson("src/rule/rulefit-engine-60.json"),
      fetchJson("src/analyzer/sensitive-url-keywords.json")
    ]).then(([featureContract, rulefitEngine, sensitiveConfig]) => ({
      featureContract,
      rulefitEngine,
      sensitiveKeywords: flattenSensitiveKeywordConfig(sensitiveConfig)
    }));
  }
  return runtimeResourcesPromise;
}

async function fetchJson(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`Gagal membaca ${path}`);
  return response.json();
}

function buildEvidence(domFeatures, rdapFeatures, brandFeatures) {
  const evidence = [];
  if (domFeatures) {
    evidence.push(
    {
      evidence_id: "D16",
      observation_id: "dom_credential_labels",
      dependency_group: "dom",
      source: "DOM credential fields",
      status: "observed",
      raw_value: {
        password_like_label_count: domFeatures.password_credential_field_count || domFeatures.password_input_count || 0,
        identity_like_label_count: domFeatures.identity_personal_field_count || domFeatures.email_credential_field_count || 0,
        sensitive_form_count: domFeatures.credential_form_count || 0,
        credential_form_count: domFeatures.credential_form_count || 0
      },
      explanation: "Input kredensial dan label sensitif dibaca langsung dari DOM halaman."
    },
    {
      evidence_id: "D18",
      observation_id: "dom_credential_forms",
      dependency_group: "dom",
      source: "DOM forms",
      status: "observed",
      raw_value: {
        credential_form_count: domFeatures.credential_form_count || 0,
        sensitive_form_count: domFeatures.credential_form_count || 0,
        no_clear_page_identity: false,
        visible_brand_hints: []
      },
      explanation: "Jumlah form kredensial dihitung dari input password, email, OTP, PIN, payment, dan identitas."
    }
    );
  }

  evidence.push({
    evidence_id: "U18",
    observation_id: "domain_age_rdap",
    dependency_group: "domain_metadata",
    source: "RDAP/WHOIS",
    status: rdapFeatures?.final_rdap_available || rdapFeatures?.original_rdap_available ? "observed" : "unavailable",
    raw_value: {
      source_domain_age_days: rdapFeatures?.source_domain_age_days ?? null,
      page_domain_age_days: rdapFeatures?.page_domain_age_days ?? null,
      original_rdap_available: rdapFeatures?.original_rdap_available ?? null,
      final_rdap_available: rdapFeatures?.final_rdap_available ?? null
    },
    explanation: "Umur domain dan metadata registrasi dibaca melalui RDAP/WHOIS seperti pipeline crawler."
  });

  evidence.push({
    evidence_id: "B01",
    observation_id: "brand_candidate",
    dependency_group: "brand",
    source: "Brand lookup",
    status: brandFeatures?.brand_found ? "observed" : "unavailable",
    raw_value: {
      brand_found: brandFeatures?.brand_found ?? false,
      brand_top_candidate_domain: brandFeatures?.brand_top_candidate_domain ?? null,
      brand_search_score: brandFeatures?.brand_search_score ?? null,
      brand_quality_score: brandFeatures?.brand_quality_score ?? null
    },
    explanation: "Kandidat brand dicari melalui Clearbit terlebih dahulu, lalu Brandfetch untuk skor domain yang sama atau fallback."
  });

  return evidence;
}

function domScore(features) {
  if (!features) return 0;
  return Math.min(100, Math.round(
    (features.credential_form_count || 0) * 22 +
    (features.external_credential_form_count || 0) * 18 +
    (features.ip_credential_form_count || 0) * 18 +
    (features.eval_count || 0) * 4 +
    (features.external_resource_ratio || 0) * 20
  ));
}

function isHttpUrl(url) {
  const parsed = safeUrl(url);
  return parsed?.protocol === "http:" || parsed?.protocol === "https:";
}

function safeUrl(url) {
  try {
    return new URL(String(url || ""));
  } catch {
    return null;
  }
}

function formatThreshold(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4).replace(/\.?0+$/, "") : String(value);
}

async function cachedRdapLookup(domain) {
  // Versi provider menghindari pemakaian cache RDAP lama setelah pergantian prioritas.
  const key = `rdap:age-fallback-v4:${String(domain || "").toLowerCase()}`;
  if (!key || key.endsWith(":")) return lookupRdapDomain(domain);
  const cache = await getMetadataCache();
  const cached = cache[key];
  if (
    cached?.metadata?.rdap_available === true &&
    cached?.cached_at &&
    Date.now() - Date.parse(cached.cached_at) < METADATA_CACHE_TTL_MS
  ) {
    return cached.metadata;
  }

  const metadata = await lookupRdapDomain(domain);
  if (metadata?.rdap_available === true || metadata?.rdap_skip_reason) {
    await updateMetadataCache((current) => {
      current[key] = { metadata, cached_at: new Date().toISOString() };
    });
  } else if (cached) {
    await updateMetadataCache((current) => { delete current[key]; });
  }
  return metadata;
}

function updateMetadataCache(mutate) {
  const task = metadataCacheWrites.then(async () => {
    const cache = await getMetadataCache();
    mutate(cache);
    await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_METADATA_CACHE]: cache });
  });
  metadataCacheWrites = task.catch(() => {});
  return task;
}

async function getMetadataCache() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.DOMAIN_METADATA_CACHE]: {} });
  return result[STORAGE_KEYS.DOMAIN_METADATA_CACHE] || {};
}

async function clearStaleRuntimeState() {
  await updateMetadataCache((cache) => {
    for (const key of Object.keys(cache)) {
      if (key.startsWith("brand:")) delete cache[key];
    }
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: {} });
}

async function ensureRuntimeStateVersion() {
  const current = await chrome.storage.local.get({ [STORAGE_KEYS.RUNTIME_STATE_VERSION]: null });
  if (current[STORAGE_KEYS.RUNTIME_STATE_VERSION] === ANALYSIS_VERSION) return;
  await clearStaleRuntimeState();
  await chrome.storage.local.set({ [STORAGE_KEYS.RUNTIME_STATE_VERSION]: ANALYSIS_VERSION });
}

function getObservedHttpStatus(tabId, finalUrl) {
  const observed = httpStatusByTab.get(Number(tabId));
  if (!observed) return null;
  if (Date.now() - observed.observedAt > 5 * 60 * 1000) return null;
  if (finalUrl && observed.url && normalizeComparableUrl(finalUrl) !== normalizeComparableUrl(observed.url)) return null;
  return Number.isInteger(observed.statusCode) ? observed.statusCode : null;
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url || "");
  }
}

async function saveFeatureJsonArchive(analysis) {
  // Arsip mentah untuk audit/debug berbeda dari tiga alasan ringkas yang terlihat di UI.
  if (!analysis?.feature_vector?.vector) return;

  const observedAt = new Date().toISOString();
  const archive = {
    archive_version: "heurishield-v5-feature-json-v1",
    observed_at: observedAt,
    analyzer_version: analysis.analyzer_version,
    document_id: analysis.document_id,
    tab_id: analysis.tab_id,
    url: analysis.url,
    original_url: analysis.original_url,
    final_url: analysis.final_url,
    normalized_url: analysis.normalized_url,
    hostname: analysis.hostname,
    registrable_domain: analysis.registrable_domain,
    verdict: analysis.verdict,
    score: analysis.score,
    model_result: compactModelResult(analysis.model_result),
    feature_vector_coverage: analysis.feature_vector_coverage,
    feature_vector_30: analysis.feature_vector.vector,
    feature_vector_values: analysis.feature_vector.values,
    feature_sources: {
      url: analysis.url_features || null,
      dom: analysis.dom_features || null,
      rdap: analysis.rdap_features || null,
      brand: analysis.brand_features || null,
      status: analysis.page_status_features || null
    }
  };

  try {
    const result = await chrome.storage.local.get({ [STORAGE_KEYS.FEATURE_ARCHIVE]: [] });
    const archives = Array.isArray(result[STORAGE_KEYS.FEATURE_ARCHIVE])
      ? result[STORAGE_KEYS.FEATURE_ARCHIVE]
      : [];
    archives.unshift({
      id: `${fileTimestamp(observedAt)}_${safeFilePart(analysis.hostname || "unknown")}_${safeFilePart(analysis.document_id || "analysis")}`,
      path_hint: `riwayat/json/${fileTimestamp(observedAt)}_${safeFilePart(analysis.hostname || "unknown")}_${safeFilePart(analysis.document_id || "analysis")}.json`,
      ...archive
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_ARCHIVE]: archives.slice(0, 500) });
  } catch (error) {
    console.warn("HeuriShield feature archive storage failed:", error?.message || error);
  }
}

function compactModelResult(model) {
  if (!model || typeof model !== "object") return null;
  return {
    predicted_label: model.predicted_label || model.targetLabel || null,
    verdict: model.verdict || null,
    probability_phishing: model.probability_phishing ?? null,
    fired_rule_count: model.fired_rule_count ?? null,
    top_fired_rules: Array.isArray(model.fired_rules)
      ? model.fired_rules.slice(0, 6).map((rule) => ({
          id: rule.id,
          coefficient: rule.coefficient,
          direction: rule.direction,
          expression: rule.expression
        }))
      : [],
    feature_coverage: model.feature_coverage || model.features || null
  };
}

function ruleToReason(rule) {
  const prefix = rule.direction === "phishing" ? "RuleFit risiko" : "RuleFit aman";
  const conditions = (rule.conditions || [])
    .slice(0, 3)
    .map((condition) => `${condition.feature} ${condition.operator} ${formatThreshold(condition.threshold)}`)
    .join("; ");
  return conditions ? `${prefix}: ${conditions}` : `${prefix}: ${rule.expression || rule.id}`;
}

function fileTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function safeFilePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}
