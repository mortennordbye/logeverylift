/**
 * Writes the synthetic Garmin FIT files the run fill tests read
 * (docs/plans/run-logger.md, step 7). No real Garmin data: every sample is
 * made up here. Run with `pnpm tsx src/__tests__/fixtures/fit/make-fit-fixtures.ts`
 * after a change, and commit the .fit files with it.
 *
 * - treadmill.fit: a treadmill run (no GPS) that starts 20 s before the app's
 *   run of 300 + 600 + 240 s, cadence per foot, Garmin's guessed distance.
 * - outdoor.fit: a road run with GPS and a lap at each step: 300 s, 1000 m in
 *   310 s, 240 s, with a 20 m climb in the 1000 m.
 * - multisport.fit: a ride of 600 s, a 72 s transition and the same run.
 * - run-bike.fit: the run first, a 60 s transition, then a ride of 600 s
 *   (the ride is the file's third part, segment 2).
 */
import { Encoder, Profile } from "@garmin/fitsdk";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const TREADMILL_START = new Date("2026-11-17T16:00:00Z");
export const OUTDOOR_START = new Date("2026-11-18T16:00:00Z");
export const MULTISPORT_START = new Date("2026-11-19T09:00:00Z");
export const RUN_BIKE_START = new Date("2026-11-16T09:00:00Z");

type Sample = { hr: number; cadence: number; speed: number; power?: number; climb?: number };
type Part = { sport: string; subSport: string; seconds: number; laps: number[]; sample: (s: number) => Sample | null; gps: boolean };

const semi = (deg: number) => Math.round((deg / 180) * 2 ** 31);
/** A small wobble, the same on every run of this script. */
const wobble = (s: number, n: number) => ((s * 13) % n) - Math.floor(n / 2);

function encode(start: Date, parts: Part[]): Buffer {
  const enc = new Encoder();
  const at = (s: number) => new Date(start.getTime() + s * 1000);
  enc.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: "development", product: 0, serialNumber: 1, timeCreated: start, type: "activity" });
  enc.onMesg(Profile.MesgNum.EVENT, { timestamp: at(0), event: "timer", eventType: "start" });
  let offset = 0;
  let distance = 0;
  let altitude = 100;
  const sessions: Record<string, unknown>[] = [];
  let lapIndex = 0;
  for (const p of parts) {
    let lapStart = 0;
    let lapDistance = distance;
    const partDistance = distance;
    for (let s = 0; s < p.seconds; s++) {
      const x = p.sample(s);
      if (x) {
        distance += x.speed;
        altitude += x.climb ?? 0;
        enc.onMesg(Profile.MesgNum.RECORD, {
          timestamp: at(offset + s),
          heartRate: x.hr,
          cadence: x.cadence,
          distance: Math.round(distance * 100) / 100,
          enhancedSpeed: x.speed,
          ...(x.power !== undefined && { power: x.power }),
          ...(p.gps && { positionLat: semi(59.9 + distance / 111_320), positionLong: semi(10.7), enhancedAltitude: altitude }),
        });
      }
      const lapEnd = p.laps.find((l) => l === s + 1);
      if (lapEnd !== undefined) {
        enc.onMesg(Profile.MesgNum.LAP, {
          timestamp: at(offset + lapEnd),
          startTime: at(offset + lapStart),
          totalElapsedTime: lapEnd - lapStart,
          totalTimerTime: lapEnd - lapStart,
          totalDistance: Math.round((distance - lapDistance) * 100) / 100,
          sport: p.sport,
        });
        lapStart = lapEnd;
        lapDistance = distance;
        lapIndex++;
      }
    }
    sessions.push({
      timestamp: at(offset + p.seconds),
      startTime: at(offset),
      totalElapsedTime: p.seconds,
      totalTimerTime: p.seconds,
      totalDistance: Math.round((distance - partDistance) * 100) / 100,
      sport: p.sport,
      subSport: p.subSport,
      firstLapIndex: lapIndex - p.laps.length,
      numLaps: p.laps.length,
    });
    offset += p.seconds;
  }
  enc.onMesg(Profile.MesgNum.EVENT, { timestamp: at(offset), event: "timer", eventType: "stopAll" });
  for (const s of sessions) enc.onMesg(Profile.MesgNum.SESSION, s);
  enc.onMesg(Profile.MesgNum.ACTIVITY, { timestamp: at(offset), numSessions: sessions.length, type: "manual", event: "activity", eventType: "stop", totalTimerTime: offset });
  return Buffer.from(enc.close());
}

/** The run's steps in seconds from its own start: 300 s warm-up, the middle step, 240 s cool-down. */
function runSample(middle: number, speeds: [number, number, number], hrs: [number, number, number], climbMiddle = 0) {
  return (s: number): Sample => {
    const i = s < 300 ? 0 : s < 300 + middle ? 1 : 2;
    return { hr: hrs[i] + wobble(s, 7), cadence: 85 + wobble(s, 3), speed: speeds[i], climb: i === 1 ? climbMiddle / middle : 0 };
  };
}

/** Garmin's treadmill guess: 20 s before the app's start, then the steps, then 10 s after. */
export function treadmillFit(): Buffer {
  const run = runSample(600, [2.2, 2.4, 1.6], [125, 145, 120]);
  return encode(TREADMILL_START, [
    {
      sport: "running",
      subSport: "treadmill",
      seconds: 1170,
      laps: [1170],
      gps: false,
      sample: (s) => (s < 20 ? { hr: 100, cadence: 80, speed: 1.5 } : s >= 1160 ? { hr: 110, cadence: 80, speed: 1.5 } : run(s - 20)),
    },
  ]);
}

const outdoorRun: Omit<Part, "sport" | "subSport"> = {
  seconds: 850,
  laps: [300, 610, 850],
  gps: true,
  sample: runSample(310, [2.5, 1000 / 310, 2.2], [130, 160, 125], 20),
};

export function outdoorFit(): Buffer {
  return encode(OUTDOOR_START, [{ sport: "running", subSport: "street", ...outdoorRun }]);
}

export function multisportFit(): Buffer {
  return encode(MULTISPORT_START, [
    { sport: "cycling", subSport: "road", seconds: 600, laps: [600], gps: true, sample: (s) => ({ hr: 135 + wobble(s, 7), cadence: 88, speed: 8, power: 150 + wobble(s, 21) }) },
    { sport: "transition", subSport: "generic", seconds: 72, laps: [72], gps: true, sample: () => ({ hr: 140, cadence: 0, speed: 1 }) },
    { sport: "running", subSport: "street", ...outdoorRun, laps: [850] },
  ]);
}

export function runBikeFit(): Buffer {
  return encode(RUN_BIKE_START, [
    { sport: "running", subSport: "street", ...outdoorRun, laps: [850] },
    { sport: "transition", subSport: "generic", seconds: 60, laps: [60], gps: true, sample: () => ({ hr: 140, cadence: 0, speed: 1 }) },
    { sport: "cycling", subSport: "road", seconds: 600, laps: [600], gps: true, sample: (s) => ({ hr: 135 + wobble(s, 7), cadence: 88, speed: 8, power: 150 + wobble(s, 21) }) },
  ]);
}

// Run as a script: write the files next to this one.
if (process.argv[1]?.endsWith("make-fit-fixtures.ts")) {
  const dir = import.meta.dirname;
  writeFileSync(join(dir, "treadmill.fit"), treadmillFit());
  writeFileSync(join(dir, "outdoor.fit"), outdoorFit());
  writeFileSync(join(dir, "multisport.fit"), multisportFit());
  writeFileSync(join(dir, "run-bike.fit"), runBikeFit());
}
