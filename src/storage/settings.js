/*
 * Akses chrome.storage untuk pengaturan, hasil per tab, riwayat dan konteks halaman blokir.
 * Fungsi di sini menyimpan/membaca data; bukan evaluator klasifikasi.
 */
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../utils/constants.js";

export async function getSetting(key, fallback) {
  const result = await chrome.storage.local.get({ [key]: fallback });
  return result[key];
}

export async function setSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function isProtectionEnabled() {
  return getSetting(STORAGE_KEYS.ENABLED, DEFAULT_SETTINGS.heurishieldEnabled);
}

export async function setProtectionEnabled(enabled) {
  await setSetting(STORAGE_KEYS.ENABLED, Boolean(enabled));
}

export async function getAnalysisByTab(tabId) {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: {} });
  return result[STORAGE_KEYS.ANALYSIS_BY_TAB][String(tabId)] || null;
}

export async function saveAnalysisForTab(tabId, analysis) {
  // Pisahkan hasil per tab agar panel tidak mengambil keputusan milik tab lain.
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: {} });
  const analysisByTab = result[STORAGE_KEYS.ANALYSIS_BY_TAB];

  analysisByTab[String(tabId)] = {
    ...analysis,
    analyzed_at: new Date().toISOString()
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: analysisByTab });
}

export async function removeAnalysisForTab(tabId) {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: {} });
  const analysisByTab = result[STORAGE_KEYS.ANALYSIS_BY_TAB];
  delete analysisByTab[String(tabId)];
  await chrome.storage.local.set({ [STORAGE_KEYS.ANALYSIS_BY_TAB]: analysisByTab });
}

export async function getUrlHistory() {
  return getSetting(STORAGE_KEYS.URL_HISTORY, []);
}

export async function saveUrlHistoryVisit(tabId, url) {
  if (!url) {
    return;
  }

  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  await saveHistoryItem(
    tabId,
    {
      url,
      domain: parsed.hostname,
      score: 0,
      status: "LIMITED",
      reasons: "Analisis belum selesai."
    },
    { preserveExistingAnalysis: true }
  );
}

export async function saveUrlHistoryEntry(tabId, analysis) {
  if (!analysis?.url && !analysis?.normalized_url) {
    return;
  }

  await saveHistoryItem(tabId, {
    url: analysis.normalized_url || analysis.url,
    domain: analysis.registrable_domain || analysis.hostname || "",
    score: analysis.score ?? 0,
    status: analysis.verdict || "LIMITED",
    reasons: buildHistoryReasons(analysis)
  });
}

async function saveHistoryItem(tabId, item, options = {}) {
  const history = await getUrlHistory();
  const now = new Date().toISOString();
  const existingIndex = history.findIndex((historyItem) => historyItem.tabId === tabId && historyItem.url === item.url);
  const previous = existingIndex > -1 ? history[existingIndex] : null;
  const mergedItem =
    options.preserveExistingAnalysis && previous
      ? {
          ...item,
          score: previous.score ?? item.score,
          status: previous.status || previous.verdict || item.status,
          reasons: previous.reasons || item.reasons
        }
      : item;
  const entry = {
    id: getHistoryId(previous, history),
    tabId,
    analyzed_at: now,
    ...mergedItem
  };

  if (existingIndex > -1) {
    history.splice(existingIndex, 1);
  }

  history.unshift(entry);
  await setSetting(STORAGE_KEYS.URL_HISTORY, history.slice(0, 200));
}

function getHistoryId(previous, history) {
  const previousId = Number(previous?.id);
  if (Number.isInteger(previousId) && previousId > 0) {
    return previousId;
  }

  return getNextHistoryId(history);
}

function getNextHistoryId(history) {
  const maxId = history.reduce((max, item) => {
    const id = Number(item.id);
    return Number.isInteger(id) && id > max ? id : max;
  }, 0);

  return maxId + 1;
}

function buildHistoryReasons(analysis) {
  const reasons = analysis?.matched_rules
    ?.map((rule) => rule.reason || rule.id)
    .filter(Boolean);

  if (reasons?.length) {
    return reasons.join("; ");
  }

  return "Tidak ada risiko besar yang terdeteksi.";
}

export async function clearUrlHistory() {
  await setSetting(STORAGE_KEYS.URL_HISTORY, []);
}

export async function getDomainCache() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.DOMAIN_METADATA_CACHE]: {} });
  return result[STORAGE_KEYS.DOMAIN_METADATA_CACHE];
}

export async function saveDomainCache(domain, metadata) {
  const cache = await getDomainCache();

  cache[domain] = {
    metadata,
    cached_at: new Date().toISOString()
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_METADATA_CACHE]: cache });
}

let warningContextWrites = Promise.resolve();
export function saveWarningContext(id, context) {
  // Dua tab diblokir bersamaan tidak boleh saling menghapus konteks.
  const operation = warningContextWrites.then(() => writeWarningContext(id, context));
  warningContextWrites = operation.catch(() => {});
  return operation;
}

async function writeWarningContext(id, context) {
  // Halaman blokir mengambil temuan lama memakai ID ini, tanpa menganalisis dirinya.
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.WARNING_CONTEXTS]: {} });
  const contexts = result[STORAGE_KEYS.WARNING_CONTEXTS];
  contexts[id] = {
    ...context,
    created_at: new Date().toISOString()
  };

  const entries = Object.entries(contexts)
    .sort(([, left], [, right]) => Date.parse(right?.created_at || 0) - Date.parse(left?.created_at || 0))
    .slice(0, 100);

  const prunedContexts = Object.fromEntries(entries);

  await chrome.storage.local.set({ [STORAGE_KEYS.WARNING_CONTEXTS]: prunedContexts });
}

export async function getWarningContext(id) {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.WARNING_CONTEXTS]: {} });
  return result[STORAGE_KEYS.WARNING_CONTEXTS][id] || null;
}

export async function getAllowlist() {
  return getSetting(STORAGE_KEYS.ALLOWLIST, []);
}

export async function addToAllowlist(domain) {
  const list = await getAllowlist();
  if (!list.includes(domain)) {
    list.push(domain);
    await setSetting(STORAGE_KEYS.ALLOWLIST, list);
    // Remove from blacklist if it exists
    await removeFromBlacklist(domain);
  }
}

export async function removeFromAllowlist(domain) {
  const list = await getAllowlist();
  const index = list.indexOf(domain);
  if (index > -1) {
    list.splice(index, 1);
    await setSetting(STORAGE_KEYS.ALLOWLIST, list);
  }
}

export async function getBlacklist() {
  return getSetting(STORAGE_KEYS.BLACKLIST, []);
}

export async function addToBlacklist(domain) {
  const list = await getBlacklist();
  if (!list.includes(domain)) {
    list.push(domain);
    await setSetting(STORAGE_KEYS.BLACKLIST, list);
    // Remove from allowlist if it exists
    await removeFromAllowlist(domain);
  }
}

export async function removeFromBlacklist(domain) {
  const list = await getBlacklist();
  const index = list.indexOf(domain);
  if (index > -1) {
    list.splice(index, 1);
    await setSetting(STORAGE_KEYS.BLACKLIST, list);
  }
}
