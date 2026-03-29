import { notFound } from "next/navigation";
import ProfileShell from "@/components/profile/ProfileShell";

type UserProfilePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { id } = await params;
  const parsedId = Number(id);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    notFound();
  }

  return <ProfileShell targetUserId={parsedId} />;
}
