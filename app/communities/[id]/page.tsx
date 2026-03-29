import TeamCommunityShell from "@/components/communities/TeamCommunityShell";

type TeamCommunityPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TeamCommunityPage({ params }: TeamCommunityPageProps) {
  const { id } = await params;
  return <TeamCommunityShell teamId={id} />;
}

