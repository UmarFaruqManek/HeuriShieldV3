/*
 * Membaca struktur HTML/DOM, menghitung resource/link dan mengenali form kredensial.
 * Pemeriksaan hanya mewakili snapshot saat dibaca, bukan seluruh perilaku situs.
 */
import { parse as parseDomain } from "../../shared/tldts.js";

export const DOM_FEATURE_VERSION = "crawler-dom-parity-v1";
// Fitur berasal dari snapshot DOM saat analisis, bukan jaminan seluruh perilaku situs.
// Kata kunci mengenali jenis field; tujuan action form diperiksa secara terpisah.

export const DEFAULT_CREDENTIAL_KEYWORDS = {
  username: ["user", "username", "userid", "login", "account", "member", "customer"],
  email: ["email", "e-mail", "mail"],
  password: ["password", "passwd", "passcode", "pwd", "kata sandi"],
  otp_mfa: ["otp", "mfa", "2fa", "verification code", "security code", "one time", "kode verifikasi"],
  pin: ["pin", "mpin"],
  payment_card: ["card", "credit", "debit", "cc", "cvv", "cvc", "expiry", "expiration", "cardnumber"],
  identity_personal: ["identity", "id number", "ssn", "passport", "ktp", "nik", "dob", "birth"]
};

const COUNT_FIELDS = {
  username: "username_field_count",
  email: "email_credential_field_count",
  password: "password_credential_field_count",
  otp_mfa: "otp_mfa_field_count",
  pin: "pin_field_count",
  payment_card: "payment_card_field_count",
  identity_personal: "identity_personal_field_count"
};

const INPUT_TYPES = new Set([
  "text",
  "email",
  "password",
  "tel",
  "number",
  "hidden",
  "search",
  "url"
]);

// Titik masuk: kumpulkan ukuran dokumen lalu tambahkan fitur tiap kelompok elemen.
export function extractDomFeaturesFromDocument(doc, finalUrl, options = {}) {
  if (!doc || typeof doc.querySelectorAll !== "function") {
    throw new TypeError("extractDomFeaturesFromDocument membutuhkan objek document/DOM yang valid.");
  }

  const baseUrl = String(finalUrl || doc.location?.href || "");
  const pageDomain = registrableDomainFromUrl(baseUrl);
  const baseHref = firstAttribute(doc, "base[href]", "href");
  const effectiveBaseUrl = safeResolveUrl(baseUrl, baseHref) || baseUrl;
  const html = typeof options.html === "string" ? options.html : getOuterHtml(doc);
  const visibleText = getVisibleText(doc);
  const keywordConfig = mergeCredentialKeywords(options.credentialKeywords);

  const result = {
    analyzer_version: DOM_FEATURE_VERSION,
    page_title: textContent(doc.querySelector?.("title")),
    meta_description: firstAttribute(doc, "meta[name='description'], meta[property='og:description']", "content"),
    html_length: html.length,
    dom_node_count: queryAll(doc, "*").length,
    visible_text_length: visibleText.length,
    ...zeroCredentialCounts()
  };

  addInputFeatures(result, doc, keywordConfig);
  addFormFeatures(result, doc, effectiveBaseUrl, pageDomain, keywordConfig);
  addIframeFeatures(result, doc, effectiveBaseUrl, pageDomain);
  addAnchorFeatures(result, doc, effectiveBaseUrl, pageDomain);
  addImageFeatures(result, doc, effectiveBaseUrl, pageDomain);
  addScriptFeatures(result, doc, effectiveBaseUrl, pageDomain);
  addStylesheetFeatures(result, doc, effectiveBaseUrl, pageDomain);
  addMetaAndBaseFeatures(result, doc, baseUrl, effectiveBaseUrl, pageDomain, baseHref);
  addResourceRollups(result);

  return result;
}

