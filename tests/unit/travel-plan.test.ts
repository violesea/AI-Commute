import { describe, expect, it } from "vitest";
import {
  alignTravelPlanAttractionsWithRoute,
  assertTravelPlanAttractionCoverage,
  assertTravelPlanOperationalCompleteness,
  completeTravelPlanArrayPayload,
  completeTravelPlanTransportPayload,
  ensureTravelPlanWeatherCoverage,
  getTravelRouteStats,
  normalizeTravelPlan,
  parseTravelPlanJson,
} from "@/lib/trips/travel-plan";
import { ensureTravelPlanRouteRiskCoverage } from "@/lib/trips/travel-schedule";

const sampleTravelPlan = {
  destination: "宁波",
  summary: "两天旅行规划",
  days: "2",
  weather: {
    city: "宁波",
    summary: "多云，24°C",
    advice: "自然景点留意降雨",
    source: "高德天气参考",
    forecastAvailableThrough: "2026-08-06",
    dynamicMonitoring: true,
    refreshPolicy: "出发前和每次路线复查",
    forecast: [
      {
        date: "2026-08-03",
        day: 1,
        summary: "多云，24°C",
        risk: "low",
        drivingAdvice: "出发前复查路况",
      },
    ],
    routeRisks: [
      {
        legOrder: 1,
        route: "北京到宁波",
        summary: "天气稳定",
        risk: "low",
        drivingAdvice: "保留公共交通备选",
      },
    ],
  },
  transport: {
    recommended: "driving",
    reason: "郊区串联更方便",
    driving: {
      summary: "约 36 分钟",
      reason: "适合携带行李",
      durationMinutes: "36",
      route: "驾车路线来自高德",
    },
    transit: {
      summary: "约 50 分钟",
      reason: "市区停车压力小",
      durationMinutes: 50,
    },
    localMovement: "市内景点优先公共交通",
  },
  budget: {
    currency: "CNY",
    total: "¥1,500-2,500/人",
    breakdown: [
      { category: "住宿", amount: "¥900-1,200" },
      { category: "油费与过路费", amount: "¥400-700" },
    ],
    assumptions: "按两人同行、不含购物估算",
  },
  attractions: [
    {
      name: "东钱湖",
      category: "nature",
      reason: "适合半日自然游",
      day: "1",
      stayMinutes: 180,
    },
    {
      name: "四明山",
      category: "natural",
      reason: "山林自然景观",
      day: 1,
    },
    {
      name: "松兰山",
      category: "natural",
      reason: "滨海自然景观",
      day: 2,
    },
    {
      name: "天一阁",
      category: "cultural",
      reason: "补足历史人文内容",
      day: 2,
    },
  ],
  lodging: [
    {
      name: "市中心住宿区",
      area: "鼓楼周边",
      reason: "交通和餐饮集中",
    },
  ],
  food: [
    {
      name: "宁波本帮菜",
      mustTry: "海鲜和汤圆",
      reason: "代表本地口味",
    },
  ],
  pitfalls: [
    {
      title: "提前预约",
      detail: "热门景点先查官方公告",
      severity: "high",
    },
  ],
};

