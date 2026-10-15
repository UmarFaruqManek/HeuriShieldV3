/*
 * Membaca kebijakan proteksi dan memeriksa apakah domain diizinkan pengguna.
 * Ini pengaturan proteksi, bukan aturan hasil training RuleFit.
 */
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./constants.js";

// Submit handlers must decide synchronously, before the browser submits the form.
// Subscribe before loading settings so an older read cannot overwrite an update.
export async function createPageProtectionPolicy(hostname, chromeApi = chrome) {
  const defaults = {
    [STORAGE_KEYS.ENABLED]: DEFAULT_SETTINGS.heurishieldEnabled,
    [STORAGE_KEYS.ALLOWLIST]: []
  };
  const values = { ...defaults };
  const changedDuringLoad = new Set();
  const onChanged = (changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(defaults)) {
      if (Object.hasOwn(changes, key)) {
        changedDuringLoad.add(key);
        values[key] = changes[key].newValue ?? defaults[key];
      }
    }
  };
  chromeApi.storage.onChanged.addListener(onChanged);
  try {
    const initial = await chromeApi.storage.local.get(defaults);
    for (const key of Object.keys(defaults)) {
      if (!changedDuringLoad.has(key)) values[key] = initial[key] ?? defaults[key];
    }
  } catch (error) {
    chromeApi.storage.onChanged.removeListener(onChanged);
    throw error;
  }
  return {
    shouldAnalyze: () => Boolean(values[STORAGE_KEYS.ENABLED]) &&
      !values[STORAGE_KEYS.ALLOWLIST].includes(hostname)
  };
}