export function extractDomFeaturesFromPage(options = {}) {
  const doc = options.documentRef || globalThis.document;
  const finalUrl = options.finalUrl || doc?.location?.href || globalThis.location?.href || "";
  return extractDomFeaturesFromDocument(doc, finalUrl, options);
}

// Resolve URL relatif sebelum membedakan domain sama, domain luar, IP dan URL invalid.
export function classifyDestination(rawValue, baseUrl, pageDomain) {
  const value = String(rawValue || "").trim();
  if (!value) return { type: "empty", url: null, domain: null };
  if (/^(javascript|mailto|tel|sms|data|blob|about):/i.test(value) || value.startsWith("#")) {
    return { type: "javascript_or_non_http", url: value, domain: null };
  }

  const resolved = safeResolveUrl(baseUrl, value);
  if (!resolved) return { type: "unknown", url: null, domain: null };
  const parsed = safeUrl(resolved);
  if (!parsed || !/^https?:$/i.test(parsed.protocol)) {
    return { type: "javascript_or_non_http", url: resolved, domain: null };
  }

  const hostInfo = parseHost(parsed.hostname);
  if (hostInfo.hostIsIp) return { type: "ip", url: resolved, domain: hostInfo.registrableDomain };
  if (pageDomain && hostInfo.registrableDomain === pageDomain) {
    return { type: "same_domain", url: resolved, domain: hostInfo.registrableDomain };
  }
  return { type: "external_domain", url: resolved, domain: hostInfo.registrableDomain };
}

// Kenali maksud field dari atribut/label; bukan membaca nilai kredensial yang diketik.
export function classifyCredentialInput(input, credentialKeywords = DEFAULT_CREDENTIAL_KEYWORDS) {
  const type = getAttr(input, "type").toLowerCase() || "text";
  const corpus = [
    type,
    getAttr(input, "name"),
    getAttr(input, "id"),
    getAttr(input, "placeholder"),
    getAttr(input, "autocomplete"),
    getAttr(input, "aria-label"),
    getAssociatedLabelText(input)
  ].join(" ").toLowerCase();

  const categories = new Set();
  if (type === "password") categories.add("password");
  if (type === "email") categories.add("email");

  for (const [category, keywords] of Object.entries(mergeCredentialKeywords(credentialKeywords))) {
    if (matchesAnyKeyword(corpus, keywords)) categories.add(category);
  }

  return [...categories].sort();
}

export function mergeCredentialKeywords(customKeywords = {}) {
  const merged = {};
  for (const [category, defaults] of Object.entries(DEFAULT_CREDENTIAL_KEYWORDS)) {
    const extra = Array.isArray(customKeywords?.[category]) ? customKeywords[category] : [];
    merged[category] = sortedUnique([...defaults, ...extra]);
  }
  return merged;
}

function addInputFeatures(result, doc, keywordConfig) {
  const inputs = queryAll(doc, "input, textarea, select");
  result.input_count = inputs.length;
  result.text_input_count = 0;
  result.email_input_count = 0;
  result.password_input_count = 0;
  result.tel_input_count = 0;
  result.number_input_count = 0;
  result.hidden_input_count = 0;

  for (const input of inputs) {
    const type = normalizeInputType(input);
    if (type === "text") result.text_input_count += 1;
    if (type === "email") result.email_input_count += 1;
    if (type === "password") result.password_input_count += 1;
    if (type === "tel") result.tel_input_count += 1;
    if (type === "number") result.number_input_count += 1;
    if (type === "hidden") result.hidden_input_count += 1;

    for (const category of classifyCredentialInput(input, keywordConfig)) {
      const field = COUNT_FIELDS[category];
      if (field) result[field] += 1;
    }
  }
}

