/**
 * The owner's two bike sessions as structured workouts (docs/plans/bike-sessions.md,
 * 4.1 and 4.2), the Garmin numbers they resolve against, and FIT laps of a
 * tempo ride. Shapes and numbers follow production data; no ids from it.
 */

import type { ZoneSet } from "@/lib/utils/workout-steps";

export const APP_FTP = 180;
/** The FTP estimate the new rule gives with the real rides: the best 60 min average power. */
export const ESTIMATED_FTP = 186;
/** functionalThresholdPower in each ride's summary. */
export const WATCH_FTP = 266;
export const LTHR_BIKE = 175;

/** hr_zones snapshot, as stored: one row per sport, zone floors in bpm. */
export const HR_ZONES_SNAPSHOT = [
  { sport: "DEFAULT", maxHeartRateUsed: 201, restingHeartRateUsed: 48, lactateThresholdHeartRateUsed: 171, zone1Floor: 101, zone2Floor: 121, zone3Floor: 141, zone4Floor: 161, zone5Floor: 181 },
  { sport: "CYCLING", maxHeartRateUsed: 201, restingHeartRateUsed: 48, lactateThresholdHeartRateUsed: 171, zone1Floor: 101, zone2Floor: 121, zone3Floor: 141, zone4Floor: 161, zone5Floor: 181 },
];

/** The CYCLING row of HR_ZONES_SNAPSHOT as a ZoneSet. */
export const GARMIN_CYCLING_ZONES: ZoneSet = {
  source: "garmin",
  hr: [
    { low: 101, high: 120 },
    { low: 121, high: 140 },
    { low: 141, high: 160 },
    { low: 161, high: 180 },
    { low: 181, high: 201 },
  ],
};

const MIN = 60;

/** 4.1 Bike tempo, 65 min, hard 30 min. */
export const TEMPO_WORKOUT = {
  v: 1,
  sport: "bike",
  name: "Tempo 2 x 15 min",
  description: "Not a hard session: you must be able to talk in short sentences.",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 60, high: 72 }, secondary: { metric: "hr", anchor: "absolute", high: 140 }, cadence: { low: 85, high: 95 }, note: "Build up in the last 5 min" },
    { type: "work", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 75, high: 80 }, secondary: { metric: "hr", anchor: "lthr", zone: 3 }, cadence: { low: 85, high: 95 }, note: "Talk in short sentences" },
    { type: "recovery", end: { type: "time", seconds: 5 * MIN }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 }, secondary: { metric: "hr", anchor: "absolute", high: 140 } },
    { type: "work", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 75, high: 80 }, secondary: { metric: "hr", anchor: "lthr", zone: 3 }, cadence: { low: 85, high: 95 }, note: "Same as block 1" },
    { type: "cooldown", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 60, high: 72 }, secondary: { metric: "hr", anchor: "absolute", high: 140 } },
  ],
} as const;

const EAT = "Eat 15-20 g carbs now";

/** 4.2 Long ride, 135 min, fuel cues at 60, 80, 100 and 120 min. */
export const LONG_RIDE_WORKOUT = {
  v: 1,
  sport: "bike",
  name: "Long ride",
  description: "Steady, no surges. Practise eating: 40-60 g carbs per hour from 60 min.",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 50, high: 66.7 }, secondary: { metric: "hr", anchor: "absolute", high: 140 } },
    { type: "steady", end: { type: "time", seconds: 45 * MIN }, target: { metric: "power", anchor: "ftp", low: 61, high: 72 }, secondary: { metric: "hr", anchor: "lthr", zone: 2 }, note: "No surges" },
    { type: "repeat", count: 3, steps: [{ type: "steady", end: { type: "time", seconds: 20 * MIN }, target: { metric: "power", anchor: "ftp", low: 61, high: 72 }, secondary: { metric: "hr", anchor: "lthr", zone: 2 }, note: EAT }] },
    { type: "steady", end: { type: "time", seconds: 10 * MIN }, target: { metric: "power", anchor: "ftp", low: 61, high: 72 }, secondary: { metric: "hr", anchor: "lthr", zone: 2 }, note: EAT },
    { type: "cooldown", end: { type: "time", seconds: 5 * MIN }, target: { metric: "power", anchor: "ftp", high: 61 }, secondary: { metric: "hr", anchor: "absolute", high: 120 } },
  ],
} as const;

type Lap = {
  totalTimerTime: number;
  totalDistance: number;
  avgPower: number;
  normalizedPower: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgCadence: number;
  lapTrigger: "manual" | "distance" | "sessionEnd";
};

/** A tempo ride with Lap pressed at each step change: 5 laps for 5 steps. */
export const TEMPO_LAPS_5: Lap[] = [
  { totalTimerTime: 902, totalDistance: 6210, avgPower: 121, normalizedPower: 124, avgHeartRate: 128, maxHeartRate: 139, avgCadence: 88, lapTrigger: "manual" },
  { totalTimerTime: 899, totalDistance: 7020, avgPower: 140, normalizedPower: 142, avgHeartRate: 152, maxHeartRate: 159, avgCadence: 90, lapTrigger: "manual" },
  { totalTimerTime: 301, totalDistance: 1810, avgPower: 98, normalizedPower: 101, avgHeartRate: 136, maxHeartRate: 150, avgCadence: 82, lapTrigger: "manual" },
  { totalTimerTime: 900, totalDistance: 7060, avgPower: 142, normalizedPower: 144, avgHeartRate: 156, maxHeartRate: 162, avgCadence: 91, lapTrigger: "manual" },
  { totalTimerTime: 910, totalDistance: 5980, avgPower: 115, normalizedPower: 118, avgHeartRate: 137, maxHeartRate: 155, avgCadence: 84, lapTrigger: "sessionEnd" },
];

/**
 * The same ride with Auto Lap on at 5 km: 2 distance laps fall inside the two
 * work steps. With the distance laps dropped, 5 laps are left for 5 steps.
 */
export const TEMPO_LAPS_7: Lap[] = [
  TEMPO_LAPS_5[0],
  { totalTimerTime: 640, totalDistance: 5000, avgPower: 139, normalizedPower: 141, avgHeartRate: 150, maxHeartRate: 157, avgCadence: 90, lapTrigger: "distance" },
  { ...TEMPO_LAPS_5[1], totalTimerTime: 259, totalDistance: 2020 },
  TEMPO_LAPS_5[2],
  { totalTimerTime: 636, totalDistance: 5000, avgPower: 141, normalizedPower: 143, avgHeartRate: 154, maxHeartRate: 161, avgCadence: 91, lapTrigger: "distance" },
  { ...TEMPO_LAPS_5[3], totalTimerTime: 264, totalDistance: 2060 },
  TEMPO_LAPS_5[4],
];
