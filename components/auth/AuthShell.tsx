import type { ReactNode } from "react";
import { ChevronDown, ShieldCheck, Sparkles, Users } from "lucide-react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
  highlights: [string, string, string];
};

const ICONS = [ShieldCheck, Users, Sparkles] as const;

function HighlightList({
  highlights,
  inverse = false,
}: {
  highlights: [string, string, string];
  inverse?: boolean;
}) {
  return (
    <ul className="space-y-4">
      {highlights.map((item, idx) => {
        const Icon = ICONS[idx];
        return (
          <li key={item} className="flex items-start gap-3">
            <span
              className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full ${
                inverse
                  ? "border border-[color:var(--auth-aside-icon-border)] bg-[color:var(--auth-aside-icon-bg)] text-[color:var(--auth-aside-icon-color)]"
                  : "border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] text-sky-500"
              }`}
            >
              <Icon size={15} aria-hidden />
            </span>
            <span
              className={`text-sm leading-6 ${
                inverse ? "text-[color:var(--auth-aside-item-color)]" : "text-[color:var(--foreground)]"
              }`}
            >
              {item}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
  highlights,
}: AuthShellProps) {
  return (
    <section className="-m-5 min-h-[calc(100vh-4rem)] sm:-m-7 lg:-m-10">
      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
        <div className="bg-[color:var(--surface)] px-6 py-8 sm:px-10 sm:py-12 lg:flex lg:items-center lg:px-16">
          <div className="mx-auto w-full max-w-xl">
            <header className="space-y-3">
              <span className="inline-flex w-fit rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-[color:var(--muted-foreground)]">
                Account Access
              </span>
              <h1 className="text-4xl font-bold text-[color:var(--foreground)] sm:text-5xl">{title}</h1>
              <p className="max-w-xl text-base text-[color:var(--muted-foreground)]">{subtitle}</p>
            </header>

            <div className="mt-8 w-full max-w-[430px]">{children}</div>

            <div className="mt-7 border-t border-[color:var(--surface-border)] pt-5 text-sm text-[color:var(--muted-foreground)]">{footer}</div>
          </div>
        </div>

        <aside className="relative hidden overflow-hidden border-l border-[color:var(--surface-border)] bg-[color:var(--surface)] lg:flex lg:items-center lg:justify-center">
          <div
            aria-hidden
            className="absolute inset-0 [background:var(--auth-aside-bg)]"
          />
          <div
            aria-hidden
            className="absolute inset-0 [background-image:repeating-linear-gradient(-35deg,transparent_0,transparent_76px,rgba(255,255,255,0.08)_76px,rgba(255,255,255,0.08)_106px)]"
            style={{ opacity: "var(--auth-aside-stripe-opacity)" }}
          />

          <div className="relative z-10 w-full max-w-xl px-10 py-12">
            <h2 className="mx-auto max-w-md text-center text-4xl font-semibold leading-tight text-[color:var(--auth-aside-heading)]">
              Join SportsDeck and never miss matchday buzz.
            </h2>
            <div className="mt-7 rounded-2xl border border-[color:var(--auth-aside-card-border)] bg-[color:var(--auth-aside-card-bg)] p-6 [box-shadow:var(--auth-aside-card-shadow)] backdrop-blur-sm">
              <HighlightList highlights={highlights} inverse />
            </div>
          </div>
        </aside>
      </div>

      <details className="mx-4 -mt-1 mb-4 overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-[color:var(--foreground)]">
          Learn more
          <ChevronDown className="h-4 w-4 text-[color:var(--muted-foreground)]" />
        </summary>
        <div className="relative overflow-hidden border-t border-[color:var(--surface-border)] px-4 py-4">
          <div
            aria-hidden
            className="absolute inset-0 [background:var(--auth-aside-bg)]"
          />
          <div className="relative z-10 rounded-xl border border-[color:var(--auth-aside-card-border)] bg-[color:var(--auth-aside-card-bg)] p-4 backdrop-blur-sm">
            <HighlightList highlights={highlights} inverse />
          </div>
        </div>
      </details>
    </section>
  );
}
