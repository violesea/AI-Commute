import type { ReminderJobData, ReminderKind } from "@/lib/trips/types";

/**
 * Recheck cadence: minutes before latest departure that the scheduler re-runs
 * the agent to detect route-time changes above the user's threshold.
 *
 * Each recheck fires a full agent continuation session, so these are expensive.
 * 30/20/10-minute triple-rechecks almost always stay under threshold and only
 * burn tokens; 60 min is the earliest window where route minutes can shift
 * meaningfully and the user can still adjust, 15 min is the last useful
 * correction point.
 */
export const DEFAULT_REMINDER_CADENCE_MINUTES = [60, 15, 0] as const;

/**
 * Weather refresh windows (hours before departure) for travel plans.
 * 72h forecasts are too noisy to justify an agent session; 48h is the
 * reliability/lead-time balance, and 1h is the near-departure finalization.
 */
export const FIRST_LEG_WEATHER_REFRESH_HOURS = [48, 1] as const;
export const LATER_LEG_WEATHER_REFRESH_HOURS = [1] as const;

export type BuildReminderScheduleInput = {
  tripId: string;
  legId: string;
  latestDepartAt: Date;
  cadenceMinutes?: readonly number[];
  now?: Date;
  travelWeatherRefreshAt?: Date;
  weatherRefreshHoursBeforeDeparture?: readonly number[];
};

export function buildReminderSchedule({
  tripId,
  legId,
  latestDepartAt,
  cadenceMinutes = DEFAULT_REMINDER_CADENCE_MINUTES,
  now,
  travelWeatherRefreshAt,
  weatherRefreshHoursBeforeDeparture = FIRST_LEG_WEATHER_REFRESH_HOURS,
}: BuildReminderScheduleInput): ReminderJobData[] {
  const routeReminders = cadenceMinutes
    .map((minutesBeforeDeparture) => {
      const kind: ReminderKind =
        minutesBeforeDeparture === 0 ? "depart_now" : "recheck";
      const scheduledFor = new Date(
        latestDepartAt.getTime() - minutesBeforeDeparture * 60_000
      );

      return {
        tripId,
        legId,
        kind,
        scheduledFor,
        dedupeKey: `${tripId}:${legId}:${kind}:${minutesBeforeDeparture}`,
        payloadJson: JSON.stringify({
          tripId,
          legId,
          kind,
          minutesBeforeDeparture,
        }),
      };
    })
    .filter((reminder) => !now || reminder.scheduledFor >= now);

  const weatherRefreshReminders = travelWeatherRefreshAt
    ? weatherRefreshHoursBeforeDeparture
        .map((hoursBeforeDeparture): ReminderJobData => {
          if (
            !Number.isFinite(hoursBeforeDeparture) ||
            hoursBeforeDeparture < 0
          ) {
            throw new Error(
              "Weather refresh hours must be non-negative numbers."
            );
          }

          const scheduledFor = new Date(
            travelWeatherRefreshAt.getTime() - hoursBeforeDeparture * 60 * 60_000
          );

          return {
            tripId,
            legId,
            kind: "weather_refresh",
            scheduledFor,
            dedupeKey: `${tripId}:${legId}:weather_refresh:${hoursBeforeDeparture}`,
            payloadJson: JSON.stringify({
              tripId,
              legId,
              kind: "weather_refresh",
              hoursBeforeDeparture,
            }),
          };
        })
        .filter((reminder) => !now || reminder.scheduledFor >= now)
    : [];

  return [...weatherRefreshReminders, ...routeReminders].sort(
    (left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime()
  );
}
