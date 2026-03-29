import ThreadView from "@/components/threads/ThreadView";

type ThreadPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { id } = await params;
  return <ThreadView threadId={id} />;
}

