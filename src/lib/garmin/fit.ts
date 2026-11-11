import { Decoder, Stream } from "@garmin/fitsdk";

/**
 * Parse a FIT activity file into what LogEveryLift stores per activity:
 * columnar streams (one array per field, aligned by index), laps, strength
 * sets, time in zones and the session summary.
 *
 * Bump FIT_PARSER_VERSION when the output changes, so stored activities can
 * be parsed again from their saved file.
 */
export const FIT_PARSER_VERSION = 2;

/** Record fields kept as streams, FIT name -> stored name. */
const STREAM_FIELDS = {
  heartRate: "hr",
  power: "power",
  cadence: "cadence",
  enhancedSpeed: "speed",
  enhancedAltitude: "altitude",
  distance: "distance",
  temperature: "temperature",
  positionLat: "lat",
  positionLong: "lng",
  verticalOscillation: "verticalOscillation",
  stanceTime: "groundContactTime",
  stepLength: "stepLength",
  respirationRate: "respirationRate",
} as const;

export type StreamName = (typeof STREAM_FIELDS)[keyof typeof STREAM_FIELDS] | "t";

export type ParsedFit = {
  parserVersion: number;
  sport: string | null;
  subSport: string | null;
  startTime: string | null;
  /** Seconds from the first record ("t") plus one array per field that has any value. Gaps are null. */
  streams: Partial<Record<StreamName, (number | null)[]>>;
  laps: Record<string, unknown>[];
  sets: Record<string, unknown>[];
  timeInZone: Record<string, unknown>[];
  session: Record<string, unknown> | null;
  /** Pool lengths: time, strokes, stroke type (swims only). Since v2. */
  lengths: Record<string, unknown>[];
  /** Timer start and stop events, for pauses. Since v2. */
  events: Record<string, unknown>[];
};

/** FIT stores positions in semicircles. */
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

type Mesg = Record<string, unknown>;

/** Dates become ISO strings and typed arrays become plain arrays, so the result is JSON-safe. */
function plain(m: Mesg): Mesg {
  const out: Mesg = {};
  for (const [k, v] of Object.entries(m)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (ArrayBuffer.isView(v)) out[k] = Array.from(v as unknown as ArrayLike<number>);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export function parseFit(file: Buffer): ParsedFit {
  const stream = Stream.fromBuffer(file);
  if (!Decoder.isFIT(stream)) throw new Error("not a FIT file");
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    convertDateTimesToDates: true,
    expandComponents: true,
    mergeHeartRates: true,
    convertTypesToStrings: true,
  });
  if (errors.length) throw new Error(`FIT decode failed: ${String(errors[0])}`);

  const records = (messages.recordMesgs ?? []) as Mesg[];
  const first = records.find((r) => r.timestamp instanceof Date)?.timestamp as Date | undefined;

  const streams: ParsedFit["streams"] = {};
  if (first) {
    streams.t = records.map((r) => (r.timestamp instanceof Date ? Math.round((r.timestamp.getTime() - first.getTime()) / 1000) : null));
    for (const [fitName, name] of Object.entries(STREAM_FIELDS)) {
      const values = records.map((r) => {
        const v = r[fitName];
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        return name === "lat" || name === "lng" ? Math.round(v * SEMICIRCLE_TO_DEG * 1e6) / 1e6 : v;
      });
      if (values.some((v) => v !== null)) streams[name] = values;
    }
  }

  const sport = ((messages.sportMesgs ?? []) as Mesg[])[0] ?? ((messages.sessionMesgs ?? []) as Mesg[])[0];
  const session = ((messages.sessionMesgs ?? []) as Mesg[])[0];

  return {
    parserVersion: FIT_PARSER_VERSION,
    sport: typeof sport?.sport === "string" ? sport.sport : null,
    subSport: typeof sport?.subSport === "string" ? sport.subSport : null,
    startTime: session?.startTime instanceof Date ? session.startTime.toISOString() : (first?.toISOString() ?? null),
    streams,
    laps: ((messages.lapMesgs ?? []) as Mesg[]).map(plain),
    sets: ((messages.setMesgs ?? []) as Mesg[]).map(plain),
    timeInZone: ((messages.timeInZoneMesgs ?? []) as Mesg[]).map(plain),
    session: session ? plain(session) : null,
    lengths: ((messages.lengthMesgs ?? []) as Mesg[]).map(plain),
    events: ((messages.eventMesgs ?? []) as Mesg[]).filter((e) => e.event === "timer").map(plain),
  };
}