// Gabungkan jenis field dan tujuan action form; form login sendiri bukan bukti phishing.
function addFormFeatures(result, doc, baseUrl, pageDomain, keywordConfig) {
  const forms = queryAll(doc, "form");
  Object.assign(result, {
    form_count: forms.length,
    form_get_count: 0,
    form_post_count: 0,
    form_action_empty_count: 0,
    form_action_relative_count: 0,
    form_action_same_domain_count: 0,
    form_action_external_domain_count: 0,
    form_action_ip_count: 0,
    form_action_http_count: 0,
    form_action_https_count: 0,
    credential_form_count: 0,
    external_credential_form_count: 0,
    ip_credential_form_count: 0
  });

  for (const form of forms) {
    const method = getAttr(form, "method").toLowerCase() || "get";
    if (method === "post") result.form_post_count += 1;
    else result.form_get_count += 1;

    const actionRaw = getAttr(form, "action");
    const action = classifyDestination(actionRaw, baseUrl, pageDomain);
    if (!actionRaw.trim()) result.form_action_empty_count += 1;
    else if (isRelativeUrl(actionRaw)) result.form_action_relative_count += 1;
    if (action.type === "same_domain") result.form_action_same_domain_count += 1;
    if (action.type === "external_domain") result.form_action_external_domain_count += 1;
    if (action.type === "ip") result.form_action_ip_count += 1;

    const actionUrl = safeUrl(action.url);
    if (actionUrl?.protocol === "http:") result.form_action_http_count += 1;
    if (actionUrl?.protocol === "https:") result.form_action_https_count += 1;

    const hasCredentials = formHasCredentials(form, keywordConfig);
    if (hasCredentials) result.credential_form_count += 1;
    if (hasCredentials && action.type === "external_domain") result.external_credential_form_count += 1;
    if (hasCredentials && action.type === "ip") result.ip_credential_form_count += 1;
  }
}

function addIframeFeatures(result, doc, baseUrl, pageDomain) {
  const iframes = queryAll(doc, "iframe");
  Object.assign(result, {
    iframe_count: iframes.length,
    iframe_same_domain_count: 0,
    iframe_external_domain_count: 0,
    iframe_ip_count: 0,
    iframe_empty_src_count: 0
  });

  for (const iframe of iframes) {
    const src = getAttr(iframe, "src");
    const dest = classifyDestination(src, baseUrl, pageDomain);
    if (dest.type === "empty") result.iframe_empty_src_count += 1;
    if (dest.type === "same_domain") result.iframe_same_domain_count += 1;
    if (dest.type === "external_domain") result.iframe_external_domain_count += 1;
    if (dest.type === "ip") result.iframe_ip_count += 1;
  }
}

// Hitung tautan internal/eksternal setelah URL tujuan diurai secara konsisten.
function addAnchorFeatures(result, doc, baseUrl, pageDomain) {
  const anchors = queryAll(doc, "a");
  const externalDomains = new Set();
  Object.assign(result, {
    anchor_count: anchors.length,
    internal_anchor_count: 0,
    external_anchor_count: 0,
    empty_anchor_count: 0,
    javascript_anchor_count: 0,
    external_anchor_ratio: 0,
    anchor_domains: []
  });

  for (const anchor of anchors) {
    const href = getAttr(anchor, "href");
    const dest = classifyDestination(href, baseUrl, pageDomain);
    if (dest.type === "empty") result.empty_anchor_count += 1;
    if (dest.type === "javascript_or_non_http") result.javascript_anchor_count += 1;
    if (dest.type === "same_domain") result.internal_anchor_count += 1;
    if (dest.type === "external_domain" || dest.type === "ip") {
      result.external_anchor_count += 1;
      if (dest.domain) externalDomains.add(dest.domain);
    }
  }

  result.external_anchor_ratio = ratio(result.external_anchor_count, result.anchor_count);
  result.anchor_domains = [...externalDomains].sort();
}

