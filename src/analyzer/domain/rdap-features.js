/*
 * Mengambil metadata pendaftaran domain, menghitung umur dan menandai lookup gagal/dilewati.
 * Tidak menganggap metadata yang tidak tersedia sebagai domain baru.
 */
export const RDAP_FEATURE_VERSION = "crawler-rdap-parity-v2-local-first";

const LOCAL_RDAP_API = "http://localhost:3000/api/whois?domain={domain}";
const DEFAULT_RDAP_API = "https://whois-api-dun.vercel.app/api/whois?domain={domain}";
const FALLBACK_RDAP_APIS = [
  LOCAL_RDAP_API,
  DEFAULT_RDAP_API,
  "https://who-dat.as93.net/{domain}"
];
const DEFAULT_TIMEOUT_MS = 5000;

const RDAP_KEYS = [
  "domain_age_days",
  "registration_lifetime_days",
  "days_until_expiration",
  "days_since_domain_update",
  "nameserver_count",
  "rdap_available"
];

export async function extractRdapFeatureSet({
  originalDomain,
  finalDomain,
  originalSkip = false,
  finalSkip = false,
  lookup = lookupRdapDomain
} = {}) {
  const original = await resolveRdap(originalDomain, originalSkip, lookup);
  let final = original;

  if (String(finalDomain || "").toLowerCase() !== String(originalDomain || "").toLowerCase() || Boolean(finalSkip) !== Boolean(originalSkip)) {
    final = await resolveRdap(finalDomain, finalSkip, lookup);
  }

  return {
    ...prefixRdap(original, "original"),
    ...prefixRdap(final, "final")
  };
}

export async function lookupRdapDomain(domain, options = {}) {
  const cleanDomain = String(domain || "").trim().toLowerCase();
  if (!cleanDomain) return unavailableRdap("missing_domain");

  const apiUrls = Array.isArray(options.apiUrls) && options.apiUrls.length
    ? options.apiUrls
    : options.apiUrl
      ? [options.apiUrl]
      : FALLBACK_RDAP_APIS;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const errors = [];

  for (const apiUrl of apiUrls) {
    const url = buildLookupUrl(apiUrl, cleanDomain);
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller?.signal
      });
      if (timeout) clearTimeout(timeout);
      if (!response.ok) {
        errors.push(`http_${response.status}`);
        continue;
      }
      const normalized = normalizeRdapResponse(await response.json());
      if (normalized.rdap_available) return normalized;
      errors.push(normalized.rdap_error || "unusable_response");
    } catch (error) {
      errors.push(error?.name === "AbortError" ? "timeout" : "lookup_failed");
    }
  }

  return unavailableRdap(errors.filter(Boolean).join(";") || "unavailable");
}

// Normalisasi bentuk respons API agar tanggal/nameserver memiliki format konsisten.
export function normalizeRdapResponse(payload) {
  const data = unwrapPayload(payload);
  const domain = firstValue(data, ["domain", "domainName", "ldhName", "query"]);
  const creation = parseRdapDate(firstValue(data, [
    "domain_creation_date",
    "creation_date",
    "creationDate",
    "createdDate",
    "registered_on",
    "registeredOn",
    "created"
  ]) || firstNestedValue(data, "dates", ["created", "creation", "registered"]) || eventDate(data, ["registration"]));
  const expiration = parseRdapDate(firstValue(data, [
    "domain_expiration_date",
    "expiration_date",
    "expirationDate",
    "expires_on",
    "expiresOn",
    "expiry_date",
    "expiryDate",
    "expires"
  ]) || firstNestedValue(data, "dates", ["expires", "expired", "expiry", "expiration"]) || eventDate(data, ["expiration"]));
  const updated = parseRdapDate(firstValue(data, [
    "domain_updated_date",
    "updated_date",
    "updatedDate",
    "updated_on",
    "updatedOn",
    "last_updated",
    "changed"
  ]) || firstNestedValue(data, "dates", ["updated", "changed", "lastChanged"]) || eventDate(data, ["last changed", "last update", "last update of rdap database"]));
  const nameservers = normalizeNameservers(firstValue(data, ["nameservers", "nameServers", "name_servers"]));
  const now = new Date();

  return {
    domain: domain || null,
    domain_age_days: daysBetween(creation, now),
    registration_lifetime_days: daysBetween(creation, expiration),
    days_until_expiration: daysBetween(now, expiration),
    days_since_domain_update: daysBetween(updated, now),
    nameserver_count: nameservers.length,
    rdap_available: Boolean(creation || expiration || updated || nameservers.length),
    rdap_error: null,
    rdap_skip_reason: null
  };
}

// Domain induk platform tidak mewakili umur situs tiap pengguna hosting bersama.
export function skippedSharedHostingRdap() {
  return {
    domain: null,
    domain_age_days: null,
    registration_lifetime_days: null,
    days_until_expiration: null,
    days_since_domain_update: null,
    nameserver_count: null,
    rdap_available: null,
    rdap_error: null,
    rdap_skip_reason: "shared_hosting_domain"
  };
}

// Simpan alasan kegagalan dan nilai missing, bukan membuat umur domain palsu.
export function unavailableRdap(reason = "unavailable") {
  return {
    domain: null,
    domain_age_days: null,
    registration_lifetime_days: null,
    days_until_expiration: null,
    days_since_domain_update: null,
    nameserver_count: null,
    rdap_available: false,
    rdap_error: reason,
    rdap_skip_reason: null
  };
}

export function prefixRdap(rdap, prefix) {
  const source = rdap || unavailableRdap();
  const output = {};
  for (const key of RDAP_KEYS) {
    output[`${prefix}_${key}`] = source[key] ?? null;
  }
  return output;
}

async function resolveRdap(domain, skip, lookup) {
  if (skip) return skippedSharedHostingRdap();
  return lookup(domain);
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  for (const key of ["data", "result", "whois", "rdap", "rawRdap"]) {
    if (payload[key] && typeof payload[key] === "object") return unwrapPayload(payload[key]);
  }
  return payload;
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function parseRdapDate(value) {
  if (!value) return null;
  if (Array.isArray(value)) return parseRdapDate(value[0]);
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeNameservers(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "string" ? item : item?.name || item?.ldhName || item?.hostName)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildLookupUrl(apiUrl, domain) {
  return apiUrl.includes("{domain}")
    ? apiUrl.replace("{domain}", encodeURIComponent(domain))
    : `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}domain=${encodeURIComponent(domain)}`;
}

function firstNestedValue(data, parentKey, keys) {
  const parent = data?.[parentKey];
  if (!parent || typeof parent !== "object") return null;
  return firstValue(parent, keys);
}

function eventDate(data, actions) {
  if (!Array.isArray(data?.events)) return null;
  const wanted = actions.map((action) => action.toLowerCase());
  const event = data.events.find((item) => wanted.includes(String(item?.eventAction || "").toLowerCase()));
  return event?.eventDate || null;
}

function daysBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}
