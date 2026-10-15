/*
 * Evaluator runtime RuleFit: uji kondisi AND, jumlahkan koefisien rule aktif, lalu sigmoid.
 * Keputusan ini masih dapat disesuaikan guard manual di analyzer/runtime-analysis.js.
 */
import { normalizeModelValue } from "../analyzer/feature-assembler.js";

export function evaluateRuleFitEngine(engine, featureVector) {
  if (!engine || engine.model_family !== "RuleFit") {
    throw new Error("Unsupported RuleFit engine.");
  }

  const intercept = Number(engine.intercept || 0);
  let logit = intercept;
  const firedRules = [];

  // z = intercept + jumlah koefisien rule aktif; banyaknya rule bukan voting.
  for (const rule of engine.rules || []) {
    const evaluation = evaluateRule(rule, featureVector, engine.imputer_median || {});
    if (!evaluation.fired) continue;

    const coefficient = Number(rule.coefficient || 0);
    logit += coefficient;
    firedRules.push({
      id: rule.id,
      expression: rule.expression,
      coefficient,
      direction: rule.direction || (coefficient >= 0 ? "phishing" : "legitimate"),
      conditions: evaluation.conditions
    });
  }

  // Sigmoid mengubah logit menjadi keluaran probabilitas model sebelum guard.
  const phishingProbability = sigmoid(logit);
  const predictedLabel = phishingProbability >= Number(engine.threshold)
    ? "phishing"
    : "legitimate";

  return {
    ready: true,
    model_family: engine.model_family,
    model_name: engine.model_name || "RuleFit",
    threshold: Number(engine.threshold),
    intercept,
    logit,
    probability_phishing: phishingProbability,
    predicted_label: predictedLabel,
    verdict: predictedLabel === "phishing" ? "DANGEROUS" : "SAFE",
    fired_rule_count: firedRules.length,
    fired_rules: firedRules.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient)),
    rule_count: Array.isArray(engine.rules) ? engine.rules.length : 0
  };
}

function evaluateRule(rule, featureVector, medians) {
  // Semua kondisi memakai AND. Nilai kosong diganti median dari engine pelatihan.
  const conditions = [];
  for (const condition of rule.conditions || []) {
    const rawValue = normalizeModelValue(featureVector[condition.feature]);
    const imputedValue = rawValue === null ? Number(medians[condition.feature] ?? 0) : rawValue;
    const passed = compare(imputedValue, condition.operator, Number(condition.threshold));
    conditions.push({
      feature: condition.feature,
      operator: condition.operator,
      threshold: Number(condition.threshold),
      value: rawValue,
      imputed_value: imputedValue,
      passed
    });
    if (!passed) return { fired: false, conditions };
  }
  return { fired: true, conditions };
}

function compare(value, operator, threshold) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  if (operator === "<=") return value <= threshold;
  if (operator === "<") return value < threshold;
  if (operator === ">=") return value >= threshold;
  if (operator === ">") return value > threshold;
  return false;
}

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}
