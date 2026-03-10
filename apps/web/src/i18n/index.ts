import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import commonEn from "./locales/en/common.json";
import commonHi from "./locales/hi/common.json";
import fundingEn from "./locales/en/funding.json";
import fundingHi from "./locales/hi/funding.json";

const FUNDING_LANG_KEY = "funding_lang";

function getStoredLanguage(): string {
  try {
    const stored = localStorage.getItem(FUNDING_LANG_KEY);
    if (stored === "hi" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return "en";
}

export function setFundingLanguage(lng: "en" | "hi"): void {
  localStorage.setItem(FUNDING_LANG_KEY, lng);
  i18n.changeLanguage(lng);
}

export function getFundingLanguage(): "en" | "hi" {
  const l = getStoredLanguage();
  return l === "hi" ? "hi" : "en";
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: commonEn, funding: fundingEn },
      hi: { common: commonHi, funding: fundingHi },
    },
    defaultNS: "common",
    fallbackLng: "en",
    lng: getStoredLanguage(),
    ns: ["common", "funding"],
    interpolation: { escapeValue: false },
  });

export default i18n;
