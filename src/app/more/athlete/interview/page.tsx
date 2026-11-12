import { InterviewClient } from "@/components/features/InterviewClient";
import { getAthleteData } from "@/lib/actions/athlete-profile";
import { localPath } from "@/lib/utils/sign-in-redirect";
import { redirect } from "next/navigation";

/** The intake interview (docs/plans/athlete-profile.md, 2.6), behind the endurance switch (D18). */
export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const result = await getAthleteData();
  if (!result.success) throw new Error(result.error);
  if (result.data === null) redirect("/more");
  const data = result.data;
  const { next } = await searchParams;
  // Only paths inside the app, never another site.
  const back = localPath(next, "/more/athlete");
  return (
    <InterviewClient
      race={data.race}
      profile={data.profile}
      thresholds={data.thresholds.map((t) => ({ id: t.id, kind: t.kind, value: t.value, measuredOn: t.measuredOn, source: t.source }))}
      suggestions={data.suggestions.map((s) => ({ kind: s.kind, value: s.value, basis: s.basis }))}
      injuries={data.injuries.map((i) => ({
        id: i.id,
        area: i.area,
        side: i.side,
        description: i.description,
        avoid: i.avoid,
        status: i.status,
        startedOn: i.startedOn,
        endedOn: i.endedOn,
      }))}
      memory={data.memory.map((m) => ({ id: m.id, kind: m.kind, text: m.text, date: m.entryDate }))}
      units={data.units}
      next={back}
    />
  );
}
