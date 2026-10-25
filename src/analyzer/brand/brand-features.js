/*
 * Mencari kandidat brand dari judul/alamat dan menghitung hubungan dengan domain halaman.
 * Clearbit utama, Brandfetch pelengkap/fallback; hasil pencarian bukan jaminan keamanan.
 */
import { parse as parseDomain } from "../../shared/tldts.js";
import { BRAND_TOKEN_BLOCKLIST, PUBLIC_HOSTING_PLATFORM_DOMAINS } from "../../utils/constants.js";

export const BRAND_FEATURE_VERSION = "clearbit-first-brandfetch-second-v3";

const DEFAULT_BRANDFETCH_API = "https://api.brandfetch.io/v2/search/{query}";
const DEFAULT_CLEARBIT_API = "https://autocomplete.clearbit.com/v1/companies/suggest?query={token}";
const DEFAULT_TIMEOUT_MS = 7000;

const TITLE_SEPARATORS = /\s*(?:\||-|—|–|:|::|\/)\s*/;
const GENERIC_TOKENS = new Set([
  "account", "auth", "billing", "checkout", "home", "index", "learning", "login",
  "page", "password", "payment", "progress", "secure", "security", "signin", "support",
  "update", "verify", "verification", "wallet", "www", "http", "https",
  "academy", "app", "school", "university", "institute", "international",
  "register", "registration", "admission", "admissions", "apply", "applynow",
  "privacy", "contact", "services", "permit", "permits"
]);

for (const token of BRAND_TOKEN_BLOCKLIST || []) {
  GENERIC_TOKENS.add(token);
}

export async function extractBrandFeatureSet({
  originalUrl,
  finalUrl = originalUrl,
  title = "",
  lookup = searchBrand
} = {}) {
  // Identitas kandidat berasal dari judul/alamat; hasil direktori bukan bukti keamanan.
  const queries = buildBrandQueries(title, hostnameOf(originalUrl), hostnameOf(finalUrl), pathOf(originalUrl), pathOf(finalUrl));
  const lookupResults = await Promise.all(queries.map(async (query) => {
    try {
      return await lookup(query);
    } catch {
      return lookupResult(query, [], false);
    }
  }));

  const candidate = topBrandCandidate(lookupResults, originalUrl, finalUrl);
  return {
    ...candidate,
    brand_lookup_success: lookupResults.some((item) => item.lookup_success),
    brand_lookup_failed_queries: lookupResults.filter((item) => !item.lookup_success).length
  };
}

export async function searchBrand(query, options = {}) {
  // Clearbit menjadi sumber utama. Skor Brandfetch hanya melengkapi domain yang sama.
  // Skor yang tidak tersedia tetap null agar memakai kebijakan imputasi model.
  const primary = await searchClearbit(query, options.clearbit || {});
  const secondary = await searchBrandfetch(query, options.brandfetch || {});
  if (!primary.candidates.length) {
    return { ...secondary, lookup_success: primary.lookup_success || secondary.lookup_success };
  }
  const scoresByDomain = new Map(secondary.candidates.map((candidate) => [candidate.domain, candidate]));
  return {
    ...primary,
    candidates: [...primary.candidates.map((candidate) => {
      const scores = scoresByDomain.get(candidate.domain);
      return {
        ...candidate,
        _score: scores?._score ?? null,
        qualityScore: scores?.qualityScore ?? null,
        score_source: scores ? "brandfetch" : null
      };
    }), ...secondary.candidates.filter((candidate) => !primary.candidates.some((item) => item.domain === candidate.domain))]
  };
}

export async function searchClearbit(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return lookupResult(cleanQuery, [], false);
  const apiUrl = options.apiUrl || DEFAULT_CLEARBIT_API;
  const url = new URL(apiUrl.replace("{token}", encodeURIComponent(cleanQuery)));
  if (!apiUrl.includes("{token}")) url.searchParams.set("query", cleanQuery);
  return fetchBrandCandidates(cleanQuery, url.toString(), normalizeClearbitItem, options);
}

