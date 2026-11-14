import type { Locator, Page } from "@playwright/test";

/** One screenshot in manifest.json. The runner leaves `note` and `bug` empty for the reviewer. */
export type ManifestEntry = {
  journey: number;
  step: number;
  /** Stable id of the step, like "J1-02". Keep it the same across captures. */
  id: string;
  title: string;
  account: string;
  width: number;
  file: string;
  /** URL path when the shot was taken. */
  path: string;
  /** Console errors and page errors seen during the step that took this shot. */
  errors: string[];
  note: string;
  bug: string | null;
};

/** run.json: what the review page needs besides the manifest. */
export type RunInfo = {
  set: string;
  title: string;
  intro: string;
  journeys: Journey[];
  accounts: { name: string; email: string; about: string }[];
  date: string;
  base: string;
  branch: string;
  commit: string;
  widths: number[];
  failures: string[];
  /** Free text for the reviewer, for example "Second capture, after two fix rounds". */
  summary: string;
};

export type Journey = { id: number; title: string; summary: string };

export type ShotOptions = {
  /** false: only the main width (the first of --widths). Default: every width. */
  small?: boolean;
  /** Take the shot at once, at the main width, with no wait and no growing to the full page (loading states). */
  raw?: boolean;
};

/** What a flow gets from the runner. */
export type Ctx = {
  page: Page;
  base: string;
  /** Short name of the account this flow runs as. */
  account: string;
  go: (path: string) => Promise<void>;
  settle: (ms?: number) => Promise<void>;
  /** Run one named step. The name must start with "J<n> " so --journeys can filter it. A failure is recorded and the flow goes on. */
  step: (name: string, fn: () => Promise<void>) => Promise<void>;
  shot: (journey: number, step: number, slug: string, title: string, opts?: ShotOptions) => Promise<void>;
  sheet: () => Locator;
  closeSheet: () => Promise<void>;
  dialogOpen: () => Promise<boolean>;
  /** First link href on the page that matches. */
  hrefOf: (re: RegExp) => Promise<string | null>;
  /** Href of the first link with this accessible name. */
  linkByText: (text: string | RegExp) => Promise<string | null>;
};

export type Flow = {
  /** Unique name of the flow (an account can run more than one flow). */
  name: string;
  /** Key in JourneySet.accounts. */
  account: string;
  /** Journeys this flow has steps for, so --journeys can skip the whole flow. */
  journeys: number[];
  run: (c: Ctx) => Promise<void>;
};

export type JourneySet = {
  name: string;
  /** Page title, for example "Plan tab". */
  title: string;
  /** One or two sentences for the top of the review page. */
  intro: string;
  /** Page that a signed-in account can open; used to check a cached sign-in. */
  homePath: string;
  /** Command that reseeds the demo accounts (run with --seed). */
  seed?: string[];
  /** All emails must end with @demo.local; the runner refuses others. */
  accounts: Record<string, { email: string; password: string; about: string }>;
  journeys: Journey[];
  flows: Flow[];
};
