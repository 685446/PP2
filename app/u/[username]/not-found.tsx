import Link from "next/link";

export default function PublicProfileNotFound() {
  return (
    <section className="mx-auto w-full max-w-[900px]">
      <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-8 text-center shadow-[0_12px_28px_rgba(2,8,23,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]">
          Public Profile
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[color:var(--foreground)]">
          User not found
        </h1>
        <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
          This profile does not exist or is no longer available.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className="btn-primary">
            Back Home
          </Link>
          <Link href="/discussions" className="btn-secondary">
            Browse Discussions
          </Link>
        </div>
      </div>
    </section>
  );
}