export async function searchBrandfetch(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return lookupResult(cleanQuery, [], false);

  const apiUrl = options.apiUrl || DEFAULT_BRANDFETCH_API;
  const url = apiUrl.includes("{query}")
    ? apiUrl.replace("{query}", encodeURIComponent(cleanQuery))
    : `${apiUrl.replace(/\/$/, "")}/${encodeURIComponent(cleanQuery)}`;

  return fetchBrandCandidates(cleanQuery, url, normalizeBrandfetchItem, options);
}

async function fetchBrandCandidates(query, url, normalizeItem, options) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)) : null;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller?.signal
    });
    if (!response.ok) return lookupResult(query, [], false);
    const data = await response.json();
    if (!Array.isArray(data)) return lookupResult(query, [], false);
    const results = data.slice(0, 8).map(normalizeItem).filter(Boolean);
    return lookupResult(query, results, true);
  } catch {
    return lookupResult(query, [], false);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function buildBrandQueries(title, originalHostname, finalHostname = originalHostname, originalPath = "", finalPath = originalPath) {
  const queries = [
    ...hostnameBrandTokens(originalHostname),
    ...hostnameBrandTokens(finalHostname),
    ...pathBrandTokens(originalPath),
    ...pathBrandTokens(finalPath),
    ...titleBrandQueries(title)
  ];
  return sortedUnique(queries).slice(0, 10);
}

export function titleBrandQueries(title) {
  const text = String(title || "").trim();
  if (!text) return [];
  return text
    .split(TITLE_SEPARATORS)
    .flatMap((part) => tokenCandidates(part))
    .filter((token) => token.length >= 3 && token.length <= 40);
}

export function hostnameBrandTokens(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const parsed = parseDomain(host, { allowPrivateDomains: false });
  if (!host || parsed.isIp) return [];

  const labels = [
    ...(parsed.subdomain || "").split(".").filter(Boolean),
    parsed.domainWithoutSuffix || fallbackDomainLabel(host)
  ].map((label) => String(label || "").toLowerCase()).filter(Boolean);
  const searchableLabels = labels.filter((label) => label !== "www");
  const tokens = [];

  for (const label of searchableLabels) {
    const normalizedLabel = normalizeToken(label);
    if (normalizedLabel && !GENERIC_TOKENS.has(normalizedLabel) && !/^\d+$/.test(normalizedLabel)) {
      tokens.push(normalizedLabel);
    }
    tokens.push(...tokenCandidates(label));
  }

  return sortedUnique(tokens);
}

export function pathBrandTokens(pathname) {
  const segments = String(pathname || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const tokens = [];

  for (const segment of segments) {
    const normalizedSegment = normalizeToken(segment);
    if (normalizedSegment && !GENERIC_TOKENS.has(normalizedSegment) && !/^\d+$/.test(normalizedSegment)) {
      tokens.push(normalizedSegment);
    }
    tokens.push(...tokenCandidates(segment));
  }

  return sortedUnique(tokens);
}

export function topBrandCandidate(lookupResults, originalUrl, finalUrl) {
  const candidates = [];
  for (const result of lookupResults || []) {
    for (const item of result.candidates || []) {
      const normalized = normalizeBrandCandidate(item, result.query);
      if (normalized) {
        candidates.push({
          ...normalized,
          query_priority: brandQueryPriority(result.query, originalUrl, finalUrl)
        });
      }
    }
  }

  if (!candidates.length) {
    return emptyBrandCandidate(originalUrl, finalUrl);
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    const primaryDifference = Number(b.source === "clearbit") - Number(a.source === "clearbit");
    if (primaryDifference) return primaryDifference;
    const scoreA = Number(a._score ?? a.score ?? 0);
    const scoreB = Number(b._score ?? b.score ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0);
  });

  let selected = sortedCandidates.find((candidate) => isCredibleBrandCandidate(candidate, originalUrl, finalUrl));
  const activeDomainCandidate = sortedCandidates.find((candidate) => isActiveDomainBrandCandidate(candidate, originalUrl, finalUrl));
  if (selected && activeDomainCandidate && shouldPreferActiveDomainBrand(selected, activeDomainCandidate, originalUrl, finalUrl)) {
    selected = activeDomainCandidate;
  }

  if (!selected) return emptyBrandCandidate(originalUrl, finalUrl);

  const relationship = brandRelationshipFields(selected.domain, originalUrl, finalUrl);

  return {
    brand_found: true,
    brand_top_candidate_name: selected.name || null,
    brand_top_candidate_domain: selected.domain || null,
    brand_top_candidate_source: selected.source || "brandfetch",
    brand_top_candidate_score_source: selected.score_source || (selected.source === "brandfetch" ? "brandfetch" : null),
    brand_top_candidate_query: selected.query || null,
    brand_top_candidate_query_priority: selected.query_priority || null,
    brand_search_score: numberOrNull(selected._score ?? selected.score),
    brand_quality_score: numberOrNull(selected.qualityScore),
    ...relationship
  };
}

export function brandRelationshipFields(candidateDomain, originalUrl, finalUrl = originalUrl) {
  const candidate = registrableDomain(candidateDomain ? `https://${candidateDomain}` : "");
  const original = parsedUrlParts(originalUrl);
  const final = parsedUrlParts(finalUrl);

  return {
    brand_matches_source: Boolean(candidate && original.registrableDomain && candidate === original.registrableDomain),
    brand_matches_page: Boolean(candidate && final.registrableDomain && candidate === final.registrableDomain),
    brand_source_similarity: candidate && original.registrableDomain
      ? sequenceRatio(domainLabel(candidate), domainLabel(original.registrableDomain))
      : 0,
    brand_page_similarity: candidate && final.registrableDomain
      ? sequenceRatio(domainLabel(candidate), domainLabel(final.registrableDomain))
      : 0,
    brand_in_source_subdomain: candidate ? includesToken(original.subdomain, domainLabel(candidate)) : false,
    brand_in_source_path: candidate ? includesToken(original.path, domainLabel(candidate)) : false,
    brand_in_source_query: candidate ? includesToken(original.query, domainLabel(candidate)) : false
  };
}

function lookupResult(query, candidates, lookupSuccess) {
  return { query, candidates, lookup_success: Boolean(lookupSuccess) };
}

function emptyBrandCandidate(originalUrl, finalUrl) {
  return {
    brand_found: false,
    brand_top_candidate_name: null,
    brand_top_candidate_domain: null,
    brand_top_candidate_source: null,
    brand_top_candidate_score_source: null,
    brand_top_candidate_query: null,
    brand_top_candidate_query_priority: null,
    brand_search_score: null,
    brand_quality_score: null,
    ...brandRelationshipFields(null, originalUrl, finalUrl)
  };
}

function isCredibleBrandCandidate(candidate, originalUrl, finalUrl) {
  const relationship = brandRelationshipFields(candidate.domain, originalUrl, finalUrl);
  if (relationship.brand_matches_source || relationship.brand_matches_page) return true;

  const candidateLabel = normalizeToken(domainLabel(candidate.domain));
  const candidateName = normalizeToken(candidate.name);
  const query = normalizeToken(candidate.query);

  if (isPublicHostingPlatformBrandCandidate(candidate, originalUrl, finalUrl)) {
    return false;
  }

  if (
    ["brandfetch", "clearbit"].includes(candidate.source) &&
    query.length <= 3 &&
    !relationship.brand_in_source_subdomain &&
    !relationship.brand_in_source_path &&
    !relationship.brand_in_source_query
  ) {
    return false;
  }

  if (
    GENERIC_TOKENS.has(query) ||
    GENERIC_TOKENS.has(candidateLabel) ||
    GENERIC_TOKENS.has(candidateName)
  ) {
    return false;
  }

  if (
    relationship.brand_in_source_subdomain ||
    relationship.brand_in_source_path ||
    relationship.brand_in_source_query
  ) {
    return true;
  }
  return Math.max(
    relationship.brand_source_similarity,
    relationship.brand_page_similarity
  ) >= 0.86;
}

function isActiveDomainBrandCandidate(candidate, originalUrl, finalUrl) {
  const relationship = brandRelationshipFields(candidate.domain, originalUrl, finalUrl);
  if (!relationship.brand_matches_source && !relationship.brand_matches_page) return false;

  const query = normalizeToken(candidate.query);
  const activeLabels = activeDomainLabels(originalUrl, finalUrl);
  if (!activeLabels.has(query)) return false;

  return Number(candidate.qualityScore || 0) >= 0.5 && Number(candidate._score ?? candidate.score ?? 0) >= 10;
}

function shouldPreferActiveDomainBrand(selected, activeDomainCandidate, originalUrl, finalUrl) {
  if (selected === activeDomainCandidate) return false;
  if (isPublicHostingActiveDomain(originalUrl, finalUrl)) return false;

  const selectedRelationship = brandRelationshipFields(selected.domain, originalUrl, finalUrl);
  const selectedMatchesActiveDomain = Boolean(
    selectedRelationship.brand_matches_source ||
    selectedRelationship.brand_matches_page
  );
  if (selectedMatchesActiveDomain) return false;

  return Boolean(
    selectedRelationship.brand_in_source_subdomain ||
    selectedRelationship.brand_in_source_path ||
    selectedRelationship.brand_in_source_query ||
    selected.query !== activeDomainCandidate.query
  );
}

function activeDomainLabels(originalUrl, finalUrl) {
  return new Set([
    domainLabel(registrableDomain(originalUrl)),
    domainLabel(registrableDomain(finalUrl))
  ].map(normalizeToken).filter(Boolean));
}

function isPublicHostingActiveDomain(originalUrl, finalUrl) {
  return [registrableDomain(originalUrl), registrableDomain(finalUrl)]
    .filter(Boolean)
    .some((domain) => PUBLIC_HOSTING_PLATFORM_DOMAINS.has(domain));
}

function isPublicHostingPlatformBrandCandidate(candidate, originalUrl, finalUrl) {
  const candidateLabel = normalizeToken(domainLabel(candidate.domain));
  const query = normalizeToken(candidate.query);
  return [registrableDomain(originalUrl), registrableDomain(finalUrl)]
    .filter(Boolean)
    .some((domain) => {
      if (!PUBLIC_HOSTING_PLATFORM_DOMAINS.has(domain)) return false;
      const platformLabel = normalizeToken(domainLabel(domain));
      return candidateLabel === platformLabel || query === platformLabel;
    });
}

function brandQueryPriority(query, originalUrl, finalUrl) {
  const normalizedQuery = normalizeToken(query);
  if (!normalizedQuery) return 0;

  const activeLabels = new Set([
    domainLabel(registrableDomain(originalUrl)),
    domainLabel(registrableDomain(finalUrl))
  ].map(normalizeToken).filter(Boolean));
  if (activeLabels.has(normalizedQuery)) return 30;

  const hostTokens = new Set([
    ...hostnameBrandTokens(hostnameOf(originalUrl)),
    ...hostnameBrandTokens(hostnameOf(finalUrl))
  ]);
  if (hostTokens.has(normalizedQuery)) return 15;

  const pathTokens = new Set([
    ...pathBrandTokens(pathOf(originalUrl)),
    ...pathBrandTokens(pathOf(finalUrl))
  ]);
  if (pathTokens.has(normalizedQuery)) return 20;

  return 10;
}

function normalizeClearbitItem(item) {
  if (!item || typeof item !== "object") return null;
  const domain = registrableBrandDomain(item.domain);
  if (!domain) return null;
  return { name: item.name || null, domain, source: "clearbit", _score: null, qualityScore: null };
}

function normalizeBrandfetchItem(item) {
  if (!item || typeof item !== "object") return null;
  const domain = registrableBrandDomain(item.domain);
  if (!domain) return null;
  return {
    name: item.name || null,
    domain,
    source: "brandfetch",
    _score: numberOrNull(item._score ?? item.score),
    qualityScore: numberOrNull(item.qualityScore)
  };
}

function normalizeBrandCandidate(item, query) {
  if (!item || typeof item !== "object") return null;
  const domain = registrableBrandDomain(item.domain);
  if (!domain) return null;
  return {
    ...item,
    domain,
    query
  };
}

function registrableBrandDomain(value) {
  const host = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
  if (!host || !host.includes(".")) return null;

  const domain = parseDomain(host, { allowPrivateDomains: false });
  if (domain.isIp || !domain.domain || !domain.publicSuffix) return null;
  return domain.domain;
}

function tokenCandidates(value) {
  return String(value || "")
    .split(/[^a-zA-Z0-9]+/)
    .map(normalizeToken)
    .filter((token) => token && !GENERIC_TOKENS.has(token) && !/^\d+$/.test(token));
}

function parsedUrlParts(url) {
  let parsed = null;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return { registrableDomain: null, subdomain: "", path: "", query: "" };
  }

  const domain = parseDomain(parsed.hostname, { allowPrivateDomains: false });
  return {
    registrableDomain: domain.isIp ? parsed.hostname.toLowerCase() : domain.domain || parsed.hostname.toLowerCase(),
    subdomain: domain.subdomain || "",
    path: parsed.pathname || "",
    query: parsed.search.replace(/^\?/, "") || ""
  };
}

