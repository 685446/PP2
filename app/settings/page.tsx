import { Suspense } from "react";
import SettingsShell from "@/components/settings/SettingsShell";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <section className="space-y-2">
          <h1 className="text-3xl font-bold text-[color:var(--foreground)]">Settings</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">Loading settings...</p>
        </section>
      }
    >
      <SettingsShell />
    </Suspense>
  );
}
