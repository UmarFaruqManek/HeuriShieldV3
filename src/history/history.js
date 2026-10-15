/*
 * Menampilkan riwayat analisis tersimpan dan menghubungkan tindakan pengguna pada tabel.
 * Riwayat lokal extension berbeda dari workbook hasil batch testing di luar browser.
 */
import { VERDICT_LABELS_ID } from "../utils/constants.js";
import { clearUrlHistory, getUrlHistory, saveUrlHistoryVisit } from "../storage/settings.js";
import { isSupportedHttpUrl } from "../utils/helpers.js";

const elements = {
  searchInput: document.querySelector("#searchInput"),
  verdictFilter: document.querySelector("#verdictFilter"),
  refreshButton: document.querySelector("#refreshButton"),
  clearButton: document.querySelector("#clearButton"),
  historyTableBody: document.querySelector("#historyTableBody"),
  emptyState: document.querySelector("#emptyState")
};

let historyItems = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadHistory();

  elements.searchInput.addEventListener("input", renderHistory);
  elements.verdictFilter.addEventListener("change", renderHistory);
  elements.refreshButton.addEventListener("click", loadHistory);
  elements.clearButton.addEventListener("click", handleClear);
}

async function loadHistory() {
  await syncOpenTabsToHistory();
  historyItems = await getUrlHistory();
  renderHistory();
}

async function syncOpenTabsToHistory() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id && tab.url && isSupportedHttpUrl(tab.url))
      .map((tab) => saveUrlHistoryVisit(tab.id, tab.url))
  );
}

function renderHistory() {
  const filtered = filterHistory(historyItems);

  elements.emptyState.hidden = filtered.length > 0;
  elements.historyTableBody.replaceChildren(
    ...filtered.map((item) =>
      createRow([
        createIdCell(item.id),
        createUrlCell(item.url),
        createTextCell(item.domain || item.registrable_domain || item.hostname || "-"),
        createDecisionCell(item.status || item.verdict),
        createStatusCell(item.status || item.verdict),
        createReasonCell(item.reasons),
        createTimeCell(item.analyzed_at)
      ])
    )
  );
}

function filterHistory(items) {
  // Filter hanya tampilan daftar; tidak menghapus catatan atau mengubah klasifikasi.
  const query = elements.searchInput.value.trim().toLowerCase();
  const verdict = elements.verdictFilter.value;

  return items.filter((item) => {
    const itemStatus = item.status || item.verdict;
    const matchesVerdict = verdict === "all" || itemStatus === verdict;
    const haystack = `${item.url || ""} ${item.domain || ""} ${item.hostname || ""} ${item.registrable_domain || ""} ${item.reasons || ""}`.toLowerCase();
    return matchesVerdict && (!query || haystack.includes(query));
  });
}

function createRow(cells) {
  const row = document.createElement("tr");
  row.replaceChildren(
    ...cells.map((cell) => {
      const tableCell = document.createElement("td");
      tableCell.append(cell);
      return tableCell;
    })
  );
  return row;
}

function createTextCell(text) {
  const span = document.createElement("span");
  span.className = "domain-cell";
  span.title = text;
  span.textContent = text;
  return span;
}

function createIdCell(id) {
  const span = document.createElement("span");
  span.className = "id-cell";
  span.textContent = String(id || "-");
  return span;
}

function createUrlCell(url) {
  const span = document.createElement("span");
  span.className = "url-cell";
  span.title = url || "-";
  span.textContent = url || "-";
  return span;
}

function createDecisionCell(verdict) {
  const span = document.createElement("span");
  span.className = "score-cell";
  span.textContent = getDecisionClassLabel(verdict);
  return span;
}

function createStatusCell(verdict) {
  const span = document.createElement("span");
  span.className = "hs-pill";
  span.dataset.verdict = verdict || "LIMITED";
  span.textContent = VERDICT_LABELS_ID[verdict] || verdict || "Analisis Terbatas";
  return span;
}

function getDecisionClassLabel(verdict) {
  return {
    SAFE: "Legitimate",
    WARNING: "Warning",
    DANGEROUS: "Phishing",
    LIMITED: "Analisis Terbatas"
  }[verdict] || VERDICT_LABELS_ID[verdict] || verdict || "Analisis Terbatas";
}

function createTimeCell(value) {
  const span = document.createElement("span");
  span.className = "time-cell";
  span.textContent = formatDateTime(value);
  return span;
}

function createReasonCell(reasons) {
  const span = document.createElement("span");
  span.className = "reason-cell";
  span.title = reasons || "-";
  span.textContent = reasons || "-";
  return span;
}

async function handleClear() {
  const confirmed = confirm("Hapus semua riwayat URL?");
  if (!confirmed) {
    return;
  }

  await clearUrlHistory();
  historyItems = [];
  renderHistory();
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
