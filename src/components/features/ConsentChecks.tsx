import Link from "next/link";

export type ConsentState = { terms: boolean; healthData: boolean };

/** The two boxes asked at sign-up and on /consent when the terms change. */
export function ConsentChecks({ value, onChange }: { value: ConsentState; onChange: (v: ConsentState) => void }) {
  const row = "flex items-start gap-3 text-sm min-h-[44px] cursor-pointer";
  const box = "mt-0.5 h-5 w-5 shrink-0 accent-primary";
  return (
    <div className="flex flex-col gap-3">
      <label className={row}>
        <input
          type="checkbox"
          className={box}
          checked={value.terms}
          onChange={(e) => onChange({ ...value, terms: e.target.checked })}
        />
        <span>
          I accept the{" "}
          <Link href="/terms" target="_blank" className="text-primary underline">
            terms of use
          </Link>{" "}
          and have read the{" "}
          <Link href="/privacy" target="_blank" className="text-primary underline">
            privacy policy
          </Link>
          . I understand LogEveryLift is in early access, with no guarantee of uptime or against data loss.
        </span>
      </label>
      <label className={row}>
        <input
          type="checkbox"
          className={box}
          checked={value.healthData}
          onChange={(e) => onChange({ ...value, healthData: e.target.checked })}
        />
        <span>
          I consent to LogEveryLift storing my training and body data, such as body weight, heart rate zones,
          readiness and notes, which can say something about my health.
        </span>
      </label>
    </div>
  );
}
