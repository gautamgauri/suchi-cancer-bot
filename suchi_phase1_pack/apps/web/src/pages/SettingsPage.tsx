import { AppShell } from "../components/funding/AppShell";

export function SettingsPage() {
  return (
    <AppShell apiConfigured={false}>
      <h1 className="text-xl font-semibold text-foreground md:text-2xl">
        Settings
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Settings form will be implemented next.</p>
    </AppShell>
  );
}
