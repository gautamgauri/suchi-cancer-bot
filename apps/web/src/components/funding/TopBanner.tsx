import { useTranslation } from "react-i18next";

interface TopBannerProps {
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  storageKey?: string;
  variant?: "info" | "warning";
  className?: string;
}

export function TopBanner({
  message,
  dismissible = true,
  onDismiss,
  storageKey,
  variant = "warning",
  className = "",
}: TopBannerProps) {
  const { t } = useTranslation("common");
  const bg = variant === "warning" ? "bg-accent/10 border-accent/30" : "bg-muted border-border";
  const handleDismiss = () => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, "dismissed");
      } catch {
        /* ignore */
      }
    }
    onDismiss?.();
  };

  return (
    <div
      role="banner"
      className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm text-foreground ${bg} ${className}`}
    >
      <span>{message}</span>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded p-1 hover:bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={t("close")}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
