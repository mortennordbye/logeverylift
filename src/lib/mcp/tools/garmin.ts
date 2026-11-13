/**
 * MCP tools: Garmin metrics, read-only, for the user's own AI assistant
 * (docs/plans/garmin-insights-design.md, 4.2 path 1). Derived numbers only:
 * no raw streams, no GPS, no clock times of day. Scoped to the userId from
 * the MCP access token, never a tool parameter. Registered only where the
 * Garmin feature is enabled.
 */

import { rankInsights } from "@/lib/garmin/analytics/insights";
import { RACE_LABEL } from "@/lib/garmin/analytics/overview";
import { projectionSentence } from "@/lib/garmin/analytics/projection";
import { thresholdHistory, vo2Series } from "@/lib/garmin/analytics/trends";
import { verdict } from "@/lib/garmin/charts/activity";
import { addDays } from "@/lib/garmin/dates";
import {
  garminToday,
  getActivitiesData,
  getActivityDetail,
  getLoadSeries,
  getOverviewData,
  getRaceProjection,
  getSessionInsights,
  getTrendsData,
  getVolumeData,
} from "@/lib/garmin/queries";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { readinessSwapFor } from "@/lib/readiness-swap";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const r1 = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);

export function registerGarminTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_garmin_status",
    {
      description:
        "The athlete's state today from Garmin and LogEveryLift: readiness and its contributors, body signals against their own normal (sleep, HRV, resting HR, VO2 max, body battery, weight), fitness, fatigue and form, this week's hours per sport against the plan, the race and its demands checklist, and the current insights, and readinessSwap: today's hard session to make easy on a low-readiness morning (endurance features on). Use it to coach the next sessions.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const today = await garminToday(userId);
        const [o, volume, series] = await Promise.all([getOverviewData(userId, today), getVolumeData(userId, today), getLoadSeries(userId)]);
        const [session, race, swap] = await Promise.all([getSessionInsights(userId, volume, today), getRaceProjection(userId, series.series, today), readinessSwapFor(userId)]);
        const last = o.pmc.dates.length - 1;
        return ok({
          date: o.date,
          readiness: o.readiness ? { score: o.readiness.score, band: o.readiness.band, contributors: o.readiness.contributors } : null,
          body: Object.fromEntries(Object.entries(o.body).map(([k, s]) => [k, { value: r1(s.value), date: s.date, normal: s.normal?.map((v) => r1(v)) ?? null, state: s.state }])),
          fitness: last >= 0 ? { fitness: r1(o.pmc.ctl[last]), fatigue: r1(o.pmc.atl[last]), form: r1(o.pmc.tsb[last]), calibrating: o.pmc.calibrating } : null,
          thisWeek: volume.weeks.at(-1) ? { hours: Object.fromEntries(Object.entries(volume.weeks.at(-1)!.hours).map(([k, v]) => [k, r1(v)])), plannedHours: volume.planned } : null,
          race: race
            ? {
                distance: race.race.distance ? RACE_LABEL[race.race.distance] : null,
                raceDay: race.race.raceDay,
                raceDateSet: race.race.raceSet,
                daysToRace: race.race.daysToRace,
                phase: race.race.phase,
                week: race.race.week,
                projection: race.projection ? { raceMorningForm: r1(race.projection.race.tsb), raceMorningFitness: r1(race.projection.race.ctl), verdict: race.projection.race.verdict, summary: projectionSentence(race.projection) } : null,
              }
            : null,
          demands: volume.checklist.map((d) => ({ item: d.label, best: d.best, target: d.target, met: d.met, nextStep: d.next })),
          insights: rankInsights([...o.insights, ...session]).map((i) => ({ severity: i.severity, text: i.text })),
          // D4: the same suggestion as list_planned_sessions and the home screen.
          readinessSwap: swap ? { plannedSessionId: swap.sessionId, session: swap.label, minutes: swap.minutes, text: swap.text, apply: "manage_planned_session operation='apply_readiness_swap'" } : null,
        });
      } catch (e) {
        return failInternal("garmin_status", e);
      }
    },
  );

  server.registerTool(
    "get_garmin_trends",
    {
      description:
        "Long-term progress: FTP, critical power, run critical speed and LTHR estimates week by week (last 12 weeks), VO2 max (the app's estimate from runs and Garmin's running and cycling values), and best efforts for 5 min, 20 min and 1 h.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const t = await getTrendsData(userId);
        const weeks = thresholdHistory(t.acts, addDays(t.today, -83), t.today);
        const vo2 = vo2Series(t.acts);
        const best = (kind: "power" | "speed", sport: "bike" | "run", x: number) => {
          const vs = t.acts.filter((a) => a.sport === sport && a.day >= addDays(t.today, -89)).map((a) => a.efforts[kind][x]).filter((v): v is number => typeof v === "number");
          return vs.length ? r1(Math.max(...vs)) : null;
        };
        return ok({
          thresholdsByWeek: weeks.map((w) => ({ weekStart: w.weekStart, ftpW: w.ftp, cpW: r1(w.cp), criticalSpeedMps: r1(w.cs), lthrRun: w.lthrRun, lthrBike: w.lthrBike, watchLthr: w.watchLthr })),
          vo2max: {
            app: vo2.trend.at(-1) ?? null,
            garminRunning: t.garminVo2.filter((g) => g.sport === "run").at(-1) ?? null,
            garminCycling: t.garminVo2.filter((g) => g.sport === "bike").at(-1) ?? null,
          },
          best90Days: {
            bikePowerW: { "5min": best("power", "bike", 300), "20min": best("power", "bike", 1200), "1h": best("power", "bike", 3600) },
            runSpeedMps: { "5min": best("speed", "run", 300), "20min": best("speed", "run", 1200), "1h": best("speed", "run", 3600) },
          },
        });
      } catch (e) {
        return failInternal("garmin_trends", e);
      }
    },
  );

  server.registerTool(
    "list_garmin_activities",
    {
      description: "The athlete's recent Garmin activities, newest first: id, date, sport, name, duration, distance, training load and mean heart rate.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      try {
        const a = await getActivitiesData(userId, limit ?? 20);
        return ok(
          a.list.map((x) => ({
            id: x.id,
            date: new Date(x.start).toISOString().slice(0, 10),
            sport: x.sport,
            name: x.name,
            durationMin: x.durationS ? Math.round(x.durationS / 60) : null,
            distanceKm: x.distanceM ? r1(x.distanceM / 1000) : null,
            load: r1(x.load),
            avgHr: x.avgHr,
          })),
        );
      } catch (e) {
        return failInternal("garmin_list", e);
      }
    },
  );

  server.registerTool(
    "get_garmin_activity",
    {
      description: "One Garmin activity in detail: a one-line verdict, load, intensity bands, decoupling, laps and best efforts. No GPS and no raw streams.",
      inputSchema: { id: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const d = await getActivityDetail(userId, id);
        if (!d) return fail("Activity not found");
        const m = d.metrics;
        return ok({
          id: d.id,
          date: new Date(d.start).toISOString().slice(0, 10),
          sport: d.sport,
          name: d.name,
          verdict: verdict(d),
          durationMin: typeof d.summary.duration === "number" ? Math.round(d.summary.duration / 60) : null,
          distanceKm: typeof d.summary.distance === "number" ? r1(d.summary.distance / 1000) : null,
          avgHr: d.summary.averageHR ?? null,
          load: m ? { value: m.load, method: m.loadMethod } : null,
          intensitySeconds: m?.bands ?? null,
          decoupling: m?.decoupling ?? null,
          bestEfforts: m?.efforts ? { powerW: m.efforts.power, runSpeedMps: m.efforts.speed, vo2Estimate: m.efforts.vo2?.value ?? null } : null,
          laps: d.laps.map((l, i) => ({ n: i + 1, timeS: l.totalTimerTime ?? null, distanceM: l.totalDistance ?? null, avgHr: l.avgHeartRate ?? null, avgPower: l.avgPower ?? null })),
          fuel: d.fuel,
        });
      } catch (e) {
        return failInternal("garmin_activity", e);
      }
    },
  );
}