function registrableDomain(url) {
  try {
    const parsed = new URL(String(url || ""));
    const domain = parseDomain(parsed.hostname, { allowPrivateDomains: false });
    return domain.isIp ? parsed.hostname.toLowerCase() : domain.domain || parsed.hostname.toLowerCase();
  } catch {
    const host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0];
    if (!host) return null;
    const domain = parseDomain(host, { allowPrivateDomains: false });
    return domain.domain || host.toLowerCase();
  }
}

function fallbackDomainLabel(host) {
  const parts = String(host || "").split(".").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length <= 2) return parts[0] || "";
  return parts[parts.length - 2] || "";
}

function hostnameOf(url) {
  try {
    return new URL(String(url || "")).hostname;
  } catch {
    return "";
  }
}

function pathOf(url) {
  try {
    return new URL(String(url || "")).pathname || "";
  } catch {
    return "";
  }
}

function domainLabel(domain) {
  const parsed = parseDomain(String(domain || ""), { allowPrivateDomains: false });
  return String(parsed.domainWithoutSuffix || String(domain || "").split(".")[0] || "").toLowerCase();
}

function includesToken(value, token) {
  const normalizedValue = String(value || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  return Boolean(normalizedToken && normalizedValue.includes(normalizedToken));
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function sequenceRatio(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const matches = sequenceMatcherMatches(left, right);
  return (2 * matches) / (left.length + right.length);
}

function sequenceMatcherMatches(a, b) {
  const stack = [[0, a.length, 0, b.length]];
  let matches = 0;
  while (stack.length) {
    const [alo, ahi, blo, bhi] = stack.pop();
    const block = findLongestMatch(a, b, alo, ahi, blo, bhi);
    if (!block.size) continue;
    matches += block.size;
    if (alo < block.i && blo < block.j) stack.push([alo, block.i, blo, block.j]);
    if (block.i + block.size < ahi && block.j + block.size < bhi) {
      stack.push([block.i + block.size, ahi, block.j + block.size, bhi]);
    }
  }
  return matches;
}

function findLongestMatch(a, b, alo, ahi, blo, bhi) {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  const j2len = new Map();
  for (let i = alo; i < ahi; i += 1) {
    const newJ2len = new Map();
    for (let j = blo; j < bhi; j += 1) {
      if (a[i] !== b[j]) continue;
      const size = (j2len.get(j - 1) || 0) + 1;
      newJ2len.set(j, size);
      if (size > bestSize) {
        bestI = i - size + 1;
        bestJ = j - size + 1;
        bestSize = size;
      }
    }
    j2len.clear();
    for (const [key, value] of newJ2len) j2len.set(key, value);
  }
  return { i: bestI, j: bestJ, size: bestSize };
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sortedUnique(values) {
  return [...new Set(values.map(normalizeToken).filter(Boolean))];
}
