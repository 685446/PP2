import TeamFixturesShell from "@/components/teams/TeamFixturesShell";

type TeamFixturesPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TeamFixturesPage({ params }: TeamFixturesPageProps) {
  const { id } = await params;
  return <TeamFixturesShell teamId={id} />;
}

