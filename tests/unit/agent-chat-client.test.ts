import { describe, expect, it, vi } from "vitest";
import {
  createFallbackChatClient,
  createOpenAiChatClient,
  TRAVEL_MAX_OUTPUT_TOKENS,
} from "@/lib/agent/chat-client";
import type { AgentChatMessage } from "@/lib/agent/chat-client";

const { completionMock } = vi.hoisted(() => ({
  completionMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: completionMock,
      },
    };
  },
}));

describe("createFallbackChatClient", () => {
  it("creates a complete travel plan after comparing driving and transit", async () => {
    const client = createFallbackChatClient();
    const messages: AgentChatMessage[] = [
      {
        role: "system",
        content: "You are a personal travel-itinerary planning AI.",
      },
      { role: "user", content: "计划宁波两日旅行" },
    ];

    const first = await client.complete({ messages, tools: [] });
    messages.push(first.message);
    messages.push(
      {
        role: "tool",
        toolCallId: "mock-read-settings",
        content: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "家",
          originLngLat: "121.5,29.8",
          routePreference: "balanced",
        }),
      },
      {
        role: "tool",
        toolCallId: "mock-weather",
        content: JSON.stringify({
          kind: "reference",
          city: "宁波",
          summary: "宁波天气参考：多云，24°C",
        }),
      }
    );

    const routes = await client.complete({ messages, tools: [] });
    expect(routes.message.toolCalls?.map((toolCall) => toolCall.name)).toEqual([
      "get_driving_route",
      "get_transit_route",
    ]);
    messages.push(routes.message);
    messages.push(
      {
        role: "tool",
        toolCallId: "mock-travel-driving",
        content: JSON.stringify({
          mode: "driving",
          durationMinutes: 36,
          summary: "驾车路线来自高德",
        }),
      },
      {
        role: "tool",
        toolCallId: "mock-travel-transit",
        content: JSON.stringify({
          mode: "transit",
          durationMinutes: 42,
          summary: "公交/地铁路线来自高德",
        }),
      }
    );

    const createTrip = await client.complete({ messages, tools: [] });
    const createTripCall = createTrip.message.toolCalls?.find(
      (toolCall) => toolCall.name === "create_trip"
    );
    const travelPlan = (
      createTripCall?.arguments as { travelPlan?: Record<string, unknown> }
    )?.travelPlan;

    expect(travelPlan).toMatchObject({
      destination: "Longhu Tianjie",
      weather: {
        summary: "宁波天气参考：多云，24°C",
        dynamicMonitoring: true,
        forecast: expect.any(Array),
        routeRisks: expect.any(Array),
      },
      transport: {
        recommended: "driving",
        driving: { durationMinutes: 36 },
        transit: { durationMinutes: 42 },
      },
      attractions: expect.arrayContaining([
        expect.objectContaining({ category: "natural" }),
        expect.objectContaining({ category: "cultural" }),
      ]),
      lodging: expect.any(Array),
      food: expect.any(Array),
      pitfalls: expect.any(Array),
    });
    expect(
      (travelPlan?.attractions as Array<{ category: string }>).filter(
        (attraction) => attraction.category === "natural"
      )
    ).toHaveLength(4);
  });

  it("does not invent a default origin when settings have no selected origin", async () => {
    const client = createFallbackChatClient();
    const messages: AgentChatMessage[] = [
      { role: "system", content: "test" },
      { role: "user", content: "plan commute" },
    ];

    const first = await client.complete({ messages, tools: [] });
    messages.push(first.message);
    messages.push({
      role: "tool",
      toolCallId: "mock-read-settings",
      content: JSON.stringify({
        defaultCity: "宁波",
        timezone: "Asia/Shanghai",
        originName: null,
        originLngLat: null,
        routePreference: "balanced",
      }),
    });

    const route = await client.complete({ messages, tools: [] });
    const routeCall = route.message.toolCalls?.find(
      (toolCall) => toolCall.name === "get_transit_route"
    );

    expect(routeCall?.arguments.origin).not.toBe("121.5230315924,29.8652491273");
    expect(routeCall?.arguments.origin).toBe("");

    messages.push(route.message);
    messages.push({
      role: "tool",
      toolCallId: "mock-route",
      content: JSON.stringify({ routeMinutes: 42 }),
    });

    const createTrip = await client.complete({ messages, tools: [] });
    const createTripCall = createTrip.message.toolCalls?.find(
      (toolCall) => toolCall.name === "create_trip"
    );
    const createTripArgs = createTripCall?.arguments as
      | {
          legs?: Array<{
            originName?: unknown;
            originLngLat?: unknown;
            routeTitle?: unknown;
          }>;
        }
      | undefined;
    const leg = createTripArgs?.legs?.[0];

    expect(leg?.originName).not.toBe("家");
    expect(leg?.originName).toBe("");
    expect(leg?.originLngLat).toBe("");
    expect(leg?.routeTitle).not.toContain("家");
    expect(leg?.routeTitle).not.toContain("121.5230315924,29.8652491273");
  });
});

