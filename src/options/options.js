/*
 * Menghubungkan form pengaturan dengan penyimpanan lokal extension.
 * Perubahan pengaturan dilakukan lewat kontrol halaman ini, bukan parameter hasil pelatihan.
 */
import {
  getAllowlist,
  getBlacklist,
  addToAllowlist,
  addToBlacklist,
  removeFromAllowlist,
  removeFromBlacklist
} from "../storage/settings.js";

const elements = {
  domainInput: document.querySelector("#domainInput"),
  typeSelect: document.querySelector("#typeSelect"),
  addButton: document.querySelector("#addButton"),
  listContainer: document.querySelector("#listContainer"),
  tabButtons: document.querySelectorAll(".tab-btn")
};

let currentTab = "all";
let isSubmitting = false;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await renderList();

  elements.addButton.addEventListener("click", handleAdd);
  elements.domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAdd();
  });

  elements.tabButtons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      elements.tabButtons.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentTab = e.target.dataset.tab;
      await renderList();
    });
  });
}

function cleanInputDomain(input) {
  // Bersihkan input menjadi domain sebelum menyimpan daftar izin/blokir pengguna.
  let cleaned = input.trim().toLowerCase();
  
  // Remove protocols
  if (cleaned.startsWith("http://")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("https://")) {
    cleaned = cleaned.substring(8);
  }

  // Remove leading www.
  if (cleaned.startsWith("www.")) {
    cleaned = cleaned.substring(4);
  }

  // Remove path and query parts
  const slashIdx = cleaned.indexOf("/");
  if (slashIdx > -1) {
    cleaned = cleaned.substring(0, slashIdx);
  }

  const colonIdx = cleaned.indexOf(":");
  if (colonIdx > -1) {
    cleaned = cleaned.substring(0, colonIdx);
  }

  return cleaned;
}

async function handleAdd() {
  if (isSubmitting) return;
  const rawInput = elements.domainInput.value;
  const domain = cleanInputDomain(rawInput);

  if (!domain) {
    alert("Silakan masukkan domain yang valid.");
    return;
  }

  // Simple validation to ensure it looks like a domain name
  if (!domain.includes(".") || domain.length < 4) {
    alert("Format domain tidak valid. Contoh: tokopedia.com");
    return;
  }

  const type = elements.typeSelect.value;
  setSubmitting(true);
  try {
    if (type === "allow") {
      await addToAllowlist(domain);
    } else {
      await addToBlacklist(domain);
    }

    elements.domainInput.value = "";
    await renderList();
  } finally {
    setSubmitting(false);
  }
}

function setSubmitting(value) {
  isSubmitting = value;
  elements.addButton.disabled = value;
  elements.addButton.setAttribute("aria-busy", String(value));
  elements.addButton.textContent = value ? "Menyimpan..." : "Tambah";
}

async function handleDelete(domain, type) {
  if (type === "allow") {
    await removeFromAllowlist(domain);
  } else {
    await removeFromBlacklist(domain);
  }
  await renderList();
}

async function renderList() {
  const allowlist = await getAllowlist();
  const blacklist = await getBlacklist();

  elements.listContainer.innerHTML = "";

  const items = [];
  
  if (currentTab === "all" || currentTab === "allow") {
    allowlist.forEach((domain) => {
      items.push({ domain, type: "allow", label: "Allowlist" });
    });
  }

  if (currentTab === "all" || currentTab === "block") {
    blacklist.forEach((domain) => {
      items.push({ domain, type: "block", label: "Blacklist" });
    });
  }

  // Sort domains alphabetically
  items.sort((a, b) => a.domain.localeCompare(b.domain));

  if (items.length === 0) {
    elements.listContainer.innerHTML = `
      <div class="empty-state">
        <p>Belum ada situs yang ditambahkan dalam kategori ini.</p>
      </div>
    `;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "item-card";

    const info = document.createElement("div");
    info.className = "item-info";

    const badge = document.createElement("span");
    badge.className = `badge ${item.type}`;
    badge.textContent = item.label;

    const domainName = document.createElement("span");
    domainName.className = "domain-name";
    domainName.textContent = item.domain;

    info.appendChild(badge);
    info.appendChild(domainName);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "Hapus";
    deleteBtn.addEventListener("click", () => handleDelete(item.domain, item.type));

    card.appendChild(info);
    card.appendChild(deleteBtn);

    elements.listContainer.appendChild(card);
  });
}
