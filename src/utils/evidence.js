/*
 * Utilitas representasi evidence dan penjelasan terstruktur untuk kompatibilitas.
 * Keputusan RuleFit aktif dihitung evaluator di src/rule, bukan dari jumlah evidence.
 */
export const EVIDENCE_VERSION = "1.0.0";
const STATUSES = new Set(["observed", "unavailable", "invalid", "not_applicable", "not_evaluated"]);

export function evidenceRecord(id, source, value, {
  status = "observed", entity = "page", group = id, explanation,
  observedAt = new Date().toISOString(), context = {}
} = {}) {
  if (!STATUSES.has(status) || !explanation) throw new Error("Invalid evidence definition");
  return {
    evidence_id: id, observation_id: `${id}:${entity}`, spec_version: EVIDENCE_VERSION,
    source, entity_id: entity, status, raw_value: status === "observed" ? value : null,
    dependency_group: group, observed_at: observedAt, context, explanation,
    provenance: { extractor_version: EVIDENCE_VERSION }
  };
}

// These relationships describe the current rules, not independent DS inputs.
const RULE_INPUTS = {
  HOST_IS_IP: ["U01"], PUNYCODE_OR_UNICODE: ["U19"], SHORTENER_DOMAIN: ["U15"],
  RANDOM_DOMAIN_LABEL: ["U25"], RANDOM_DOMAIN_CREDENTIAL_FORM: ["U18", "U25", "D16", "D18"],
  UNKNOWN_IDENTITY_CREDENTIAL_FORM: ["D16", "D18"],
  HOSTED_PLATFORM_AUTH_TENANT: ["U24"], HOSTED_PLATFORM_BRANDLIKE_TENANT: ["U24"],
  HOSTED_PLATFORM_BRANDLIKE_AUTH_PATH: ["U24"], HOSTED_PLATFORM_AUTH_BRANDLIKE_COMBO: ["U24"],
  PUBLIC_HOSTING_BRAND_TENANT_COMBO: ["U24"], PUBLIC_HOSTING_BRAND_INTENT_COMBO: ["U24"],
  PUBLIC_HOSTING_BRAND_DOWNLOAD_COMBO: ["U24"],
  DOMAIN_AGE_7_DAYS: ["U18"], DOMAIN_AGE_30_DAYS: ["U18"], DOMAIN_AGE_90_DAYS: ["U18"],
  EMBEDDED_URL_IN_QUERY: ["U22"], REDIRECT_PARAM: ["U22"],
  OBFUSCATED_QUERY: ["U12"], RANDOM_QUERY_TOKEN: ["U12"], ROOT_PATH_WITH_LONG_QUERY: ["U12"],
  RANDOM_PATH_TOKEN: ["U20"], SHORT_PREFIX_TOKEN_PATH: ["U20"], LOW_INFORMATION_TOKEN_PATH: ["U20"],
  ARCHIVE_FILE: ["U21"], EXECUTABLE_FILE: ["U21"], REDIRECT_WITH_EMBEDDED_URL: ["U22"],
  NEW_DOMAIN_WITH_OBFUSCATED_QUERY: ["U18", "U12"],
  NEW_DOMAIN_WITH_RANDOM_PATH_TOKEN: ["U18", "U20"], NEW_DOMAIN_WITH_SUSPICIOUS_FILE: ["U18", "U21"],
  OAUTH_OIDC_STANDARD_FLOW: ["U23"], OAUTH_TRUSTED_PROVIDER_FLOW: ["U23"],
  OAUTH_OIDC_TRUSTED_PROVIDER_REDIRECT: ["U23"], OAUTH_OIDC_SAME_SITE_REDIRECT: ["U23"],
  SHORTENER_TO_RISKY_FINAL_URL: ["U17", "U18", "U20", "U21"],
  FAST_CROSS_DOMAIN_REDIRECT: ["U17", "U18", "U20", "U21"],
  SHORTENER_TO_RANDOM_PATH_TOKEN: ["U17", "U20"], REDIRECT_TO_NEW_DOMAIN: ["U17", "U18"],
  REDIRECT_CHAIN: ["U17", "U23"],
  SENSITIVE_FORM_CROSS_SITE: ["D01", "D02"], PASSWORD_FORM_CROSS_SITE: ["D01", "D02"],
  OTP_PIN_FORM_CROSS_SITE: ["D01", "D02"], PAYMENT_FORM_CROSS_SITE: ["D01", "D02"],
  SENSITIVE_FORM_TO_IP: ["D01", "D03"], CREDENTIAL_FORM_TO_IP: ["D01", "D03"],
  SENSITIVE_FORM_TO_SHORTENER: ["D01", "D04"], CREDENTIAL_FORM_TO_SHORTENER: ["D01", "D04"],
  SENSITIVE_FORM_REDIRECT_PARAM: ["D01", "D06"], CREDENTIAL_FORM_REDIRECT_PARAM: ["D01", "D06"],
  SENSITIVE_FORM_EMBEDDED_URL: ["D01", "D06"], CREDENTIAL_FORM_EMBEDDED_URL: ["D01", "D06"],
  EXECUTABLE_DOWNLOAD_LINK: ["D07"], ARCHIVE_DOWNLOAD_LINK: ["D07"],
  CROSS_SITE_SHORTENER_LINK: ["D08"], LINK_TO_IP_ADDRESS: ["D08"], EXTERNAL_HTTP_LINK: ["D08"],
  CROSS_SITE_IFRAME: ["D09"], HIDDEN_CROSS_SITE_IFRAME: ["D09"], IFRAME_TO_IP_ADDRESS: ["D09"],
  HIDDEN_SENSITIVE_FORM: ["D10", "D11"], TRUSTED_MEDIA_EMBED_IFRAME: ["D09", "D11"],
  BRAND_LOGIN_GATE_ON_UNRELATED_DOMAIN: ["D14"],
  CREDENTIAL_FORM_BRAND_TEXT_UNRELATED_DOMAIN: ["D01", "D14", "D17"],
  HOSTED_PLATFORM_VISIBLE_BRAND_CREDENTIAL_FORM: ["D01", "D16", "D17"],
  HOSTED_PLATFORM_VISIBLE_BRAND_PAGE: ["D14", "D17"],
  SENSITIVE_FORM_SCRIPT_EXTERNAL_ENDPOINT: ["D01", "D15"],
  CREDENTIAL_FORM_SCRIPT_HIGH_RISK_ENDPOINT: ["D01", "D15"],
  PASSWORD_PAGE_CANONICAL_DOMAIN_MISMATCH: ["D01", "D14"],
  PASSWORD_PAGE_CLAIMED_DOMAIN_MISMATCH: ["D01", "D14"],
  BRAND_IN_SUBDOMAIN_UNRELATED_DOMAIN: ["B01", "B02", "B03", "B07"],
  BRAND_LOGIN_ON_UNRELATED_DOMAIN: ["B01", "B02", "B03", "B07"],
  BRAND_LOGIN_CLONE_PATH_ON_UNRELATED_DOMAIN: ["B01", "B02", "B03", "B07"],
  BRAND_IN_URL_UNRELATED_DOMAIN: ["B01", "B02", "B03", "B07"],
  BRAND_IN_PATH_UNRELATED_DOMAIN: ["B01", "B02", "B03"],
  BRAND_IN_QUERY_UNRELATED_DOMAIN: ["B01", "B02", "B03"],
  NEW_DOMAIN_WITH_BRAND_IMPERSONATION: ["B03", "U18"],
  OFFICIAL_BRAND_DOMAIN_MATCH: ["B02", "B03"], OAUTH_BRAND_REDIRECT_DOMAIN_MATCH: ["B02", "B03"],
  OFFICIAL_AUTH_DOMAIN_CONTEXT: ["B01"],
  TRUSTED_TENANT_PLATFORM_BRAND_CONTEXT: ["B01", "B02", "B03", "U24"]
};

