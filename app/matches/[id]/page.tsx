import MatchDetailShell from "@/components/matches/MatchDetailShell";

type MatchDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { id } = await params;
  return <MatchDetailShell matchId={id} />;
}
