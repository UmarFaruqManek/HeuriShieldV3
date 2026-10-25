/* Pemetaan nama lama untuk kompatibilitas catatan/crawler historis; tidak mengubah nilai. */
export const LEGACY_FEATURE_NAMES = Object.freeze({
  "original_domain_age_days": "source_domain_age_days",
  "final_domain_age_days": "page_domain_age_days",
  "brand_top_candidate_search_score": "brand_search_score",
  "brand_top_candidate_quality_score": "brand_quality_score",
  "brand_candidate_original_domain_similarity": "brand_source_similarity",
  "original_path_length": "source_path_length",
  "brand_candidate_final_domain_similarity": "brand_page_similarity",
  "brand_candidate_matches_final_domain": "brand_matches_page",
  "brand_candidate_matches_original_domain": "brand_matches_source",
  "original_url_token_count": "source_url_token_count",
  "original_special_char_ratio": "source_special_char_ratio",
  "final_subdomain_count": "page_subdomain_count",
  "original_subdomain_count": "source_subdomain_count",
  "final_dot_count": "page_dot_count",
  "original_hostname_length": "source_hostname_length",
  "final_hostname_length": "page_hostname_length",
  "final_url_entropy": "page_url_entropy",
  "original_query_length": "source_query_length",
  "brand_candidate_in_original_subdomain": "brand_in_source_subdomain",
  "original_uses_shared_hosting_domain": "source_uses_shared_hosting_domain",
  "original_skip_domain_age_lookup": "source_skip_domain_age_lookup",
  "final_path_length": "page_path_length",
  "original_special_char_count": "source_special_char_count",
  "final_url_token_count": "page_url_token_count",
  "original_url_entropy": "source_url_entropy",
  "original_url_length": "source_url_length",
  "raw_redirect_count": "redirect_count",
  "final_url_length": "page_url_length",
  "brand_candidate_found": "brand_found",
  "brand_lookup_status": "brand_lookup_success",
  "brand_candidate_in_original_path": "brand_in_source_path",
  "brand_candidate_in_original_query": "brand_in_source_query",
  "original_embedded_domain_count": "source_embedded_domain_count"
});

export function canonicalFeatureName(name) {
  return LEGACY_FEATURE_NAMES[name] || name;
}

export function normalizeFeatureRecord(record = {}) {
  const result = {};
  for (const [name, value] of Object.entries(record)) {
    const key = canonicalFeatureName(name);
    if (Object.hasOwn(result, key) && !Object.is(result[key], value)) {
      throw new Error(`Nilai fitur bertabrakan: ${key}`);
    }
    result[key] = value;
  }
  return result;
}
