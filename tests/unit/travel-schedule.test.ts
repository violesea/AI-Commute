import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import {
  assertTravelItinerarySchedule,
  findDailyDrivingLimitViolation,
  normalizeTravelItinerarySchedule,
  parseDateTimeInTimeZone,
  parseDailyDrivingLimitMinutes,
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

  it("parses date ranges with weekday labels between the dates", () => {
    expect(
      parseTravelDateRange(
        "请规划2026年8月8日（周六）至2026年8月12日（周三）的旅行"
      )
    ).toEqual({
      startDate: "2026-08-08",
      endDate: "2026-08-12",
      days: 5,
    });
  });

  it("interprets offset-less model timestamps in the trip timezone", () => {
    expect(
      parseDateTimeInTimeZone("2026-08-08T07:00:00", "Asia/Shanghai").toISOString()
    ).toBe("2026-08-07T23:00:00.000Z");
    expect(
      parseDateTimeInTimeZone("2026-08-08T07:00:00Z", "Asia/Shanghai").toISOString()
    ).toBe("2026-08-08T07:00:00.000Z");
  });

  it("keeps daylight checks active when weekday labels are present", () => {
    expect(() =>
      assertTravelItinerarySchedule({
        prompt:
          "2026年8月8日（周六）至2026年8月12日（周三），只安排白天驾驶的自驾旅行",
        timezone: "Asia/Shanghai",
        stops: [
          { name: "北京", lngLat: "116.506640,39.960684" },
          { name: "正蓝旗", lngLat: "116.013628,42.247801" },
        ],
        legs: [
          {
            originName: "北京",
            originLngLat: "116.506640,39.960684",
            destinationName: "正蓝旗",
            destinationLngLat: "116.013628,42.247801",
            routeMinutes: 311,
            mode: "driving",
            latestDepartAt: new Date("2026-08-08T07:00:00.000Z"),
            targetArriveAt: new Date("2026-08-08T12:31:00.000Z"),
          },
        ],
      })
    ).toThrow(/不能把这段夜间自驾落盘/);
  });

  it("parses an explicit daily self-drive ceiling", () => {
    expect(parseDailyDrivingLimitMinutes("请按每天自驾不超过 6 小时安排路线")).toBe(360);
    expect(parseDailyDrivingLimitMinutes("每日不超过 90 分钟自驾")).toBe(90);
    expect(parseDailyDrivingLimitMinutes("每天游览不超过 6 小时")).toBeUndefined();
  });

  it("rejects the aggregate daily driving time above the user's ceiling", () => {
    const prompt =
      "请规划 2026-08-15 至 2026-08-19 的自驾旅行，每天自驾不超过 6 小时。";
    const legs = [
      {
        order: 0,
        originName: "北京",
        destinationName: "元上都遗址",
        routeMinutes: 342,
        mode: "driving",
        latestDepartAt: new Date("2026-08-15T00:00:00.000Z"),
        targetArriveAt: new Date("2026-08-15T05:42:00.000Z"),
      },
      {
        order: 1,
        originName: "元上都遗址",
        destinationName: "多伦",
        routeMinutes: 48,
        mode: "driving",
        latestDepartAt: new Date("2026-08-15T07:00:00.000Z"),
        targetArriveAt: new Date("2026-08-15T07:48:00.000Z"),
      },
    ];

    expect(
      findDailyDrivingLimitViolation({
        prompt,
        timezone: "Asia/Shanghai",
        legs,
      })
    ).toEqual({
      date: "2026-08-15",
      drivingMinutes: 390,
      limitMinutes: 360,
    });

    expect(() =>
      assertTravelItinerarySchedule({
        prompt,
        timezone: "Asia/Shanghai",
        legs,
      })
    ).toThrow(/累计自驾约 6\.5 小时，超过用户指定的每日上限 6\.0 小时/);
  });

  it("allows a day at or below the explicit self-drive ceiling", () => {
    const prompt =
      "请规划 2026-08-15 至 2026-08-19 的自驾旅行，每日驾驶上限 6 小时。";
    const legs = [
      {
        originName: "北京",
        destinationName: "中途站",
        routeMinutes: 300,
        mode: "driving",
        latestDepartAt: new Date("2026-08-15T00:00:00.000Z"),
        targetArriveAt: new Date("2026-08-15T05:00:00.000Z"),
      },
      {
        originName: "中途站",
        destinationName: "目的地",
        routeMinutes: 60,
        mode: "driving",
        latestDepartAt: new Date("2026-08-15T06:00:00.000Z"),
        targetArriveAt: new Date("2026-08-15T07:00:00.000Z"),
      },
    ];

    expect(
      findDailyDrivingLimitViolation({
        prompt,
        timezone: "Asia/Shanghai",
        legs,
      })
    ).toBeUndefined();
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

  it("keeps a complete explicit daytime schedule when its dates are safe", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至12日北京出发的锡林郭勒自驾旅行",
      timezone: "Asia/Shanghai",
      stops: [
        { order: 0, name: "北京", kind: "origin", plannedStayMin: 0 },
        { order: 1, name: "石条山", kind: "natural", plannedStayMin: 90 },
        { order: 2, name: "宝昌镇", kind: "lodging", plannedStayMin: 300 },
        { order: 3, name: "元上都遗址", kind: "cultural", plannedStayMin: 120 },
      ],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "石条山",
          routeMinutes: 240,
          bufferMinutes: 30,
          totalMinutes: 270,
          latestDepartAt: new Date("2026-08-08T23:00:00.000Z"),
          targetArriveAt: new Date("2026-08-09T03:30:00.000Z"),
          mode: "driving",
          segmentTitle: "出京高速段",
        },
        {
          order: 1,
          originName: "石条山",
          destinationName: "宝昌镇",
          routeMinutes: 15,
          bufferMinutes: 5,
          totalMinutes: 20,
          latestDepartAt: new Date("2026-08-09T05:00:00.000Z"),
          targetArriveAt: new Date("2026-08-09T05:20:00.000Z"),
          mode: "driving",
          segmentTitle: "乡镇短驳",
        },
        {
          order: 2,
          originName: "宝昌镇",
          destinationName: "元上都遗址",
          routeMinutes: 90,
          bufferMinutes: 15,
          totalMinutes: 105,
          latestDepartAt: new Date("2026-08-09T23:00:00.000Z"),
          targetArriveAt: new Date("2026-08-10T00:45:00.000Z"),
          mode: "driving",
          segmentTitle: "G207国道段",
        },
      ],
    });

    expect(result.legs.map((leg) => [
      localTime(leg.latestDepartAt),
      localTime(leg.targetArriveAt),
    ])).toEqual([
      ["2026-08-09 07:00", "2026-08-09 11:30"],
      ["2026-08-09 13:00", "2026-08-09 13:20"],
      ["2026-08-10 07:00", "2026-08-10 08:45"],
    ]);
  });

  it("rebases an explicit schedule when it skips a stop's planned stay", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至12日北京出发的锡林郭勒自驾旅行",
      timezone: "Asia/Shanghai",
      stops: [
        { order: 0, name: "北京", kind: "origin", plannedStayMin: 0 },
        {
          order: 1,
          name: "贝子庙",
          kind: "cultural",
          plannedStayMin: 90,
        },
        { order: 2, name: "宝昌镇", kind: "lodging", plannedStayMin: 0 },
      ],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "贝子庙",
          routeMinutes: 60,
          totalMinutes: 60,
          latestDepartAt: new Date("2026-08-08T00:00:00.000Z"),
          targetArriveAt: new Date("2026-08-08T01:00:00.000Z"),
          mode: "driving",
          segmentTitle: "D1 到达贝子庙",
        },
        {
          order: 1,
          originName: "贝子庙",
          destinationName: "宝昌镇",
          routeMinutes: 60,
          totalMinutes: 60,
          latestDepartAt: new Date("2026-08-08T01:00:00.000Z"),
          targetArriveAt: new Date("2026-08-08T02:00:00.000Z"),
          mode: "driving",
          segmentTitle: "D1 离开贝子庙",
        },
      ],
    });

    expect(result.legs.map((leg) => [
      localTime(leg.latestDepartAt),
      localTime(leg.targetArriveAt),
    ])).toEqual([
      ["2026-08-08 07:00", "2026-08-08 08:00"],
      ["2026-08-08 09:30", "2026-08-08 10:30"],
    ]);
  });

  it("recognizes English Day markers when grouping route legs by calendar day", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026-08-08至2026-08-12北京出发的自驾旅行",
      timezone: "Asia/Shanghai",
      stops: [],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "正蓝旗",
          routeMinutes: 60,
          mode: "driving",
          segmentTitle: "Day1 去程",
        },
        {
          order: 1,
          originName: "正蓝旗",
          destinationName: "上都湖",
          routeMinutes: 30,
          mode: "driving",
          segmentTitle: "Day1 晚间",
        },
        {
          order: 2,
          originName: "上都湖",
          destinationName: "锡林浩特",
          routeMinutes: 60,
          mode: "driving",
          segmentTitle: "Day2 上午",
        },
        {
          order: 3,
          originName: "锡林浩特",
          destinationName: "北京",
          routeMinutes: 60,
          mode: "driving",
          segmentTitle: "Day5 返程",
        },
      ],
    });

    expect(result.legs.map((leg) => [
      localTime(leg.latestDepartAt),
      localTime(leg.targetArriveAt),
    ])).toEqual([
      ["2026-08-08 07:00", "2026-08-08 08:00"],
      ["2026-08-08 08:00", "2026-08-08 08:30"],
      ["2026-08-09 08:00", "2026-08-09 09:00"],
      ["2026-08-12 06:30", "2026-08-12 07:30"],
    ]);
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
      segmentDetail: "抵达宝昌镇，入住休息",
      routeRationale: "再出发会影响返程安排",
    });
    expect(result.legs[0]?.segmentDetail).not.toMatch(/14:15/);
    expect(JSON.stringify(result)).not.toContain("按行程结构化时间");
  });

  it("replaces internal structured-time placeholders with neutral itinerary text", () => {
    const result = normalizeTravelItinerarySchedule({
      prompt: "请规划2026年8月8日至11日北京出发的自驾旅行",
      timezone: "Asia/Shanghai",
      stops: [
        { order: 0, name: "北京", kind: "origin" },
        { order: 1, name: "正蓝旗", kind: "destination" },
      ],
      legs: [
        {
          order: 0,
          originName: "北京",
          destinationName: "正蓝旗",
          routeMinutes: 120,
          mode: "driving",
          segmentTitle: "D1·去程",
          segmentDetail: "按行程结构化时间-按行程结构化时间游览",
        },
      ],
    });

    expect(result.legs[0]?.segmentDetail).toBe("按行程安排");
    expect(JSON.stringify(result)).not.toContain("按行程结构化时间");
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
