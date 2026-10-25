/*
 * Panel mengambang dalam shadow DOM untuk menampilkan hasil, alasan dan tombol pengguna.
 * Panel hanya menampilkan analisis dari background; tidak melatih atau menghitung ulang model.
 */
(function () {
  if (globalThis.__heurishieldV5ScoreOverlay) return;
  globalThis.__heurishieldV5ScoreOverlay = true;

  const STATE = {
    analysis: null,
    expanded: false,
    detailsExpanded: false,
    loading: true,
    error: null,
    contextInvalidated: false
  };

  const rootHost = document.createElement("div");
  rootHost.id = "heurishield-v5-score-overlay";
  const shadow = rootHost.attachShadow({ mode: "closed" });
  shadow.append(buildStyles(), buildShell());

  const safeAppend = () => {
    if (!document.documentElement || rootHost.isConnected) return;
    document.documentElement.append(rootHost);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeAppend, { once: true });
  } else {
    safeAppend();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "HEURISHIELD_ANALYSIS_UPDATED") return false;
    STATE.loading = false;
    STATE.error = null;
    STATE.analysis = message.analysis || null;
    render();
    return false;
  });

  requestAnalysis();
  render();

  async function sendToBackground(message) {
    // Reload extension membatalkan konteks tab lama; API dapat melempar sebelum membuat Promise.
    try {
      if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      STATE.loading = false;
      STATE.contextInvalidated = /context invalidated/i.test(error?.message || "");
      STATE.error = STATE.contextInvalidated
        ? "HeuriShield telah dimuat ulang atau dinonaktifkan. Muat ulang halaman ini untuk menghubungkan kembali extension."
        : error?.message || "Tidak dapat menghubungi HeuriShield.";
      STATE.expanded = true;
      render();
      return null;
    }
  }

  async function requestAnalysis(forceRefresh = false) {
    // Background adalah sumber keputusan; panel hanya menerima objek hasil analisis.
    try {
      const response = await sendToBackground({
        type: "HEURISHIELD_ANALYZE_PAGE",
        url: location.href,
        forceRefresh
      });
      if (!response) return;
      STATE.loading = false;
      if (!response?.ok) {
        STATE.error = response?.error || "Analisis gagal.";
      } else {
        STATE.analysis = response.analysis || null;
      }
    } catch (error) {
      STATE.loading = false;
      STATE.error = error?.message || "Analisis gagal.";
    }
    render();
  }

  function buildShell() {
    const wrap = document.createElement("section");
    wrap.className = "hs-wrap";
    wrap.innerHTML = `
      <button class="hs-pill" type="button" aria-label="Buka detail HeuriShield">
        <span class="hs-mark">H5</span>
        <span class="hs-pill-copy">
          <strong class="hs-score">...</strong>
          <span class="hs-label">Menganalisis</span>
        </span>
      </button>
      <article class="hs-panel" hidden>
        <header class="hs-panel-header">
          <div>
            <span class="hs-kicker">HeuriShield V5</span>
            <h2>Threat Check</h2>
          </div>
          <button class="hs-close" type="button" aria-label="Tutup detail">&times;</button>
        </header>
        <div class="hs-status">
          <div class="hs-decision-mark"><span class="hs-panel-score">...</span></div>
          <div>
            <strong class="hs-verdict">Menganalisis</strong>
            <p class="hs-summary">Memeriksa halaman...</p>
          </div>
        </div>
        <dl class="hs-facts">
          <div><dt>Domain</dt><dd class="hs-domain">-</dd></div>
          <div><dt class="hs-brand-label">Brand</dt><dd class="hs-brand">-</dd></div>
          <div><dt>Umur domain</dt><dd class="hs-age">-</dd></div>
          <div><dt>Pemeriksaan</dt><dd class="hs-rules">-</dd></div>
        </dl>
        <section class="hs-details" id="hs-details" hidden aria-label="Alasan keputusan">
          <h3>Alasan utama</h3>
          <ul class="hs-reason-list"></ul>
          <p class="hs-limitation" hidden></p>
          <p class="hs-advice"></p>
        </section>
        <div class="hs-actions">
          <button class="hs-action hs-detail-action hs-primary" type="button" aria-expanded="false" aria-controls="hs-details">Detail alasan</button>
          <button class="hs-action hs-refresh" type="button">Ulang</button>
          <button class="hs-action hs-allow-list" type="button">Allow list</button>
          <button class="hs-action hs-block-list" type="button">Block list</button>
          <button class="hs-action hs-history" type="button">Riwayat</button>
          <button class="hs-action hs-options" type="button">Pengaturan</button>
        </div>
      </article>
    `;

    wrap.querySelector(".hs-pill").addEventListener("click", () => {
      STATE.expanded = !STATE.expanded;
      render();
    });
    wrap.querySelector(".hs-close").addEventListener("click", () => {
      STATE.expanded = false;
      render();
    });
    wrap.querySelector(".hs-refresh").addEventListener("click", () => {
      // Konteks yang batal tidak bisa dipulihkan dengan mengirim pesan lagi.
      if (STATE.contextInvalidated) {
        location.reload();
        return;
      }
      STATE.loading = true;
      STATE.error = null;
      render();
      requestAnalysis(true);
    });
    wrap.querySelector(".hs-detail-action").addEventListener("click", () => {
      STATE.detailsExpanded = !STATE.detailsExpanded;
      render();
    });
    wrap.querySelector(".hs-allow-list").addEventListener("click", async () => {
      const response = await sendToBackground({ type: "HEURISHIELD_TOGGLE_ALLOWLIST", url: STATE.analysis?.final_url || location.href });
      if (response) await requestAnalysis();
    });
    wrap.querySelector(".hs-block-list").addEventListener("click", async () => {
      const response = await sendToBackground({ type: "HEURISHIELD_TOGGLE_BLOCKLIST", url: STATE.analysis?.final_url || location.href });
      if (response) await requestAnalysis();
    });
    wrap.querySelector(".hs-history").addEventListener("click", () => {
      void sendToBackground({ type: "HEURISHIELD_OPEN_HISTORY_PAGE" });
    });
    wrap.querySelector(".hs-options").addEventListener("click", () => {
      void sendToBackground({ type: "HEURISHIELD_OPEN_OPTIONS_PAGE" });
    });
    return wrap;
  }

  function render() {
    // textContent dipakai untuk temuan agar teks dari halaman tidak menjadi HTML aktif.
    const analysis = STATE.analysis;
    const verdict = STATE.error ? "LIMITED" : analysis?.verdict || "LIMITED";
    const tone = toneFor(verdict);
    const label = STATE.loading ? "Menganalisis" : STATE.error ? "Gagal" : labelFor(verdict);

    setText(".hs-score", shortLabelFor(verdict, STATE.loading, STATE.error));
    setText(".hs-label", STATE.loading ? "Menganalisis" : "Keputusan");
    setText(".hs-panel-score", iconFor(verdict, STATE.loading, STATE.error));
    setText(".hs-verdict", STATE.loading ? "Menganalisis halaman" : label);
    setText(".hs-summary", STATE.loading ? "Memeriksa halaman..." : STATE.error || analysis?.explanation?.summary || summaryFor(analysis));
    setText(".hs-domain", analysis?.registrable_domain || analysis?.hostname || getHost());
    const brand = STATE.loading ? { label: "Brand", value: "Memeriksa..." } : brandDisplay(analysis);
    setText(".hs-brand-label", brand.label);
    setText(".hs-brand", brand.value);
    setText(".hs-age", domainAgeText(analysis));
    setText(".hs-refresh", STATE.contextInvalidated ? "Muat ulang halaman" : analysis?.is_warning_snapshot ? "Muat hasil" : "Ulang");
    setText(".hs-rules", STATE.loading ? "Berjalan" : analysis?.model_result?.ready ? "Selesai" : "Terbatas");
    const explanation = analysis?.explanation;
    const reasons = STATE.loading ? ["Analisis sedang berjalan."] : STATE.error ? [STATE.error] : explanation?.reasons || ["Detail pemeriksaan belum tersedia. Coba ulang pemeriksaan."];
    shadow.querySelector(".hs-reason-list").replaceChildren(...reasons.slice(0, 3).map(reason => {
      const item = document.createElement("li");
      item.textContent = reason;
      return item;
    }));
    shadow.querySelector(".hs-details").hidden = !STATE.detailsExpanded;
    setText(".hs-limitation", STATE.loading ? "" : explanation?.limitation || "");
    shadow.querySelector(".hs-limitation").hidden = STATE.loading || !explanation?.limitation;
    setText(".hs-advice", STATE.loading ? "" : explanation?.action || "");

    const wrap = shadow.querySelector(".hs-wrap");
    const panel = shadow.querySelector(".hs-panel");
    wrap.dataset.tone = tone;
    wrap.dataset.loading = String(STATE.loading);
    panel.hidden = !STATE.expanded;

    updateActionLabels(verdict);
  }

  function updateActionLabels(verdict) {
    const detail = shadow.querySelector(".hs-detail-action");
    if (detail) {
      detail.textContent = STATE.detailsExpanded ? "Tutup alasan" : "Detail alasan";
      detail.setAttribute("aria-expanded", String(STATE.detailsExpanded));
    }
  }


  function buildStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .hs-wrap {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #102033;
      }
      .hs-pill {
        display: grid;
        grid-template-columns: 38px auto;
        align-items: center;
        gap: 10px;
        min-width: 156px;
        border: 1px solid rgba(18, 42, 68, 0.18);
        border-radius: 999px;
        padding: 8px 13px 8px 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.22);
        cursor: pointer;
        backdrop-filter: blur(12px);
      }
      .hs-mark {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 14px;
        background: #08764f;
        color: #fff;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0;
      }
      .hs-pill-copy {
        display: grid;
        gap: 1px;
        text-align: left;
      }
      .hs-score {
        font-size: 15px;
        line-height: 1;
      }
      .hs-label {
        font-size: 11px;
        font-weight: 800;
        color: #557084;
      }
      .hs-panel {
        width: min(360px, calc(100vw - 28px));
        max-height: calc(100dvh - 100px);
        margin-bottom: 12px;
        border: 1px solid rgba(18, 42, 68, 0.16);
        border-radius: 16px;
        overflow-x: hidden;
        overflow-y: auto;
        background: #f8fbfd;
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
      }
      .hs-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px 12px;
        background: #102033;
        color: #fff;
      }
      .hs-kicker {
        display: block;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: #9fd3e9;
      }
      h2, h3, p { margin: 0; }
      h2 { font-size: 20px; line-height: 1.1; }
      .hs-close {
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 50%;
        background: rgba(255,255,255,.14);
        color: #fff;
        font-size: 22px;
        cursor: pointer;
      }
      .hs-status {
        display: grid;
        grid-template-columns: 72px auto;
        gap: 14px;
        align-items: center;
        padding: 16px 18px;
        background: #fff;
        border-bottom: 1px solid #d8e4eb;
      }
      .hs-decision-mark {
        display: grid;
        place-items: center;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: #e5edf2;
      }
      .hs-decision-mark span {
        display: grid;
        place-items: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #fff;
        font-weight: 900;
        font-size: 26px;
      }
      .hs-verdict { display: block; font-size: 20px; line-height: 1.15; }
      .hs-summary { margin-top: 5px; font-size: 13px; line-height: 1.45; color: #526779; }
      .hs-facts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin: 0;
        padding: 12px 14px;
      }
      .hs-facts div {
        min-width: 0;
        padding: 10px;
        border: 1px solid #d7e4ec;
        border-radius: 10px;
        background: #fff;
      }
      dt {
        margin: 0 0 4px;
        color: #60788d;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
        font-size: 13px;
        line-height: 1.25;
        font-weight: 800;
      }
      h3 {
        margin: 8px 0;
        font-size: 13px;
        text-transform: uppercase;
        color: #60788d;
      }
      .hs-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 0 14px 14px;
      }
      .hs-details { padding: 0 18px 16px; overflow-wrap: anywhere; }
      .hs-details[hidden] { display: none; }
      .hs-reason-list { margin: 0; padding-left: 18px; color: #253d47; font-size: 13px; line-height: 1.5; }
      .hs-reason-list li + li { margin-top: 8px; }
      .hs-advice { margin-top: 12px; color: #253d47; font-size: 12px; line-height: 1.5; font-weight: 700; }
      .hs-limitation { margin-top: 12px; color: #735400; font-size: 12px; line-height: 1.5; }
      @media (max-width: 400px) { .hs-wrap { right: 12px; bottom: 12px; } }
      .hs-action {
        height: 40px;
        border-radius: 10px;
        border: 1px solid #cbd9e2;
        background: #fff;
        color: #153045;
        font-weight: 900;
        cursor: pointer;
      }
      .hs-primary {
        grid-column: 1 / -1;
        border-color: #145a76;
        background: #145a76;
        color: #fff;
      }
      .hs-wrap[data-tone="danger"] .hs-mark,
      .hs-wrap[data-tone="danger"] .hs-primary { background: #c91f37; border-color: #c91f37; }
      .hs-wrap[data-tone="danger"] .hs-decision-mark { background: #f3dadd; color: #c91f37; }
      .hs-wrap[data-tone="safe"] .hs-mark { background: #08764f; }
      .hs-wrap[data-tone="safe"] .hs-decision-mark { background: #d9eee6; color: #08764f; }
      .hs-wrap[data-tone="warn"] .hs-mark { background: #b26200; }
      .hs-wrap[data-tone="warn"] .hs-decision-mark { background: #f1e2cc; color: #b26200; }
    `;
    return style;
  }

  function setText(selector, value) {
    const element = shadow.querySelector(selector);
    if (element) element.textContent = String(value ?? "-");
  }

  function toneFor(verdict) {
    if (verdict === "DANGEROUS") return "danger";
    if (verdict === "WARNING" || verdict === "SUSPICIOUS") return "warn";
    if (verdict === "SAFE") return "safe";
    return "neutral";
  }

  function labelFor(verdict) {
    return {
      SAFE: "Legitimate",
      WARNING: "Waspada",
      SUSPICIOUS: "Mencurigakan",
      DANGEROUS: "Phishing",
      LIMITED: "Terbatas"
    }[verdict] || "Terbatas";
  }

  function shortLabelFor(verdict, loading, error) {
    if (loading) return "...";
    if (error) return "Gagal";
    return {
      SAFE: "Legit",
      WARNING: "Waspada",
      SUSPICIOUS: "Curiga",
      DANGEROUS: "Phishing",
      LIMITED: "Terbatas"
    }[verdict] || "Terbatas";
  }

  function iconFor(verdict, loading, error) {
    if (loading) return "...";
    if (error) return "!";
    return verdict === "DANGEROUS" ? "!" : verdict === "SAFE" ? "✓" : "?";
  }

  function summaryFor(analysis) {
    if (!analysis) return "Belum ada hasil analisis.";
    if (analysis.verdict === "DANGEROUS") return "Sinyal risiko kuat. Jangan masukkan data pribadi sebelum yakin domain benar.";
    if (analysis.verdict === "SAFE") return "Tidak ada sinyal phishing kuat dari fitur yang terbaca.";
    return "Ada sinyal yang perlu diperiksa sebelum lanjut.";
  }

  function brandDisplay(analysis) {
    const brand = analysis?.brand_features;
    if (!brand?.brand_found) {
      const value = brand?.brand_lookup_success === false ? "Lookup tidak tersedia"
        : brand?.brand_lookup_failed_queries > 0 ? "Pencarian belum lengkap" : "Tidak ditemukan";
      return { label: "Brand", value };
    }
    const name = brand.brand_top_candidate_name || brand.brand_top_candidate_domain || "Terdeteksi";
    const guard = analysis?.model_result?.post_model_guard;
    const impersonationGuard = guard?.id === "BRAND_IMPERSONATION_GUARD";
    if (guard?.id === "SELF_BRAND_LABEL_GUARD") {
      return { label: "Brand", value: domainToBrandName(guard.active_domain) || name };
    }
    if (impersonationGuard) return { label: "Impersonate", value: name };
    return { label: "Brand", value: name };
  }

  function domainToBrandName(domain) {
    const label = String(domain || "").split(".")[0] || "";
    if (!label) return "";
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function domainAgeText(analysis) {
    const days = analysis?.rdap_features?.page_domain_age_days ?? analysis?.rdap_features?.source_domain_age_days;
    if (days === null || days === undefined || days === "" || !Number.isFinite(Number(days))) return "Tidak tersedia";
    if (Number(days) < 365) return `${Math.round(Number(days))} hari`;
    return `${(Number(days) / 365).toFixed(1)} tahun`;
  }

  function getHost() {
    try {
      if (!/^https?:$/.test(location.protocol)) return "Tidak tersedia";
      return location.hostname || "-";
    } catch {
      return "-";
    }
  }
}());
