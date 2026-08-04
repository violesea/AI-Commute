import { beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import {
  loadCompletedWeatherReferenceCities,
  runPlanningSession,
  startPlanningSession,
  stringifyToolResult,
} from "@/lib/agent/planner";
import type { AgentChatClient } from "@/lib/agent/chat-client";
import { createMockAmapClient } from "@/lib/amap/mock";
import { ensureTestDatabase } from "./test-db";

const travelPlan = {
  destination: "锡林郭勒盟",
  summary: "北京出发的四日自然风光自驾路线。",
  days: 4,
  weather: {
    city: "锡林浩特",
    summary: "行程日预报尚未发布。",
    advice: "出发前刷新天气。",
    source: "test",
    dynamicMonitoring: true,
    refreshPolicy: "出发前 72 小时、24 小时和每日路线复查",
    forecast: [
      {
        date: "2026-08-08",
        day: 1,
        summary: "阵雨，需留意",
        risk: "medium",
        drivingAdvice: "雨天减速",
        outdoorAdvice: "缩短湖边停留",
      },
    ],
    routeRisks: [
      {
        legOrder: 1,
        route: "北京到正蓝旗",
        summary: "午后雷阵雨",
        risk: "medium",
        drivingAdvice: "服务区等待强降雨",
        action: "必要时延后湖边活动",
      },
      {
        legOrder: 2,
        route: "正蓝旗到上都湖",
        summary: "草原风力变化",
        risk: "medium",
        drivingAdvice: "出发前刷新风力和能见度",
        action: "大风时缩短湖边停留",
      },
      {
        legOrder: 3,
        route: "上都湖到锡林浩特",
        summary: "傍晚降温",
        risk: "low",
        drivingAdvice: "按白天时段完成转场",
        action: "若能见度下降则提前结束户外活动",
      },
      {
        legOrder: 4,
        route: "锡林浩特到北京",
        summary: "返程天气可能变化",
        risk: "medium",
        drivingAdvice: "返程前重新确认降雨和道路情况",
        action: "恶劣天气时拆分返程或延后出发",
      },
    ],
  },
  transport: {
    recommended: "driving",
    reason: "景点分散，自驾更可行。",
    driving: {
      summary: "自驾约 1,300 公里",
      reason: "便于串联自然景观。",
      durationMinutes: 780,
      route: "高速和国道",
    },
    transit: {
      summary: "公共交通耗时更长",
      reason: "景点之间换乘复杂。",
      durationMinutes: 1200,
      route: "火车和接驳",
    },
  },
  budget: {
    currency: "CNY",
    total: "¥3,000-4,500/车",
    breakdown: [
      { category: "住宿", amount: "¥1,200-1,800" },
      { category: "油费与过路费", amount: "¥1,000-1,500" },
      { category: "餐饮和门票", amount: "¥800-1,200", notes: "门票待核实" },
    ],
    assumptions: "两人同行、油车估算",
  },
  attractions: [
    { name: "上都湖", category: "natural", reason: "湖泊日落。", day: 1 },
    { name: "柳兰沟", category: "natural", reason: "草原花甸。", day: 2 },
    { name: "平顶山", category: "natural", reason: "火山台地。", day: 2 },
    { name: "达里湖", category: "natural", reason: "草原湖区。", day: 3 },
    { name: "元上都遗址", category: "cultural", reason: "元代夏都遗址。", day: 2 },
  ],
  lodging: [
    { name: "正蓝旗酒店", area: "上都镇", reason: "方便首晚休息。" },
  ],
  food: [
    { name: "锡林浩特涮羊肉", mustTry: "手切羊肉", reason: "当地饮食。" },
  ],
  pitfalls: [
    { title: "天气待核实", detail: "出发前刷新。", severity: "high" },
    { title: "景区预约", detail: "热门景点先查官方公告。", severity: "medium" },
    { title: "草原道路与停车", detail: "提前确认道路、停车和补给点。", severity: "medium" },
  ],
};

describe("travel planning integration", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("aggregates every completed weather provider city in one session", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-weather-cities-${Date.now()}@example.com`,
        name: "天气证据聚合用户",
        passwordHash: "hash",
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划北京到锡林郭勒的自驾旅行。",
    });

    await prisma.agentToolCall.create({
      data: {
        agentSessionId: session.id,
        name: "get_weather_reference",
        requestJson: JSON.stringify({ city: "北京" }),
        responseJson: JSON.stringify({ city: "北京市", summary: "晴" }),
        status: "completed",
      },
    });
    await prisma.agentToolCall.create({
      data: {
        agentSessionId: session.id,
        name: "get_weather_reference",
        requestJson: JSON.stringify({ city: "正蓝旗" }),
        responseJson: JSON.stringify({ city: "正蓝旗", summary: "多云" }),
        status: "completed",
      },
    });
    await prisma.agentToolCall.create({
      data: {
        agentSessionId: session.id,
        name: "get_weather_reference",
        requestJson: JSON.stringify({ city: "未完成" }),
        responseJson: JSON.stringify({ city: "未完成", summary: "失败调用" }),
        status: "failed",
      },
    });

    await expect(
      loadCompletedWeatherReferenceCities(session.id)
    ).resolves.toEqual(["北京市", "正蓝旗"]);
  });

  it("keeps provider route payloads out of the model context", () => {
    const serialized = stringifyToolResult({
      mode: "driving",
      durationMinutes: 458,
      summary: "驾车路线来自高德",
      raw: {
        route: {
          paths: [{ polyline: "116.4,39.9;".repeat(100_000) }],
        },
      },
    });

    expect(serialized).toContain('"durationMinutes":458');
    expect(serialized).toContain("驾车路线来自高德");
    expect(serialized).not.toContain("polyline");
    expect(Buffer.byteLength(serialized)).toBeLessThan(1_000);
  });

  it("completes a partial transport block from both recorded route results", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-transport-fallback-${Date.now()}@example.com`,
        name: "交通字段补全用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划 2026 年 8 月 8 日北京到锡林郭勒的一日自驾旅行。",
    });
    const chatClient: AgentChatClient = {
      async complete() {
        return {
          message: {
            role: "assistant",
            content: "已查询两种交通方案并落地行程。",
            toolCalls: [
              {
                id: "transport-fallback-driving",
                name: "get_driving_route",
                arguments: {
                  origin: "116.4,39.9",
                  destination: "116.5,42.0",
                  city: "北京",
                  cityd: "锡林郭勒",
                },
              },
              {
                id: "transport-fallback-transit",
                name: "get_transit_route",
                arguments: {
                  origin: "116.4,39.9",
                  destination: "116.5,42.0",
                  city: "北京",
                  cityd: "锡林郭勒",
                },
              },
              {
                id: "transport-fallback-create",
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  finalStopName: "锡林郭勒",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "锡林郭勒", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "锡林郭勒",
                      routeMinutes: 36,
                      totalMinutes: 36,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                  ],
                  travelPlan: {
                    ...travelPlan,
                    transport: {},
                  },
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
    });
    expect(JSON.parse(persisted.travelPlanJson ?? "{}")).toMatchObject({
      transport: {
        recommended: "driving",
        driving: { durationMinutes: 36 },
        transit: { durationMinutes: 42 },
      },
    });
  });

  it("persists recommendation arrays when the model flattens them beside travelPlan", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-array-fallback-${Date.now()}@example.com`,
        name: "旅行数组兼容用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划 2026 年 8 月 8 日北京到锡林郭勒的一日自驾旅行。",
    });
    const chatClient: AgentChatClient = {
      async complete() {
        return {
          message: {
            role: "assistant",
            content: "已完成旅行规划。",
            toolCalls: [
              {
                id: "array-fallback-create",
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  finalStopName: "锡林郭勒",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "锡林郭勒", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "锡林郭勒",
                      routeMinutes: 36,
                      totalMinutes: 36,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                  ],
                  travelPlan: {
                    ...travelPlan,
                    attractions: undefined,
                    lodging: undefined,
                    food: undefined,
                    pitfalls: undefined,
                    budget: undefined,
                  },
                  attractions: travelPlan.attractions,
                  lodging: travelPlan.lodging,
                  food: travelPlan.food,
                  pitfalls: travelPlan.pitfalls,
                  budget: travelPlan.budget,
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
    });
    expect(JSON.parse(persisted.travelPlanJson ?? "{}")).toMatchObject({
      attractions: expect.arrayContaining([
        expect.objectContaining({ name: "上都湖" }),
      ]),
      lodging: expect.arrayContaining([
        expect.objectContaining({ name: "正蓝旗酒店" }),
      ]),
      food: expect.arrayContaining([
        expect.objectContaining({ name: "锡林浩特涮羊肉" }),
      ]),
      pitfalls: expect.arrayContaining([
        expect.objectContaining({ title: "天气待核实" }),
      ]),
      budget: expect.objectContaining({ total: "¥3,000-4,500/车" }),
    });
  });

  it("nudges the model to converge after the direct POI budget is exhausted", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-poi-budget-${Date.now()}@example.com`,
        name: "旅行检索预算用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划 2026 年 8 月 8 日至 11 日北京到锡林郭勒的旅行。",
    });
    let callCount = 0;
    let receivedConvergenceNudge = false;
    const chatClient: AgentChatClient = {
      async complete(input) {
        callCount += 1;
        receivedConvergenceNudge = input.messages.some((message) =>
          message.content.includes("旅行地点检索预算已用完")
        );

        if (callCount === 1) {
          return {
            message: {
              role: "assistant",
              content: "补充有限的地点证据。",
              toolCalls: Array.from({ length: 8 }, (_, index) => ({
                id: `poi-budget-${index}`,
                name: "search_poi",
                arguments: {
                  keywords: `预算测试地点${index}`,
                  city: "锡林郭勒盟",
                },
              })),
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "已根据已有证据落地行程。",
            toolCalls: [
              {
                id: "poi-budget-create",
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  finalStopName: "锡林郭勒",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "锡林郭勒", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "锡林郭勒",
                      routeMinutes: 120,
                      totalMinutes: 120,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                  ],
                  travelPlan,
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(receivedConvergenceNudge).toBe(true);
    expect(callCount).toBe(2);
  });

  it("normalizes invalid model times and persists pre-departure weather jobs", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-schedule-${Date.now()}@example.com`,
        name: "旅行时间轴用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行。",
    });
    const chatClient: AgentChatClient = {
      async complete() {
        return {
          message: {
            role: "assistant",
            content: "创建旅行行程。",
            toolCalls: [
              {
                id: "create-invalid-travel-time",
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  targetArriveAt: "2026-08-11T20:30:00.000Z",
                  finalStopName: "北京",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "正蓝旗", kind: "destination" },
                    {
                      order: 2,
                      name: "上都湖",
                      kind: "waypoint",
                      notes: "D1 游览后在湖区附近住宿",
                    },
                    { order: 3, name: "锡林浩特", kind: "destination" },
                    { order: 4, name: "北京", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "正蓝旗",
                      routeMinutes: 324,
                      totalMinutes: 364,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                    {
                      order: 1,
                      originName: "正蓝旗",
                      destinationName: "上都湖",
                      routeMinutes: 40,
                      totalMinutes: 50,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·湖泊",
                    },
                    {
                      order: 2,
                      originName: "上都湖",
                      destinationName: "锡林浩特",
                      routeMinutes: 159,
                      totalMinutes: 174,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D2·转场",
                    },
                    {
                      order: 3,
                      originName: "锡林浩特",
                      destinationName: "北京",
                      routeMinutes: 600,
                      totalMinutes: 660,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D4·返程长线",
                    },
                  ],
                  travelPlan,
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
      include: {
        legs: { orderBy: { order: "asc" } },
        reminderJobs: { orderBy: { scheduledFor: "asc" } },
      },
    });

    expect(
      persisted.legs.map((leg) => [
        formatInTimeZone(leg.latestDepartAt!, "Asia/Shanghai", "yyyy-MM-dd HH:mm"),
        formatInTimeZone(leg.targetArriveAt!, "Asia/Shanghai", "yyyy-MM-dd HH:mm"),
      ])
    ).toEqual([
      ["2026-08-08 07:00", "2026-08-08 13:04"],
      ["2026-08-08 13:04", "2026-08-08 13:54"],
      ["2026-08-09 08:00", "2026-08-09 10:54"],
      ["2026-08-11 06:30", "2026-08-11 17:30"],
    ]);
    const weatherJobs = persisted.reminderJobs.filter(
      (job) => job.kind === "weather_refresh"
    );
    expect(weatherJobs).toHaveLength(6);
    expect(
      weatherJobs.filter((job) => job.legId === persisted.legs[0]?.id)
    ).toHaveLength(3);
    for (const leg of persisted.legs.slice(1)) {
      expect(weatherJobs.filter((job) => job.legId === leg.id)).toHaveLength(1);
    }
    expect(
      weatherJobs
        .filter((job) => job.legId === persisted.legs[0]?.id)
        .map((job) => JSON.parse(job.payloadJson).hoursBeforeDeparture)
        .sort((left, right) => left - right)
    ).toEqual([1, 24, 72]);
    expect(JSON.parse(persisted.travelPlanJson ?? "{}")).toMatchObject({
      budget: { total: "¥3,000-4,500/车" },
      pitfalls: expect.arrayContaining([
        expect.objectContaining({ title: "单日驾驶强度偏高", severity: "high" }),
      ]),
    });
  });

  it("rejects a daily driving ceiling violation and lets the model re-plan", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-daily-limit-${Date.now()}@example.com`,
        name: "每日驾驶上限用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt:
        "请规划 2026-08-15 至 2026-08-19 的北京到锡林郭勒自驾旅行，每天自驾不超过 6 小时。",
    });
    let callCount = 0;
    let rejectedToolMessage = "";
    const chatClient: AgentChatClient = {
      async complete(input) {
        callCount += 1;
        rejectedToolMessage =
          input.messages
            .filter((message) => message.role === "tool")
            .at(-1)?.content ?? rejectedToolMessage;
        const splitAcrossDays = callCount > 1;

        return {
          message: {
            role: "assistant",
            content: "创建旅行行程。",
            toolCalls: [
              {
                id: `daily-limit-create-${callCount}`,
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  finalStopName: "北京",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    {
                      order: 1,
                      name: "元上都遗址",
                      kind: "destination",
                      notes: "D1 游览后在遗址附近住宿",
                    },
                    { order: 2, name: "多伦", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "元上都遗址",
                      routeMinutes: 342,
                      totalMinutes: 342,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                    {
                      order: 1,
                      originName: "元上都遗址",
                      destinationName: "多伦",
                      routeMinutes: 48,
                      totalMinutes: 48,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: splitAcrossDays ? "D2·转场" : "D1·转场",
                    },
                  ],
                  travelPlan,
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);
    expect(rejectedToolMessage).toContain("累计自驾 390 分钟（约 6.5 小时）");
    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
      include: { legs: { orderBy: { order: "asc" } } },
    });
    expect(
      persisted.legs.map((leg) =>
        formatInTimeZone(leg.latestDepartAt!, "Asia/Shanghai", "yyyy-MM-dd")
      )
    ).toEqual(["2026-08-15", "2026-08-16"]);
  });

  it("forces create_trip when the model ends its evidence pass with plain text", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-create-nudge-${Date.now()}@example.com`,
        name: "旅行落地用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行。",
    });
    const toolChoices: unknown[] = [];
    let callCount = 0;
    const chatClient: AgentChatClient = {
      async complete(input) {
        toolChoices.push(input.toolChoice);
        callCount += 1;

        if (callCount === 1) {
          return {
            message: {
              role: "assistant",
              content: "证据已经整理完毕，现在生成完整行程。",
            },
          };
        }

        if (callCount === 2) {
          return {
            message: {
              role: "assistant",
              content: "调用旅行行程工具。",
              toolCalls: [
                {
                  id: "malformed-create-after-nudge",
                  name: "create_trip",
                  arguments: {},
                  parseError: "模型返回的工具参数不是合法 JSON。",
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "已落地旅行行程。",
            toolCalls: [
              {
                id: "create-after-nudge",
                name: "create_trip",
                arguments: {
                  title: "北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  targetArriveAt: "2026-08-11T20:30:00.000Z",
                  finalStopName: "北京",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "正蓝旗", kind: "destination" },
                    {
                      order: 2,
                      name: "上都湖",
                      kind: "waypoint",
                      notes: "D1 游览后在湖区附近住宿",
                    },
                    { order: 3, name: "锡林浩特", kind: "destination" },
                    { order: 4, name: "北京", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "正蓝旗",
                      routeMinutes: 324,
                      totalMinutes: 364,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·去程",
                    },
                    {
                      order: 1,
                      originName: "正蓝旗",
                      destinationName: "上都湖",
                      routeMinutes: 40,
                      totalMinutes: 50,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·湖泊",
                    },
                    {
                      order: 2,
                      originName: "上都湖",
                      destinationName: "锡林浩特",
                      routeMinutes: 159,
                      totalMinutes: 174,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D2·转场",
                    },
                    {
                      order: 3,
                      originName: "锡林浩特",
                      destinationName: "北京",
                      routeMinutes: 600,
                      totalMinutes: 660,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D4·返程长线",
                    },
                  ],
                  travelPlan,
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(result.tripId).toBeTruthy();
    expect(callCount).toBe(3);
    expect(toolChoices[0]).toBeUndefined();
    expect(toolChoices[1]).toBeUndefined();
    expect(toolChoices[2]).toBeUndefined();
  });

  it("returns rejected tool calls to the model for correction", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-tool-retry-${Date.now()}@example.com`,
        name: "旅行工具重试用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行。",
    });
    let callCount = 0;
    let rejectedToolMessage = "";
    const chatClient: AgentChatClient = {
      async complete(input) {
        callCount += 1;
        rejectedToolMessage = input.messages
          .filter((message) => message.role === "tool")
          .at(-1)?.content ?? rejectedToolMessage;

        return {
          message: {
            role: "assistant",
            content: "创建旅行行程。",
            toolCalls: [
              {
                id: `create-retry-${callCount}`,
                name: "create_trip",
                arguments:
                  callCount === 1
                    ? {
                        title: "无效旅行行程",
                        timezone: "Asia/Shanghai",
                        stops: [],
                        legs: [],
                        travelPlan,
                      }
                    : {
                        title: "北京到锡林郭勒",
                        timezone: "Asia/Shanghai",
                        finalStopName: "锡林浩特",
                        stops: [
                          { order: 0, name: "北京", kind: "origin" },
                          { order: 1, name: "锡林浩特", kind: "destination" },
                        ],
                        legs: [
                          {
                            order: 0,
                            originName: "北京",
                            destinationName: "锡林浩特",
                            routeMinutes: 120,
                            bufferMinutes: 0,
                            totalMinutes: 120,
                            bufferComponents: [],
                            mode: "driving",
                            segmentTitle: "D1·去程",
                          },
                        ],
                        travelPlan,
                      },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(result.tripId).toBeTruthy();
    expect(callCount).toBe(2);
    expect(rejectedToolMessage).toContain("创建行程至少需要一个目的地停靠点");
  });

  it("merges a failed complete candidate into a partial route repair", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-candidate-merge-${Date.now()}@example.com`,
        name: "旅行候选合并用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行。",
    });
    let callCount = 0;
    let rejectedToolMessage = "";
    const chatClient: AgentChatClient = {
      async complete(input) {
        callCount += 1;
        rejectedToolMessage = input.messages
          .filter((message) => message.role === "tool")
          .at(-1)?.content ?? rejectedToolMessage;

        if (callCount === 1) {
          return {
            message: {
              role: "assistant",
              content: "提交完整旅行方案。",
              toolCalls: [
                {
                  id: "candidate-merge-first",
                  name: "create_trip",
                  arguments: {
                    title: "首轮完整方案",
                    timezone: "Asia/Shanghai",
                    stops: [],
                    legs: [],
                    travelPlan,
                  },
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "修正路线并落地旅行方案。",
            toolCalls: [
              {
                id: "candidate-merge-second",
                name: "create_trip",
                arguments: {
                  title: "修正后的北京到锡林郭勒",
                  timezone: "Asia/Shanghai",
                  finalStopName: "锡林郭勒",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "锡林浩特", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "锡林浩特",
                      routeMinutes: 120,
                      totalMinutes: 120,
                      bufferComponents: [],
                      mode: "driving",
                      segmentTitle: "D1·修正后的去程",
                    },
                  ],
                  travelPlan: {
                    weather: { summary: "第二轮刷新后的天气摘要" },
                    food: [
                      {
                        name: "锡林浩特涮羊肉",
                        reason: "第二轮重新确认当地用餐安排。",
                      },
                    ],
                  },
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);
    expect(rejectedToolMessage).toContain("创建行程至少需要一个目的地停靠点");

    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
      include: { stops: { orderBy: { order: "asc" } } },
    });
    expect(persisted.title).toBe("北京-锡林郭勒");
    expect(persisted.stops.map((stop) => stop.name)).toEqual([
      "北京",
      "锡林浩特",
    ]);
    expect(JSON.parse(persisted.travelPlanJson ?? "{}")).toMatchObject({
      destination: "锡林郭勒盟",
      weather: { summary: "第二轮刷新后的天气摘要" },
      lodging: expect.arrayContaining([
        expect.objectContaining({ name: "正蓝旗酒店" }),
      ]),
      food: [
        expect.objectContaining({
          name: "锡林浩特涮羊肉",
          mustTry: "手切羊肉",
          reason: "第二轮重新确认当地用餐安排。",
        }),
      ],
    });
  });

  it("persists failed create_trip validation and stops repeated identical errors", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-failed-tool-audit-${Date.now()}@example.com`,
        name: "旅行失败审计用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划2026年8月8日至11日北京出发、锡林郭勒盟自驾4天3晚的旅行。",
    });
    let callCount = 0;
    const chatClient: AgentChatClient = {
      async complete() {
        callCount += 1;
        return {
          message: {
            role: "assistant",
            content: "创建旅行行程。",
            toolCalls: [
              {
                id: `repeated-invalid-create-${callCount}`,
                name: "create_trip",
                arguments: {
                  title: "无效旅行行程",
                  timezone: "Asia/Shanghai",
                  stops: [
                    { order: 0, name: "北京", kind: "origin" },
                    { order: 1, name: "锡林郭勒", kind: "destination" },
                  ],
                  legs: [
                    {
                      order: 0,
                      originName: "北京",
                      destinationName: "锡林郭勒",
                      routeMinutes: 120,
                      totalMinutes: 120,
                      bufferComponents: [],
                      mode: "driving",
                    },
                  ],
                  travelPlan: {
                    ...travelPlan,
                    weather: {
                      ...travelPlan.weather,
                      dynamicMonitoring: false,
                    },
                  },
                },
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("failed");
    expect(callCount).toBe(2);
    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { toolCalls: { orderBy: { createdAt: "asc" } } },
    });
    const failedCreates = persisted.toolCalls.filter(
      (toolCall) => toolCall.name === "create_trip"
    );
    expect(failedCreates).toHaveLength(2);
    expect(failedCreates.every((toolCall) => toolCall.status === "failed")).toBe(
      true
    );
    expect(failedCreates[0]?.error).toContain("动态天气监控");
  });

  it("stops an agent that keeps calling tools without completing", async () => {
    const user = await prisma.user.create({
      data: {
        email: `travel-round-limit-${Date.now()}@example.com`,
        name: "旅行轮数上限用户",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "北京",
            timezone: "Asia/Shanghai",
            originName: "北京",
            originLngLat: "116.4,39.9",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      purpose: "travel",
      prompt: "请规划北京到锡林郭勒的旅行。",
    });
    let callCount = 0;
    const chatClient: AgentChatClient = {
      async complete() {
        callCount += 1;
        return {
          message: {
            role: "assistant",
            content: "继续读取设置。",
            toolCalls: [
              {
                id: `round-limit-settings-${callCount}`,
                name: "read_settings",
                arguments: {},
              },
            ],
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: createMockAmapClient(),
      chatClient,
    });

    expect(result.status).toBe("failed");
    expect(callCount).toBe(14);
    const failure = await prisma.agentMessage.findFirstOrThrow({
      where: { agentSessionId: session.id, role: "assistant", content: { startsWith: "规划失败" } },
      orderBy: { createdAt: "desc" },
    });
    expect(failure.content).toContain("超过 14 轮");
  });
});
