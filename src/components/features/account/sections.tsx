"use client";

/**
 * The Account pages as data: the group buttons on the top page, the sections
 * the sub-pages show, and each row's label, value, when it shows, and the
 * editor its sheet opens. To add a field, add a row here; to add a sub-page,
 * add a section and a group button. A sub-page renders its section in one
 * loop and opens one sheet.
 */

import {
  AvailabilityStep,
  DAY_LABELS,
  ExperienceStep,
  Injuries,
  LEVEL_TEXT,
  StrengthStep,
  type DeletedInjuryView,
  type InjuryView,
  type ProfileView,
} from "@/components/features/AthleteProfileParts";
import { SickPeriods, type Consistency, type IllnessDraft } from "@/components/features/IllnessSheet";
import { InvitedBadge } from "@/components/features/InvitedBadge";
import {
  DeletedThresholds,
  ThresholdEditor,
  ThresholdHistory,
  thresholdSourceLine,
  type DeletedThresholdView,
  type SuggestionView,
  type ThresholdView,
} from "@/components/features/ThresholdEditor";
import {
  EXPERIENCE_HINTS,
  EXPERIENCE_LABELS,
  GENDER_LABELS,
  FOCUS_LABELS,
  FocusStep,
  GOAL_LABELS,
  GoalsStep,
  OTHER_GOALS,
  focusOf,
  NameStep,
  NumberStep,
  PickerStep,
  type ExperienceLevel,
  type Gender,
} from "@/components/features/account/ProfileSteps";
import { SUB_PAGES, type SubPage } from "@/components/features/account/pages";
import { SyncNote } from "@/components/features/account/SyncNote";
import type { ThresholdKind } from "@/db/schema/athlete-profile";
import { ChangePassword } from "@/components/features/account/ChangePassword";
import { addThresholdValue } from "@/lib/actions/athlete-profile";
import { updateActivityPrivacy } from "@/lib/actions/friends";
import { setAiConsent } from "@/lib/actions/legal";
import { setGarminSync, takeGarminField } from "@/lib/actions/garmin";
import { sourceLine, type FieldSource, type SyncedField } from "@/lib/utils/field-sources";
import type { Goal } from "@/lib/utils/goals";
import { STRENGTH_GOAL_LABEL } from "@/lib/utils/strength-goal";
import { THRESHOLD_LABEL, currentThresholds, formatThreshold, thresholdWarnings } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";
import type { ActionResult } from "@/types/workout";
import { Download, Gauge, HeartPulse, Shield, Target, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Everything the rows read, loaded in the page's one server read. */
export type AccountData = {
  name: string;
  email: string;
  role: string;
  invited: boolean;
  goals: Goal[];
  experienceLevel: ExperienceLevel | null;
  gender: Gender | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  /** Premium with Garmin enabled: the only users who see Garmin text. */
  premium: boolean;
  /** null hides the Garmin section: not Premium, or Garmin not connected. */
  garminSync: boolean | null;
  weightSource: FieldSource | null;
  /** Per synced field, its source line and Garmin's differing value; Premium only. */
  sync: Partial<Record<SyncedField, { note: string | null; says: string | null }>>;
  endurance: boolean;
  athlete: ProfileView | null;
  injuries: InjuryView[];
  deletedInjuries: DeletedInjuryView[];
  illness: (IllnessDraft & { id: number })[];
  consistency: Consistency;
  thresholds: ThresholdView[];
  deletedThresholds: DeletedThresholdView[];
  suggestions: SuggestionView[];
  units: Units;
  today: string;
  showActivityToFriends: boolean;
  aiConsent: boolean;
};

export type Row = {
  id: string;
  label: string | ((d: AccountData) => string);
  value?: (d: AccountData) => ReactNode;
  /** A second line under the row. */
  note?: (d: AccountData) => ReactNode;
  show?: (d: AccountData) => boolean;
  /** What the row's sheet shows; `done` closes it and reloads the data. */
  editor?: (d: AccountData, done: () => void) => ReactNode;
  href?: string;
  /** A switch in the row instead of a sheet. */
  toggle?: { on: (d: AccountData) => boolean; set: (on: boolean) => Promise<ActionResult<unknown>> };
};

export type Section = { id: string; title: string; rows: Row[] };

const notSet = "Not set";

function fieldNote(d: AccountData, field: SyncedField) {
  const v = d.sync[field];
  if (!v?.note && !v?.says) return null;
  return <SyncNote note={v.note} says={v.says} onUse={() => takeGarminField({ field })} />;
}
const endurance = (d: AccountData) => d.endurance;

function thresholdRow(kind: ThresholdKind): Row {
  return {
    id: `threshold-${kind}`,
    label: THRESHOLD_LABEL[kind],
    value: (d) => {
      const c = currentThresholds(d.thresholds)[kind];
      return c ? formatThreshold(kind, c.value, d.units) : notSet;
    },
    note: (d) => {
      const current = currentThresholds(d.thresholds);
      const c = current[kind];
      const s = d.suggestions.find((x) => x.kind === kind);
      const warnings = thresholdWarnings({ max_hr: current.max_hr, [kind]: current[kind] });
      if (!c && warnings.length === 0) return null;
      return (
        <>
          <SyncNote
            note={c ? thresholdSourceLine(c, d.today, d.premium) : null}
            says={s && c && c.source !== "garmin" ? formatThreshold(kind, s.value, d.units) : null}
            onUse={() => addThresholdValue({ kind, value: s!.value, source: "garmin" })}
          />
          {warnings.map((w) => (
            <p key={w} className="text-amber-600 dark:text-amber-400" data-testid="threshold-warning">
              {w}
            </p>
          ))}
        </>
      );
    },
    editor: (d, done) => (
      <>
        <ThresholdEditor kind={kind} units={d.units} onSaved={done} />
        <ThresholdHistory history={d.thresholds.filter((t) => t.kind === kind)} units={d.units} onDeleted={done} />
      </>
    ),
  };
}

export const SECTIONS: Section[] = [
  {
    id: "profile",
    title: SUB_PAGES["profile"],
    rows: [
      { id: "name", label: "Name", value: (d) => d.name, editor: (d, done) => <NameStep initial={d.name} onSaved={done} /> },
      { id: "email", label: "Email", value: (d) => d.email },
      { id: "role", label: "Role", value: (d) => <span className="capitalize">{d.role}</span> },
      { id: "joined", label: "Joined", value: () => <InvitedBadge compact />, show: (d) => d.invited },
    ],
  },
  {
    id: "garmin",
    title: "Garmin",
    rows: [
      {
        id: "garmin-sync",
        label: "Sync from Garmin",
        note: () => "Keeps body weight, max HR, threshold HR, FTP, run pace, availability, time zone and units up to date.",
        show: (d) => d.garminSync !== null,
        toggle: { on: (d) => d.garminSync === true, set: (on) => setGarminSync({ enabled: on }) },
      },
    ],
  },
  {
    id: "goals-and-training",
    title: SUB_PAGES["goals-and-training"],
    rows: [
      {
        id: "goals",
        label: "Goals",
        value: (d) => {
          const others = d.goals.filter((g) => OTHER_GOALS.includes(g));
          return others.length ? others.map((g) => GOAL_LABELS[g]).join(", ") : notSet;
        },
        editor: (d, done) => <GoalsStep initial={d.goals} onSaved={done} />,
      },
      {
        id: "main-focus",
        label: "Main focus",
        value: (d) => {
          const f = focusOf(d.goals);
          return f ? FOCUS_LABELS[f] : notSet;
        },
        editor: (d, done) => <FocusStep initial={d.goals} onSaved={done} />,
      },
      {
        id: "strength-goal",
        label: "Strength on the side",
        value: (d) => (d.athlete?.strengthGoal ? STRENGTH_GOAL_LABEL[d.athlete.strengthGoal] : notSet),
        // Only the triathlon plan and the strength limit read it, so only an endurance focus needs it.
        show: (d) => d.endurance && (focusOf(d.goals) === "endurance" || focusOf(d.goals) === "both"),
        editor: (d, done) => <StrengthStep initial={d.athlete?.strengthGoal ?? null} onSaved={done} />,
      },
      {
        id: "experience-strength",
        label: "Experience, strength",
        value: (d) => (d.experienceLevel ? EXPERIENCE_LABELS[d.experienceLevel] : notSet),
        editor: (d, done) => <PickerStep field="experienceLevel" initial={d.experienceLevel} labels={EXPERIENCE_LABELS} hints={EXPERIENCE_HINTS} onSaved={done} />,
      },
      {
        id: "experience-endurance",
        label: "Experience, endurance",
        value: (d) => (d.athlete?.enduranceLevel ? LEVEL_TEXT[d.athlete.enduranceLevel].label : notSet),
        show: endurance,
        editor: (d, done) => <ExperienceStep initial={d.athlete?.enduranceLevel ?? null} onSaved={done} />,
      },
      {
        id: "availability",
        label: "Availability",
        value: (d) =>
          d.athlete?.availableDays?.length
            ? `${d.athlete.availableDays.map((n) => DAY_LABELS[n]).join(" ")} · ${d.athlete.hoursPerWeek ?? "?"} h a week`
            : notSet,
        note: (d) => fieldNote(d, "availability"),
        show: endurance,
        editor: (d, done) => <AvailabilityStep initial={d.athlete} onSaved={done} />,
      },
    ],
  },
  {
    id: "body-and-health",
    title: SUB_PAGES["body-and-health"],
    rows: [
      {
        id: "gender",
        label: "Gender",
        value: (d) => (d.gender ? GENDER_LABELS[d.gender] : notSet),
        editor: (d, done) => <PickerStep field="gender" initial={d.gender} labels={GENDER_LABELS} onSaved={done} />,
      },
      {
        id: "birth-year",
        label: "Year of birth",
        value: (d) => d.birthYear ?? notSet,
        editor: (d, done) => <NumberStep field="birthYear" label="Year of birth" initial={d.birthYear} unit="" placeholder="1990" onSaved={done} />,
      },
      {
        id: "height",
        label: "Height",
        value: (d) => (d.heightCm != null ? `${d.heightCm} cm` : notSet),
        editor: (d, done) => <NumberStep field="heightCm" label="Height" initial={d.heightCm} unit="cm" placeholder="180" onSaved={done} />,
      },
      {
        id: "weight",
        label: "Body weight",
        value: (d) => (d.weightKg != null ? `${d.weightKg} kg` : notSet),
        note: (d) => (d.premium && d.weightSource ? sourceLine(d.weightSource) : null),
        editor: (d, done) => <NumberStep field="weightKg" label="Body weight" initial={d.weightKg} unit="kg" placeholder="80" onSaved={done} />,
      },
      {
        id: "injuries",
        label: "Injuries and limits",
        value: (d) => {
          const now = d.injuries.filter((i) => i.status !== "past").length;
          return now ? `${now} current` : "None";
        },
        show: endurance,
        editor: (d) => <Injuries injuries={d.injuries} deleted={d.deletedInjuries} />,
      },
      {
        id: "sick-periods",
        label: "Sick periods",
        value: (d) => (d.illness.some((p) => p.endedOn === null || p.endedOn >= d.today) ? "Sick now" : d.illness.length ? `${d.illness.length}` : "None"),
        show: endurance,
        editor: (d) => <SickPeriods illness={d.illness} consistency={d.consistency} today={d.today} />,
      },
    ],
  },
  {
    id: "training-numbers",
    title: SUB_PAGES["training-numbers"],
    rows: [
      ...(["max_hr", "ftp", "lthr_bike", "lthr_run", "run_threshold_pace", "swim_css"] as const).map(thresholdRow),
      {
        id: "deleted-thresholds",
        label: (d) => `Recently deleted (${d.deletedThresholds.length})`,
        show: (d) => d.deletedThresholds.length > 0,
        editor: (d) => <DeletedThresholds deleted={d.deletedThresholds} units={d.units} />,
      },
    ],
  },
  {
    id: "privacy-and-security",
    title: SUB_PAGES["privacy-and-security"],
    rows: [
      { id: "change-password", label: "Change Password", editor: (_d, done) => <ChangePassword onDone={done} /> },
      {
        id: "activity-privacy",
        label: "Show workout activity to friends",
        note: () => "Friends can see your workouts, sets and streak",
        toggle: { on: (d) => d.showActivityToFriends, set: (on) => updateActivityPrivacy({ showActivityToFriends: on }) },
      },
      // Turning AI editing on happens in AI Setup, next to what it sends.
      {
        id: "ai-editing",
        label: "AI editing",
        note: () => "AI Setup can send your request to an outside model",
        show: (d) => d.aiConsent,
        toggle: { on: (d) => d.aiConsent, set: (on) => setAiConsent({ consent: on }) },
      },
    ],
  },
];

/** A button on the top Account page: it opens /more/account/<id>. */
export type GroupButton = { id: SubPage; title: string; icon: LucideIcon };

export const GROUPS: { title: string; buttons: GroupButton[] }[] = [
  {
    title: "You",
    buttons: [
      { id: "goals-and-training", title: SUB_PAGES["goals-and-training"], icon: Target },
      { id: "body-and-health", title: SUB_PAGES["body-and-health"], icon: HeartPulse },
      { id: "training-numbers", title: SUB_PAGES["training-numbers"], icon: Gauge },
    ],
  },
  {
    title: "Account",
    buttons: [
      { id: "privacy-and-security", title: SUB_PAGES["privacy-and-security"], icon: Shield },
      { id: "your-data", title: SUB_PAGES["your-data"], icon: Download },
    ],
  },
];
