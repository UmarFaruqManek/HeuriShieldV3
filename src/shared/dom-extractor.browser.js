/*
 * Extractor DOM bersama versi historis untuk kompatibilitas pipeline.
 * Snapshot runtime aktif memanggil analyzer/dom/dom-features.js melalui content script.
 */
// Shared, privacy-preserving DOM feature extractor. Runs in the page world in
// both the crawler and (when wired into the extension) the content script.
(() => {
  const VERSION = 'dom-v1.0.0';
  const WORDS = {
    login: ['log in', 'login', 'sign in', 'signin', 'account', 'username', 'password', 'email address', 'masuk', 'log masuk', 'akun', 'nama pengguna', 'kata sandi', 'sandi', 'alamat email'],
    payment: ['payment', 'billing', 'credit card', 'debit card', 'card number', 'cvv', 'checkout', 'pay now', 'pembayaran', 'tagihan', 'kartu kredit', 'kartu debit', 'nomor kartu', 'bayar sekarang'],
    otp: ['one time code', 'one-time code', 'verification code', 'security code', 'authentication code', 'otp', 'kode sekali pakai', 'kode verifikasi', 'kode keamanan', 'kode autentikasi', 'kode otp'],
    urgency: ['urgent', 'immediately', 'suspended', 'locked', 'expire', 'verify now', 'unusual activity', 'action required', 'mendesak', 'segera', 'ditangguhkan', 'dikunci', 'kedaluwarsa', 'verifikasi sekarang', 'aktivitas tidak biasa', 'tindakan diperlukan']
  };
  const SCHEMA = [
    'dom_capture_status','dom_ready_state','dom_capture_delay_ms','dom_extractor_version',
    'dom_title_length','dom_visible_text_length','dom_login_term_count','dom_payment_term_count','dom_otp_term_count','dom_urgency_term_count',
    'dom_form_count','dom_sensitive_form_count','dom_sensitive_control_count','dom_password_input_count','dom_identity_input_count','dom_otp_input_count','dom_payment_input_count','dom_sensitive_control_outside_form_count','dom_hidden_sensitive_control_count',
    'dom_sensitive_form_cross_domain_action_count','dom_sensitive_form_empty_action_count','dom_sensitive_form_non_https_action_count',
    'dom_anchor_count','dom_internal_anchor_count','dom_external_anchor_count','dom_empty_or_script_anchor_count',
    'dom_iframe_count','dom_cross_domain_iframe_count','dom_hidden_cross_domain_iframe_count',
    'dom_external_script_count','dom_external_script_origin_count'
  ];

  function collect(registrableKey) {
    const out = Object.fromEntries(SCHEMA.map(k => [k, null]));
    out.dom_capture_status = 'captured';
    out.dom_ready_state = document.readyState || 'unknown';
    out.dom_extractor_version = VERSION;
    for (const k of SCHEMA) if (k.startsWith('dom_') && k.endsWith('_count') || k === 'dom_title_length' || k === 'dom_visible_text_length' || k === 'dom_capture_delay_ms') out[k] = 0;
    out.dom_capture_delay_ms = Math.max(0, Math.round(performance.now()));

    const pageHost = location.hostname.toLowerCase().replace(/\.$/, '');
    const pageKey = registrableKey(pageHost) || pageHost;
    const text = document.body ? (document.body.innerText || '') : '';
    out.dom_title_length = [...(document.title || '')].length;
    out.dom_visible_text_length = [...text].length;
    for (const [group, terms] of Object.entries(WORDS)) out[`dom_${group}_term_count`] = countTerms(text, terms);

    const forms = [...document.forms];
    out.dom_form_count = forms.length;
    const controls = [...document.querySelectorAll('input,textarea,select,[contenteditable="true"],[role="textbox"]')];
    const info = controls.map(el => ({ el, kind: classify(el), visible: isVisible(el) })).filter(x => x.kind);
    out.dom_sensitive_control_count = info.length;
    out.dom_password_input_count = info.filter(x => x.kind === 'password').length;
    out.dom_identity_input_count = info.filter(x => x.kind === 'identity').length;
    out.dom_otp_input_count = info.filter(x => x.kind === 'otp').length;
    out.dom_payment_input_count = info.filter(x => x.kind === 'payment').length;
    out.dom_sensitive_control_outside_form_count = info.filter(x => !x.el.closest('form')).length;
    out.dom_hidden_sensitive_control_count = info.filter(x => !x.visible).length;

    const sensitiveForms = forms.filter(form => info.some(x => form.contains(x.el)));
    out.dom_sensitive_form_count = sensitiveForms.length;
    for (const form of sensitiveForms) {
      const rawAction = form.getAttribute('action');
      if (rawAction == null || rawAction.trim() === '') out.dom_sensitive_form_empty_action_count++;
      let action;
      try { action = new URL(rawAction || location.href, location.href); } catch { continue; }
      const actionKey = registrableKey(action.hostname.toLowerCase().replace(/\.$/, '')) || action.hostname;
      if (actionKey !== pageKey) out.dom_sensitive_form_cross_domain_action_count++;
      if (action.protocol === 'http:') out.dom_sensitive_form_non_https_action_count++;
    }

    const anchors = [...document.querySelectorAll('a')];
    out.dom_anchor_count = anchors.length;
    for (const a of anchors) {
      const raw = (a.getAttribute('href') || '').trim();
      if (!raw || raw === '#' || raw === '#!' || /^javascript:/i.test(raw)) {
        out.dom_empty_or_script_anchor_count++;
        continue;
      }
      try {
        const u = new URL(raw, location.href);
        if (!/^https?:$/.test(u.protocol)) continue;
        const key = registrableKey(u.hostname.toLowerCase().replace(/\.$/, '')) || u.hostname;
        if (key === pageKey) out.dom_internal_anchor_count++;
        else out.dom_external_anchor_count++;
      } catch { /* malformed destinations are not counted as internal/external */ }
    }

    const frames = [...document.querySelectorAll('iframe')];
    out.dom_iframe_count = frames.length;
    for (const frame of frames) {
      const src = (frame.getAttribute('src') || '').trim();
      if (!src) continue;
      try {
        const u = new URL(src, location.href);
        if (!/^https?:$/.test(u.protocol)) continue;
        const key = registrableKey(u.hostname.toLowerCase().replace(/\.$/, '')) || u.hostname;
        if (key !== pageKey) {
          out.dom_cross_domain_iframe_count++;
          if (!isVisible(frame)) out.dom_hidden_cross_domain_iframe_count++;
        }
      } catch { /* ignore invalid iframe source */ }
    }

    const scripts = [...document.querySelectorAll('script[src]')];
    const scriptOrigins = new Set();
    for (const script of scripts) {
      try {
        const u = new URL(script.getAttribute('src'), location.href);
        if (!/^https?:$/.test(u.protocol)) continue;
        const key = registrableKey(u.hostname.toLowerCase().replace(/\.$/, '')) || u.hostname;
        if (key !== pageKey) { out.dom_external_script_count++; scriptOrigins.add(key); }
      } catch { /* ignore invalid script source */ }
    }
    out.dom_external_script_origin_count = scriptOrigins.size;
    return out;
  }

  function classify(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const hint = [type, el.getAttribute('name'), el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('title'), ...(el.labels ? [...el.labels].map(x => x.innerText || x.textContent || '') : [])].filter(Boolean).join(' ').toLowerCase();
    if (type === 'password' || /current-password|new-password/.test(hint) || /\b(passw(?:or)?d|passcode)\b/.test(hint)) return 'password';
    if (/one-time-code|\b(otp|2fa|mfa|verification code|security code|auth(?:entication)? code)\b/.test(hint)) return 'otp';
    if (/cc-number|cc-exp|cc-csc|\b(card number|credit card|debit card|cvv|cvc|cardholder|payment card)\b/.test(hint)) return 'payment';
    if (type === 'email' || type === 'tel' || /username|user name|login id|email|e-mail|phone number|mobile number|account id|identifier/.test(hint)) return 'identity';
    return null;
  }
  function isVisible(el) {
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function countTerms(text, terms) {
    const s = String(text || '').toLocaleLowerCase(); let count = 0;
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu');
      for (const _ of s.matchAll(re)) count++;
    }
    return count;
  }

  globalThis.__toolCrawDomV1 = { version: VERSION, schema: SCHEMA, collect };
})();
