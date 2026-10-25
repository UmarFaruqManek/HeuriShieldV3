/*
 * Mengurai URL awal dan akhir, menghitung fitur struktur alamat dan konteks redirect.
 * PSL memisahkan domain terdaftar dari subdomain agar perbandingan tidak sekadar teks.
 */
import { parse as parseDomain } from "../../shared/tldts.js";
import { isPublicHostingPlatformHost } from "../../utils/hosted-platforms.js";
import { canonicalFeatureName } from "../../rule/feature-names.js";

export const URL_FEATURE_VERSION = "crawler-url-parity-v1";
// PSL (tldts) memisahkan domain terdaftar dan subdomain, bukan sekadar memotong titik.
// Nama fitur source_/page_ membedakan URL sumber dan halaman akhir.

const FILE_EXTENSION_SUFFIXES = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "css", "js", "json",
  "xml", "pdf", "txt", "csv", "zip", "rar", "7z", "html", "htm", "php",
  "aspx", "asp", "jsp", "dll", "exe", "db"
]);

const URL_FEATURE_KEYS = [
  "scheme",
  "hostname",
  "registrable_domain",
  "subdomain",
  "public_suffix",
  "path",
  "query",
  "url_length",
  "hostname_length",
  "path_length",
  "query_length",
  "query_parameter_count",
  "subdomain_count",
  "dot_count",
  "hyphen_count",
  "underscore_count",
  "at_count",
  "percent_count",
  "digit_count",
  "digit_ratio",
  "special_char_count",
  "special_char_ratio",
  "host_is_ip",
  "punycode_present",
  "encoded_char_count",
  "embedded_domain_count",
  "sensitive_word_count",
  "sensitive_words_found",
  "url_token_count",
  "url_entropy"
];

// Hitungan panjang/karakter memakai string URL; hostname dipakai khusus fitur domain.
export function extractUrlFeatures(url, sensitiveKeywords = []) {
  const parsed = safeUrl(url);
  const finalUrl = String(url || "");
  const host = parsed?.hostname || "";
  const domain = parseHost(host);
  const query = parsed ? parsed.search.replace(/^\?/, "") : "";
  const path = parsed?.pathname || "";
  const queryPairs = query ? [...new URLSearchParams(query).entries()] : [];
  const specialChars = finalUrl.match(/[^A-Za-z0-9]/g) || [];
  const digits = finalUrl.match(/\d/g) || [];
  const found = sensitiveWords(finalUrl, sensitiveKeywords);

  return {
    scheme: parsed?.protocol.replace(":", "") || "",
    hostname: host ? host.toLowerCase() : null,
    registrable_domain: domain.registrableDomain,
    subdomain: domain.subdomain,
    public_suffix: domain.publicSuffix,
    path,
    query,
    url_length: finalUrl.length,
    hostname_length: host.length,
    path_length: path.length,
    query_length: query.length,
    query_parameter_count: queryPairs.length,
    subdomain_count: domain.subdomain ? domain.subdomain.split(".").filter(Boolean).length : 0,
    dot_count: host.split(".").length > 1 ? (host.match(/\./g) || []).length : 0,
    hyphen_count: countChar(finalUrl, "-"),
    underscore_count: countChar(finalUrl, "_"),
    at_count: countChar(finalUrl, "@"),
    percent_count: countChar(finalUrl, "%"),
    digit_count: digits.length,
    digit_ratio: finalUrl ? digits.length / finalUrl.length : 0,
    special_char_count: specialChars.length,
    special_char_ratio: finalUrl ? specialChars.length / finalUrl.length : 0,
    host_is_ip: domain.hostIsIp,
    punycode_present: host.toLowerCase().includes("xn--"),
    encoded_char_count: (finalUrl.match(/%[0-9a-fA-F]{2}/g) || []).length,
    embedded_domain_count: embeddedDomainCount(`${path}?${query}`),
    sensitive_word_count: found.length,
    sensitive_words_found: found,
    url_token_count: finalUrl.split(/[^A-Za-z0-9]+/).filter(Boolean).length,
    url_entropy: shannonEntropy(finalUrl)
  };
}

// Prefix memisahkan sinyal URL awal dan akhir tanpa mengganti definisi hitungannya.
export function prefixedUrlFeatures(url, prefix, sensitiveKeywords = []) {
  const features = extractUrlFeatures(url, sensitiveKeywords);
  const output = { [`${prefix}_url`]: url };
  for (const key of URL_FEATURE_KEYS) {
    output[canonicalFeatureName(`${prefix}_${key}`)] = features[key];
  }
  return output;
}

