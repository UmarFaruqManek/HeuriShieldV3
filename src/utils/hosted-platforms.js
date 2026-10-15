/*
 * Mengenali platform hosting publik dari daftar suffix dan menentukan bagian host situs.
 * Nama platform membantu memberi konteks, bukan otomatis berarti phishing.
 */
import {
  HOSTED_PLATFORM_AUTH_TOKENS,
  PUBLIC_HOSTING_PLATFORM_DOMAINS
} from "./constants.js";
import { normalizeHostname, safeDecode } from "./helpers.js";

const WORD_SEPARATORS = /[^a-z0-9]+/i;

export function analyzeHostedPlatformContext(parsed, hostname) {
  const normalizedHost = normalizeHostname(hostname || parsed.hostname);
  const publicPlatformDomain = findMatchingSuffix(normalizedHost, PUBLIC_HOSTING_PLATFORM_DOMAINS);
  const platformDomain = publicPlatformDomain || null;
  const tenantLabel = platformDomain ? getTenantLabel(normalizedHost, platformDomain) : "";
  const tenantTokens = tokenizeHostedText(tenantLabel);
  const pathTokens = tokenizeHostedText(parsed.pathname);
  const queryKeyTokens = Array.from(parsed.searchParams.keys()).flatMap(tokenizeHostedText);
  const textForCompoundAuth = `${tenantLabel} ${safeDecode(parsed.pathname)} ${safeDecode(parsed.search)}`.toLowerCase();
  const authTokens = Array.from(HOSTED_PLATFORM_AUTH_TOKENS).filter((token) => {
    if (tenantTokens.includes(token) || pathTokens.includes(token) || queryKeyTokens.includes(token)) return true;
    return token.length >= 5 && textForCompoundAuth.includes(token);
  });
  const registeredBrandTokens = extractRegisteredBrandTokens([...tenantTokens, ...pathTokens]);
  const brandLikeTenantTokens = tenantTokens.filter((token) => isBrandLikeTenantToken(token, authTokens));
  const brandIntentTokens = uniqueValues([...registeredBrandTokens, ...brandLikeTenantTokens]);
  const hasDownloadIntent = [tenantLabel, parsed.pathname, parsed.search].some((text) =>
    /download|install|installer|setup|exe|msi|apk|pdf|document|docusign/i.test(safeDecode(String(text || "")))
  );
  const hasBrandLikeAuthCompound = tenantTokens.some((token) =>
    authTokens.some((authToken) => token !== authToken && token.includes(authToken) && token.length > authToken.length + 2)
  );

  return {
    is_public_hosting_platform: Boolean(publicPlatformDomain),
    is_trusted_tenant_platform: false,
    platform_domain: platformDomain,
    tenant_label: tenantLabel || null,
    auth_tokens: authTokens,
    tenant_token_count: tenantTokens.length,
    brand_like_tenant_tokens: brandLikeTenantTokens.slice(0, 3),
    registered_brand_tokens: registeredBrandTokens.slice(0, 5),
    brand_intent_tokens: brandIntentTokens.slice(0, 5),
    has_brand_like_auth_compound: hasBrandLikeAuthCompound,
    has_auth_context: authTokens.length > 0,
    has_download_intent: hasDownloadIntent,
    has_registered_brand_token: registeredBrandTokens.length > 0,
    has_brand_like_tenant: brandLikeTenantTokens.length > 0 || hasBrandLikeAuthCompound || registeredBrandTokens.length > 0
  };
}

export function isTrustedTenantPlatformHost(hostname) {
  return false;
}

export function isPublicHostingPlatformHost(hostname) {
  return Boolean(findMatchingSuffix(normalizeHostname(hostname), PUBLIC_HOSTING_PLATFORM_DOMAINS));
}

export function findMatchingSuffix(hostname, suffixes) {
  const normalized = normalizeHostname(hostname);
  for (const suffix of suffixes) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) {
      return suffix;
    }
  }
  return null;
}

function getTenantLabel(hostname, platformDomain) {
  if (hostname === platformDomain) return "";
  const prefix = hostname.endsWith(`.${platformDomain}`)
    ? hostname.slice(0, -(platformDomain.length + 1))
    : "";
  const labels = prefix.split(".").filter(Boolean);
  const label = labels.at(-1) || "";
  return label === "www" ? "" : label;
}

function tokenizeHostedText(text) {
  return safeDecode(String(text || ""))
    .toLowerCase()
    .split(WORD_SEPARATORS)
    .filter((token) => token.length >= 3 && token.length <= 30 && !/^\d+$/.test(token));
}

function isBrandLikeTenantToken(token, authTokens) {
  if (HOSTED_PLATFORM_AUTH_TOKENS.has(token)) return false;
  if (authTokens.some((authToken) => token === authToken)) return false;
  if (token.length < 4) return false;
  return /[a-z]/.test(token);
}

function extractRegisteredBrandTokens(_tokens) {
  return [];
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
