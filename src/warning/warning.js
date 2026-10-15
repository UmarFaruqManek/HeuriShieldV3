/*
 * Membaca konteks hasil sebelum redirect dan menampilkan alasan ringkas halaman blokir.
 * Tombol lanjut mengirim permintaan bypass sementara sebelum kembali ke URL tujuan.
 */
import { getWarningContext, getAnalysisByTab } from "../storage/settings.js";
import { buildAnalysisExplanation } from "../shared/analysis-explanation.js";

const params = new URLSearchParams(location.search);
const contextId = params.get("id");
const elements = {
  domain: document.querySelector("#domain"),
  score: document.querySelector("#score"),
  reasonList: document.querySelector("#reasonList"),
  redirectSourceSection: document.querySelector("#redirectSourceSection"),
  redirectSourceText: document.querySelector("#redirectSourceText"),
  backButton: document.querySelector("#backButton"),
  continueButton: document.querySelector("#continueButton")
};

let originalUrl = null;
let currentTabId = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  currentTabId = await getCurrentTabId();
  let context = contextId ? await getWarningContext(contextId) : null;
  if (context && !context.analysis && currentTabId !== null) {
    const previous = await getAnalysisByTab(currentTabId);
    if (previous && (previous.final_url || previous.url) === context.originalUrl) context.analysis = previous;
  }
  // Cadangan per tab mempertahankan identitas saat daftar konteks lokal dipangkas.
  const cacheKey = `heurishield-warning:${contextId}`;
  if (context) { try { sessionStorage.setItem(cacheKey, JSON.stringify(context)); } catch { /* Storage utama tetap menjadi sumber. */ } }
  else if (contextId) {
    try { context = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); } catch { /* Cache invalid tidak dipakai. */ }
  }

  if (!context) {
    renderFallback();
  } else {
    try {
      const parsed = new URL(context.originalUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Bukan situs web.");
      originalUrl = parsed.href;
      elements.domain.textContent = parsed.hostname;
      document.title = `HeuriShield - ${parsed.hostname} diblokir`;
    } catch { renderFallback(); return; }
    elements.score.textContent = getDecisionClassLabel(context.verdict);
    const explanation = context.analysis ? buildAnalysisExplanation(context.analysis) : context.explanation || buildAnalysisExplanation(context);
    document.querySelector("h1").textContent = explanation.title;
    document.querySelector(".lead").textContent = explanation.summary;
    document.querySelector("#reasonAdvice").textContent = explanation.action;
    document.querySelector("#reasonNote").textContent = explanation.limitation || "";
    document.querySelector("#reasonNote").hidden = !explanation.limitation;
    renderReasons(explanation.reasons);
    renderRedirectSource(context.redirect_source_warning);
  }

  elements.backButton.addEventListener("click", () => history.back());
  elements.continueButton.addEventListener("click", continueAnyway);
}

function renderFallback() {
  elements.domain.textContent = "Tidak tersedia";
  elements.score.textContent = "Phishing";
  renderReasons(["Detail analisis tidak tersedia, tetapi halaman ini dibuka dari proteksi HeuriShield."]);
  renderRedirectSource(null);
}

function renderReasons(reasons) {
  const items = reasons.length ? reasons.slice(0, 3) : ["Detail pemeriksaan belum tersedia."];
  elements.reasonList.replaceChildren(
    ...items.map((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      return item;
    })
  );
}

function renderRedirectSource(warning) {
  if (!warning) {
    elements.redirectSourceSection.hidden = true;
    elements.redirectSourceText.textContent = "";
    return;
  }

  elements.redirectSourceSection.hidden = false;
  if (warning.trigger === "final_risk_after_redirect") {
    elements.redirectSourceText.textContent =
      `${warning.source_domain || "Domain awal"} mengarah ke ${warning.final_domain || "domain akhir"}; halaman akhir berstatus ${getDecisionClassLabel(warning.final_verdict)}.`;
    return;
  }

  elements.redirectSourceText.textContent =
    `${warning.source_domain || "Domain awal"} berstatus ${getDecisionClassLabel(warning.source_verdict)} sebelum mengarah ke ${warning.final_domain || "domain akhir"}.`;
}

function getDecisionClassLabel(verdict) {
  return {
    SAFE: "Legitimate",
    WARNING: "Warning",
    DANGEROUS: "Phishing",
    LIMITED: "Analisis terbatas"
  }[verdict] || verdict || "Phishing";
}
async function continueAnyway() {
  // Pengecualian sementara untuk navigasi ini; bukan perubahan label latih atau model.
  if (originalUrl) {
    await chrome.runtime.sendMessage({
      type: "TEMPORARY_BYPASS_URL",
      tabId: currentTabId,
      url: originalUrl
    }).catch(() => null);
    location.href = originalUrl;
    return;
  }

  history.back();
}

async function getCurrentTabId() {
  try {
    const tab = await chrome.tabs.getCurrent();
    return Number.isInteger(tab?.id) ? tab.id : null;
  } catch {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return Number.isInteger(tab?.id) ? tab.id : null;
    } catch {
      return null;
    }
  }
}
