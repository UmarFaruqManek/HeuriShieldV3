/*
 * Menyatukan output analyzer sesuai kontrak 60 fitur dan menormalkan nilai numerik.
 * Nilai kosong tetap null; median diterapkan oleh evaluator, bukan dianggap nol.
 */
export const MISSING_NUMERIC_VALUE = null;

export function buildFeatureVector(featureNames, sources = {}) {
  // Nama fitur adalah kontrak dengan model; jangan diganti tanpa memperbarui engine.
  const merged = Object.assign({}, ...Object.values(sources).filter(Boolean));
  const vector = {};
  const missing = [];

  for (const feature of featureNames) {
    if (Object.prototype.hasOwnProperty.call(merged, feature)) {
      vector[feature] = normalizeModelValue(merged[feature]);
    } else {
      vector[feature] = MISSING_NUMERIC_VALUE;
      missing.push(feature);
    }
  }

  return {
    feature_count: featureNames.length,
    vector,
    values: featureNames.map((feature) => vector[feature]),
    missing_features: missing,
    provided_features: featureNames.length - missing.length
  };
}

export function normalizeModelValue(value) {
  // Bedakan missing (null) dari nol; boolean menjadi 0/1 untuk kondisi numerik.
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return null;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return 1;
    if (lowered === "false") return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function summarizeFeatureCoverage(assembled) {
  return {
    feature_count: assembled.feature_count,
    provided_features: assembled.provided_features,
    missing_features: assembled.missing_features.length,
    coverage_percent: assembled.feature_count
      ? Number(((assembled.provided_features / assembled.feature_count) * 100).toFixed(2))
      : 0
  };
}
