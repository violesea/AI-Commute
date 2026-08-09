import { describe, expect, it } from "vitest";
import { buildReminderSchedule } from "@/lib/trips/reminders";

describe("buildReminderSchedule", () => {
  it("builds the default recheck cadence and a depart-now reminder from latest departure", () => {
    const latestDepartAt = new Date("2026-07-01T09:00:00.000Z");

    const reminders = buildReminderSchedule({
      tripId: "trip_123",
      legId: "leg_456",
      latestDepartAt,
    });

    expect(reminders.map((reminder) => reminder.kind)).toEqual([
      "recheck",
      "recheck",
      "depart_now",
    ]);
    expect(reminders.map((reminder) => reminder.scheduledFor.toISOString())).toEqual([
      "2026-07-01T08:00:00.000Z",
      "2026-07-01T08:45:00.000Z",
      "2026-07-01T09:00:00.000Z",
    ]);
    expect(reminders.map((reminder) => reminder.dedupeKey)).toEqual([
      "trip_123:leg_456:recheck:60",
      "trip_123:leg_456:recheck:15",
      "trip_123:leg_456:depart_now:0",
    ]);
    expect(reminders.map((reminder) => JSON.parse(reminder.payloadJson))).toEqual([
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 60 },
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 15 },
      { tripId: "trip_123", legId: "leg_456", kind: "depart_now", minutesBeforeDeparture: 0 },
    ]);
  });

  it("adds pre-departure weather refresh jobs for travel plans", () => {
    const latestDepartAt = new Date("2026-08-08T23:00:00.000Z");
    const reminders = buildReminderSchedule({
      tripId: "trip_travel",
      legId: "leg_first",
      latestDepartAt,
      travelWeatherRefreshAt: latestDepartAt,
      now: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(
      reminders
        .filter((reminder) => reminder.kind === "weather_refresh")
        .map((reminder) => reminder.scheduledFor.toISOString())
    ).toEqual([
      "2026-08-06T23:00:00.000Z",
      "2026-08-08T22:00:00.000Z",
    ]);
    expect(reminders.map((reminder) => reminder.kind)).toContain(
      "depart_now"
    );
    expect(
      JSON.parse(
        reminders.find((reminder) => reminder.kind === "weather_refresh")!
          .payloadJson
      )
    ).toMatchObject({ kind: "weather_refresh", hoursBeforeDeparture: 48 });
  });

  it("supports a one-hour weather refresh for each later travel leg", () => {
    const latestDepartAt = new Date("2026-08-09T01:00:00.000Z");
    const reminders = buildReminderSchedule({
      tripId: "trip_travel",
      legId: "leg_second",
      latestDepartAt,
      travelWeatherRefreshAt: latestDepartAt,
      weatherRefreshHoursBeforeDeparture: [1],
    });

    expect(
      reminders
        .filter((reminder) => reminder.kind === "weather_refresh")
        .map((reminder) => reminder.scheduledFor.toISOString())
    ).toEqual(["2026-08-09T00:00:00.000Z"]);
    expect(
      JSON.parse(
        reminders.find((reminder) => reminder.kind === "weather_refresh")!
          .payloadJson
      )
    ).toMatchObject({ kind: "weather_refresh", hoursBeforeDeparture: 1 });
  });
});