export function linkRuleEvidence(rules, evidence) {
  return rules.map(rule => {
    const id = rule.id.replace(/_SUPPRESSED$/, "");
    const ids = [...(RULE_INPUTS[id] || [])];
    if (rule.id.endsWith("_SUPPRESSED")) ids.push(id.includes("FORM") || id.includes("IFRAME") ? "D11" : "U23");
    const formEntity = rule.evidence?.formIndex;
    const refs = evidence.filter(e => ids.includes(e.evidence_id) &&
      (formEntity === undefined || e.entity_id === "page" || e.entity_id === `form-${formEntity}`))
      .map(e => e.observation_id);
    return { ...rule, evidence_refs: refs };
  });
}

export function domainAgeEvidence(age, available, options = {}) {
  const status = options.notApplicable ? "not_applicable" : !available ? "unavailable" :
    Number.isFinite(age) && age >= 0 ? "observed" : "invalid";
  return evidenceRecord("U18", "DOMAIN_METADATA", age, {
    ...options, status, group: "domain_age", explanation: "Umur domain dalam hari pada waktu pengamatan; bukan skor phishing."
  });
}

export function buildUrlEvidence(features, parsed, metadata, redirect, redirectObserved, observedAt) {
  const result = [];
  const add = (id, value, group, explanation, status = "observed", context = {}) =>
    result.push(evidenceRecord(id, "URL", value, { group, explanation, status, context, observedAt }));
  const { url_structure: u, domain_structure: d, query_features: q, path_features: p, hosted_platform: h } = features;
  add("U01", d.host_is_ip, "domain_structure", "Host hasil parsing berupa alamat IP.");
  add("U02", u.url_length, "url_complexity", "Panjang parsed.href JavaScript, termasuk normalisasi URL.", "observed", { unit: "UTF-16 code units" });
  add("U03", d.hostname_length, "domain_structure", "Panjang hostname yang dinormalisasi parser; tidak termasuk port.");
  add("U04", d.subdomain_count, "domain_structure", "Jumlah label di depan registrable domain menurut parser lokal; alamat IP bernilai nol.");
  add("U06", u.hyphen_count, "url_complexity", "Jumlah tanda hubung pada parsed.href.");
  add("U07", u.dot_count, "url_complexity", "Jumlah titik pada parsed.href.");
  add("U08", { count: u.digit_count, ratio: u.digit_ratio }, "url_complexity", "Jumlah digit ASCII dan rasionya terhadap panjang parsed.href.");
  add("U09", { count: u.special_count, ratio: u.special_ratio }, "url_complexity", "Karakter selain huruf dan digit ASCII pada parsed.href, termasuk pemisah URL.");
  add("U11", u.percent_encoded_count, "url_complexity", "Jumlah triplet %HH yang valid pada parsed.href; tanpa decoding berulang.");
  add("U13", q.query_param_count, "url_complexity", "Jumlah pasangan parameter query, termasuk nama yang berulang dan nilai kosong.");
  add("U05", parsed.tld, "domain_structure", "Label terakhir hostname menurut parser saat ini.");
  add("U10", { at_count: u.qty_at_url, has_userinfo: Boolean(parsed.parsed.username || parsed.parsed.password) }, "url_complexity", "Jumlah @ pada parsed.href; userinfo diperiksa terpisah tanpa menyimpan nilainya.");
  add("U12", q, "url_complexity", "Indikator panjang/entropi query dan konteks tracking; tidak memuat nilai parameter.");
  add("U14", u.email_in_url, "url_complexity", "Regex ekstraktor menemukan pola email dalam URL.");
  add("U15", d.is_shortener, "redirect", "Domain cocok dengan daftar shortener lokal.");
  add("U16", parsed.parsed.protocol === "https:", "transport", "URL menggunakan skema HTTPS, tanpa verifikasi sertifikat.");
  add("U17", redirectObserved ? {
    hop_count: redirect.hop_count, original_domain: redirect.original_domain,
    final_domain: redirect.final_domain, original_is_shortener: redirect.original_is_shortener,
    cross_domain_redirect: redirect.cross_domain_redirect, fast_redirect: redirect.fast_redirect
  } : null, "redirect", "Navigasi yang diamati browser; tanpa konteks navigasi hasil tidak tersedia.", redirectObserved ? "observed" : "unavailable");
  result.push(domainAgeEvidence(metadata.domainAgeDays, metadata.available, {
    observedAt, notApplicable: parsed.hostIsIp,
    context: { provider: metadata.source || "unknown", cached: metadata.cached ?? null,
      fetched_at: metadata.fetched_at || null }
  }));
  add("U19", d.has_punycode_or_unicode, "domain_structure", "Hostname memuat punycode atau karakter non-ASCII; bukan pembuktian impersonasi.");
  add("U20", { has_random_path_token: p.has_random_path_token,
    has_short_prefix_token_path: p.has_short_prefix_token_path, low_information_path: p.low_information_path,
    token_length: p.random_path_token?.length || 0 }, "url_complexity", "Pola token path dihitung oleh ekstraktor; isi token tidak disalin.");
  add("U21", p.suspicious_file_extension || { category: "none", extension: null }, "download", "Kecocokan ekstensi file path terhadap daftar executable/archive.");
  add("U22", { redirect_param: q.has_redirect_param, embedded_url: q.embedded_url_in_query }, "redirect", "Indikator redirect dan URL tertanam dari query yang sama.");
  add("U23", features.legitimate_context, "auth_context", "Konteks OAuth/tracking menurut heuristik lokal; tidak membuktikan situs aman.");
  add("U24", h || null, "hosting_context", "Konteks platform hosting publik atau tenant.");
  add("U25", {
    label_length: d.domain_label_length || 0,
    entropy: d.domain_label_entropy || 0,
    vowel_ratio: d.domain_label_vowel_ratio || 0,
    longest_consonant_run: d.domain_label_consonant_run || 0,
    random_domain_label: Boolean(d.random_domain_label)
  }, "domain_lexical", "Pola leksikal label domain: keacakan, rasio vokal, dan run konsonan; bukan reputasi eksternal.");
  return result;
}

