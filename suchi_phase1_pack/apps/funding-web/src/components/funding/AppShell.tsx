import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFundingUi } from "../../context/FundingUiContext";

interface AppShellProps {
  children: React.ReactNode;
  apiConfigured: boolean;
}

export function AppShell({ children, apiConfigured }: AppShellProps) {
  const { t } = useTranslation(["common", "funding"]);
  const location = useLocation();
  const { compact, setCompact } = useFundingUi();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const nav = [
    { to: "/pipeline", labelKey: "funding:nav.pipeline" },
    { to: "/framework", labelKey: "funding:framework.nav" },
    { to: "/settings", labelKey: "funding:nav.settings" },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t("common:skipToContent")}
      </a>

      {/* Header */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded p-2 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring md:hidden"
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={sidebarOpen}
          >
            <span className="text-lg" aria-hidden="true">
              ☰
            </span>
          </button>
          <Link
            to="/pipeline"
            className="text-lg font-semibold text-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
          >
            {t("common:appName")}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => setCompact(e.target.checked)}
              className="h-4 w-4 rounded border-border focus:ring-ring"
              aria-label={t("common:compactMode")}
            />
            <span className="hidden sm:inline">{t("common:compactMode")}</span>
          </label>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            title={apiConfigured ? t("funding:header.apiConfigured") : t("funding:header.apiNotConfigured")}
            aria-label={apiConfigured ? t("funding:header.apiConfigured") : t("funding:header.apiNotConfigured")}
          >
            {apiConfigured ? (
              <span className="text-primary">●</span>
            ) : (
              <span className="text-muted-foreground">○</span>
            )}
          </span>
          <span
            className="rounded px-2 py-1 text-xs text-muted-foreground"
            aria-label={t("funding:header.userMenu")}
          >
            {t("funding:header.userMenu")}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden print:block">
        {/* Sidebar */}
        <aside
          className={`shrink-0 border-r border-border bg-card print:hidden ${
            sidebarOpen ? "fixed inset-y-0 left-0 z-30 w-56 pt-14 md:static md:pt-0" : "hidden w-56 md:block"
          }`}
          aria-label="Main navigation"
        >
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-20 bg-background/60 md:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <nav className="flex flex-col gap-1 p-3" aria-label="Sidebar">
            {nav.map(({ to, labelKey }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setSidebarOpen(false)}
                  className={`rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  {t(labelKey)}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main
          id="main-content"
          className="flex-1 overflow-auto p-4 focus:outline-none"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
