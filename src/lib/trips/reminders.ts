import type { ReminderJobData, ReminderKind } from "@/lib/trips/types";

export const DEFAULT_REMINDER_CADENCE_MINUTES = [30, 20, 15, 10, 5, 0] as const;

export type BuildReminderScheduleInput = {
  tripId: string;
  legId: string;
  latestDepartAt: Date;
  cadenceMinutes?: readonly number[];
  now?: Date;
  travelWeatherRefreshAt?: Date;
};

export function buildReminderSchedule({
  tripId,
  legId,
  latestDepartAt,
  cadenceMinutes = DEFAULT_REMINDER_CADENCE_MINUTES,
  now,
  travelWeatherRefreshAt,
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
    ? [72, 24]
        .map((hoursBeforeDeparture): ReminderJobData => {
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