export function buildDomEvidence({
  forms,
  linkFeatures,
  iframeFeatures,
  hiddenFeatures,
  textFeatures,
  scriptFeatures,
  ruleContext,
  submit = false,
  observedAt
}) {
  const result = [];
  const add = (id, value, group, explanation, status = "observed", entity = "page") =>
    result.push(evidenceRecord(id, "DOM", value, { group, explanation, status, entity, observedAt,
      context: { stage: submit ? "submit" : "page" } }));
  if (!forms.length) {
    for (const id of ["D01", "D02", "D03", "D04", "D05", "D06"])
      add(id, null, "form_destination", "Tidak ada form pada snapshot yang diperiksa.", "not_applicable");
  }
  for (const form of forms) {
    const entity = `form-${form.index}`;
    const d = form.destinationFeatures;
    let validAction = false;
    try { validAction = ["https:", "http:"].includes(new URL(form.resolvedAction).protocol); } catch {}
    const status = !form.hasSensitiveInput ? "not_applicable" : validAction ? "observed" : "invalid";
    add("D01", { password: form.hasPasswordInput, otp_pin: form.hasOtpOrPinInput,
      payment: form.hasPaymentInput, identity: form.hasEmailOrUsernameInput, sensitive: form.hasSensitiveInput },
    "form_destination", "Jenis input berdasarkan metadata; tidak membaca nilai input.", "observed", entity);
    add("D02", { cross_site: d.crossSiteAction, page_domain: d.pageRegistrableDomain,
      action_domain: d.actionRegistrableDomain }, "form_destination", "Perbandingan domain halaman dan action pada form yang sama.", status, entity);
    add("D03", d.actionToIp, "form_destination", "Tujuan form sensitif berupa alamat IP.", status, entity);
    add("D04", d.actionToShortener, "form_destination", "Tujuan form sensitif cocok daftar shortener.", status, entity);
    add("D05", !d.actionIsHttps, "form_destination", "Action HTTP pada form sensitif; belum memiliki rule scoring HTTP khusus.", status, entity);
    add("D06", { redirect_param: d.actionHasRedirectParam, embedded_url: d.actionHasEmbeddedUrl },
      "form_destination", "Pola query action form, tanpa nilai query mentah.", status, entity);
  }
  add("D07", linkFeatures ? { executable: linkFeatures.executableDownloadLinks, archive: linkFeatures.archiveDownloadLinks } : null,
    "links", "Jumlah link executable/archive.", submit ? "not_evaluated" : "observed");
  add("D08", linkFeatures ? { http_external: linkFeatures.httpExternalLinks, ip: linkFeatures.ipLinks, shortener: linkFeatures.shortenerLinks } : null,
    "links", "Jumlah link eksternal berdasarkan jenis tujuan.", submit ? "not_evaluated" : "observed");
  add("D09", iframeFeatures, "iframes", "Jumlah iframe berdasarkan domain, IP, dan visibilitas.", submit ? "not_evaluated" : "observed");
  add("D10", hiddenFeatures, "form_destination", "Jumlah form sensitif tersembunyi pada snapshot DOM.", submit ? "not_evaluated" : "observed");
  add("D11", { auth: ruleContext?.auth || null, trusted_media_embeds: iframeFeatures?.trustedMediaEmbedIframeCount ?? null },
    "auth_context", "Konteks autentikasi yang digunakan aturan dan jumlah media embed tepercaya; bukan jaminan legitimate.");
  add("D12", textFeatures ? {
    text_length: textFeatures.textLength || 0,
    matched_hint_groups: textFeatures.matchedTextHints || [],
    credential_text: Boolean(textFeatures.hasCredentialText),
    payment_text: Boolean(textFeatures.hasPaymentText),
    urgency_text: Boolean(textFeatures.hasUrgencyText),
    recovery_text: Boolean(textFeatures.hasRecoveryText),
    manipulative_text: Boolean(textFeatures.hasManipulativeText)
  } : null, "page_text", "Ringkasan pola teks halaman; tidak menyimpan isi teks mentah.", submit ? "not_evaluated" : "observed");
  add("D13", submit ? { form_index: forms[0]?.index, method: forms[0]?.method } : null,
    "form_destination", "Pemeriksaan action efektif ketika submit; memperbarui bukti form, bukan sumber independen.", submit ? "observed" : "not_evaluated");
  const credentialSummary = summarizeCredentialLabelEvidence(forms);
  add("D14", { page_domain: ruleContext?.page_identity?.page_domain || null,
    canonical_domain: ruleContext?.page_identity?.canonical_domain || null,
    claimed_domains: ruleContext?.page_identity?.claimed_domains || [],
    mismatch: Boolean(ruleContext?.page_identity?.mismatch),
    login_gate: ruleContext?.page_identity?.login_gate || null,
    visible_brand_hints: ruleContext?.page_identity?.visible_brand_hints || [],
    credential_form_count: credentialSummary.credential_form_count,
    sensitive_form_count: credentialSummary.sensitive_form_count },
    "page_identity", "Canonical dan metadata domain halaman dibandingkan dengan domain aktif; tidak membaca nilai input.");
  add("D16", credentialSummary, "credential_semantics", "Ringkasan label dan metadata input untuk mendeteksi form kredensial tersamar tanpa membaca nilai input.");
  add("D17", {
    hosted_platform: ruleContext?.page_identity?.hosted_platform || null,
    visible_brand_hints: ruleContext?.page_identity?.visible_brand_hints || [],
    visible_brand_credential_form: Boolean(ruleContext?.page_identity?.visible_brand_credential_form),
    page_domain: ruleContext?.page_identity?.page_domain || null
  }, "page_identity", "Konteks brand yang terlihat pada halaman dan hubungannya dengan form kredensial serta platform hosting.");
  add("D18", {
    credential_form_count: credentialSummary.credential_form_count,
    sensitive_form_count: credentialSummary.sensitive_form_count,
    has_visible_brand: Boolean((ruleContext?.page_identity?.visible_brand_hints || []).length),
    has_claimed_domain: Boolean(ruleContext?.page_identity?.canonical_domain || (ruleContext?.page_identity?.claimed_domains || []).length),
    no_clear_page_identity: Boolean(ruleContext?.page_identity?.unknown_credential_page)
  }, "page_identity", "Form kredensial/pembayaran pada halaman tanpa identitas organisasi yang jelas; tidak membaca nilai input.");
  add("D15", scriptFeatures ? {
    external_request_endpoint_count: scriptFeatures.externalRequestEndpointCount,
    high_risk_request_endpoint_count: scriptFeatures.highRiskRequestEndpointCount,
    sensitive_form_count: credentialSummary.sensitive_form_count,
    credential_form_count: credentialSummary.credential_form_count,
    endpoints: (scriptFeatures.endpoints || []).map(endpoint => ({
      source: endpoint.source,
      request_context: endpoint.requestContext,
      hostname: endpoint.hostname,
      registrable_domain: endpoint.registrableDomain,
      external: endpoint.isExternal,
      high_risk_service: endpoint.isHighRiskService,
      https: endpoint.isHttps
    }))
  } : null, "script_endpoints", "Endpoint URL yang tampak di script halaman; hanya metadata domain, bukan nilai form.",
    submit ? "not_evaluated" : "observed");
  return result;
}

