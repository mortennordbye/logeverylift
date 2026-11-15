/** "Record on Garmin" (docs/plans/bike-sessions.md, 5.2): the lines come from recordLines(). */
export function RecordBox({ lines }: { lines: string[] }) {
  return (
    <section className="mt-3 rounded-[18px] bg-widget px-3.5 py-3 text-sm" aria-labelledby="record-on-garmin" data-testid="record-box">
      <h2 id="record-on-garmin" className="font-bold">
        Record on Garmin
      </h2>
      <ol className="mt-1.5 list-decimal pl-5">
        {lines.map((l) => (
          <li key={l} className="my-0.5">
            {l}
          </li>
        ))}
      </ol>
    </section>
  );
}
