import TeamPlaceholderShell from "@/components/teams/TeamPlaceholderShell";

type TeamDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  return <TeamPlaceholderShell teamId={id} />;
}

