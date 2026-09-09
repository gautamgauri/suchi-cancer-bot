import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/funding/AppShell";
import { useFundingUi } from "../context/FundingUiContext";
import { fundingApiService } from "../services/fundingApi";
import { setFundingLanguage, getFundingLanguage } from "../i18n";

function isValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function SettingsPage() {
  const { t } = useTranslation(["common", "funding"]);
  const { apiBaseUrl, setApiBaseUrl, compact, setCompact, resetUi } = useFundingUi();
  const [urlInput, setUrlInput] = useState(apiBaseUrl);
  const [urlTouched, setUrlTouched] = useState(false);

  const { data: health, isError } = useQuery({
    queryKey: ["health", apiBaseUrl],
    queryFn: () => fundingApiService.getHealth(),
    retry: false,
    staleTime: 30_000,
  });

  const apiConfigured = !isError && health?.ok === true;

  const handleSaveUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setApiBaseUrl("http://localhost:3001/v1");
      setUrlInput("http://localhost:3001/v1");
      setUrlTouched(false);
      return;
    }
    if (!isValidUrl(trimmed)) {
      toast.error("Invalid URL");
      return;
    }
    setApiBaseUrl(trimmed);
    setUrlInput(trimmed);
    setUrlTouched(false);
    toast.success(t("common:saved"));
  };

  const handleTestConnection = () => {
    fundingApiService
      .getHealth()
      .then(() => toast.success(t("funding:settings.testSuccess")))
      .catch(() => toast.error(t("funding:settings.testFailed")));
  };

  const handleLanguageChange = (lng: "en" | "hi") => {
    setFundingLanguage(lng);
    toast.success(t("common:saved"));
  };

  const handleResetUi = () => {
    if (!window.confirm(t("funding:settings.resetUiConfirm"))) return;
    resetUi();
  };

  const currentLang = getFundingLanguage();

  return (
    <AppShell apiConfigured={apiConfigured}>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-foreground md:text-2xl">
          {t("funding:settings.title")}
        </h1>

        {/* API base URL */}
        <section aria-labelledby="settings-api-heading">
          <h2 id="settings-api-heading" className="text-base font-medium text-foreground">
            {t("funding:settings.apiBaseUrl")}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="url"
              id="settings-api-url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => setUrlTouched(true)}
              placeholder={t("funding:settings.apiBaseUrlPlaceholder")}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              aria-describedby="settings-api-url-desc"
            />
            <button
              type="button"
              onClick={handleSaveUrl}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t("common:save")}
            >
              {t("common:save")}
            </button>
          </div>
          <p id="settings-api-url-desc" className="mt-1 text-xs text-muted-foreground">
            {t("funding:settings.apiBaseUrl")}
          </p>
          {urlTouched && urlInput.trim() && !isValidUrl(urlInput) && (
            <p className="mt-1 text-xs text-destructive">Invalid URL</p>
          )}
        </section>

        {/* Test connection */}
        <section aria-labelledby="settings-test-heading">
          <h2 id="settings-test-heading" className="text-base font-medium text-foreground">
            {t("common:testConnection")}
          </h2>
          <button
            type="button"
            onClick={handleTestConnection}
            className="mt-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("common:testConnection")}
          >
            {t("common:testConnection")}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            {apiConfigured ? t("funding:header.apiConfigured") : t("funding:header.apiNotConfigured")}
          </p>
        </section>

        {/* Compact mode */}
        <section aria-labelledby="settings-compact-heading">
          <h2 id="settings-compact-heading" className="text-base font-medium text-foreground">
            {t("common:compactMode")}
          </h2>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => setCompact(e.target.checked)}
              className="h-4 w-4 rounded border-border focus:ring-ring"
              aria-describedby="settings-compact-desc"
            />
            <span className="text-sm text-foreground">{t("common:compactMode")}</span>
          </label>
          <p id="settings-compact-desc" className="sr-only">
            {t("common:compactMode")}
          </p>
        </section>

        {/* Language */}
        <section aria-labelledby="settings-language-heading">
          <h2 id="settings-language-heading" className="text-base font-medium text-foreground">
            {t("common:language")}
          </h2>
          <select
            id="settings-language"
            value={currentLang}
            onChange={(e) => handleLanguageChange(e.target.value as "en" | "hi")}
            className="mt-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-describedby="settings-language-desc"
          >
            <option value="en">{t("common:english")}</option>
            <option value="hi">{t("common:hindi")}</option>
          </select>
          <p id="settings-language-desc" className="sr-only">
            {t("common:language")}
          </p>
        </section>

        {/* Reset UI */}
        <section aria-labelledby="settings-reset-heading">
          <h2 id="settings-reset-heading" className="text-base font-medium text-foreground">
            {t("common:resetUi")}
          </h2>
          <button
            type="button"
            onClick={handleResetUi}
            className="mt-2 rounded-md border border-destructive bg-background px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("common:resetUi")}
          >
            {t("common:resetUi")}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            Clears API URL, compact mode, and language; reloads the page.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