describe("travel plan normalization", () => {
  it("marks only concrete attraction stops with route legs as planned", () => {
    const plan = normalizeTravelPlan(sampleTravelPlan);
    const aligned = alignTravelPlanAttractionsWithRoute(
      plan,
      [
        { order: 0, name: "北京", kind: "origin" },
        { order: 1, name: "东钱湖", kind: "destination" },
        { order: 2, name: "宁波市区（天一阁区域）", kind: "destination" },
      ],
      [
        {
          order: 0,
          originName: "北京",
          destinationName: "东钱湖",
          routeMinutes: 120,
          mode: "driving",
        },
        {
          order: 1,
          originName: "东钱湖",
          destinationName: "宁波市区（天一阁区域）",
          routeMinutes: 30,
          mode: "driving",
        },
      ]
    );

    expect(
      aligned.attractions.find((attraction) => attraction.name === "东钱湖")
    ).toMatchObject({ routeStatus: "planned" });
    expect(
      aligned.attractions.find((attraction) => attraction.name === "天一阁")
    ).toMatchObject({ routeStatus: "alternative" });
    expect(
      aligned.attractions
        .filter((attraction) => attraction.routeStatus === "planned")
        .map((attraction) => attraction.name)
    ).toEqual(["东钱湖"]);
    expect(aligned.routeCoverage).toEqual({
      plannedAttractions: ["东钱湖"],
      alternativeAttractions: ["四明山", "松兰山", "天一阁"],
    });
  });

  it("merges provider aliases for the same planned attraction", () => {
    const plan = normalizeTravelPlan({
      ...sampleTravelPlan,
      attractions: [
        {
          name: "火山地质公园博物馆",
          category: "cultural",
          reason: "火山地质展陈",
          address: "S27锡张高速附近",
        },
        {
          name: "锡林郭勒草原火山地质公园博物馆",
          category: "cultural",
          reason: "展示草原火山成因",
          address: "S27锡张高速附近",
        },
      ],
    });
    const aligned = alignTravelPlanAttractionsWithRoute(
      plan,
      [
        { order: 0, name: "锡林浩特", kind: "origin" },
        {
          order: 1,
          name: "锡林郭勒草原火山地质公园博物馆",
          kind: "destination",
          address: "S27锡张高速附近",
        },
      ],
      [
        {
          order: 0,
          originName: "锡林浩特",
          destinationName: "锡林郭勒草原火山地质公园博物馆",
          routeMinutes: 35,
          mode: "driving",
        },
      ]
    );

    expect(
      aligned.attractions.filter((attraction) => /博物馆/.test(attraction.name))
    ).toHaveLength(1);
    expect(aligned.attractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "锡林郭勒草原火山地质公园博物馆",
          routeStatus: "planned",
        }),
      ])
    );
  });

  it("normalizes persisted route coverage without treating it as route evidence", () => {
    const normalized = normalizeTravelPlan({
      ...sampleTravelPlan,
      routeCoverage: {
        plannedAttractions: [" 东钱湖 ", ""],
        alternativeAttractions: ["天一阁", 12],
      },
    });

    expect(normalized.routeCoverage).toEqual({
      plannedAttractions: ["东钱湖"],
      alternativeAttractions: ["天一阁"],
    });
  });

  it("fills missing transport fields only from both queried route results", () => {
    const incomplete = {
      ...sampleTravelPlan,
      transport: {
        driving: {},
        transit: { summary: "公共交通结果" },
      },
    };
    const completed = completeTravelPlanTransportPayload(incomplete, {
      driving: { durationMinutes: 36, summary: "驾车路线：北京到东钱湖" },
      transit: { durationMinutes: 58, summary: "公交路线：北京到东钱湖" },
    });
    const normalized = normalizeTravelPlan(completed);

    expect(normalized.transport).toMatchObject({
      recommended: "driving",
      driving: {
        durationMinutes: 36,
        route: "驾车路线：北京到东钱湖",
      },
      transit: {
        durationMinutes: 58,
        route: "公交路线：北京到东钱湖",
      },
    });
  });

  it("recovers recommendation arrays flattened beside travelPlan", () => {
    const flattened = {
      ...sampleTravelPlan,
      attractions: undefined,
      lodging: undefined,
      food: undefined,
      pitfalls: undefined,
      budget: undefined,
    };
    const completed = completeTravelPlanArrayPayload(flattened, {
      attractions: sampleTravelPlan.attractions,
      lodging: sampleTravelPlan.lodging,
      food: sampleTravelPlan.food,
      pitfalls: sampleTravelPlan.pitfalls,
      budget: sampleTravelPlan.budget,
    });

    expect(normalizeTravelPlan(completed)).toMatchObject({
      attractions: expect.arrayContaining([
        expect.objectContaining({ name: "东钱湖" }),
      ]),
      lodging: expect.arrayContaining([
        expect.objectContaining({ name: "市中心住宿区" }),
      ]),
      food: expect.arrayContaining([
        expect.objectContaining({ name: "宁波本帮菜" }),
      ]),
      pitfalls: expect.arrayContaining([
        expect.objectContaining({ title: "提前预约" }),
      ]),
      budget: expect.objectContaining({ total: "¥1,500-2,500/人" }),
    });
  });

  it("uses structured route legs as the canonical driving statistics", () => {
    expect(
      getTravelRouteStats(
        [
          {
            order: 2,
            routeMinutes: 179,
            bufferMinutes: 12,
            totalMinutes: 191,
            mode: "driving",
            latestDepartAt: "2026-08-10T00:00:00.000Z",
          },
          {
            order: 1,
            routeMinutes: 262,
            bufferMinutes: 15,
            totalMinutes: 277,
            mode: "driving",
            latestDepartAt: "2026-08-08T00:00:00.000Z",
          },
          {
            order: 3,
            routeMinutes: 742,
            bufferMinutes: 20,
            totalMinutes: 762,
            mode: "transit",
            latestDepartAt: "2026-08-10T02:00:00.000Z",
          },
        ],
        "Asia/Shanghai"
      )
    ).toEqual({
      totalRouteMinutes: 1183,
      totalBufferMinutes: 47,
      totalMinutes: 1230,
      totalDrivingMinutes: 441,
      dailyDrivingMinutes: [
        { date: "2026-08-08", minutes: 262, legOrders: [1] },
        { date: "2026-08-10", minutes: 179, legOrders: [2] },
      ],
    });
  });

  it("normalizes agent JSON into the persisted display shape", () => {
    expect(normalizeTravelPlan(sampleTravelPlan)).toMatchObject({
      destination: "宁波",
      days: 2,
      transport: {
        recommended: "driving",
        driving: { durationMinutes: 36 },
      },
      budget: {
        currency: "CNY",
        total: "¥1,500-2,500/人",
      },
      weather: {
        dynamicMonitoring: true,
        forecast: [{ summary: "多云，24°C", risk: "low" }],
      },
    });
    expect(normalizeTravelPlan(sampleTravelPlan).attractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "东钱湖",
          category: "natural",
          day: 1,
        }),
        expect.objectContaining({
          name: "天一阁",
          category: "cultural",
          day: 2,
        }),
      ])
    );
    expect(normalizeTravelPlan(sampleTravelPlan).attractions[0].evidence).toMatchObject(
      {
        source: "agent_inference",
        status: "needs_verification",
        label: "AI建议，出发前核验",
      }
    );
    expect(normalizeTravelPlan(sampleTravelPlan).lodging[0].evidence).toMatchObject(
      {
        source: "agent_inference",
        status: "needs_verification",
      }
    );
  });

  it("preserves provider evidence while keeping verification visible", () => {
    const normalized = normalizeTravelPlan({
      ...sampleTravelPlan,
      attractions: [
        {
          ...sampleTravelPlan.attractions[0],
          evidence: {
            source: "amap_poi",
            observedAt: "2026-08-01T02:00:00.000Z",
          },
        },
        ...sampleTravelPlan.attractions.slice(1),
      ],
    });

    expect(normalized.attractions[0].evidence).toMatchObject({
      source: "amap_poi",
      status: "provider_reference",
      observedAt: "2026-08-01T02:00:00.000Z",
    });
  });

  it("recovers stringified nested weather and transport objects", () => {
    const normalized = normalizeTravelPlan({
      ...sampleTravelPlan,
      weather: JSON.stringify({
        ...sampleTravelPlan.weather,
        summary: "",
        advice: "出发前刷新天气",
      }),
      transport: JSON.stringify(sampleTravelPlan.transport),
    });

    expect(normalized.weather.summary).toBe("出发前刷新天气");
    expect(normalized.transport.recommended).toBe("driving");
  });

  it("requires a broad natural-attraction candidate set for travel creation", () => {
    const plan = normalizeTravelPlan(sampleTravelPlan);

    expect(() => assertTravelPlanAttractionCoverage(plan)).not.toThrow();
    expect(() =>
      assertTravelPlanAttractionCoverage({
        ...plan,
        attractions: plan.attractions.filter(
          (attraction) => attraction.category !== "natural"
        ),
      })
    ).toThrow("至少需要 3 个自然景观");

    expect(() =>
      assertTravelPlanAttractionCoverage({
        ...plan,
        attractions: [
          { name: "湖泊一", category: "natural", reason: "湖泊风光" },
          { name: "湖泊二", category: "natural", reason: "湖边自然风光" },
          { name: "湖泊三", category: "natural", reason: "湖畔日落" },
          { name: "天一阁", category: "cultural", reason: "历史人文" },
        ],
      })
    ).toThrow("不同类型");
  });

  it("counts every declared type in compound natural attraction labels", () => {
    const plan = normalizeTravelPlan({
      ...sampleTravelPlan,
      days: 5,
      attractions: [
        {
          name: "平顶山锡林郭勒草原火山地质公园",
          category: "natural",
          naturalType: "火山/地质台地",
          reason: "火山地质景观与草原结合",
        },
        {
          name: "锡林河国家湿地公园",
          category: "natural",
          naturalType: "湿地/河流",
          reason: "芦苇水鸟生态",
        },
        {
          name: "锡林九曲湾旅游区",
          category: "natural",
          naturalType: "河流/草原湿地",
          reason: "河流与草原湿地地貌",
        },
        {
          name: "上都湖",
          category: "natural",
          naturalType: "湖泊/草原湖",
          reason: "草原湖泊风光",
        },
        {
          name: "金莲川草原",
          category: "natural",
          naturalType: "草原",
          reason: "草原花海",
        },
        {
          name: "元上都遗址",
          category: "cultural",
          reason: "元朝历史遗址",
        },
      ],
    });

    expect(() => assertTravelPlanAttractionCoverage(plan)).not.toThrow();
  });

  it("infers natural diversity from attraction text when the model uses a generic type", () => {
    const plan = normalizeTravelPlan({
      ...sampleTravelPlan,
      days: 5,
      attractions: [
        {
          name: "达里湖",
          category: "natural",
          naturalType: "other",
          reason: "草原湖泊风光，适合清晨观景",
        },
        {
          name: "乌拉盖九曲湾",
          category: "natural",
          naturalType: "other",
          reason: "河流湿地与草原交汇，适合顺光拍摄",
        },
        {
          name: "锡林郭勒草原火山地质公园",
          category: "natural",
          naturalType: "other",
          reason: "火山地质与草原地貌组合，适合天气稳定时徒步",
        },
        {
          name: "锡林河国家湿地公园",
          category: "natural",
          naturalType: "other",
          reason: "湿地、芦苇和水鸟生态景观",
        },
        {
          name: "元上都遗址",
          category: "cultural",
          reason: "元代历史遗址",
        },
      ],
    });

    expect(() => assertTravelPlanAttractionCoverage(plan)).not.toThrow();
  });

  it("requires operational weather, route, lodging, food, and pitfall evidence", () => {
    const validPlan = normalizeTravelPlan({
      ...sampleTravelPlan,
      weather: {
        ...sampleTravelPlan.weather,
        routeRisks: [
          ...sampleTravelPlan.weather.routeRisks,
          {
            legOrder: 2,
            route: "景点一到景点二",
            summary: "天气稳定",
            risk: "low",
            drivingAdvice: "出发前复查",
            action: "大风时调整户外安排",
          },
        ],
      },
      transport: {
        ...sampleTravelPlan.transport,
        transit: {
          ...sampleTravelPlan.transport.transit,
          route: "地铁与接驳",
        },
      },
      pitfalls: [
        ...sampleTravelPlan.pitfalls,
        { title: "停车", detail: "提前确认停车位", severity: "medium" },
        { title: "路况", detail: "出发前检查道路", severity: "medium" },
      ],
    });

    expect(() =>
      assertTravelPlanOperationalCompleteness(validPlan, {
        drivingLegOrders: [1, 2],
      })
    ).not.toThrow();
    expect(() =>
      assertTravelPlanOperationalCompleteness(
        normalizeTravelPlan({
          ...validPlan,
          weather: { ...validPlan.weather, dynamicMonitoring: undefined },
        }),
        { drivingLegOrders: [1, 2] }
      )
    ).toThrow("动态天气监控");
    expect(() =>
      assertTravelPlanOperationalCompleteness(validPlan, {
        drivingLegOrders: [1, 2, 3],
      })
    ).toThrow("每个自驾路段");
  });

  it("fills missing weather entries for every itinerary date", () => {
    const plan = normalizeTravelPlan(sampleTravelPlan);
    expect(plan.weather.forecastAvailableThrough).toBe("2026-08-06");
    const covered = ensureTravelPlanWeatherCoverage(plan, {
      startDate: "2026-08-08",
      endDate: "2026-08-11",
    });

    expect(covered.weather.forecast?.slice(0, 4).map((item) => item.date)).toEqual([
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
    ]);
    expect(covered.weather.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-08-10",
          summary: "当前预报未覆盖该日期，天气未知；出发前刷新",
          risk: "medium",
        }),
        expect.objectContaining({
          date: "2026-08-03",
          summary: "多云，24°C",
        }),
      ])
    );
  });

  it("fills missing route risks conservatively for short self-drive legs", () => {
    const plan = normalizeTravelPlan(sampleTravelPlan);
    const covered = ensureTravelPlanRouteRiskCoverage(
      plan,
      [
        {
          order: 0,
          originName: "北京",
          destinationName: "景点一",
          routeMinutes: 120,
          mode: "driving",
          latestDepartAt: new Date("2026-08-08T00:00:00.000Z"),
          targetArriveAt: new Date("2026-08-08T02:00:00.000Z"),
        },
        {
          order: 1,
          originName: "景点一",
          destinationName: "景点二",
          routeMinutes: 20,
          mode: "driving",
          latestDepartAt: new Date("2026-08-08T03:00:00.000Z"),
          targetArriveAt: new Date("2026-08-08T03:20:00.000Z"),
        },
        {
          order: 2,
          originName: "景点二",
          destinationName: "酒店",
          routeMinutes: 10,
          mode: "transit",
          latestDepartAt: new Date("2026-08-08T04:00:00.000Z"),
          targetArriveAt: new Date("2026-08-08T04:10:00.000Z"),
        },
      ],
      "Asia/Shanghai",
      "请规划2026年8月8日至9日北京出发的自驾旅行"
    );

    expect(covered.weather.routeRisks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ legOrder: 1, risk: "low" }),
        expect.objectContaining({
          legOrder: 2,
          date: "2026-08-08",
          risk: "medium",
          summary: expect.stringContaining("未知风险"),
          action: expect.stringContaining("延后、改道或取消"),
        }),
      ])
    );
    expect(
      covered.weather.routeRisks?.some((risk) => risk.legOrder === 3)
    ).toBe(false);
  });

  it("rejects incomplete plans and safely hides invalid persisted JSON", () => {
    expect(
      () =>
        normalizeTravelPlan({
          destination: "宁波",
          summary: "",
          weather: {},
          transport: { recommended: "driving" },
        })
    ).toThrow("travelPlan.summary");
    expect(parseTravelPlanJson("not-json")).toBeNull();
    expect(parseTravelPlanJson(null)).toBeNull();
  });
});
