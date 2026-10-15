/*
 * Fungsi bantu URL/domain dan format yang dipakai modul lain.
 * Gunakan fungsi analyzer aktif untuk mempelajari definisi 60 fitur model.
 */
import { COMMON_PUBLIC_SUFFIX_SECOND_LEVEL_LABELS, PUBLIC_SUFFIX_EXCEPTIONS } from "./constants.js";

export function nowIso() {
  return new Date().toISOString();
}

export function daysBetween(fromDate, toDate = new Date()) {
  const fromTime = new Date(fromDate).getTime();
  const toTime = toDate.getTime();

  if (!Number.isFinite(fromTime)) {
    return null;
  }

  return Math.max(0, Math.floor((toTime - fromTime) / 86400000));
}

export function isSupportedHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function countDigits(text) {
  return (String(text || "").match(/\d/g) || []).length;
}

export function countHyphens(text) {
  return (String(text || "").match(/-/g) || []).length;
}

export function countSpecialChars(text) {
  return (String(text || "").match(/[^a-z0-9]/gi) || []).length;
}

export function calculateEntropy(text) {
  const value = String(text || "");

  if (!value) {
    return 0;
  }

  const frequencies = new Map();
  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }

  const entropy = Array.from(frequencies.values()).reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);

  return Number(entropy.toFixed(3));
}

export function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

export function daysUntil(dateValue, fromDate = new Date()) {
  const targetTime = new Date(dateValue).getTime();
  const fromTime = fromDate.getTime();

  if (!Number.isFinite(targetTime)) {
    return null;
  }

  return Math.ceil((targetTime - fromTime) / 86400000);
}

export function daysBetweenDates(startDate, endDate) {
  const startTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  return Math.max(0, Math.floor((endTime - startTime) / 86400000));
}

export function normalizeHostname(hostname) {
  return String(hostname || "").replace(/\.$/, "").toLowerCase();
}

export function getRegistrableDomain(hostname) {
  const normalized = normalizeHostname(hostname);

  if (!normalized || isIpAddress(normalized)) {
    return normalized;
  }

  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return normalized;
  }

  const lastTwo = labels.slice(-2).join(".");
  const lastThree = labels.slice(-3).join(".");

  if (PUBLIC_SUFFIX_EXCEPTIONS.has(lastTwo) && labels.length >= 3) {
    return lastThree;
  }

  if (isCommonCountryCodeSecondLevelSuffix(labels) && labels.length >= 3) {
    return lastThree;
  }

  return lastTwo;
}

export function getTld(hostname) {
  const labels = normalizeHostname(hostname).split(".").filter(Boolean);
  return labels.length ? labels[labels.length - 1] : "";
}

export function getSubdomainCount(hostname, registrableDomain) {
  const normalized = normalizeHostname(hostname);
  const registrable = normalizeHostname(registrableDomain);

  if (!normalized || !registrable || normalized === registrable) {
    return 0;
  }

  if (!normalized.endsWith(`.${registrable}`)) {
    return 0;
  }

  return normalized.slice(0, -(registrable.length + 1)).split(".").filter(Boolean).length;
}

export function isIpAddress(hostname) {
  const host = normalizeHostname(hostname).replace(/^\[/, "").replace(/\]$/, "");
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
  const ipv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);

  return ipv4 || ipv6;
}

export function timeoutSignal(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
}

export function formatAge(days) {
  if (days === null || days === undefined) {
    return "Tidak tersedia";
  }

  if (days < 1) {
    return "Kurang dari 1 hari";
  }

  return `${days} hari`;
}


function isCommonCountryCodeSecondLevelSuffix(labels) {
  const tld = labels[labels.length - 1] || "";
  const secondLevel = labels[labels.length - 2] || "";

  return (
    tld.length === 2 &&
    /^[a-z]{2}$/.test(tld) &&
    COMMON_PUBLIC_SUFFIX_SECOND_LEVEL_LABELS.has(secondLevel)
  );
}
