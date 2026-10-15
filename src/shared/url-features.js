/*
 * Helper URL bersama untuk kompatibilitas, bukan titik masuk analyzer runtime aktif.
 * Implementasi kontrak crawler aktif berada di analyzer/url/url-features.js.
 */
import { parse as parseDomain } from "./tldts.js";

// Shared, versioned URL extractor. The crawler imports this same file so that
// the extension and the data-collection tool use identical calculations.
export const URL_EXTRACTOR_VERSION = "url-v1.1.0";

export function extractUrlFeatures(raw, sourceRaw = raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const p = parseDomain(host, { allowPrivateDomains: true });
  const domainLabel = p.domainWithoutSuffix || host.split(".").slice(-2, -1)[0] || host;
  const subdomains = p.subdomain ? p.subdomain.split(".").filter(Boolean).length : 0;
  const rawText = String(sourceRaw || raw);
  const rawLength = Array.from(rawText).length;
  const letters = (rawText.match(/\p{L}/gu) || []).length;
  const digits = (rawText.match(/\p{N}/gu) || []).length;
  const specials = (rawText.match(/[^\p{L}\p{N}]/gu) || []).length;
  const encoded = (rawText.match(/%[0-9a-fA-F]{2}/g) || []).length;
  const pathname = u.pathname || "";
  const pathTokens = pathname.split(/[\/_-]+/).filter(Boolean);
  const query = u.search.startsWith("?") ? u.search.slice(1) : u.search;
  const queryParams = [...u.searchParams.entries()];
  const rawHost = rawAuthorityHost(rawText);
  const tld = host.split(".").at(-1) || "";
  const portText = rawAuthorityPort(rawText);
  const standardPort = !portText || (u.protocol === "https:" && portText === "443") || (u.protocol === "http:" && portText === "80");
  const queryKeys = queryParams.map(([key]) => key.toLowerCase());
  const hasRedirectParam = queryKeys.some(key => /^(redirect|redirect_url|redirect_uri|url|next|return|returnurl|continue|destination|dest|target|callback|redir|goto)$/i.test(key));
  const embeddedUrl = queryParams.some(([key, value]) => /https?:\/\//i.test(safeDecode(key) + " " + safeDecode(value)));
  const unicode = Boolean(rawHost && /[^\x00-\x7F]/.test(rawHost));
  const isIp = Boolean(p.isIp);

  return {
    url_length: rawLength,
    url_letter_count: letters,
    url_letter_ratio: ratio(letters, rawLength),
    url_digit_count: digits,
    url_digit_ratio: ratio(digits, rawLength),
    url_special_char_count: specials,
    url_special_char_ratio: ratio(specials, rawLength),
    host_is_ip: isIp,
    hostname_length: host.length,
    registrable_domain_label_length: isIp ? null : domainLabel.length,
    subdomain_count: isIp ? null : subdomains,
    tld: isIp ? "" : tld,
    tld_length: isIp ? null : tld.length,
    domain_digit_count: isIp ? null : (domainLabel.match(/\d/g) || []).length,
    domain_digit_ratio: isIp ? null : ratio((domainLabel.match(/\d/g) || []).length, domainLabel.length),
    domain_hyphen_count: isIp ? null : (domainLabel.match(/-/g) || []).length,
    domain_label_entropy: isIp ? null : entropy(domainLabel),
    has_punycode_or_unicode: unicode || host.split(".").some(label => label.startsWith("xn--")),
    scheme: u.protocol.replace(":", ""),
    is_https: u.protocol === "https:",
    has_userinfo: Boolean(u.username || u.password),
    has_nonstandard_port: !standardPort,
    percent_encoded_count: encoded,
    obfuscation_ratio: ratio(encoded, rawLength),
    path_length: Array.from(pathname).length,
    path_depth: pathname.split("/").filter(Boolean).length,
    longest_path_token_length: Math.max(0, ...pathTokens.map(token => Array.from(token).length)),
    path_entropy: entropy(pathname),
    query_length: Array.from(query).length,
    query_param_count: queryParams.length,
    query_entropy: entropy(query),
    has_redirect_param: hasRedirectParam,
    embedded_url_in_query: embeddedUrl
  };
}

export function getRegistrableDomain(hostOrUrl) {
  let host = String(hostOrUrl || "");
  try { host = new URL(host.includes("://") ? host : `https://${host}`).hostname; } catch { return ""; }
  const parsed = parseDomain(host.toLowerCase().replace(/\.$/, ""), { allowPrivateDomains: true });
  return parsed.domain || host.toLowerCase();
}

function rawAuthorityHost(raw) {
  const match = String(raw).match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  if (!match) return "";
  const authority = match[1].split("@").at(-1);
  if (authority.startsWith("[")) return authority.slice(1, authority.indexOf("]"));
  return authority.replace(/:\d+$/, "");
}
function rawAuthorityPort(raw) {
  const match = String(raw).match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  if (!match) return "";
  const authority = match[1].split("@").at(-1);
  if (authority.startsWith("[")) return authority.match(/\]:(\d+)$/)?.[1] || "";
  return authority.match(/:(\d+)$/)?.[1] || "";
}
function entropy(value) {
  if (!value) return 0;
  const length = Array.from(value).length;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let result = 0;
  for (const count of counts.values()) { const probability = count / length; result -= probability * Math.log2(probability); }
  return Number(result.toFixed(6));
}
function ratio(a, b) { return b ? Number((a / b).toFixed(6)) : 0; }
function safeDecode(value) { try { return decodeURIComponent(value.replace(/\+/g, " ")); } catch { return value; } }
