import type { NumbersTable } from "@/lib/utils/bike-view";
import Link from "next/link";

function Rows({ title, rows }: { title: string; rows: NumbersTable["hr"] }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pt-2 pb-1 text-muted-foreground">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.zone} className="border-b border-hairline last:border-b-0">
          <td className="py-1.5">
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: `var(--viz-zone-${r.zone})` }} aria-hidden />Z{r.zone}
          </td>
          <td className="py-1.5 text-right tabular-nums">{r.text}</td>
        </tr>
      ))}
    </>
  );
}

/** The HR and power zones the steps resolve against (5.2), with a link to change them. */
export function YourNumbers({ table }: { table: NumbersTable }) {
  return (
    <section aria-labelledby="your-numbers" data-testid="your-numbers">
      <div className="mx-0.5 mb-2 mt-4 flex items-center justify-between">
        <h2 id="your-numbers" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Your numbers
        </h2>
        <Link href="/more/thresholds" className="flex min-h-11 items-center text-sm text-primary active:opacity-70">
          Thresholds
        </Link>
      </div>
      <div className="rounded-2xl bg-widget px-3 py-1">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {table.hr.length > 0 ? <Rows title={table.hrTitle} rows={table.hr} /> : (
              <tr>
                <td colSpan={2} className="py-2 text-muted-foreground">
                  No bike heart rate zones yet. Sync Garmin or set your bike LTHR.
                </td>
              </tr>
            )}
            {table.powerTitle && table.power.length > 0 && <Rows title={table.powerTitle} rows={table.power} />}
          </tbody>
        </table>
      </div>
    </section>
  );
}
