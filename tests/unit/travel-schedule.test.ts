import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import {
  assertTravelItinerarySchedule,
  normalizeTravelItinerarySchedule,
  parseTravelDateRange,
} from "@/lib/trips/travel-schedule";

function localTime(date: Date | undefined) {
  return date
    ? formatInTimeZone(date, "Asia/Shanghai", "yyyy-MM-dd HH:mm")
    : undefined;
}

describe("travel itinerary schedule", () => {
  it("parses a Chinese date range with an omitted end month", () => {
    expect(parseTravelDateRange("请规划2026年8月8日至11日北京出发的旅行")).toEqual({
      startDate: "2026-08-08",
      endDate: "2026-08-11",
      days: 4,
    });
  });

  it("parses Chinese date ranges with spaces around date units", () => {
    expect(
      parseTravelDateRange(
        "请规划 2026 年 8 月 8 日至 8 月 11 日北京出发的旅行"
      )
    ).toEqual({
      startDate: "2026-08-08",
      endDate: "2026-08-11",
      days: 4,
    });
  });

  it("rebases model times into a chronological daytime itinerary", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行",
      timezone: "Asia/Shanghai",
      targetArriveAt: new Date("2026-08-12T04:30:00.000Z"),
      stops: [
        { order: 0, name: "北京", kind: "origin" },
        { order: 1, name: "正蓝旗", kind: "destination" },
        { order: 2, name: "锡林浩特", kind: "destination" },
        { order: 3, name: "北京", kind: "destination" },
      ],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "正蓝旗",
          routeMinutes: 324,
          totalMinutes: 364,
          latestDepartAt: new Date("2026-08-08T06:30:00.000Z"),
          targetArriveAt: new Date("2026-08-08T13:00:00.000Z"),
          segmentTitle: "D1·去程主段",
        },
        {
          order: 1,
          originName: "正蓝旗",
          destinationName: "上都湖",
          routeMinutes: 40,
          totalMinutes: 50,
          latestDepartAt: new Date("2026-08-09T16:00:00.000Z"),
          targetArriveAt: new Date("2026-08-09T16:50:00.000Z"),
          segmentTitle: "D1·上都湖日落",
        },
        {
          order: 2,
          originName: "上都湖",
          destinationName: "锡林浩特",
          routeMinutes: 159,
          totalMinutes: 174,
          latestDepartAt: new Date("2026-08-10T08:00:00.000Z"),
          targetArriveAt: new Date("2026-08-10T10:54:00.000Z"),
          segmentTitle: "D2·转场",
        },
        {
          order: 3,
          originName: "锡林浩特",
          destinationName: "北京",
          routeMinutes: 600,
          totalMinutes: 660,
          latestDepartAt: new Date("2026-08-12T06:30:00.000Z"),
          targetArriveAt: new Date("2026-08-12T17:30:00.000Z"),
          segmentTitle: "D4·返程长线",
        },
      ],
    });

    const times = result.legs.map((leg) => [
      localTime(leg.latestDepartAt),
      localTime(leg.targetArriveAt),
    ]);

    expect(times[0]).toEqual(["2026-08-08 07:00", "2026-08-08 13:04"]);
    expect(times[1]).toEqual(["2026-08-08 13:04", "2026-08-08 13:54"]);
    expect(times[2]).toEqual(["2026-08-09 08:00", "2026-08-09 10:54"]);
    expect(times[3]).toEqual(["2026-08-11 06:30", "2026-08-11 17:30"]);
    expect(localTime(result.targetArriveAt)).toBe("2026-08-11 17:30");
  });

  it("does not let an inconsistent comparison total create a cross-midnight leg", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行",
      timezone: "Asia/Shanghai",
      stops: [
        { order: 0, name: "北京", kind: "origin" },
        { order: 1, name: "锡林浩特", kind: "destination" },
      ],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "锡林浩特",
          routeMinutes: 438,
          bufferMinutes: 20,
          totalMinutes: 978,
          mode: "driving",
          segmentTitle: "D1·去程",
        },
      ],
    });

    expect(result.legs.map((leg) => [
      localTime(leg.latestDepartAt),
      localTime(leg.targetArriveAt),
    ])).toEqual([["2026-08-08 07:00", "2026-08-08 14:38"]]);
  });

  it("removes model clock text that can contradict the structured itinerary", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行",
      timezone: "Asia/Shanghai",
      stops: [
        { order: 0, name: "南山森林公园", kind: "origin" },
        { order: 1, name: "太仆寺旗宝昌镇", kind: "destination" },
      ],
      legs: [
        {
          order: 0,
          originName: "南山森林公园",
          destinationName: "太仆寺旗宝昌镇",
          routeMinutes: 193,
          mode: "driving",
          segmentTitle: "D4 森林",
          segmentDetail: "下午14:15抵达宝昌镇，入住休息",
          routeRationale: "14:15 后再出发会影响返程安排",
        },
      ],
    });

    expect(result.legs[0]).toMatchObject({
      segmentDetail: "按行程结构化时间抵达宝昌镇，入住休息",
      routeRationale: "按行程结构化时间后再出发会影响返程安排",
    });
    expect(result.legs[0]?.segmentDetail).not.toMatch(/14:15/);
  });

  it("rejects a long self-drive leg that arrives after the local sunset safety line", () => {
    expect(() =>
      assertTravelItinerarySchedule({
        prompt:
          "请规划 2026 年 8 月 8 日至 8 月 11 日北京出发、全程白天驾驶的锡林郭勒自驾旅行",
        timezone: "Asia/Shanghai",
        stops: [
          { name: "达里湖", lngLat: "116.47,43.35", kind: "waypoint" },
          { name: "锡林浩特", lngLat: "116.07,43.93", kind: "destination" },
        ],
        legs: [
          {
            order: 0,
            originName: "达里湖",
            originLngLat: "116.47,43.35",
            destinationName: "锡林浩特",
            destinationLngLat: "116.07,43.93",
            routeMinutes: 150,
            mode: "driving",
            latestDepartAt: new Date("2026-08-10T08:40:00.000Z"),
            targetArriveAt: new Date("2026-08-10T11:10:00.000Z"),
            segmentTitle: "D3·返回锡林浩特",
          },
        ],
      })
    ).toThrow(/提前返程.*途中住宿.*缩短\/删除远端景点/);
  });
});