describe("createOpenAiChatClient", () => {
  it("requests enough output for long structured travel tool calls", async () => {
    completionMock.mockResolvedValueOnce({
      choices: [{ message: { content: "已完成" } }],
    });

    const client = createOpenAiChatClient({
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    });

    await client.complete({
      messages: [{ role: "user", content: "规划五天旅行" }],
      tools: [
        {
          name: "create_trip",
          description: "Create a trip",
          parameters: { type: "object" },
        },
      ],
      model: "deepseek-v4-flash",
    });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 32768 }),
      expect.objectContaining({ signal: undefined })
    );
    completionMock.mockReset();
  });

  it("allows travel planning to use a bounded structured-output budget", async () => {
    completionMock.mockResolvedValueOnce({
      choices: [{ message: { content: "已完成" } }],
    });

    const client = createOpenAiChatClient({
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    });

    await client.complete({
      messages: [{ role: "user", content: "规划北京到锡林郭勒五天旅行" }],
      tools: [],
      model: "deepseek-v4-flash",
      purpose: "travel",
      maxOutputTokens: TRAVEL_MAX_OUTPUT_TOKENS,
    });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: TRAVEL_MAX_OUTPUT_TOKENS,
        thinking: { type: "disabled" },
      }),
      expect.objectContaining({ signal: undefined })
    );
    completionMock.mockReset();
  });

  it("keeps verbose assistant reasoning out of later model prompts while preserving tool calls", async () => {
    completionMock.mockResolvedValueOnce({
      choices: [{ message: { content: "已完成" } }],
    });

    const client = createOpenAiChatClient({
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    });
    const verboseContent = "详细推理 ".repeat(500);

    await client.complete({
      messages: [
        {
          role: "assistant",
          content: verboseContent,
          toolCalls: [
            {
              id: "read-settings",
              name: "read_settings",
              arguments: {},
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "read-settings",
          content: "{}",
        },
      ],
      tools: [],
      model: "deepseek-v4-flash",
      purpose: "travel",
    });

    const requestMessages = completionMock.mock.calls[0]?.[0]?.messages as Array<{
      role: string;
      content: string;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
    expect(requestMessages[0]).toMatchObject({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "read_settings" } }],
    });
    expect(requestMessages[0]?.content.length).toBeLessThanOrEqual(1200);
    completionMock.mockReset();
  });

  it("repairs common malformed JSON from a structured travel tool call", async () => {
    completionMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "repair-create-trip",
                type: "function",
                function: {
                  name: "create_trip",
                  arguments:
                    '{"title":"北京到锡林郭勒","notes":"雨天\n减速",}',
                },
              },
            ],
          },
        },
      ],
    });

    const client = createOpenAiChatClient({
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    });

    const result = await client.complete({
      messages: [{ role: "user", content: "规划旅行" }],
      tools: [],
      model: "deepseek-v4-flash",
      purpose: "travel",
    });

    expect(result.message.toolCalls?.[0]).toMatchObject({
      name: "create_trip",
      arguments: {
        title: "北京到锡林郭勒",
        notes: "雨天\n减速",
      },
      parseRepaired: true,
    });
    expect(result.message.toolCalls?.[0]?.parseError).toBeUndefined();
    completionMock.mockReset();
  });
});