function summarizeCredentialLabelEvidence(forms = []) {
  const inputs = forms.flatMap((form) => form.inputs || []);
  const semanticHints = inputs.map((input) => input.semanticLabelHints).filter(Boolean);
  return {
    password_like_label_count: semanticHints.filter((hint) => hint.password_like_label).length,
    identity_like_label_count: semanticHints.filter((hint) => hint.identity_like_label).length,
    payment_like_label_count: semanticHints.filter((hint) => hint.payment_like_label).length,
    sensitive_form_count: forms.filter((form) => form.hasSensitiveInput).length,
    credential_form_count: forms.filter((form) => form.hasPasswordInput || form.hasOtpOrPinInput || form.hasPaymentInput || (form.hasEmailOrUsernameInput && form.hasSubmitButton)).length
  };
}

export function attachEvidence(result, evidence, matchedKey = "matchedRules", suppressedKey = "suppressedRules") {
  result.evidence_version = EVIDENCE_VERSION;
  result.evidence = evidence;
  result[matchedKey] = linkRuleEvidence(result[matchedKey] || [], evidence);
  result[suppressedKey] = linkRuleEvidence(result[suppressedKey] || [], evidence);
  result.evidence_trace = [...result[matchedKey].map(rule => ({ ...rule, disposition: "matched" })),
    ...result[suppressedKey].map(rule => ({ ...rule, disposition: "suppressed" }))];
  return result;
}

