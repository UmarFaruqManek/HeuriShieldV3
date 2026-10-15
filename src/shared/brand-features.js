/*
 * Helper brand historis/kompatibilitas; analyzer aktif memakai analyzer/brand/brand-features.js.
 * Jangan menyamakan helper ini dengan urutan provider aktif tanpa memeriksa pemanggilnya.
 */
import { parse as parseDomain } from "./tldts.js";

const STOP = new Set("www com net org gov edu mil int co uk id au nz sg de fr es it ru xyz online site app login signin signup sign in auth account secure security verify verification payment billing checkout wallet password recovery reset otp www html php index page home".split(/\s+/));
const brandCache = new Map();
const brandInflight = new Map();

export async function extractBrandFeatures(url, timeoutMs = 15000) {
  const candidates = extractCandidates(url);
  const selected = candidates.slice(0, 8);
  const results = new Array(selected.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(3, selected.length)}, async () => {
    while (next < selected.length) {
      const index = next++, candidate = selected[index];
      let hit = brandCache.get(candidate.token);
      if (!hit) {
        if (!brandInflight.has(candidate.token)) {
          const task = lookupBrand(candidate.token, timeoutMs).then(result => {
            brandCache.set(candidate.token, result);
            return result;
          }).finally(() => brandInflight.delete(candidate.token));
          brandInflight.set(candidate.token, task);
        }
        hit = await brandInflight.get(candidate.token);
      }
      results[index] = {...candidate, ...hit};
    }
  }));
  const found = results.filter(item => item.status === "matched");
  const distinct = [...new Map(found.map(item => [item.domain, item])).values()];
  let status = "no_match", source = "", name = "", official = "";
  if (distinct.length > 1 || results.some(item => item.status === "ambiguous")) {
    status = "ambiguous"; source = [...new Set(distinct.map(item => item.source).filter(Boolean))].join("|");
  } else if (distinct.length === 1) {
    status = "matched"; source = distinct[0].source; name = distinct[0].name; official = distinct[0].domain;
  } else if (results.length && results.every(item => item.status === "lookup_unavailable")) status = "lookup_unavailable";
  const active = registrable(url);
  const match = status === "matched" ? active === registrable(`https://${official}`) : null;
  return {
    brand_candidate_tokens: candidates.map(item => item.token),
    brand_candidate_locations: candidates.map(item => item.location),
    brand_lookup_status: status,
    brand_lookup_source: source,
    brand_name: name,
    brand_official_domain: official,
    brand_official_domain_match: match,
    brand_domain_mismatch: status === "matched" ? !match : null
  };
}

async function lookupBrand(token, timeoutMs) {
  let success = false; const sources = [], candidates = [];
  try {
    const response = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(token)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      sources.push("brandfetch"); const data = await response.json();
      if (Array.isArray(data)) { success = true; for (const item of data) if (relevant(token, item.name, item.domain)) candidates.push({ name: item.name, domain: registrable(`https://${item.domain}`), source: "brandfetch" }); }
    } else if (response.status === 429) sources.push("rate_limited");
  } catch { sources.push("unavailable"); }
  const exactDomain = candidates.filter(item => normalize(parseDomain(item.domain, { allowPrivateDomains: true }).domainWithoutSuffix) === normalize(token));
  if (exactDomain.length) {
    const exact = [...new Map(exactDomain.map(item => [item.domain, item])).values()];
    return exact.length === 1 ? { status: "matched", source: "brandfetch", name: exact[0].name, domain: exact[0].domain } : { status: "ambiguous", source: "", name: "", domain: "" };
  }
  if (!candidates.length) {
    try {
      const search = new URL("https://www.wikidata.org/w/api.php");
      search.search = new URLSearchParams({ action: "wbsearchentities", search: token, language: "en", uselang: "en", type: "item", limit: "5", format: "json" });
      const response = await fetch(search, { headers: { accept: "application/json", "Api-User-Agent": "ToolCrawResearch/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        sources.push("wikidata"); const data = await response.json(); if (!Array.isArray(data.search)) throw new Error("invalid Wikidata response"); success = true;
        const exact = (data.search || []).filter(item => normalize(item.label) === normalize(token) || (item.aliases || []).some(alias => normalize(alias) === normalize(token)));
        if (exact.length) {
          const detail = new URL("https://www.wikidata.org/w/api.php");
          detail.search = new URLSearchParams({ action: "wbgetentities", ids: exact.map(item => item.id).join("|"), props: "labels|aliases|claims", languages: "en", format: "json" });
          const responseDetails = await fetch(detail, { headers: { accept: "application/json", "Api-User-Agent": "ToolCrawResearch/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
          if (responseDetails.ok) {
            const entities = (await responseDetails.json()).entities || {};
            for (const entity of Object.values(entities)) {
              const label = entity.labels?.en?.value || "";
              if (normalize(label) !== normalize(token) && !(entity.aliases?.en || []).some(alias => normalize(alias.value) === normalize(token))) continue;
              for (const statement of entity.claims?.P856 || []) {
                const value = statement.mainsnak?.datavalue?.value; if (!value) continue;
                try { const domain = registrable(value); if (domain) candidates.push({ name: label, domain, source: "wikidata" }); } catch { /* ignore malformed official URL */ }
              }
            }
          }
        }
      } else if (response.status === 429) sources.push("rate_limited");
    } catch { sources.push("unavailable"); }
  }
  const unique = [...new Map(candidates.filter(item => item.domain).map(item => [item.domain, item])).values()];
  if (unique.length > 1) return { status: "ambiguous", source: "", name: "", domain: "" };
  if (unique.length === 1) return { status: "matched", source: unique[0].source, name: unique[0].name, domain: unique[0].domain };
  return { status: success ? "no_match" : "lookup_unavailable", source: sources.find(item => item === "brandfetch" || item === "wikidata") || "", name: "", domain: "" };
}

function extractCandidates(url) {
  const parsedUrl = new URL(url), parsed = parseDomain(parsedUrl.hostname, { allowPrivateDomains: true }), entries = [];
  const add = (text, location) => { for (const part of String(text || "").split(/[^a-zA-Z0-9]+/)) { const token = normalize(part); if (token.length >= 3 && token.length <= 30 && !/^\d+$/.test(token) && !STOP.has(token) && !entries.some(item => item.token === token && item.location === location)) entries.push({ token, location }); } };
  const suffixParts = new Set(String(parsed.publicSuffix || "").split("."));
  for (const label of parsedUrl.hostname.toLowerCase().split(".")) { if (suffixParts.has(label) || label === "www") continue; add(label, label === parsed.domainWithoutSuffix ? "domain" : "subdomain"); }
  const context = /login|log-in|signin|sign-in|verify|verification|auth|account|billing|payment|checkout|wallet|password|secure|recover|recovery|reset|otp/i.test(parsedUrl.pathname + " " + parsedUrl.search);
  if (context) {
    for (const part of parsedUrl.pathname.split("/").filter(Boolean)) if (!/\.[a-z0-9]{2,5}$/i.test(part)) add(part, "path");
    for (const [key, value] of parsedUrl.searchParams) { add(key, "query"); if (!/^https?:\/\//i.test(value)) add(value, "query"); }
  }
  return entries;
}
function relevant(token, name, domain) { return normalize(name) === normalize(token) || normalize(parseDomain(domain, { allowPrivateDomains: false }).domainWithoutSuffix) === normalize(token); }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function registrable(value) { try { return parseDomain(new URL(value).hostname, { allowPrivateDomains: true }).domain || new URL(value).hostname.toLowerCase(); } catch { return ""; } }
