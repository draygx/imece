import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import trCommon from "./locales/tr/common.json";
import enCommon from "./locales/en/common.json";

/**
 * İmece's interface language. Turkish is the product default — not a locale
 * guess, a deliberate choice — with English kept as a selectable fallback
 * for the (currently small) set of screens already translated.
 *
 * Persistence is a plain localStorage key, the same pattern this codebase
 * already uses for other low-stakes UI prefs (see `NAV_COLLAPSED_KEY` in
 * settings-panel.tsx) — not `config.toml`, so this stays a frontend-only
 * concern with no Rust-side schema change.
 */
export const LANGUAGE_STORAGE_KEY = "imece:language";

export type SupportedLanguage = "tr" | "en";
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["tr", "en"];
export const DEFAULT_LANGUAGE: SupportedLanguage = "tr";

function readStoredLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "tr" || stored === "en") return stored;
  } catch {
    // Storage can be unavailable (private mode, disabled cookies); fall
    // through to the default rather than failing language init over it.
  }
  return DEFAULT_LANGUAGE;
}

void i18next.use(initReactI18next).init({
  lng: readStoredLanguage(),
  fallbackLng: "en",
  resources: {
    tr: { common: trCommon },
    en: { common: enCommon },
  },
  defaultNS: "common",
  interpolation: {
    // React already escapes rendered text; i18next's own HTML-escaping on
    // top of that would double-escape interpolated values.
    escapeValue: false,
  },
});

export function setLanguage(language: SupportedLanguage): void {
  void i18next.changeLanguage(language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Non-fatal — the language still changes for this session, it just
    // won't survive a restart.
  }
}

export default i18next;
