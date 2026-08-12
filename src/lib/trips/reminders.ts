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
  // Background recheck/weather_refresh jobs have been disabled — users refresh
  // each day manually via the DayCard refresh button. Only keep the depart_now
  // reminder (the "time to leave" notification at latestDepartAt).
  const departNowReminder: ReminderJobData = {
    tripId,
    legId,
    kind: "depart_now",
    scheduledFor: latestDepartAt,
    dedupeKey: `${tripId}:${legId}:depart_now:0`,
    payloadJson: JSON.stringify({
      tripId,
      legId,
      kind: "depart_now",
      minutesBeforeDeparture: 0,
    }),
  };

  if (now && departNowReminder.scheduledFor < now) {
    return [];
  }

  return [departNowReminder];
}
