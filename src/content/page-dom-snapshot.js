/*
 * Jembatan content script ke background: membalas permintaan snapshot DOM halaman aktif.
 * Extractor yang dipanggil berasal dari analyzer/dom, bukan DOM halaman blokir.
 */
(function () {
  if (globalThis.__heurishieldV5DomSnapshotListener) return;
  globalThis.__heurishieldV5DomSnapshotListener = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Hanya tangani pesan snapshot; return true menjaga kanal respons async tetap hidup.
    if (message?.type !== "HEURISHIELD_V5_COLLECT_DOM") return false;

    collectDomSnapshot(message)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || "DOM snapshot gagal."
      }));

    return true;
  });

  async function collectDomSnapshot(message) {
    // Impor modul milik extension agar definisi fitur sama dengan analyzer runtime.
    var module = await import(chrome.runtime.getURL("src/analyzer/dom/dom-features.js"));
    var domFeatures = module.extractDomFeaturesFromPage({
      finalUrl: message.finalUrl || location.href,
      html: document.documentElement?.outerHTML || ""
    });

    return {
      url: location.href,
      title: document.title || "",
      domFeatures,
      domAnalysis: buildDomAnalysisSummary(domFeatures)
    };
  }

  function buildDomAnalysisSummary(features) {
    return {
      feature_version: features.analyzer_version,
      forms: [{
        credential_form_count: features.credential_form_count || 0,
        sensitive_form_count: features.credential_form_count || 0,
        hasSensitiveInput: Number(features.credential_form_count || 0) > 0,
        hasPasswordInput: Number(features.password_input_count || 0) > 0,
        hasOtpOrPinInput: Number(features.otp_mfa_field_count || 0) > 0 || Number(features.pin_field_count || 0) > 0,
        hasPaymentInput: Number(features.payment_card_field_count || 0) > 0
      }],
      resources: {
        anchor_count: features.anchor_count || 0,
        external_anchor_count: features.external_anchor_count || 0,
        external_resource_count: features.external_resource_count || 0,
        unique_external_domain_count: features.unique_external_domain_count || 0
      },
      scripts: {
        script_count: features.script_count || 0,
        inline_script_count: features.inline_script_count || 0,
        eval_count: features.eval_count || 0,
        document_write_count: features.document_write_count || 0,
        window_open_count: features.window_open_count || 0
      },
      text: {
        html_length: features.html_length || 0,
        dom_node_count: features.dom_node_count || 0,
        visible_text_length: features.visible_text_length || 0
      }
    };
  }
}());
