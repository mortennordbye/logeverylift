import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { Suspense } from "react";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function WorkoutLayout({ children, params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  return (
    <>
      {!Number.isNaN(programId) && (
        <Suspense fallback={null}>
          <WorkoutSessionInitializer programId={programId} />
        </Suspense>
      )}
      {children}
    </>
  );
}
