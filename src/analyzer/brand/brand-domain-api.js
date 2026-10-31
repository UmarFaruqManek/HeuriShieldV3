// Cadangan terakhir: mencari kandidat identitas berdasarkan domain situs.
// Respons direktori merupakan kandidat, bukan bukti kepemilikan domain.
const API_ROOT = "https://brnad-heuri.vercel.app/api/v1/domain/";

export async function lookupBrandByDomain(domain, { fetchImpl = fetch, timeoutMs = 4500 } = {}) {
  const clean = String(domain || "").trim().toLowerCase();
  if (!/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(clean)) {
    return { lookup_success: false, found: false, error: "invalid_domain" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API_ROOT}${encodeURIComponent(clean)}`, { signal: controller.signal });
    if (!response.ok) return { lookup_success: false, found: false, error: `http_${response.status}` };
    const data = await response.json();
    if (!data || typeof data.found !== "boolean") {
      return { lookup_success: false, found: false, error: "invalid_response" };
    }
    // Hanya terima jawaban untuk domain yang benar-benar ditanyakan.
    if (data.found && String(data.registrable_domain || data.domain || "").toLowerCase() !== clean) {
      return { lookup_success: false, found: false, error: "domain_mismatch" };
    }
    return { lookup_success: true, ...data };
  } catch (error) {
    return { lookup_success: false, found: false, error: error?.name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
