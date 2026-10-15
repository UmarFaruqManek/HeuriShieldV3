/*
 * Helper metadata/umur domain bersama untuk kompatibilitas.
 * Alur runtime utama memakai analyzer/domain/rdap-features.js.
 */
import { parse as parseDomain } from "./tldts.js";

const domainAgeCache = new Map();

export function getAgeLookupDomain(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (parseDomain(host, { allowPrivateDomains: true }).isIp) return { domain: "", scope: "registrable_domain" };
  const normal = parseDomain(host, { allowPrivateDomains: false });
  const privateAware = parseDomain(host, { allowPrivateDomains: true });
  if (normal.isPrivate === false && privateAware.isPrivate === true && normal.domain && privateAware.domain && normal.domain !== privateAware.domain) {
    return { domain: normal.domain, scope: "platform_parent" };
  }
  return { domain: normal.domain || host, scope: "registrable_domain" };
}

export async function fetchRegistrationAge(domain, timeoutMs = 15000) {
  if (!domain) return { days: null, status: "unsupported", createdAt: null, source: "" };
  if (domainAgeCache.has(domain)) return domainAgeCache.get(domain);
  const providers = [
    { name: "local-whois", url: `http://localhost:3000/api/whois?domain=${encodeURIComponent(domain)}`, date: data => data?.data?.creationDate || data?.creationDate || data?.registered_on || data?.registeredOn || data?.created },
    { name: "whois-vercel", url: `https://whois-api-dun.vercel.app/api/whois?domain=${encodeURIComponent(domain)}`, date: data => data?.registered_on || data?.registeredOn || data?.creationDate || data?.created },
    { name: "who-dat", url: `https://who-dat.as93.net/${encodeURIComponent(domain)}`, date: data => data?.dates?.created || data?.created || data?.creationDate }
  ];
  const failures = []; let successfulLookup = false;
  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429) { failures.push("rate_limited"); continue; }
      if (!response.ok) { if (response.status === 404) successfulLookup = true; else failures.push("error"); continue; }
      let data; try { data = await response.json(); } catch { failures.push("error"); continue; }
      successfulLookup = true;
      const created = validDate(provider.date(data));
      const returned = String(data?.domain || data?.data?.domain || "").toLowerCase().replace(/^www\./, "");
      if (returned && returned !== domain && registrable(`https://${returned}`) !== registrable(`https://${domain}`)) { failures.push("error"); continue; }
      if (created) {
        const days = Math.floor((Date.now() - Date.parse(`${created}T00:00:00Z`)) / 86400000);
        if (days >= 0) {
          const backend = String(data?.source || data?.data?.source || "").toLowerCase();
          const isRdap = backend.includes("rdap") || Boolean(data?.data?.rawRdap || data?.rawRdap);
          const isWhois = backend.includes("whois");
          const method = isRdap ? "RDAP" : isWhois ? "WHOIS" : "method_not_reported";
          const result = { days, status: "observed", createdAt: created, source: `${method}:${provider.name}` };
          domainAgeCache.set(domain, result); return result;
        }
      }
    } catch (error) { failures.push(error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "error"); }
  }
  const status = failures.length && failures.every(value => value === "rate_limited") ? "rate_limited"
    : failures.length && failures.every(value => value === "timeout") ? "timeout"
    : successfulLookup ? "not_found"
    : failures.includes("rate_limited") ? "rate_limited"
    : failures.includes("timeout") ? "timeout" : "error";
  const result = { days: null, status, createdAt: null, source: "" };
  domainAgeCache.set(domain, result); return result;
}

function registrable(url) { try { const host = new URL(url).hostname.toLowerCase(); return parseDomain(host, { allowPrivateDomains: true }).domain || host; } catch { return ""; } }
function validDate(value) { if (!value) return ""; const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) return ""; return date.toISOString().slice(0, 10); }
