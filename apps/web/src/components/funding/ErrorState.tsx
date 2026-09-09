import { useTranslation } from "react-i18next";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  showApiHint?: boolean;
  className?: string;
}

export function ErrorState({
  message,
  onRetry,
  showApiHint = false,
  className = "",
}: ErrorStateProps) {
  const { t } = useTranslation(["common", "funding"]);
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-border bg-card py-8 px-4 text-center ${className}`}
      role="alert"
    >
      <p className="text-sm text-foreground">{message}</p>
      {showApiHint && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("common:checkApiUrl")}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label={t("common:retry")}
        >
          {t("common:retry")}
        </button>
      )}
    </div>
  );
}
