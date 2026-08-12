import { describe, expect, it } from "vitest";
import { buildReminderSchedule } from "@/lib/trips/reminders";

describe("buildReminderSchedule", () => {
  it("builds only a depart-now reminder (background recheck disabled)", () => {
    const latestDepartAt = new Date("2026-07-01T09:00:00.000Z");

    const reminders = buildReminderSchedule({
      tripId: "trip_123",
      legId: "leg_456",
      latestDepartAt,
    });

    // Background recheck/weather_refresh removed — only depart_now remains.
    expect(reminders.map((reminder) => reminder.kind)).toEqual(["depart_now"]);
    expect(reminders.map((reminder) => reminder.scheduledFor.toISOString())).toEqual([
      "2026-07-01T09:00:00.000Z",
    ]);
    expect(reminders.map((reminder) => reminder.dedupeKey)).toEqual([
      "trip_123:leg_456:depart_now:0",
    ]);
    expect(reminders.map((reminder) => JSON.parse(reminder.payloadJson))).toEqual([
      { tripId: "trip_123", legId: "leg_456", kind: "depart_now", minutesBeforeDeparture: 0 },
    ]);
  });

  it("does not create weather refresh jobs even for travel plans", () => {
    const latestDepartAt = new Date("2026-08-08T23:00:00.000Z");
    const reminders = buildReminderSchedule({
      tripId: "trip_travel",
      legId: "leg_first",
      latestDepartAt,
      travelWeatherRefreshAt: latestDepartAt,
      now: new Date("2026-08-01T00:00:00.000Z"),
    });

    // No weather_refresh jobs — manual refresh via DayCard replaces them.
    expect(reminders.filter((r) => r.kind === "weather_refresh")).toHaveLength(0);
    expect(reminders.map((r) => r.kind)).toContain("depart_now");
  });

  it("returns empty array if departure time has already passed", () => {
    const latestDepartAt = new Date("2026-08-09T00:00:00.000Z");
    const reminders = buildReminderSchedule({
      tripId: "trip_past",
      legId: "leg_past",
      latestDepartAt,
      now: new Date("2026-08-09T01:00:00.000Z"),
    });

    expect(reminders).toEqual([]);
  });
});
