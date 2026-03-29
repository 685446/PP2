import type { Metadata } from "next";
import AppShell from "@/components/layout/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "SportsDeck",
  description: "Premier League discussion, threads, and match day conversation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInitScript = `
    (function () {
      try {
        var key = "sportsdeck.theme";
        var raw = window.localStorage.getItem(key);
        var pref = raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
        var system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        var resolved = pref === "system" ? system : pref;
        var root = document.documentElement;
        root.dataset.theme = resolved;
        root.style.colorScheme = resolved;
      } catch (e) {}
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
