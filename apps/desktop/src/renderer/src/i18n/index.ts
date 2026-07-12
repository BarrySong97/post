/**
 * @purpose Initialize i18next for the desktop renderer (zh-CN + en).
 * @role    Single i18n singleton imported by main.tsx, components (via useTranslation), and non-React helpers.
 * @deps    i18next, react-i18next, locale JSON resources.
 * @gotcha  Persist with localStorage key post.locale. Call changeAppLanguage (not only changeLanguage)
 *          so storage stays in sync. Vault/user content is never translated here.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const LOCALE_STORAGE_KEY = "post.locale";
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number] | "auto";

export function resolveLocale(preference: AppLocale | string | null | undefined): "zh-CN" | "en" {
  if (preference === "en" || preference === "zh-CN") {
    return preference;
  }
  if (preference === "zh" || preference === "zh-Hans" || preference === "zh-Hant") {
    return "zh-CN";
  }
  // auto / unknown → system
  const nav = typeof navigator !== "undefined" ? navigator.language : "zh-CN";
  if (nav.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
}

export function getStoredLocalePreference(): AppLocale {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "en" || raw === "zh-CN" || raw === "auto") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "auto";
}

export function changeAppLanguage(preference: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // ignore
  }
  return i18n.changeLanguage(resolveLocale(preference));
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: resolveLocale(typeof window !== "undefined" ? getStoredLocalePreference() : "zh-CN"),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