function addImageFeatures(result, doc, baseUrl, pageDomain) {
  const images = queryAll(doc, "img");
  Object.assign(result, {
    image_count: images.length,
    internal_image_count: 0,
    external_image_count: 0,
    external_image_ratio: 0
  });

  for (const image of images) {
    const src = getAttr(image, "src") || getAttr(image, "data-src");
    const dest = classifyDestination(src, baseUrl, pageDomain);
    if (dest.type === "same_domain") result.internal_image_count += 1;
    if (dest.type === "external_domain" || dest.type === "ip") result.external_image_count += 1;
  }
  result.external_image_ratio = ratio(result.external_image_count, result.image_count);
}

function addScriptFeatures(result, doc, baseUrl, pageDomain) {
  const scripts = queryAll(doc, "script");
  Object.assign(result, {
    script_count: scripts.length,
    inline_script_count: 0,
    external_script_count: 0,
    external_script_ratio: 0,
    eval_count: 0,
    document_write_count: 0,
    window_open_count: 0
  });

  for (const script of scripts) {
    const src = getAttr(script, "src");
    const sourceText = textContent(script);
    if (!src) result.inline_script_count += 1;
    const dest = classifyDestination(src, baseUrl, pageDomain);
    if (dest.type === "external_domain" || dest.type === "ip") result.external_script_count += 1;
    result.eval_count += countRegex(sourceText, /\beval\s*\(/gi);
    result.document_write_count += countRegex(sourceText, /\bdocument\s*\.\s*write(?:ln)?\s*\(/gi);
    result.window_open_count += countRegex(sourceText, /\bwindow\s*\.\s*open\s*\(/gi);
  }
  result.external_script_ratio = ratio(result.external_script_count, result.script_count);
}

function addStylesheetFeatures(result, doc, baseUrl, pageDomain) {
  const stylesheets = queryAll(doc, "link[rel~='stylesheet']");
  Object.assign(result, {
    stylesheet_count: stylesheets.length,
    external_stylesheet_count: 0,
    external_stylesheet_ratio: 0
  });

  for (const stylesheet of stylesheets) {
    const dest = classifyDestination(getAttr(stylesheet, "href"), baseUrl, pageDomain);
    if (dest.type === "external_domain" || dest.type === "ip") result.external_stylesheet_count += 1;
  }
  result.external_stylesheet_ratio = ratio(result.external_stylesheet_count, result.stylesheet_count);
}

function addMetaAndBaseFeatures(result, doc, baseUrl, effectiveBaseUrl, pageDomain, baseHref) {
  const metaRefresh = firstMetaRefresh(doc);
  const metaRefreshUrl = metaRefresh ? extractMetaRefreshUrl(metaRefresh) : "";
  const metaRefreshDest = classifyDestination(metaRefreshUrl, effectiveBaseUrl || baseUrl, pageDomain);
  const baseDest = classifyDestination(baseHref, baseUrl, pageDomain);

  result.meta_refresh_present = Boolean(metaRefresh);
  result.meta_refresh_url = metaRefreshUrl || null;
  result.meta_refresh_domain = metaRefreshDest.domain;
  result.meta_refresh_external = metaRefreshDest.type === "external_domain" || metaRefreshDest.type === "ip";
  result.base_tag_present = Boolean(baseHref);
  result.base_href = baseHref || null;
  result.base_href_domain = baseDest.domain;
  result.base_href_external = baseDest.type === "external_domain" || baseDest.type === "ip";
}

// Ringkas hitungan resource dan rasio dari kelompok elemen yang sudah dikumpulkan.
function addResourceRollups(result) {
  result.resource_count = result.image_count + result.script_count + result.stylesheet_count + result.iframe_count;
  result.external_resource_count =
    result.external_image_count +
    result.external_script_count +
    result.external_stylesheet_count +
    result.iframe_external_domain_count +
    result.iframe_ip_count;
  result.external_resource_ratio = ratio(result.external_resource_count, result.resource_count);

  const unique = new Set(result.anchor_domains || []);
  result.unique_external_domain_count = unique.size;
}

function formHasCredentials(form, keywordConfig) {
  const fields = typeof form.querySelectorAll === "function" ? [...form.querySelectorAll("input, textarea, select")] : [];
  return fields.some((field) => classifyCredentialInput(field, keywordConfig).length > 0);
}

function zeroCredentialCounts() {
  return Object.fromEntries(Object.values(COUNT_FIELDS).map((field) => [field, 0]));
}

function normalizeInputType(input) {
  const tag = String(input?.tagName || "").toLowerCase();
  if (tag === "textarea") return "text";
  if (tag === "select") return "text";
  const type = getAttr(input, "type").toLowerCase() || "text";
  return INPUT_TYPES.has(type) ? type : "text";
}

function firstMetaRefresh(doc) {
  return queryAll(doc, "meta[http-equiv]").find((meta) => getAttr(meta, "http-equiv").toLowerCase() === "refresh") || null;
}

function extractMetaRefreshUrl(meta) {
  const content = getAttr(meta, "content");
  const match = content.match(/url\s*=\s*([^;]+)/i);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

function firstAttribute(doc, selector, attribute) {
  return getAttr(doc.querySelector?.(selector), attribute) || null;
}

function getAssociatedLabelText(input) {
  const id = getAttr(input, "id");
  const direct = textContent(input?.closest?.("label"));
  if (direct) return direct;
  if (!id) return "";
  const root = input?.ownerDocument;
  try {
    return textContent(root?.querySelector?.(`label[for="${cssEscape(id)}"]`));
  } catch {
    return "";
  }
}

function matchesAnyKeyword(text, keywords) {
  const source = String(text || "").toLowerCase();
  return keywords.some((keyword) => {
    const key = String(keyword || "").toLowerCase().trim();
    if (!key) return false;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(source);
  });
}

function isRelativeUrl(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^[a-z][a-z0-9+.-]*:/i.test(text) && !text.startsWith("//");
}

function registrableDomainFromUrl(url) {
  const parsed = safeUrl(url);
  return parseHost(parsed?.hostname || "").registrableDomain;
}

function parseHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return { registrableDomain: null, hostIsIp: false };
  const parsed = parseDomain(host, { allowPrivateDomains: false });
  if (parsed.isIp || isIpHost(host)) return { registrableDomain: host, hostIsIp: true };
  return { registrableDomain: parsed.domain || fallbackRegistrableDomain(host), hostIsIp: false };
}

function fallbackRegistrableDomain(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host || null;
  return parts.slice(-2).join(".");
}

function isIpHost(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host) || /^[0-9a-f:]{3,}$/i.test(host);
}

function safeResolveUrl(baseUrl, value) {
  try {
    return new URL(String(value || ""), String(baseUrl || "")).href;
  } catch {
    return null;
  }
}

function safeUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function getAttr(element, attribute) {
  if (!element || typeof element.getAttribute !== "function") return "";
  return String(element.getAttribute(attribute) || "");
}

function textContent(element) {
  return String(element?.textContent || "").trim();
}

function queryAll(root, selector) {
  try {
    return [...(root?.querySelectorAll?.(selector) || [])];
  } catch {
    return [];
  }
}

function getOuterHtml(doc) {
  return doc?.documentElement?.outerHTML || "";
}

function getVisibleText(doc) {
  const body = doc?.body;
  if (!body) return "";
  const clone = body.cloneNode?.(true);
  if (!clone) return textContent(body);
  for (const item of queryAll(clone, "script, style, noscript, template")) item.remove?.();
  return String(clone.textContent || "").replace(/\s+/g, " ").trim();
}

// Hindari pembagian nol pada halaman tanpa elemen dari kelompok terkait.
function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function countRegex(value, regex) {
  return (String(value || "").match(regex) || []).length;
}

function sortedUnique(values) {
  return [...new Set(values.map((value) => String(value || "").toLowerCase().trim()).filter(Boolean))].sort();
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
}
