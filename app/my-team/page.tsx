"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadAuthSession } from "@/components/auth/session";

export default function MyTeamPage() {
  const router = useRouter();

  useEffect(() => {
    const session = loadAuthSession();
    const favoriteTeamId = session?.user.favoriteTeamId ?? null;

    if (favoriteTeamId) {
      router.replace(`/teams/${favoriteTeamId}`);
      return;
    }

    router.replace("/settings?tab=profile");
  }, [router]);

  return (
    <section className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-6 shadow-[0_8px_22px_rgba(2,8,23,0.06)]">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Opening your team space...</h1>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        We are taking you to the right place.
      </p>
    </section>
  );
}