// Bedakan redirect ke halaman lain dalam domain sama dan perpindahan domain.
export function calculateRedirectFields(originalUrl, finalUrl, redirectChain = []) {
  const rawSequence = Array.isArray(redirectChain) && redirectChain.length ? [...redirectChain] : [originalUrl, finalUrl];
  const sequence = [];
  for (const item of rawSequence) {
    if (item && sequence[sequence.length - 1] !== item) sequence.push(item);
  }
  if (!sequence.length && originalUrl) sequence.push(originalUrl);
  if (finalUrl && sequence[sequence.length - 1] !== finalUrl) sequence.push(finalUrl);

  const originalRegistrable = parseHostFromUrl(originalUrl).registrableDomain;
  const finalRegistrable = parseHostFromUrl(finalUrl).registrableDomain;
  const registrables = sequence.map((item) => parseHostFromUrl(item).registrableDomain);
  let crossDomainRedirectCount = 0;
  let previous = registrables[0] || null;
  for (const current of registrables.slice(1)) {
    if (previous && current && current !== previous) crossDomainRedirectCount += 1;
    previous = current;
  }

  return {
    redirect_chain: sequence,
    redirect_count: Math.max(sequence.length - 1, 0),
    cross_domain_redirect_count: crossDomainRedirectCount,
    original_registrable_domain: originalRegistrable,
    final_registrable_domain: finalRegistrable,
    final_domain_changed: Boolean(originalRegistrable && finalRegistrable && originalRegistrable !== finalRegistrable)
  };
}

export function extractCrawlerUrlFeatureSet({
  originalUrl,
  finalUrl = originalUrl,
  redirectChain = [],
  sensitiveKeywords = []
} = {}) {
  const originalSharedHosting = usesSharedHostingFromUrl(originalUrl);
  const finalSharedHosting = usesSharedHostingFromUrl(finalUrl);
  return {
    ...prefixedUrlFeatures(originalUrl, "original", sensitiveKeywords),
    ...prefixedUrlFeatures(finalUrl, "final", sensitiveKeywords),
    ...extractUrlFeatures(finalUrl, sensitiveKeywords),
    ...calculateRedirectFields(originalUrl, finalUrl, redirectChain),
    source_uses_shared_hosting_domain: originalSharedHosting,
    final_uses_shared_hosting_domain: finalSharedHosting,
    uses_shared_hosting_domain: finalSharedHosting,
    source_skip_domain_age_lookup: originalSharedHosting,
    final_skip_domain_age_lookup: finalSharedHosting
  };
}

export function usesSharedHostingFromUrl(url) {
  const parsed = safeUrl(url);
  return Boolean(parsed?.hostname && isPublicHostingPlatformHost(parsed.hostname));
}

export function flattenSensitiveKeywordConfig(config) {
  if (Array.isArray(config)) return sortedUnique(config);
  if (!config || typeof config !== "object") return [];
  return sortedUnique(Object.values(config).flatMap((value) => Array.isArray(value) ? value : []));
}

function parseHostFromUrl(url) {
  const parsed = safeUrl(url);
  return parseHost(parsed?.hostname || "");
}

function parseHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) {
    return { registrableDomain: null, subdomain: null, publicSuffix: null, hostIsIp: false };
  }
  const parsed = parseDomain(host, { allowPrivateDomains: false });
  if (parsed.isIp) {
    return { registrableDomain: host, subdomain: "", publicSuffix: "", hostIsIp: true };
  }
  const registrableDomain = parsed.domain || fallbackRegistrableDomain(host);
  return {
    registrableDomain,
    subdomain: parsed.subdomain || "",
    publicSuffix: parsed.publicSuffix || "",
    hostIsIp: false
  };
}

function fallbackRegistrableDomain(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host || null;
  return parts.slice(-2).join(".");
}

function embeddedDomainCount(value) {
  const decoded = safeDecode(value || "");
  const matches = decoded.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi) || [];
  const domains = new Set();
  for (const match of matches) {
    const candidate = match.replace(/^\.+|\.+$/g, "").toLowerCase();
    const parsed = parseDomain(candidate, { allowPrivateDomains: false });
    if (!parsed.publicSuffix || !parsed.domain) continue;
    if (!parsed.isIcann && !parsed.isPrivate) continue;
    if (String(parsed.publicSuffix).length < 2) continue;
    if (FILE_EXTENSION_SUFFIXES.has(String(parsed.publicSuffix).toLowerCase())) continue;
    domains.add(parsed.domain.toLowerCase());
  }
  return domains.size;
}

function sensitiveWords(url, keywords) {
  const decoded = safeDecode(url).toLowerCase();
  const found = [];
  for (const keyword of keywords || []) {
    const key = String(keyword || "").toLowerCase();
    if (!key) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(decoded)) {
      found.push(key);
    }
  }
  return sortedUnique(found);
}

// Entropi Shannon: H = -sum(p * log2(p)); p adalah frekuensi relatif karakter.
function shannonEntropy(value) {
  const text = String(value || "");
  if (!text) return 0;
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) || 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function safeUrl(url) {
  try {
    return new URL(String(url || ""));
  } catch {
    return null;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function countChar(value, char) {
  return String(value || "").split(char).length - 1;
}

function sortedUnique(values) {
  return [...new Set(values.map((value) => String(value).toLowerCase()).filter(Boolean))].sort();
}
