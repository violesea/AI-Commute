import { beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import {
  runPlanningSession,
  startPlanningSession,
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
  ],
};

describe("travel planning integration", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
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
    expect(
      persisted.reminderJobs.filter((job) => job.kind === "weather_refresh")
    ).toHaveLength(2);
    expect(JSON.parse(persisted.travelPlanJson ?? "{}")).toMatchObject({
      budget: { total: "¥3,000-4,500/车" },
      pitfalls: expect.arrayContaining([
        expect.objectContaining({ title: "单日驾驶强度偏高", severity: "high" }),
      ]),
    });
  });
});
