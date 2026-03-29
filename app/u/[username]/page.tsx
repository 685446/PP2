import { notFound, redirect } from "next/navigation";
import ProfileShell from "@/components/profile/ProfileShell";
import { prisma } from "@/prisma/db";

type PublicProfileByUsernamePageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function PublicProfileByUsernamePage({
  params,
}: PublicProfileByUsernamePageProps) {
  const { username } = await params;
  const requestedUsername = username.trim();

  if (!requestedUsername) {
    notFound();
  }

  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: requestedUsername,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (!user) {
    notFound();
  }

  if (user.username !== requestedUsername) {
    redirect(`/u/${encodeURIComponent(user.username)}`);
  }

  return <ProfileShell targetUserId={user.id} />;
}
