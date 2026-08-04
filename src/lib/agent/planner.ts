import { createAmapClient } from "@/lib/amap";
import type { AmapClient } from "@/lib/amap";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";
import type {
  AgentChatClient,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatToolDefinition,
} from "@/lib/agent/chat-client";
import {
  createOpenAiChatClient,
  TRAVEL_MAX_OUTPUT_TOKENS,
  TRAVEL_PLANNING_MODEL,
} from "@/lib/agent/chat-client";
import {
  assertAgentRunActive,
  recordFailedToolCall,
  recordToolCall,
} from "@/lib/agent/tools";
import { buildConfirmedMemoryContext } from "@/lib/memories/context";
import type {
  AgentToolName,
  ContinueAgentSessionInput,
  PlanningAttemptResult,
  PlanningSessionResult,
  StartPlanningSessionInput,
} from "@/lib/agent/types";
import {
  AgentRunTimeoutError,
  runWithTimeoutAndRetry,
} from "@/lib/agent/runner";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import {
  cancelTripMonitoring,
  createMemoryCandidateForTrip,
  replaceReminderSchedule,
  replaceTripRoute,
  selectRouteCandidate,
  updateTripSummary,
} from "@/lib/trips/route-updates";
import type {
  BufferComponentInput,
  CreatePlannedTripInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";
import {
  alignTravelPlanAttractionsWithRoute,
  assertTravelPlanAttractionCoverage,
  assertTravelPlanBudget,
  assertTravelPlanOperationalCompleteness,
  completeTravelPlanArrayPayload,
  completeTravelPlanTransportPayload,
  ensureTravelPlanWeatherCoverage,
  ensureTravelPlanWeatherLocations,
  normalizeTravelPlan,
  parseTravelPlanJson,
  summarizeTravelRouteEvidence,
  type TravelPlan,
  type TravelRecommendationEvidence,
  type TravelRouteLegEvidence,
  type TravelTransportEvidence,
  type TravelWeatherForecast,
} from "@/lib/trips/travel-plan";
import {
  addTravelSchedulePitfall,
  alignTravelPlanPitfallsWithSchedule,
  assertTravelItinerarySchedule,
  ensureTravelPlanRouteRiskCoverage,
  isTravelDayMarker,
  normalizeTravelItinerarySchedule,
  parseDateTimeInTimeZone,
  parseTravelDateRange,
} from "@/lib/trips/travel-schedule";
import type { AgentPlanningPurpose } from "@/lib/agent/types";

const SESSION_TIMEOUT_MS = 600000;
const SESSION_MAX_ATTEMPTS = 2;
const MAX_CONVERSATION_ROUNDS = {
  planning: 10,
  travel: 14,
} as const;
const MAX_CREATE_TRIP_FAILURES = 4;
const MAX_IDENTICAL_CREATE_TRIP_FAILURES = 2;
const ORIGIN_REQUIRED_MESSAGE =
  "请先在设置中选择默认出发点，或在本次请求中提供出发点。";
const LNG_LAT_PATTERN = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;
const NATURAL_ATTRACTION_SEARCH_GROUPS = [
  "山,峰,森林,森林公园,国家公园",
  "湖,湿地,溪流,瀑布,峡谷",
  "海,海岛,海滩,滨海,湾",
  "公园,植物园,观景台,风景区",
] as const;
const CANONICAL_NATURAL_TYPES = [
  "mountain",
  "lake",
  "forest",
  "wetland",
  "coast",
  "island",
  "canyon",
  "waterfall",
  "park",
  "viewpoint",
  "grassland",
  "river",
  "volcanic",
  "geological",
] as const;

export { AgentRunTimeoutError };

export class AgentSessionAlreadyRunningError extends Error {
  constructor() {
    super("Agent session is already running.");
    this.name = "AgentSessionAlreadyRunningError";
  }
}

export class AgentSessionNotFoundError extends Error {
  constructor() {
    super("Agent session not found.");
    this.name = "AgentSessionNotFoundError";
  }
}

export class AgentConversationLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConversationLimitError";
  }
}

type PlanningSettings = {
  defaultCity: string;
  timezone: string;
  model: string;
  originName: string;
  originLngLat: string;
  routePreference: string;
};

type TravelEvidenceBudget = {
  maxDirectPoiSearches: number;
  directPoiSearches: number;
  exhaustionNudgeSent: boolean;
};

export type RunPlanningSessionOptions = {
  chatClient?: AgentChatClient;
  amapClient?: AmapClient;
};

type ToolExecutionContext = {
  amap: AmapClient;
  sessionId: string;
  userId: string;
  prompt: string;
  purpose: AgentPlanningPurpose;
  tripId?: string | null;
  signal?: AbortSignal;
  toolResultCache: Map<string, unknown>;
  travelEvidenceBudget?: TravelEvidenceBudget;
};

const fallbackSettings = (): PlanningSettings => {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    model: env.openAiModel,
    originName: "",
    originLngLat: "",
    routePreference: "balanced",
  };
};

function normalizePlanningSettings(settings: {
  defaultCity: string;
  timezone: string;
  model: string | null;
  originName: string | null;
  originLngLat: string | null;
  routePreference: string;
}): PlanningSettings {
  return {
    defaultCity: settings.defaultCity,
    timezone: settings.timezone,
    model: settings.model ?? fallbackSettings().model,
    originName: settings.originName ?? "",
    originLngLat: settings.originLngLat ?? "",
    routePreference: settings.routePreference,
  };
}

function normalizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("请输入通勤规划需求。");
  }

  return trimmed;
}

export async function enrichTravelPlanWithLatestWeatherEvidence(
  plan: TravelPlan,
  sessionId: string,
  options: { minCreatedAt?: Date; replaceForecast?: boolean } = {}
): Promise<TravelPlan> {
  const weatherCalls = await prisma.agentToolCall.findMany({
    where: {
      agentSessionId: sessionId,
      name: "get_weather_reference",
      status: "completed",
      ...(options.minCreatedAt
        ? { createdAt: { gte: options.minCreatedAt } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { responseJson: true, createdAt: true },
  });
  const latestWeatherCall = weatherCalls[0];

  if (!latestWeatherCall) {
    return plan;
  }

  let response: Record<string, unknown> = {};
  try {
    const parsed = latestWeatherCall.responseJson
      ? JSON.parse(latestWeatherCall.responseJson)
      : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      response = parsed as Record<string, unknown>;
    }
  } catch {
    response = {};
  }

  const responseForecast = Array.isArray(response.forecast)
    ? response.forecast
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .map((item): TravelWeatherForecast | null => {
          const date = typeof item.date === "string" ? item.date : undefined;
          const summary =
            typeof item.summary === "string" ? item.summary.trim() : "";
          if (!summary) return null;

          return {
            date,
            location:
              typeof response.city === "string" ? response.city : undefined,
            summary,
            risk: "medium",
            drivingAdvice: "出发前根据最新天气和道路情况确认自驾时段。",
            outdoorAdvice: "根据最新降雨和大风预警调整户外景点。",
          };
        })
        .filter((item): item is TravelWeatherForecast => Boolean(item))
    : [];
  const responseForecastDates = Array.isArray(response.forecast)
    ? response.forecast
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .map((item) => (typeof item.date === "string" ? item.date.trim() : ""))
        .filter(Boolean)
        .sort()
    : [];
  const responseCity =
    typeof response.city === "string" && response.city.trim()
      ? response.city.trim()
      : plan.weather.city;
  const responseSummary =
    typeof response.summary === "string" && response.summary.trim()
      ? response.summary.trim()
      : plan.weather.summary;

  return {
    ...plan,
    weather: {
      ...plan.weather,
      city: responseCity,
      summary: responseSummary,
      source: "高德天气参考",
      observedAt:
        typeof response.observedAt === "string" && response.observedAt.trim()
          ? response.observedAt
          : latestWeatherCall.createdAt.toISOString(),
      forecastAvailableThrough:
        responseForecastDates.at(-1) ?? plan.weather.forecastAvailableThrough,
      forecast:
        options.replaceForecast && responseForecast.length > 0
          ? responseForecast
          : plan.weather.forecast && plan.weather.forecast.length > 0
            ? plan.weather.forecast
            : responseForecast,
    },
  };
}

/**
 * Returns only cities present in completed provider responses. This is kept
 * separate from the plan payload so model-authored weather.locations values
 * cannot become evidence accidentally.
 */
export async function loadCompletedWeatherReferenceCities(
  sessionId: string,
  options: { minCreatedAt?: Date } = {}
): Promise<string[]> {
  const weatherCalls = await prisma.agentToolCall.findMany({
    where: {
      agentSessionId: sessionId,
      name: "get_weather_reference",
      status: "completed",
      ...(options.minCreatedAt
        ? { createdAt: { gte: options.minCreatedAt } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { responseJson: true },
  });
  const cities: string[] = [];

  for (const call of weatherCalls) {
    try {
      const parsed = call.responseJson ? JSON.parse(call.responseJson) : null;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof parsed.city === "string" &&
        parsed.city.trim()
      ) {
        cities.push(parsed.city.trim());
      }
    } catch {
      // Ignore malformed provider records and keep the valid evidence.
    }
  }

  return [...new Set(cities)];
}

function normalizeRecommendationName(value: string) {
  return value
    .toLowerCase()
    .replace(
      /(?:住宿|酒店|宾馆|民宿|客栈|餐厅|饭店|馆子|第?\d+天|d\d+)/gi,
      ""
    )
    .replace(/[\s·、，,。/（）()]/g, "")
    .trim();
}

function usablePoiId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  return /^(?:amap-poi|mock-|0,0)$/i.test(normalized)
    ? undefined
    : normalized;
}

async function enrichTravelPlanWithToolEvidence(
  plan: TravelPlan,
  sessionId: string
): Promise<TravelPlan> {
  const weatherEnriched = await enrichTravelPlanWithLatestWeatherEvidence(
    plan,
    sessionId
  );
  const poiCalls = await prisma.agentToolCall.findMany({
    where: {
      agentSessionId: sessionId,
      name: {
        in: ["search_poi", "search_natural_attractions", "get_poi_detail"],
      },
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
    select: { responseJson: true, createdAt: true },
  });
  const poiEvidence: Array<{
    id?: string;
    name: string;
    address?: string;
    lngLat?: string;
    observedAt: string;
  }> = [];

  for (const call of poiCalls) {
    try {
      const parsed = call.responseJson ? JSON.parse(call.responseJson) : null;
      const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const name = record.name;
        if (typeof name === "string" && name.trim()) {
          poiEvidence.push({
            id: usablePoiId(record.id),
            name: name.trim(),
            address:
              typeof record.address === "string" && record.address.trim()
                ? record.address.trim()
                : undefined,
            lngLat:
              typeof record.lngLat === "string" && record.lngLat.trim()
                ? record.lngLat.trim()
                : undefined,
            observedAt: call.createdAt.toISOString(),
          });
        }
      }
    } catch {
      continue;
    }
  }

  function findPoiEvidence(name: string, area?: string) {
    const normalizedName = normalizeRecommendationName(name);
    const normalizedArea = area ? normalizeRecommendationName(area) : "";
    if (!normalizedName) return undefined;

    return poiEvidence
      .map((candidate) => {
        const normalizedCandidate = normalizeRecommendationName(candidate.name);
        const normalizedAddress = candidate.address
          ? normalizeRecommendationName(candidate.address)
          : "";
        let score = 0;
        if (normalizedName === normalizedCandidate) score = 100;
        else if (
          normalizedName.length >= 4 &&
          normalizedCandidate.includes(normalizedName)
        )
          score = 80;
        else if (
          normalizedCandidate.length >= 4 &&
          normalizedName.includes(normalizedCandidate)
        )
          score = 70;

        if (
          score > 0 &&
          normalizedArea &&
          (normalizedAddress.includes(normalizedArea) ||
            normalizedCandidate.includes(normalizedArea))
        ) {
          score += 10;
        }

        return { candidate, score };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)[0]?.candidate;
  }

  function providerEvidenceFor(
    name: string,
    area?: string
  ): { evidence: TravelRecommendationEvidence; poi: (typeof poiEvidence)[number] } | null {
    const match = findPoiEvidence(name, area);
    if (!match) return null;

    return {
      poi: match,
      evidence: {
        source: "amap_poi",
        status: "provider_reference",
        label: "高德地点检索参考，仍需核对开放与价格",
        observedAt: match.observedAt,
      },
    };
  }

  function addProviderEvidence<
    T extends {
      name: string;
      area?: string;
      poiId?: string;
      address?: string;
      lngLat?: string;
      evidence?: TravelRecommendationEvidence;
    }
  >(item: T): T {
    if (item.evidence && item.evidence.source !== "agent_inference") {
      if (item.evidence.source !== "amap_poi") return item;
    }

    const provider = providerEvidenceFor(item.name, item.area);
    if (!provider) {
      if (
        item.evidence?.source === "amap_poi" &&
        !item.address &&
        !item.lngLat
      ) {
        return {
          ...item,
          evidence: {
            ...item.evidence,
            status: "needs_verification",
            label: "地点证据未能匹配到完整 POI，出发前核验名称与位置",
          },
        };
      }

      return item;
    }

    return {
      ...item,
      name: provider.poi.name,
      poiId: provider.poi.id ?? item.poiId,
      address: provider.poi.address ?? item.address,
      lngLat: provider.poi.lngLat ?? item.lngLat,
      evidence: provider.evidence,
    };
  }

  return {
    ...weatherEnriched,
    attractions: weatherEnriched.attractions.map(addProviderEvidence),
    lodging: weatherEnriched.lodging.map(addProviderEvidence),
    food: weatherEnriched.food.map(addProviderEvidence),
  };
}

export function formatPlanningFailureMessage(error: unknown) {
  if (error instanceof AgentRunTimeoutError) {
    return "规划失败：智能体规划超时，请稍后重试。";
  }

  if (error instanceof AgentConversationLimitError) {
    return `规划失败：${error.message}`;
  }

  if (error instanceof Error) {
    const knownMessages: Record<string, string> = {
      "Agent run aborted.": "规划失败：智能体运行已中止。",
      "timeoutMs must be greater than zero.":
        "规划失败：内部运行超时配置无效。",
      "maxAttempts must be greater than zero.":
        "规划失败：内部重试配置无效。",
      "Agent planning failed after all attempts.":
        "规划失败：多次尝试后仍未完成，请稍后重试。",
    };

    return knownMessages[error.message] ?? `规划失败：${error.message}`;
  }

  return "规划失败：请稍后重试。";
}

async function createAssistantMessage(input: {
  sessionId: string;
  content: string;
  metadata?: unknown;
  signal?: AbortSignal;
}) {
  assertAgentRunActive(input.signal);
  const message = await prisma.agentMessage.create({
    data: {
      agentSessionId: input.sessionId,
      role: "assistant",
      content: input.content,
      metadataJson:
        input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
    },
  });
  assertAgentRunActive(input.signal);
  return message;
}

function objectParameters(
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function arrayOfItems(items: Record<string, unknown>) {
  return {
    type: "array",
    items,
  };
}

const bufferComponentSchema = objectParameters(
  {
    category: { type: "string" },
    label: { type: "string" },
    minutes: { type: "number" },
    reason: { type: "string" },
    source: {
      type: "string",
      enum: [
        "agent_inference",
        "user_setting",
        "memory",
        "weather_context",
        "manual_override",
      ],
    },
  },
  ["category", "label", "minutes", "reason"]
);

const stopSchema = objectParameters(
  {
    order: { type: "number" },
    name: { type: "string" },
    address: { type: "string" },
    lngLat: { type: "string" },
    targetArriveAt: { type: "string" },
    plannedStayMin: { type: "number" },
    kind: { type: "string" },
    notes: { type: "string" },
  },
  ["name"]
);

const legSchema = objectParameters(
  {
    order: { type: "number" },
    originName: { type: "string" },
    originLngLat: { type: "string" },
    destinationName: { type: "string" },
    destinationLngLat: { type: "string" },
    routeMinutes: { type: "number" },
    bufferMinutes: { type: "number" },
    totalMinutes: { type: "number" },
    bufferComponents: arrayOfItems(bufferComponentSchema),
    latestDepartAt: { type: "string" },
    targetArriveAt: { type: "string" },
    mode: { type: "string" },
    routeTitle: { type: "string" },
    routeRationale: { type: "string" },
    segmentTitle: { type: "string" },
    segmentDetail: { type: "string" },
    segmentSource: { type: "string" },
    source: { type: "object" },
  },
  [
    "originName",
    "originLngLat",
    "destinationName",
    "routeMinutes",
    "bufferComponents",
  ]
);

const travelWeatherForecastSchema = objectParameters(
  {
    date: { type: "string" },
    day: { type: "number" },
    location: { type: "string" },
    summary: { type: "string" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    drivingAdvice: { type: "string" },
    outdoorAdvice: { type: "string" },
  },
  ["summary"]
);

const travelWeatherRouteRiskSchema = objectParameters(
  {
    legOrder: { type: "number" },
    day: { type: "number" },
    date: { type: "string" },
    route: { type: "string" },
    summary: { type: "string" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    drivingAdvice: { type: "string" },
    action: { type: "string" },
  },
  ["legOrder", "route", "summary", "risk", "drivingAdvice", "action"]
);

const travelWeatherSchema = objectParameters(
  {
    city: { type: "string" },
    summary: { type: "string" },
    advice: { type: "string" },
    source: { type: "string" },
    observedAt: { type: "string" },
    forecastAvailableThrough: { type: "string" },
    dynamicMonitoring: { type: "boolean" },
    refreshPolicy: { type: "string" },
    forecast: arrayOfItems(travelWeatherForecastSchema),
    routeRisks: arrayOfItems(travelWeatherRouteRiskSchema),
  },
  [
    "city",
    "summary",
    "advice",
    "dynamicMonitoring",
    "refreshPolicy",
    "forecast",
    "routeRisks",
  ]
);

const travelTransportOptionSchema = objectParameters(
  {
    summary: { type: "string" },
    reason: { type: "string" },
    durationMinutes: { type: "number" },
    route: { type: "string" },
  },
  ["summary", "reason", "durationMinutes", "route"]
);

const travelTransportSchema = objectParameters(
  {
    recommended: {
      type: "string",
      enum: ["driving", "transit", "mixed"],
    },
    reason: { type: "string" },
    driving: travelTransportOptionSchema,
    transit: travelTransportOptionSchema,
    localMovement: { type: "string" },
  },
  ["recommended", "reason", "driving", "transit"]
);

const travelBudgetItemSchema = objectParameters(
  {
    category: { type: "string" },
    amount: { type: "string" },
    notes: { type: "string" },
  },
  ["category", "amount"]
);

const travelBudgetSchema = objectParameters(
  {
    currency: { type: "string" },
    total: { type: "string" },
    breakdown: arrayOfItems(travelBudgetItemSchema),
    assumptions: { type: "string" },
  },
  ["currency", "total", "breakdown"]
);

const travelRecommendationEvidenceSchema = objectParameters(
  {
    source: {
      type: "string",
      enum: [
        "amap_poi",
        "amap_route",
        "amap_weather",
        "agent_inference",
        "user_input",
      ],
    },
    status: {
      type: "string",
      enum: ["provider_reference", "needs_verification"],
    },
    label: { type: "string" },
    observedAt: { type: "string" },
    note: { type: "string" },
  },
  ["source"]
);

const travelAttractionSchema = objectParameters(
  {
    name: { type: "string" },
    category: { type: "string", enum: ["natural", "cultural"] },
    reason: { type: "string" },
    naturalType: { type: "string", enum: [...CANONICAL_NATURAL_TYPES] },
    address: { type: "string" },
    lngLat: { type: "string" },
    day: { type: "number" },
    stayMinutes: { type: "number" },
    bestTime: { type: "string" },
    weatherNote: { type: "string" },
    notes: { type: "string" },
    evidence: travelRecommendationEvidenceSchema,
  },
  ["name", "category", "reason"]
);

const travelLodgingSchema = objectParameters(
  {
    name: { type: "string" },
    area: { type: "string" },
    reason: { type: "string" },
    poiId: { type: "string" },
    address: { type: "string" },
    lngLat: { type: "string" },
    budget: { type: "string" },
    notes: { type: "string" },
    evidence: travelRecommendationEvidenceSchema,
  },
  ["name", "area", "reason"]
);

const travelFoodSchema = objectParameters(
  {
    name: { type: "string" },
    area: { type: "string" },
    mustTry: { type: "string" },
    reason: { type: "string" },
    poiId: { type: "string" },
    address: { type: "string" },
    lngLat: { type: "string" },
    budget: { type: "string" },
    notes: { type: "string" },
    evidence: travelRecommendationEvidenceSchema,
  },
  ["name", "mustTry", "reason"]
);

const travelPitfallSchema = objectParameters(
  {
    title: { type: "string" },
    detail: { type: "string" },
    severity: { type: "string", enum: ["high", "medium", "low"] },
  },
  ["title", "detail"]
);

const travelPlanSchema = objectParameters(
  {
    destination: { type: "string" },
    summary: { type: "string" },
    days: { type: "number" },
    weather: travelWeatherSchema,
    transport: travelTransportSchema,
    budget: travelBudgetSchema,
    attractions: arrayOfItems(travelAttractionSchema),
    lodging: arrayOfItems(travelLodgingSchema),
    food: arrayOfItems(travelFoodSchema),
    pitfalls: arrayOfItems(travelPitfallSchema),
  },
  [
    "destination",
    "summary",
    "weather",
    "transport",
    "budget",
    "attractions",
    "lodging",
    "food",
    "pitfalls",
  ]
);

// DeepSeek V4 Flash is more reliable when large recommendation arrays are
// siblings of the route object instead of deeply nested inside it. The server
// folds these fields back into the canonical TravelPlan before validation.
const travelPlanCreateCoreSchema = objectParameters(
  {
    destination: { type: "string" },
    summary: { type: "string" },
    days: { type: "number" },
    weather: travelWeatherSchema,
    transport: travelTransportSchema,
  },
  ["destination", "summary", "weather", "transport"]
);

const TOOL_DEFINITIONS: AgentChatToolDefinition[] = [
  {
    name: "read_settings",
    description:
      "Read the user's city, timezone, selected planning model, default origin, and route preference.",
    parameters: objectParameters({}),
  },
  {
    name: "read_memories",
    description: "Read confirmed commute memories and preferences.",
    parameters: objectParameters({}),
  },
  {
    name: "search_poi",
    description: "Search AMap POIs by keyword.",
    parameters: objectParameters(
      {
        keywords: { type: "string" },
        city: { type: "string" },
      },
      ["keywords"]
    ),
  },
  {
    name: "search_natural_attractions",
    description:
      "Search and deduplicate a broad set of natural-attraction candidates in one call. The application searches mountain, lake, forest, wetland, coast, canyon, waterfall, park, and viewpoint keywords. Use this before choosing natural attractions; return at least three distinct candidates when the destination has enough options.",
    parameters: objectParameters(
      {
        city: { type: "string" },
        limit: { type: "number" },
      },
      []
    ),
  },
  {
    name: "get_poi_detail",
    description: "Read AMap POI details.",
    parameters: objectParameters({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "get_weather_reference",
    description:
      "Read live weather plus the available multi-day forecast from AMap. Use the forecast for each itinerary day and route segment; call it again during route rechecks because weather is dynamic evidence, not a static label.",
    parameters: objectParameters({ city: { type: "string" } }, ["city"]),
  },
  {
    name: "get_transit_route",
    description:
      "Query AMap transit route. origin and destination must be lng,lat coordinates; use search_poi to resolve place names first.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "get_driving_route",
    description:
      "Query AMap driving route for self-drive comparison. origin and destination must be lng,lat coordinates; use search_poi to resolve place names first.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "get_walking_route",
    description:
      "Query AMap walking route. origin and destination must be lng,lat coordinates; use search_poi to resolve place names first.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "get_bicycling_route",
    description:
      "Query AMap bicycling route. origin and destination must be lng,lat coordinates; use search_poi to resolve place names first.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "create_trip",
    description:
      "Create the final planned trip after the AI has gathered evidence and made a decision.",
    parameters: objectParameters(
      {
        title: { type: "string" },
        timezone: { type: "string" },
        targetArriveAt: { type: "string" },
        finalStopName: { type: "string" },
        stops: arrayOfItems(stopSchema),
        legs: arrayOfItems(legSchema),
        travelPlan: travelPlanSchema,
      },
      ["title", "timezone", "stops", "legs"]
    ),
  },
  {
    name: "read_current_trip",
    description:
      "Read the current trip with stops, legs, route candidates, buffers, segments, and reminders.",
    parameters: objectParameters({ tripId: { type: "string" } }),
  },
  {
    name: "update_trip_summary",
    description:
      "Update the current trip summary: title, final stop, target arrival, and status.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      status: { type: "string" },
      travelPlan: travelPlanSchema,
    }),
  },
  {
    name: "replace_trip_stops",
    description:
      "Replace trip stops. Provide legs too to rebuild the complete route transactionally.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      stops: arrayOfItems(stopSchema),
      legs: arrayOfItems(legSchema),
      travelPlan: travelPlanSchema,
    }),
  },
  {
    name: "replace_trip_legs",
    description:
      "Replace trip legs. Provide stops too to rebuild the complete route transactionally.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      stops: arrayOfItems(stopSchema),
      legs: arrayOfItems(legSchema),
      travelPlan: travelPlanSchema,
    }),
  },
  {
    name: "select_route_candidate",
    description: "Select an existing route candidate for a trip leg.",
    parameters: objectParameters({
      tripId: { type: "string" },
      legId: { type: "string" },
      legOrder: { type: "number" },
      candidateId: { type: "string" },
      candidateKey: { type: "string" },
    }),
  },
  {
    name: "replace_reminder_schedule",
    description: "Regenerate reminder jobs from the current latest departure times.",
    parameters: objectParameters({
      tripId: { type: "string" },
      legId: { type: "string" },
      legOrder: { type: "number" },
      cadenceMinutes: arrayOfItems({ type: "number" }),
    }),
  },
  {
    name: "cancel_trip_monitoring",
    description: "Cancel monitoring for the current trip and scheduled reminders.",
    parameters: objectParameters({ tripId: { type: "string" } }),
  },
  {
    name: "create_memory_candidate",
    description: "Create a pending memory candidate for user confirmation.",
    parameters: objectParameters(
      {
        tripId: { type: "string" },
        kind: { type: "string" },
        label: { type: "string" },
        valueJson: {},
      },
      ["kind", "label", "valueJson"]
    ),
  },
];

export function getAgentToolDefinitions(purpose: AgentPlanningPurpose) {
  if (purpose !== "travel") {
    return TOOL_DEFINITIONS;
  }

  return TOOL_DEFINITIONS.map((tool) => {
    if (tool.name !== "create_trip") {
      return tool;
    }

    return {
      ...tool,
      description:
        "Create the final planned trip. In travel mode, provide destination, summary, weather, and transport inside travelPlan; provide budget, attractions, lodging, food, and pitfalls as top-level sibling fields. The server folds those fields into travelPlan before validation. Keep the recommendation arrays compact and complete in this same tool call.",
      parameters: objectParameters(
        {
          title: { type: "string" },
          timezone: { type: "string" },
          targetArriveAt: { type: "string" },
          finalStopName: { type: "string" },
          stops: arrayOfItems(stopSchema),
          legs: arrayOfItems(legSchema),
          travelPlan: travelPlanCreateCoreSchema,
          budget: travelBudgetSchema,
          attractions: arrayOfItems(travelAttractionSchema),
          lodging: arrayOfItems(travelLodgingSchema),
          food: arrayOfItems(travelFoodSchema),
          pitfalls: arrayOfItems(travelPitfallSchema),
        },
        [
          "title",
          "timezone",
          "stops",
          "legs",
          "travelPlan",
          "budget",
          "attractions",
          "lodging",
          "food",
          "pitfalls",
        ]
      ),
    };
  });
}

const COMMUTE_SYSTEM_PROMPT = `You are a personal commute-planning AI. Current dates should be interpreted in Beijing time.
You must plan, calculate, compare, and decide yourself. The app only exposes tools; it will not hard-code route ranking, destination extraction, or buffer minutes for you.
Available tools include user settings, memories, all AMap POI/weather/transit/driving/walking/bicycling tools, create_trip, and current-route update tools. Keep the evidence pass bounded and move to create_trip as soon as the required evidence is available. Weather, route results, user preferences, and memories are evidence for your decision, not fixed app rules.
Before calling get_transit_route, get_driving_route, get_walking_route, or get_bicycling_route, provide origin and destination as lng,lat coordinates. Never pass place names directly; call search_poi first and use a returned lngLat value.
When the user does not explicitly say where to start, use the default origin from read_settings. When the user says they are starting from "我现在的位置", "当前位置", or similar, use the current-location context if it is provided.
You should actively adapt to weather evidence. In 恶劣天气 such as heavy rain, storms, extreme heat, strong wind, or snow, compare options with less exposed walking or bicycling when possible. If you still choose 长距离步行 or bicycling in bad weather, explain why it remains acceptable, and reflect the weather impact in route rationale and bufferComponents with meaningful minutes when extra time is needed.
Actively capture stable user preferences. When the user says phrases such as 我习惯, 我偏好, 我不喜欢, 以后都, 通常, or similar durable commute habits, call create_memory_candidate with a concise label and structured valueJson so the user can confirm it later.
Final user-facing replies must be plain text without Markdown formatting, headings, code ticks, or list markers.`;

const TRAVEL_SYSTEM_PROMPT = `You are a personal travel-itinerary planning AI. Current dates should be interpreted in Beijing time.
Plan a practical, evidence-aware trip rather than a generic list of attractions. Parse the destination, dates, number of days, origin, budget, pace, party, and constraints from the user's request. Ask for missing value-critical details only when the request cannot be safely planned; otherwise make a reasonable choice and state it in the result. If the user gives a date range but no clock time, schedule daytime driving by default: first-day departure around 07:00, later sightseeing days around 08:00, and the final long return around 06:30. Never schedule a driving leg across midnight or put a leg outside the requested date range. If the user gives an explicit daily self-drive ceiling such as "每天自驾不超过 6 小时", treat it as a hard constraint on the sum of all driving route minutes on each calendar day, not merely the longest individual leg; before create_trip, add every driving leg on the same date and leave a small safety margin below the limit. Count local hotel transfers too. A lodging recommendation does not by itself need to become a stop or an extra driving leg; if the day already ends at a scenic stop, use that stop as the overnight endpoint when it is practical, or move/delete the extra transfer after recalculating the dated legs. If the tool rejects the plan, use the returned per-leg budget diagnosis and change the actual stops, route legs, dates, and lodging continuity; never repeat the same stops/legs or only change a day marker in prose. Split the transfer to another day, add an overnight stop, shorten the route, or remove a remote attraction when necessary. Keep a normal driving day near eight hours when no stricter user ceiling exists; if the fixed dates make that impossible, state the high-intensity tradeoff and recommend adding a night instead of hiding it. When the user asks to drive in daylight, avoid night driving proactively and use the destination's sunset as a safety boundary.
Use read_settings for the default city, timezone, and origin, and use the current-location context when the user says they are starting from their current position. Call get_weather_reference early: its result contains live weather and the available multi-day forecast. Weather is dynamic evidence, not a static label or guarantee. Map the forecast to each itinerary day, populate weather.forecast, and add weather.routeRisks for every self-drive leg, including short local shuttles, using the 1-based leg order with drivingAdvice and a concrete action. If a route segment has no specific forecast evidence, mark it as unknown and require a refresh instead of omitting it. Set dynamicMonitoring to true and state a refreshPolicy such as rechecking before departure and at every scheduled route review. If the forecast horizon does not cover the trip, explicitly mark the later days as unknown and require a refresh before departure.
Self-driving is a time-varying process. Before calling get_transit_route, get_driving_route, get_walking_route, or get_bicycling_route, resolve both endpoints to lng,lat coordinates with search_poi. Compare self-drive and public transit whenever the route is meaningfully comparable. Use get_driving_route for self-drive and get_transit_route for public transit, then choose driving, transit, or mixed with a reason. Treat route duration and weather as snapshots: avoid claiming that a route is guaranteed, and make bad-weather actions explicit, such as postponing an exposed segment, switching to transit, adding indoor stops, or checking road and parking conditions again.
Natural scenery is a hard output requirement, not an optional extra. Call search_natural_attractions once before selecting attractions. It searches multiple nature categories for you. Recommend at least three distinct natural candidates for a one-to-three-day trip, at least four for a trip of four days or longer, and at least one cultural candidate. Cover different natural types when the destination supports them, such as mountain, lake, forest, wetland, coast, island, canyon, waterfall, park, or viewpoint, and set naturalType for every natural candidate using canonical English labels such as lake, wetland, grassland, mountain, river, volcanic, or park. If the user says “优先自然风光/自然景观” or equivalent, at least two natural attractions for a short trip and at least four for a trip of four days or longer must be concrete stops in the main route, with adjacent legs and usable stay time; do not leave most natural attractions as alternatives. If the user explicitly names natural types, put at least one supported attraction of each requested type into the main route: add that attraction as a stop and connect it with adjacent legs. Listing it only as an attraction recommendation, alternative, or narrative mention does not satisfy the request. Never use a generic label such as other or unknown when the attraction name or reason identifies a type. The application rejects a travel plan that has too few natural candidates, too little type diversity, or too few planned natural stops for a natural-priority request, so do not stop after finding one scenic spot. Use the evidence returned by tools; do not invent venue-specific facts.
Search POIs before naming specific lodging or food venues. Explain the reason for every attraction, its best visiting time, suggested stay, and weather note. Add an evidence object to every attraction, lodging, and food recommendation: use source amap_poi only when it comes from a POI search, otherwise use agent_inference; mark prices, opening times, availability, and AI-only suggestions as needs_verification. Search practical lodging areas and local food options. Add at least three concrete pitfalls covering tickets/reservations, peak periods, parking or transit, weather, road conditions, and other destination-specific friction when relevant. The budget is mandatory: provide a total range and a breakdown for lodging, food, fuel/charging, tolls, tickets and other meaningful costs; mark uncertain prices as pending verification and state the assumptions such as party size and vehicle type.
For a normal one-to-three-day request, keep evidence bounded but sufficient: make one initial weather call, one broad natural-attraction search, at most ten representative attraction or practical-place keyword searches plus one lodging and one food keyword, and call each main driving/transit comparison at most once. For trips of four days or longer, use one broad natural-attraction search, at most eight additional POI keyword searches, one practical lodging search, one food search, and one route call per unique itinerary leg; reuse coordinates and equivalent results already returned instead of searching again. Once you have the weather forecast, enough natural candidates, a cultural candidate, lodging, food, and both transport options, stop searching and immediately call create_trip. Do not search every possible option or repeat an equivalent route call. Keep create_trip arguments compact: use at most six natural attractions, three cultural attractions, four lodging suggestions, four food suggestions, and eight pitfalls; keep narrative fields concise, avoid repeating the same route or weather fact, provide exactly one route risk per self-drive leg, and never copy raw provider payloads into tool arguments.
The create_trip call is mandatory. In travel mode it must include a complete travelPlan object with destination, summary, weather including forecast and routeRisks, transport.driving, transport.transit, budget, attractions, lodging, food, and pitfalls. Stops and legs must form a chronological itinerary; every leg must include explicit latestDepartAt and targetArriveAt in the requested date range, with no cross-midnight driving. For a multi-stop travel plan, provide exactly one leg for every adjacent pair in stops, and make each leg's originName/originLngLat match stops[i] and destinationName/destinationLngLat match stops[i+1]. Include lodging and attraction waypoints in stops when a leg starts or ends there; never rely on a text-only endpoint that is absent from stops. If you provide explicit leg times, keep them consistent and chronological; otherwise use D1/Day1/第1天 markers in segmentTitle, routeTitle, routeRationale, or stop notes so the server can safely group legs by calendar day. Never put a day marker such as D1, Day1, or 第1天 into a date field such as latestDepartAt, targetArriveAt, or a stop targetArriveAt. If the next natural day starts from a scenic stop, explicitly mark lodging at that stop or add the previous day's return-to-city leg and lodging stop; do not rely on a narrative claim that the traveler returned. Use stop notes for day/order context and route rationale for transport decisions. Every travel leg gets a weather refresh task one hour before departure; the first leg also gets 72-hour and 24-hour refresh tasks. During a later route recheck, call get_weather_reference again before deciding. If weather, traffic, or road conditions change, update the route and pass the refreshed travelPlan to update_trip_summary or replace_trip_stops/replace_trip_legs so the visible plan stays consistent. If the server rejects a create or replacement because a daylight-driving leg arrives after the local sunset safety line, because the total driving minutes on a day exceed the user's explicit daily ceiling, or because a cross-day scenic stop lacks an overnight or return connection, do not repeat the same route: add the missing stop/leg or revise the dates and call the route tool again.
Final user-facing replies must be plain text without Markdown formatting, headings, code ticks, or list markers.`;

function getSystemPrompt(purpose: AgentPlanningPurpose) {
  return purpose === "travel" ? TRAVEL_SYSTEM_PROMPT : COMMUTE_SYSTEM_PROMPT;
}

function buildCurrentLocationContext(
  currentLocation: StartPlanningSessionInput["currentLocation"]
) {
  if (!currentLocation?.name || !currentLocation.lngLat) {
    return null;
  }

  return [
    "当前定位上下文：",
    `名称：${currentLocation.name}`,
    `坐标：${currentLocation.lngLat}`,
    currentLocation.city ? `城市：${currentLocation.city}` : null,
    "如果用户说从我现在的位置、当前位置或类似表达出发，请使用这个位置；如果用户没有说明出发点，请继续使用 read_settings 中的默认出发点。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function createInitialMessages(
  session: {
    id: string;
    prompt: string;
    userId: string;
    purpose: string;
  },
  attempt: number
) {
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const sessionContextMessages = await prisma.agentMessage.findMany({
    where: { agentSessionId: session.id, role: "system" },
    orderBy: { createdAt: "asc" },
  });
  const messages: AgentChatMessage[] = [
    {
      role: "system",
      content: getSystemPrompt(session.purpose === "travel" ? "travel" : "planning"),
    },
    { role: "system", content: memoryContext },
    ...sessionContextMessages.map((message) => ({
      role: "system" as const,
      content: message.content,
    })),
    {
      role: "user",
      content: `第 ${attempt} 次规划尝试：${session.prompt}`,
    },
  ];

  return messages;
}

async function createContinuationMessages(session: {
  id: string;
  prompt: string;
  userId: string;
  tripId: string | null;
  purpose: string;
}) {
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const persistedMessages = await prisma.agentMessage.findMany({
    where: { agentSessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  const messages: AgentChatMessage[] = [
    {
      role: "system",
      content: getSystemPrompt(session.purpose === "travel" ? "travel" : "planning"),
    },
    { role: "system", content: memoryContext },
    {
      role: "system",
      content:
        "Continue the existing planning session. All planning and route update tools are available. Keep the evidence pass bounded and stop after the requested route update is complete. If a current trip exists, use route update tools to revise it instead of assuming the app will update it for you.",
    },
    {
      role: "system",
      content: `Original planning prompt: ${session.prompt}. Current trip id: ${
        session.tripId ?? "none"
      }.`,
    },
  ];

  for (const message of persistedMessages) {
    if (
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant"
    ) {
      messages.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  return messages;
}

function getToolName(name: string): AgentToolName {
  const allowed = new Set(
    TOOL_DEFINITIONS.map((tool) => tool.name as AgentToolName)
  );

  if (!allowed.has(name as AgentToolName)) {
    throw new Error(`Unknown agent tool: ${name}`);
  }

  return name as AgentToolName;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  fallback?: string
) {
  const raw = value[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing string tool argument: ${key}`);
}

function readOptionalString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function readOptionalNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Tool argument ${key} must be a number.`);
  }

  return numeric;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const numeric = readOptionalNumber(value, key);
  if (numeric === undefined) {
    throw new Error(`Missing number tool argument: ${key}`);
  }

  return numeric;
}

function readOptionalDate(
  value: Record<string, unknown>,
  key: string,
  timezone?: string,
  options: { allowDayMarker?: boolean } = {}
) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  if (options.allowDayMarker && isTravelDayMarker(raw)) {
    return undefined;
  }

  const date = timezone ? parseDateTimeInTimeZone(raw, timezone) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Tool argument ${key} is not a valid date.`);
  }

  return date;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const raw = value[key];
  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

function readOptionalArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

function normalizeLngLat(value: string) {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const normalized = parts.join(",");
  if (!LNG_LAT_PATTERN.test(normalized)) {
    return null;
  }

  const [lng, lat] = parts.map(Number);
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null;
  }

  return normalized;
}

function normalizeCacheValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  if (Array.isArray(value)) {
    return value.map(normalizeCacheValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeCacheValue(nested)])
    );
  }

  return value;
}

function getToolCacheKey(name: AgentToolName, request: unknown) {
  if (
    name !== "search_poi" &&
    name !== "search_natural_attractions" &&
    name !== "get_poi_detail" &&
    name !== "get_transit_route" &&
    name !== "get_driving_route" &&
    name !== "get_walking_route" &&
    name !== "get_bicycling_route"
  ) {
    return null;
  }

  return `${name}:${JSON.stringify(normalizeCacheValue(request))}`;
}

function createTravelEvidenceBudget(
  purpose: AgentPlanningPurpose,
  prompt: string
): TravelEvidenceBudget | undefined {
  if (purpose !== "travel") return undefined;

  const range = parseTravelDateRange(prompt);
  const start = range ? new Date(`${range.startDate}T00:00:00Z`) : null;
  const end = range ? new Date(`${range.endDate}T00:00:00Z`) : null;
  const dayCount =
    start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
      ? Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
      : 0;

  return {
    maxDirectPoiSearches: dayCount >= 4 ? 8 : 10,
    directPoiSearches: 0,
    exhaustionNudgeSent: false,
  };
}

async function recordCachedToolCall<T>(input: {
  context: ToolExecutionContext;
  name: AgentToolName;
  request: unknown;
  run: () => Promise<T>;
}) {
  const cacheKey = getToolCacheKey(input.name, input.request);
  if (!cacheKey) {
    return recordToolCall({
      agentSessionId: input.context.sessionId,
      name: input.name,
      request: input.request,
      signal: input.context.signal,
      run: input.run,
    });
  }

  if (input.context.toolResultCache.has(cacheKey)) {
    return recordToolCall({
      agentSessionId: input.context.sessionId,
      name: input.name,
      request: input.request,
      signal: input.context.signal,
      run: async () => input.context.toolResultCache.get(cacheKey) as T,
    });
  }

  const result = await recordToolCall({
    agentSessionId: input.context.sessionId,
    name: input.name,
    request: input.request,
    signal: input.context.signal,
    run: input.run,
  });
  input.context.toolResultCache.set(cacheKey, result);
  return result;
}

async function resolveRouteEndpoint(input: {
  value: string;
  label: "origin" | "destination";
  city: string;
  context: ToolExecutionContext;
}) {
  const coordinate = normalizeLngLat(input.value);
  if (coordinate) {
    return coordinate;
  }

  const request = {
    keywords: input.value,
    city: input.city,
  };
  const pois = await recordCachedToolCall({
    context: input.context,
    name: "search_poi",
    request,
    run: () => input.context.amap.searchPoi(request),
  });
  const resolved = pois
    .map((poi) => normalizeLngLat(poi.lngLat))
    .find((lngLat): lngLat is string => Boolean(lngLat));

  if (!resolved) {
    throw new Error(
      `Unable to resolve route ${input.label} "${input.value}" to lng,lat coordinates.`
    );
  }

  return resolved;
}

function normalizeBufferComponent(value: unknown): BufferComponentInput {
  const component = requireObject(value, "bufferComponents[]");
  return {
    category: readString(component, "category"),
    label: readString(component, "label"),
    minutes: readNumber(component, "minutes"),
    reason: readString(component, "reason"),
    source: readOptionalString(component, "source") as
      | BufferComponentInput["source"]
      | undefined,
  };
}

function normalizeStop(value: unknown, timezone?: string): PlannedTripStopInput {
  const stop = requireObject(value, "stops[]");
  return {
    order: readOptionalNumber(stop, "order"),
    name: readString(stop, "name"),
    address: readOptionalString(stop, "address"),
    lngLat: readOptionalString(stop, "lngLat"),
    targetArriveAt: readOptionalDate(stop, "targetArriveAt", timezone, {
      allowDayMarker: true,
    }),
    plannedStayMin: readOptionalNumber(stop, "plannedStayMin"),
    kind: readOptionalString(stop, "kind"),
    notes: readOptionalString(stop, "notes"),
  };
}

function normalizeRouteEvidence(value: unknown): TravelRouteLegEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const durationMinutes = Number(record.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return undefined;
  }

  const source = record.source === "amap_route" ? "amap_route" : "agent_estimate";
  const status =
    record.status === "provider_verified" ? "provider_verified" : "estimated";
  return {
    source,
    status,
    durationMinutes: Math.round(durationMinutes),
    modelDurationMinutes:
      record.modelDurationMinutes === undefined
        ? undefined
        : Number(record.modelDurationMinutes),
    safetyMarginMinutes: Math.max(0, Math.round(Number(record.safetyMarginMinutes) || 0)),
    observedAt: readOptionalString(record, "observedAt"),
    summary: readOptionalString(record, "summary") ?? "路线时长证据",
    note: readOptionalString(record, "note") ?? "出发前重新核验路线。",
    origin: readOptionalString(record, "origin"),
    destination: readOptionalString(record, "destination"),
  };
}

function normalizeLeg(value: unknown, timezone?: string): PlannedTripLegInput {
  const leg = requireObject(value, "legs[]");
  return {
    order: readOptionalNumber(leg, "order"),
    originName: readOptionalString(leg, "originName"),
    originLngLat: readOptionalString(leg, "originLngLat"),
    destinationName: readOptionalString(leg, "destinationName"),
    destinationLngLat: readOptionalString(leg, "destinationLngLat"),
    routeMinutes: readNumber(leg, "routeMinutes"),
    bufferMinutes: readOptionalNumber(leg, "bufferMinutes"),
    totalMinutes: readOptionalNumber(leg, "totalMinutes"),
    bufferComponents: readArray(leg, "bufferComponents").map(
      normalizeBufferComponent
    ),
    latestDepartAt: readOptionalDate(leg, "latestDepartAt", timezone, {
      allowDayMarker: true,
    }),
    targetArriveAt: readOptionalDate(leg, "targetArriveAt", timezone, {
      allowDayMarker: true,
    }),
    mode: readOptionalString(leg, "mode"),
    routeTitle: readOptionalString(leg, "routeTitle"),
    routeRationale: readOptionalString(leg, "routeRationale"),
    segmentTitle: readOptionalString(leg, "segmentTitle"),
    segmentDetail: readOptionalString(leg, "segmentDetail"),
    segmentSource: readOptionalString(leg, "segmentSource"),
    source: leg.source,
    routeEvidence: normalizeRouteEvidence(leg.routeEvidence),
  };
}

function isTravelDrivingLeg(leg: PlannedTripLegInput) {
  return /driving|drive|car|驾车|自驾|开车|驾驶/i.test(
    [leg.mode, leg.routeTitle, leg.segmentTitle, leg.segmentDetail]
      .filter(Boolean)
      .join(" ")
  );
}

function getTravelDrivingLegOrders(legs: PlannedTripLegInput[]) {
  return legs.reduce<number[]>((orders, leg, index) => {
    if (isTravelDrivingLeg(leg)) {
      orders.push(index + 1);
    }
    return orders;
  }, []);
}

function isTravelTransportValidationError(error: unknown) {
  return (
    error instanceof Error && error.message.includes("travelPlan.transport")
  );
}

function parseTravelTransportRouteEvidence(
  responseJson: string | null,
  label: "driving" | "transit"
) {
  if (!responseJson) return undefined;

  try {
    const response = JSON.parse(responseJson) as Record<string, unknown>;
    const durationMinutes = Number(response.durationMinutes);
    const summary =
      typeof response.summary === "string" ? response.summary.trim() : "";
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || !summary) {
      return undefined;
    }

    return {
      durationMinutes: Math.round(durationMinutes),
      summary,
      label,
    };
  } catch {
    return undefined;
  }
}

async function loadTravelTransportEvidence(sessionId: string) {
  const calls = await prisma.agentToolCall.findMany({
    where: {
      agentSessionId: sessionId,
      name: { in: ["get_driving_route", "get_transit_route"] },
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
  });
  let driving;
  let transit;

  for (const call of calls) {
    if (!driving && call.name === "get_driving_route") {
      driving = parseTravelTransportRouteEvidence(
        call.responseJson,
        "driving"
      );
    }
    if (!transit && call.name === "get_transit_route") {
      transit = parseTravelTransportRouteEvidence(
        call.responseJson,
        "transit"
      );
    }
    if (driving && transit) break;
  }

  return driving && transit
    ? ({ driving, transit } satisfies TravelTransportEvidence)
    : undefined;
}

type CompletedDrivingRouteEvidence = {
  origin?: string;
  destination?: string;
  requestedOrigin?: string;
  requestedDestination?: string;
  durationMinutes: number;
  summary: string;
  observedAt: string;
};

function parseRecordJson(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function optionalRecordString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

async function loadTravelDrivingRouteEvidence(
  sessionId: string
): Promise<CompletedDrivingRouteEvidence[]> {
  const calls = await prisma.agentToolCall.findMany({
    where: {
      agentSessionId: sessionId,
      name: "get_driving_route",
      status: "completed",
    },
    orderBy: { createdAt: "asc" },
    select: { requestJson: true, responseJson: true, createdAt: true },
  });

  return calls.flatMap((call) => {
    const request = parseRecordJson(call.requestJson);
    const response = parseRecordJson(call.responseJson);
    const durationMinutes = Number(response.durationMinutes);
    const summary = optionalRecordString(response, "summary");
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || !summary) {
      return [];
    }

    return [
      {
        origin:
          optionalRecordString(response, "origin", "resolvedOrigin") ??
          optionalRecordString(request, "origin"),
        destination:
          optionalRecordString(response, "destination", "resolvedDestination") ??
          optionalRecordString(request, "destination"),
        requestedOrigin:
          optionalRecordString(response, "requestedOrigin") ??
          optionalRecordString(request, "origin"),
        requestedDestination:
          optionalRecordString(response, "requestedDestination") ??
          optionalRecordString(request, "destination"),
        durationMinutes: Math.round(durationMinutes),
        summary,
        observedAt: call.createdAt.toISOString(),
      },
    ];
  });
}

function normalizeRoutePlace(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s（）()【】［］[\]·•,，。:：/\\_\-—→到至]/g, "");
}

function routeCoordinate(value?: string | null) {
  const normalized = value ? normalizeLngLat(value) : null;
  if (!normalized) return undefined;
  return normalized.split(",").map(Number) as [number, number];
}

function sameRouteEndpoint(
  legName: string | undefined,
  legLngLat: string | undefined,
  candidateName: string | undefined,
  candidateLngLat: string | undefined
) {
  const left = routeCoordinate(legLngLat);
  const right = routeCoordinate(candidateLngLat);
  if (left && right) {
    return Math.abs(left[0] - right[0]) < 0.01 && Math.abs(left[1] - right[1]) < 0.01;
  }

  const normalizedLeft = normalizeRoutePlace(legName);
  const normalizedRight = normalizeRoutePlace(candidateName);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    (Math.min(normalizedLeft.length, normalizedRight.length) >= 3 &&
      (normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft)))
  );
}

function routeEvidenceMatches(
  leg: PlannedTripLegInput,
  evidence: CompletedDrivingRouteEvidence
) {
  const originMatches = sameRouteEndpoint(
    leg.originName,
    leg.originLngLat,
    evidence.requestedOrigin,
    evidence.origin
  );
  const destinationMatches = sameRouteEndpoint(
    leg.destinationName,
    leg.destinationLngLat,
    evidence.requestedDestination,
    evidence.destination
  );

  return originMatches && destinationMatches;
}

function estimatedRouteSafetyMargin(routeMinutes: number) {
  return Math.max(15, Math.min(45, Math.ceil(Math.max(1, routeMinutes) * 0.15)));
}

function sourceWithRouteEvidence(
  source: unknown,
  routeEvidence: TravelRouteLegEvidence
) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return { ...(source as Record<string, unknown>), routeEvidence };
  }

  return {
    ...(source === undefined ? {} : { modelSource: source }),
    routeEvidence,
  };
}

function legBufferMinutes(leg: PlannedTripLegInput) {
  return Math.max(
    0,
    Math.round(
      leg.bufferMinutes ??
        (leg.bufferComponents ?? []).reduce(
          (total, component) => total + Math.max(0, Math.round(component.minutes)),
          0
        )
    )
  );
}

async function annotateTravelRouteEvidence(
  legs: PlannedTripLegInput[],
  sessionId: string
) {
  const evidence = await loadTravelDrivingRouteEvidence(sessionId);
  const usedEvidence = new Set<number>();

  const annotatedLegs = legs.map((leg) => {
    if (!isTravelDrivingLeg(leg) || leg.routeMinutes <= 0) return leg;

    const matchIndex = evidence.findIndex(
      (candidate, index) =>
        !usedEvidence.has(index) && routeEvidenceMatches(leg, candidate)
    );
    const bufferMinutes = legBufferMinutes(leg);

    if (matchIndex >= 0) {
      usedEvidence.add(matchIndex);
      const matched = evidence[matchIndex];
      const routeEvidence: TravelRouteLegEvidence = {
        source: "amap_route",
        status: "provider_verified",
        durationMinutes: matched.durationMinutes,
        modelDurationMinutes: Math.round(leg.routeMinutes),
        safetyMarginMinutes: 0,
        observedAt: matched.observedAt,
        summary: matched.summary,
        note: "已匹配同一起终点的高德驾车路线；出发前仍需刷新实时路况和道路管制。",
        origin: matched.origin,
        destination: matched.destination,
      };

      const routeMinutes = matched.durationMinutes;
      return {
        ...leg,
        routeMinutes,
        totalMinutes: Math.max(
          routeMinutes + bufferMinutes,
          Math.round(leg.totalMinutes ?? 0)
        ),
        routeEvidence,
        source: sourceWithRouteEvidence(leg.source, routeEvidence),
      };
    }

    const modelDurationMinutes = Math.max(0, Math.round(leg.routeMinutes));
    const safetyMarginMinutes = estimatedRouteSafetyMargin(modelDurationMinutes);
    const routeMinutes = modelDurationMinutes;
    const routeEvidence: TravelRouteLegEvidence = {
      source: "agent_estimate",
      status: "estimated",
      durationMinutes: routeMinutes,
      modelDurationMinutes,
      safetyMarginMinutes,
      summary: `模型估算约 ${modelDurationMinutes} 分钟，已加入 ${safetyMarginMinutes} 分钟安全余量`,
      note: "本段没有匹配到同一起终点的高德驾车路线；详情页、油费/过路费和出发时间均需出发前用地图重新核验。",
    };

    const safetyMarginComponent: BufferComponentInput = {
      category: "route_evidence",
      label: "未验证路线安全余量",
      minutes: safetyMarginMinutes,
      reason:
        "该段没有匹配到同一起终点的高德路线，先为模型估算保留安全余量；出发前应使用地图实测替换。",
      source: "agent_inference",
    };
    const bufferComponents = [
      ...(leg.bufferComponents ?? []),
      safetyMarginComponent,
    ];
    const adjustedBufferMinutes = bufferMinutes + safetyMarginMinutes;

    return {
      ...leg,
      bufferComponents,
      bufferMinutes: adjustedBufferMinutes,
      routeMinutes,
      totalMinutes: Math.max(
        routeMinutes + adjustedBufferMinutes,
        Math.round(leg.totalMinutes ?? 0)
      ),
      routeEvidence,
      source: sourceWithRouteEvidence(leg.source, routeEvidence),
    };
  });

  return {
    legs: annotatedLegs,
    evidence: summarizeTravelRouteEvidence(annotatedLegs),
  };
}

function attachRouteEvidenceSummary(
  plan: TravelPlan,
  summary: ReturnType<typeof summarizeTravelRouteEvidence>
) {
  if (!summary) return plan;

  const existingAssumptions = plan.budget?.assumptions?.trim();
  const assumptions = [existingAssumptions, summary.note]
    .filter(Boolean)
    .join("；");

  return {
    ...plan,
    routeEvidence: summary,
    budget: plan.budget
      ? { ...plan.budget, assumptions }
      : plan.budget,
  };
}

async function normalizeTravelPlanForContext(
  value: unknown,
  context: ToolExecutionContext
) {
  try {
    return normalizeTravelPlan(value);
  } catch (error) {
    if (context.purpose !== "travel" || !isTravelTransportValidationError(error)) {
      throw error;
    }

    const evidence = await loadTravelTransportEvidence(context.sessionId);
    if (!evidence) {
      throw error;
    }

    return normalizeTravelPlan(
      completeTravelPlanTransportPayload(value, evidence)
    );
  }
}

function completeTravelPlanArgument(args: Record<string, unknown>) {
  return completeTravelPlanArrayPayload(args.travelPlan, {
    attractions: args.attractions,
      lodging: args.lodging,
      food: args.food,
      pitfalls: args.pitfalls,
      budget: args.budget,
    });
}

async function normalizeCreateTripInput(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  settings: PlanningSettings
): Promise<CreatePlannedTripInput> {
  const travelPlanArgument =
    args.travelPlan === undefined
      ? undefined
      : completeTravelPlanArgument(args);
  let travelPlan =
    travelPlanArgument === undefined
      ? undefined
      : await normalizeTravelPlanForContext(travelPlanArgument, context);

  if (context.purpose === "travel" && !travelPlan) {
    throw new Error("旅行规划必须提供结构化 travelPlan。");
  }

  if (context.purpose === "travel" && travelPlan) {
    assertTravelPlanAttractionCoverage(travelPlan);
    assertTravelPlanBudget(travelPlan);
  }

  const timezone = readString(args, "timezone", settings.timezone);
  const stops = readArray(args, "stops").map((stop) =>
    normalizeStop(stop, timezone)
  );
  let legs = readArray(args, "legs").map((leg) =>
    normalizeLeg(leg, timezone)
  );
  if (context.purpose === "travel" && travelPlan) {
    const routeEvidence = await annotateTravelRouteEvidence(
      legs,
      context.sessionId
    );
    legs = routeEvidence.legs;
    travelPlan = attachRouteEvidenceSummary(travelPlan, routeEvidence.evidence);
  }
  const initialTargetArriveAt = readOptionalDate(
    args,
    "targetArriveAt",
    timezone,
    { allowDayMarker: context.purpose === "travel" }
  );
  const schedule =
    context.purpose === "travel" && travelPlan
      ? normalizeTravelItinerarySchedule({
          prompt: context.prompt,
          timezone,
          targetArriveAt: initialTargetArriveAt,
          stops,
          legs,
        })
      : {
          targetArriveAt: initialTargetArriveAt,
          stops,
          legs,
          dateRange: undefined,
        };
  if (context.purpose === "travel" && travelPlan) {
    const operationalTravelPlan = ensureTravelPlanRouteRiskCoverage(
      travelPlan,
      schedule.legs,
      timezone,
      context.prompt
    );
    assertTravelPlanOperationalCompleteness(operationalTravelPlan, {
      drivingLegOrders: getTravelDrivingLegOrders(schedule.legs),
    });
    travelPlan = operationalTravelPlan;
  }
  const travelPlanWithEvidence =
    context.purpose === "travel" && travelPlan
      ? await enrichTravelPlanWithToolEvidence(
          travelPlan,
          context.sessionId
        )
      : travelPlan;
  const queriedWeatherLocations =
    context.purpose === "travel" && travelPlan
      ? await loadCompletedWeatherReferenceCities(context.sessionId)
      : [];
  const normalizedTravelPlan =
    context.purpose === "travel" && travelPlan
      ? alignTravelPlanPitfallsWithSchedule(
          addTravelSchedulePitfall(
            ensureTravelPlanWeatherLocations(
              ensureTravelPlanWeatherCoverage(
                travelPlanWithEvidence!,
                schedule.dateRange
              ),
              schedule.stops,
              queriedWeatherLocations
            ),
            schedule.legs,
            timezone
          ),
          schedule.legs,
          context.prompt,
          timezone
        )
      : travelPlanWithEvidence;

  const alignedTravelPlan =
    context.purpose === "travel" && normalizedTravelPlan
      ? alignTravelPlanAttractionsWithRoute(
          normalizedTravelPlan,
          schedule.stops,
          schedule.legs,
          context.prompt
        )
      : normalizedTravelPlan;

  if (context.purpose === "travel" && alignedTravelPlan) {
    assertTravelPlanAttractionCoverage(alignedTravelPlan, {
      prompt: context.prompt,
      requirePlannedRequestedTypes: true,
    });
    assertTravelItinerarySchedule({
      prompt: context.prompt,
      timezone,
      stops: schedule.stops,
      legs: schedule.legs,
      lodging: alignedTravelPlan.lodging,
    });
  }

  return {
    userId: context.userId,
    agentSessionId: context.sessionId,
    rawPrompt: context.prompt,
    timezone,
    title: readString(args, "title"),
    targetArriveAt: schedule.targetArriveAt,
    finalStopName: readOptionalString(args, "finalStopName"),
    stops: schedule.stops,
    legs: schedule.legs,
    travelPlan: alignedTravelPlan,
  };
}

function readTripId(args: Record<string, unknown>, context: ToolExecutionContext) {
  const tripId = readOptionalString(args, "tripId") ?? context.tripId;
  if (!tripId) {
    throw new Error("The current session has no associated trip.");
  }

  return tripId;
}

async function readCurrentTrip(context: ToolExecutionContext, tripId: string) {
  return recordToolCall({
    agentSessionId: context.sessionId,
    name: "read_current_trip",
    request: { tripId },
    signal: context.signal,
    run: () =>
      prisma.trip.findFirstOrThrow({
        where: { id: tripId, userId: context.userId },
        include: {
          stops: { orderBy: { order: "asc" } },
          legs: {
            orderBy: { order: "asc" },
            include: {
              selectedCandidate: true,
              routeCandidates: { orderBy: { createdAt: "asc" } },
              routeSegments: { orderBy: { order: "asc" } },
              bufferComponents: { orderBy: { order: "asc" } },
              reminderJobs: { orderBy: { scheduledFor: "asc" } },
            },
          },
          reminderJobs: { orderBy: { scheduledFor: "asc" } },
        },
      }),
  });
}

async function loadCurrentRouteInputs(tripId: string, userId: string) {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, userId },
    include: {
      stops: { orderBy: { order: "asc" } },
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          bufferComponents: { orderBy: { order: "asc" } },
          routeSegments: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  return {
    trip,
    stops: trip.stops.map((stop) => ({
      order: stop.order,
      name: stop.name,
      address: stop.address ?? undefined,
      lngLat: stop.lngLat ?? undefined,
      targetArriveAt: stop.targetArriveAt ?? undefined,
      plannedStayMin: stop.plannedStayMin ?? undefined,
      kind: stop.kind,
      notes: stop.notes ?? undefined,
    })),
    legs: trip.legs.map((leg) => {
      const persistedSource = parseRecordJson(
        leg.selectedCandidate?.sourceJson
      );
      return {
        order: leg.order,
        originName: leg.originName,
        originLngLat: leg.originLngLat,
        destinationName: leg.destinationName,
        destinationLngLat: leg.destinationLngLat ?? undefined,
        routeMinutes: leg.selectedCandidate?.routeMinutes ?? 30,
        bufferMinutes: leg.selectedCandidate?.bufferMinutes ?? undefined,
        totalMinutes: leg.selectedCandidate?.totalMinutes ?? undefined,
        latestDepartAt: leg.latestDepartAt ?? undefined,
        targetArriveAt: leg.targetArriveAt ?? undefined,
        mode: leg.selectedCandidate?.mode ?? undefined,
        routeTitle: leg.selectedCandidate?.title ?? undefined,
        routeRationale: leg.selectedCandidate?.rationale ?? undefined,
        segmentTitle: leg.routeSegments[0]?.title,
        segmentDetail: leg.routeSegments[0]?.detail ?? undefined,
        segmentSource: leg.routeSegments[0]?.source,
        source: persistedSource,
        routeEvidence: normalizeRouteEvidence(persistedSource.routeEvidence),
        bufferComponents: leg.bufferComponents.map((component) => ({
          category: component.category,
          label: component.label,
          minutes: component.minutes,
          reason: component.reason,
          source: component.source as BufferComponentInput["source"],
        })),
      };
    }),
  };
}

async function normalizeReplaceRouteInput(
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  const tripId = readTripId(args, context);
  const current = await loadCurrentRouteInputs(tripId, context.userId);
  const timezone = current.trip.timezone;
  const stopArgs = readOptionalArray(args, "stops");
  const legArgs = readOptionalArray(args, "legs");
  const stops = stopArgs
    ? stopArgs.map((stop) => normalizeStop(stop, timezone))
    : current.stops;
  let legs = legArgs
    ? legArgs.map((leg) => normalizeLeg(leg, timezone))
    : current.legs;
  let travelPlan =
    args.travelPlan === undefined
      ? parseTravelPlanJson(current.trip.travelPlanJson)
      : await normalizeTravelPlanForContext(
          completeTravelPlanArgument(args),
          context
        );

  if (context.purpose === "travel" && travelPlan && legArgs) {
    const routeEvidence = await annotateTravelRouteEvidence(
      legs,
      context.sessionId
    );
    legs = routeEvidence.legs;
    travelPlan = attachRouteEvidenceSummary(travelPlan, routeEvidence.evidence);
  }

  if (context.purpose === "travel" && travelPlan) {
    assertTravelPlanAttractionCoverage(travelPlan);
    if (args.travelPlan !== undefined) {
      assertTravelPlanBudget(travelPlan);
    }
  }

  if (!stops.length || !legs.length) {
    throw new Error(
      "Replacing stops or legs requires complete route data or an existing route to merge with."
    );
  }

  const initialTargetArriveAt =
    readOptionalDate(args, "targetArriveAt", timezone, {
      allowDayMarker: context.purpose === "travel",
    }) ??
    current.trip.targetArriveAt ??
    undefined;
  const schedule =
    context.purpose === "travel" && travelPlan
      ? normalizeTravelItinerarySchedule({
          prompt: context.prompt,
          timezone: current.trip.timezone,
          targetArriveAt: initialTargetArriveAt,
          stops,
          legs,
        })
      : {
          targetArriveAt: initialTargetArriveAt,
          stops,
          legs,
          dateRange: undefined,
        };
  if (context.purpose === "travel" && travelPlan) {
    const operationalTravelPlan = ensureTravelPlanRouteRiskCoverage(
      travelPlan,
      schedule.legs,
      current.trip.timezone,
      context.prompt
    );
    assertTravelPlanOperationalCompleteness(operationalTravelPlan, {
      drivingLegOrders: getTravelDrivingLegOrders(schedule.legs),
    });
    travelPlan = operationalTravelPlan;
  }
  const travelPlanWithEvidence =
    context.purpose === "travel" && travelPlan
      ? await enrichTravelPlanWithToolEvidence(
          travelPlan,
          context.sessionId
        )
      : travelPlan;
  const queriedWeatherLocations =
    context.purpose === "travel" && travelPlan
      ? await loadCompletedWeatherReferenceCities(context.sessionId)
      : [];
  const normalizedTravelPlan =
    context.purpose === "travel" && travelPlan
      ? alignTravelPlanPitfallsWithSchedule(
          addTravelSchedulePitfall(
            ensureTravelPlanWeatherLocations(
              ensureTravelPlanWeatherCoverage(
                travelPlanWithEvidence!,
                schedule.dateRange
              ),
              schedule.stops,
              queriedWeatherLocations
            ),
            schedule.legs,
            current.trip.timezone
          ),
          schedule.legs,
          context.prompt,
          current.trip.timezone
        )
      : travelPlanWithEvidence;

  const alignedTravelPlan =
    context.purpose === "travel" && normalizedTravelPlan
      ? alignTravelPlanAttractionsWithRoute(
          normalizedTravelPlan,
          schedule.stops,
          schedule.legs,
          context.prompt
        )
      : normalizedTravelPlan;

  if (context.purpose === "travel" && alignedTravelPlan) {
    assertTravelPlanAttractionCoverage(alignedTravelPlan, {
      prompt: context.prompt,
      requirePlannedRequestedTypes: true,
    });
    assertTravelItinerarySchedule({
      prompt: context.prompt,
      timezone: current.trip.timezone,
      stops: schedule.stops,
      legs: schedule.legs,
      lodging: alignedTravelPlan.lodging,
    });
  }

  return {
    tripId,
    userId: context.userId,
    title: readOptionalString(args, "title") ?? current.trip.title,
    finalStopName:
      readOptionalString(args, "finalStopName") ??
      current.trip.finalStopName ??
      legs[legs.length - 1]?.destinationName ??
      stops[stops.length - 1]?.name,
    targetArriveAt: schedule.targetArriveAt,
    status: readOptionalString(args, "status") ?? "monitoring",
    stops: schedule.stops,
    legs: schedule.legs,
    travelPlan: alignedTravelPlan ?? undefined,
  };
}

async function readSettings(context: ToolExecutionContext) {
  return recordToolCall({
    agentSessionId: context.sessionId,
    name: "read_settings",
    request: { userId: context.userId },
    signal: context.signal,
    run: async () => {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: context.userId },
      });

      return settings ? normalizePlanningSettings(settings) : fallbackSettings();
    },
  });
}

async function loadPlanningSettings(userId: string): Promise<PlanningSettings> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  return settings ? normalizePlanningSettings(settings) : fallbackSettings();
}

async function executeToolCall(
  toolCall: AgentChatToolCall,
  context: ToolExecutionContext,
  settings: PlanningSettings
) {
  const name = getToolName(toolCall.name);
  const args = requireObject(toolCall.arguments, `${name} arguments`);
  const amap = context.amap;

  if (name === "read_settings") {
    return readSettings(context);
  }

  if (name === "read_memories") {
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request: { userId: context.userId },
      signal: context.signal,
      run: async () =>
        prisma.memory.findMany({
          where: { userId: context.userId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
    });
  }

  if (name === "search_poi") {
    const request = {
      keywords: readString(args, "keywords"),
      city: readOptionalString(args, "city") ?? settings.defaultCity,
    };

    const cacheKey = getToolCacheKey(name, request);
    const budget = context.travelEvidenceBudget;
    if (
      budget &&
      cacheKey &&
      !context.toolResultCache.has(cacheKey)
    ) {
      if (budget.directPoiSearches >= budget.maxDirectPoiSearches) {
        const exhaustedResult = {
          kind: "budget_exhausted",
          candidates: [],
          instruction:
            "本次旅行的地点检索预算已用完。不要再次调用 search_poi；请使用已经返回的地点证据，继续查询路线或立即调用 create_trip。",
        };
        context.toolResultCache.set(cacheKey, exhaustedResult);
        return recordToolCall({
          agentSessionId: context.sessionId,
          name,
          request,
          signal: context.signal,
          run: async () => exhaustedResult,
        });
      }

      budget.directPoiSearches += 1;
    }

    return recordCachedToolCall({
      context,
      name,
      request,
      run: () => amap.searchPoi(request),
    });
  }

  if (name === "search_natural_attractions") {
    const city = readOptionalString(args, "city") ?? settings.defaultCity;
    const requestedLimit = readOptionalNumber(args, "limit") ?? 12;
    const limit = Math.min(12, Math.max(3, requestedLimit));

    const request = {
        city,
        limit,
        keywordGroups: NATURAL_ATTRACTION_SEARCH_GROUPS,
      };

    return recordCachedToolCall({
      context,
      name,
      request,
      run: async () => {
        const batches = await Promise.all(
          NATURAL_ATTRACTION_SEARCH_GROUPS.map((keywords) =>
            amap.searchPoi({ keywords, city })
          )
        );
        const seen = new Set<string>();

        return batches
          .flat()
          .filter((poi) => {
            const key = poi.id || `${poi.name}:${poi.lngLat}`;
            if (seen.has(key)) {
              return false;
            }

            seen.add(key);
            return true;
          })
          .slice(0, limit);
      },
    });
  }

  if (name === "get_poi_detail") {
    const request = { id: readString(args, "id") };
    return recordCachedToolCall({
      context,
      name,
      request,
      run: () => amap.getPoiDetail(request),
    });
  }

  if (name === "get_weather_reference") {
    const request = {
      city: readOptionalString(args, "city") ?? settings.defaultCity,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => amap.getWeather(request),
    });
  }

  if (
    name === "get_transit_route" ||
    name === "get_driving_route" ||
    name === "get_walking_route" ||
    name === "get_bicycling_route"
  ) {
    const originInput = firstNonEmptyString(
      readOptionalString(args, "origin"),
      settings.originLngLat
    );
    const request = {
      origin: originInput ?? "",
      destination: readString(args, "destination"),
      city: readOptionalString(args, "city") ?? settings.defaultCity,
      cityd: readOptionalString(args, "cityd") ?? settings.defaultCity,
    };
    const route = (resolvedRequest: typeof request) =>
      name === "get_transit_route"
        ? amap.getTransitRoute(resolvedRequest)
        : name === "get_driving_route"
          ? amap.getDrivingRoute(resolvedRequest)
        : name === "get_walking_route"
          ? amap.getWalkingRoute(resolvedRequest)
          : amap.getBicyclingRoute(resolvedRequest);

    return recordCachedToolCall({
      context,
      name,
      request,
      run: async () => {
        if (!request.origin) {
          throw new Error(ORIGIN_REQUIRED_MESSAGE);
        }

        const resolvedRequest = {
          ...request,
          origin: await resolveRouteEndpoint({
            value: request.origin,
            label: "origin",
            city: request.city,
            context,
          }),
          destination: await resolveRouteEndpoint({
            value: request.destination,
            label: "destination",
            city: request.cityd,
            context,
          }),
        };

        const result = await route(resolvedRequest);
        return {
          ...result,
          origin: resolvedRequest.origin,
          destination: resolvedRequest.destination,
          requestedOrigin: request.origin,
          requestedDestination: request.destination,
        };
      },
    });
  }

  if (name === "read_current_trip") {
    return readCurrentTrip(context, readTripId(args, context));
  }

  if (name === "update_trip_summary") {
    const tripId = readTripId(args, context);
    let travelPlan =
      args.travelPlan === undefined
        ? undefined
        : ensureTravelPlanWeatherCoverage(
            await enrichTravelPlanWithToolEvidence(
              normalizeTravelPlan(completeTravelPlanArgument(args)),
              context.sessionId
            ),
            parseTravelDateRange(context.prompt) ?? undefined
          );

    if (context.purpose === "travel" && travelPlan) {
      const current = await loadCurrentRouteInputs(tripId, context.userId);
      const queriedWeatherLocations =
        await loadCompletedWeatherReferenceCities(context.sessionId);
      travelPlan = ensureTravelPlanWeatherLocations(
        travelPlan,
        current.stops,
        queriedWeatherLocations
      );
      travelPlan = alignTravelPlanAttractionsWithRoute(
        travelPlan,
        current.stops,
        current.legs,
        context.prompt
      );
      travelPlan = alignTravelPlanPitfallsWithSchedule(
        travelPlan,
        current.legs,
        context.prompt,
        current.trip.timezone
      );
    }

    if (context.purpose === "travel" && travelPlan) {
      assertTravelPlanAttractionCoverage(travelPlan, {
        prompt: context.prompt,
        requirePlannedRequestedTypes: true,
      });
      assertTravelPlanBudget(travelPlan);
      assertTravelPlanOperationalCompleteness(travelPlan);
    }

    const request = {
      tripId,
      userId: context.userId,
      title: readOptionalString(args, "title"),
      finalStopName: readOptionalString(args, "finalStopName"),
      targetArriveAt: readOptionalDate(
        args,
        "targetArriveAt",
        settings.timezone,
        { allowDayMarker: context.purpose === "travel" }
      ),
      status: readOptionalString(args, "status"),
      travelPlan,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => updateTripSummary(request),
    });
  }

  if (name === "replace_trip_stops" || name === "replace_trip_legs") {
    const request = await normalizeReplaceRouteInput(args, context);
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: async () => {
        const updated = await replaceTripRoute(request);
        context.tripId = updated.id;
        return updated;
      },
    });
  }

  if (name === "select_route_candidate") {
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
      legId: readOptionalString(args, "legId"),
      legOrder: readOptionalNumber(args, "legOrder"),
      candidateId: readOptionalString(args, "candidateId"),
      candidateKey: readOptionalString(args, "candidateKey"),
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => selectRouteCandidate(request),
    });
  }

  if (name === "replace_reminder_schedule") {
    const cadence = readOptionalArray(args, "cadenceMinutes")?.map((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error("cadenceMinutes must contain only numbers.");
      }
      return numeric;
    });
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
      legId: readOptionalString(args, "legId"),
      legOrder: readOptionalNumber(args, "legOrder"),
      cadenceMinutes: cadence,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => replaceReminderSchedule(request),
    });
  }

  if (name === "cancel_trip_monitoring") {
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => cancelTripMonitoring(request),
    });
  }

  if (name === "create_memory_candidate") {
    const request = {
      tripId: readOptionalString(args, "tripId") ?? context.tripId,
      userId: context.userId,
      kind: readString(args, "kind"),
      label: readString(args, "label"),
      valueJson: args.valueJson,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => createMemoryCandidateForTrip(request),
    });
  }

  let createdTripId: string | null = null;

  try {
    return await recordToolCall({
      agentSessionId: context.sessionId,
      name: "create_trip",
      request: args,
      signal: context.signal,
      run: async () => {
        const input = await normalizeCreateTripInput(args, context, settings);
        const created = await createPlannedTrip(input);
        createdTripId = created.id;
        assertAgentRunActive(context.signal);
        return created;
      },
    });
  } catch (error) {
    if (createdTripId && context.signal?.aborted) {
      await prisma.trip
        .delete({ where: { id: createdTripId } })
        .catch(() => undefined);
    }

    throw error;
  }
}

export function stringifyToolResult(result: unknown) {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (_key === "raw") {
      return undefined;
    }

    return value;
  });
}

export function stringifyToolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let instruction =
    "工具调用未执行成功。请根据错误修正参数后重新调用同一个工具，不要只返回文字。";
  let recovery:
    | {
        constraintType:
          | "daylight_driving"
          | "daily_driving_limit"
          | "overnight_continuity";
        mustChange: string[];
        preserve: string[];
      }
    | undefined;

  if (
    message.includes("不能把这段夜间自驾落盘") ||
    (message.includes("日落") && message.includes("安全线"))
  ) {
    instruction =
      "本次 create_trip 因白天驾驶安全线被拒绝。下一次调用必须实际改变对应 stops 和 legs：提前出发或提前返程并在安全线前到达，或增加途中住宿拆分路段，或缩短/删除远端景点；不能重复被拒的到达时间和路线。travelPlan 的天气、景点、住宿、美食、预算和避坑可以沿用，只需同步变更后的自驾路段天气风险。请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "daylight_driving",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
      ],
    };
  } else if (
    message.includes("停靠点和路段数量不一致") ||
    message.includes("与相邻停靠点")
  ) {
    instruction =
      "本次旅行路线因 stops 与 legs 端点不连续而未落盘。下一次必须实际修正结构：按 stops 的顺序让每一段连接相邻停靠点，给景点或住宿补入缺失 stop，或删除不在路线中的 stop/leg；每个 leg 的 originName/originLngLat 必须对应 stops[i]，destinationName/destinationLngLat 必须对应 stops[i+1]。保留完整 travelPlan 的天气、交通、景点、住宿、美食、预算和避坑后立即重新调用完整 create_trip。";
  } else if (
    message.includes("跨自然日") &&
    message.includes("住宿")
  ) {
    instruction =
      "本次 create_trip 因跨自然日路线缺少住宿或返城连接而未落盘。下一次调用必须实际修改对应 stops 和 legs：如果下一自然日从景点继续出发，补充景点附近住宿，并在该景点 stop 和 lodging 推荐中明确对应安排；或者在前一日的 legs 中显式加入返回城市的连接段及住宿 stop。不能只修改说明文字或继续沿用缺失的路线连接；请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "overnight_continuity",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
      ],
    };
  } else if (message.includes("超过用户指定的每日上限")) {
    instruction =
      "本次 create_trip 因单日自驾总时长超过用户上限被拒绝。先读取 error 中列出的日期、累计分钟数和逐段违规路段，重新逐段相加并留出安全余量。下一次调用必须实际改变对应 stops、legs、日期和住宿连续性：把转场拆到下一天并在实际停靠点安排住宿，或减少/删除远端景点；住宿推荐不等于必须新增一段本地驾车，不能只改文字、segmentTitle 或重复同一组 stops/legs。travelPlan 的其他完整区块可以沿用，并同步变更后的自驾路段天气风险。请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "daily_driving_limit",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
      ],
    };
  } else if (
    message.includes("用户明确要求的自然景观类型") &&
    message.includes("已有候选")
  ) {
    instruction =
      "本次 create_trip 因用户点名的自然景观类型已有候选，但候选没有进入主路线。保留完整 travelPlan 和已有证据，把该类型的一个真实候选加入 stops，并在 stops 的相邻 legs 中实际经过；不要只把它留在 attractions、alternativeAttractions 或文字说明中。同步补齐对应 routeRisks，保持日期、住宿连接和每日驾驶上限可执行，然后立即重新调用完整 create_trip。";
  } else if (message.includes("自然风光优先要求")) {
    instruction =
      "本次 create_trip 因用户要求优先自然风光，但主路线中的自然景点数量不足。保留上一版完整 travelPlan、住宿、美食、预算和避坑，把足够数量的真实自然景点从 attractions 加入 stops，并为每个新增 stop 增加相邻 legs、停留时间和对应 routeRisks；不要只修改 routeCoverage 或文字说明。重新检查每日驾驶上限、白天驾驶和跨日住宿连接后，立即重新调用完整 create_trip。";
  } else if (message.includes("旅行规划的自然景观至少需要覆盖")) {
    instruction =
      "本次 create_trip 的自然景观类型校验失败。请保留完整 travelPlan 和路线，仅修正每个自然景点的 naturalType：使用 lake、wetland、grassland、mountain、river、volcanic、forest、canyon、waterfall、park 或 viewpoint 等规范英文类型；不要使用 other、unknown 或把所有景点写成同一种类型。类型也必须能从景点名称、理由或检索证据得到支持。请立即重新调用完整 create_trip。";
  } else if (message.includes("必须提供总预算")) {
    instruction =
      "上一版旅行计划的住宿、美食、景点、天气和路线可以保留；本次只需补齐 travelPlan.budget。budget 必须是对象，包含 currency、total 和至少一项 breakdown（每项含 category、amount；未知价格写明待核实），不能只把 budget 放在 travelPlan 外。请立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.weather.summary")) {
    instruction =
      "保留上一版完整 travelPlan 的 destination、weather、transport、budget、attractions、lodging、food、pitfalls；只修正 weather.summary。weather.summary 必须是非空纯文本字符串，不能省略 weather 或 transport，不能把对象写成字符串。请立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.weather")) {
    instruction =
      "保留上一版完整 travelPlan；weather 必须是对象，包含 city、summary、advice、dynamicMonitoring、refreshPolicy、forecast、routeRisks。不要只提交 weather 或 stops/legs，压缩文字后立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.transport")) {
    instruction =
      "保留上一版完整 travelPlan；transport 必须是对象，包含 recommended、reason、driving、transit，且 driving/transit 各自包含 summary、reason、durationMinutes、route。不要只提交 transport 或 stops/legs，立即重新调用完整 create_trip。";
  } else if (
    message.includes("travelPlan.attractions") ||
    message.includes("travelPlan.lodging") ||
    message.includes("travelPlan.food") ||
    message.includes("travelPlan.pitfalls")
  ) {
    instruction =
      "本次 create_trip 缺少旅行推荐数组。请保留 travelPlan.destination、summary、weather、transport 和现有 stops/legs；在 create_trip 顶层补齐 budget、attractions、lodging、food、pitfalls 五个字段。attractions 至少包含 4 个自然景观和 1 个人文景点，lodging、food 各至少 1 项，pitfalls 至少 3 项；数组要精简但不能省略，立即重新调用完整 create_trip。";
  } else if (message.includes("结构化 travelPlan") || message.includes("travelPlan.")) {
    instruction =
      "旅行模式的 create_trip 必须在本次调用中包含完整旅行计划：travelPlan 内提供 destination、summary、weather、transport；create_trip 顶层提供 budget、attractions、lodging、food、pitfalls。不要只提交 stops 和 legs；请压缩文字后立即重新调用一次完整 create_trip。";
  }

  return JSON.stringify({
    error: message,
    instruction,
    ...(recovery ? { recovery } : {}),
  });
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingCandidateValue(value: unknown) {
  return value === undefined || value === null;
}

function candidateArrayItemKey(value: unknown) {
  if (!isRecordValue(value)) return undefined;

  if (typeof value.name === "string" && value.name.trim()) {
    return `name:${value.name.trim().toLowerCase()}`;
  }

  if (typeof value.title === "string" && value.title.trim()) {
    return `title:${value.title.trim().toLowerCase()}`;
  }

  if (typeof value.date === "string" && value.date.trim()) {
    return `date:${value.date.trim()}`;
  }

  if (typeof value.legOrder === "number" && Number.isFinite(value.legOrder)) {
    return `leg:${value.legOrder}`;
  }

  if (typeof value.category === "string" && value.category.trim()) {
    return `category:${value.category.trim().toLowerCase()}`;
  }

  return undefined;
}

function mergeCreateTripCandidateValue(
  previous: unknown,
  current: unknown,
  path: string
): unknown {
  if (isMissingCandidateValue(current)) {
    return previous;
  }

  if (isRecordValue(previous) && isRecordValue(current)) {
    const merged: Record<string, unknown> = { ...previous };
    for (const [key, value] of Object.entries(current)) {
      merged[key] = mergeCreateTripCandidateValue(
        previous[key],
        value,
        path ? `${path}.${key}` : key
      );
    }
    return merged;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    const usedPreviousIndexes = new Set<number>();
    const mergedCurrent = current.map((currentItem, index) => {
      const currentKey = candidateArrayItemKey(currentItem);
      let previousIndex = currentKey
        ? previous.findIndex(
            (previousItem, previousItemIndex) =>
              !usedPreviousIndexes.has(previousItemIndex) &&
              candidateArrayItemKey(previousItem) === currentKey
          )
        : -1;

      if (previousIndex < 0 && !currentKey && index < previous.length) {
        previousIndex = index;
      }

      if (previousIndex < 0) {
        return currentItem;
      }

      usedPreviousIndexes.add(previousIndex);
      return mergeCreateTripCandidateValue(
        previous[previousIndex],
        currentItem,
        `${path}[${index}]`
      );
    });

    // Route risks are keyed to the current route. Keeping an unreferenced old
    // risk would make a route replacement look weather-covered when it is not.
    if (path.endsWith("weather.routeRisks")) {
      return mergedCurrent;
    }

    // Recommendation and forecast arrays may be truncated by a model repair.
    // Retain unmentioned prior items so coverage validation still sees the
    // previously complete candidate; explicit current items always win.
    return [
      ...mergedCurrent,
      ...previous.filter((_, index) => !usedPreviousIndexes.has(index)),
    ];
  }

  return current;
}

function mergeCreateTripCandidate(
  previous: Record<string, unknown>,
  current: Record<string, unknown>
) {
  const merged = mergeCreateTripCandidateValue(previous, current, "") as Record<
    string,
    unknown
  >;

  // A route repair is the model's explicit decision. Never merge stop/leg
  // items by index, because doing so could silently restore the unsafe route.
  for (const key of ["stops", "legs"] as const) {
    if (Array.isArray(current[key])) {
      merged[key] = current[key];
    } else if (isMissingCandidateValue(current[key])) {
      merged[key] = previous[key];
    }
  }

  return merged;
}

const CONTINUATION_COMPLETION_TOOL_NAMES = new Set([
  "replace_trip_stops",
  "replace_trip_legs",
  "cancel_trip_monitoring",
]);

function shouldCompleteContinuationAfterTools(
  toolCalls: AgentChatToolCall[],
  requireCreateTrip: boolean
) {
  return (
    !requireCreateTrip &&
    toolCalls.some((toolCall) =>
      CONTINUATION_COMPLETION_TOOL_NAMES.has(toolCall.name)
    )
  );
}

async function runConversationAttempt(input: {
  sessionId: string;
  context: ToolExecutionContext;
  settings: PlanningSettings;
  messages: AgentChatMessage[];
  chatClient: AgentChatClient;
  signal?: AbortSignal;
  requireCreateTrip: boolean;
}) {
  let latestTripId = input.context.tripId ?? null;
  let forceCreateTrip = false;
  let forceCreateTripFallbackUsed = false;
  let conversationRounds = 0;
  let createTripFailureCount = 0;
  let lastToolExecutionError: unknown = null;
  let lastCreateTripCandidate: Record<string, unknown> | null = null;
  const identicalCreateTripFailures = new Map<string, number>();

  function noteCreateTripFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    createTripFailureCount += 1;
    const sameFailureCount =
      (identicalCreateTripFailures.get(message) ?? 0) + 1;
    identicalCreateTripFailures.set(message, sameFailureCount);

    if (
      createTripFailureCount >= MAX_CREATE_TRIP_FAILURES ||
      sameFailureCount >= MAX_IDENTICAL_CREATE_TRIP_FAILURES
    ) {
      throw new AgentConversationLimitError(
        sameFailureCount >= MAX_IDENTICAL_CREATE_TRIP_FAILURES
          ? `create_trip 连续收到相同的结构化校验错误，已停止重复请求：${message}`
          : `create_trip 已连续失败 ${createTripFailureCount} 次，已停止重复请求。最后一次错误：${message}`
      );
    }
  }

  while (true) {
    assertAgentRunActive(input.signal);
    conversationRounds += 1;
    const maxRounds = MAX_CONVERSATION_ROUNDS[input.context.purpose];
    if (conversationRounds > maxRounds) {
      throw new AgentConversationLimitError(
        `${input.context.purpose === "travel" ? "旅行" : "通勤"}规划超过 ${maxRounds} 轮对话仍未完成，已停止重复调用工具；请缩短需求或稍后重试。`
      );
    }
    let completion;

    try {
      completion = await input.chatClient.complete({
        messages: input.messages,
        tools: getAgentToolDefinitions(input.context.purpose),
        purpose: input.context.purpose,
        maxOutputTokens:
          input.context.purpose === "travel"
            ? TRAVEL_MAX_OUTPUT_TOKENS
            : undefined,
        model:
          input.context.purpose === "travel"
            ? TRAVEL_PLANNING_MODEL
            : input.settings.model,
        toolChoice: forceCreateTrip && input.context.purpose !== "travel"
          ? { type: "function", function: { name: "create_trip" } }
          : undefined,
        signal: input.signal,
      });
    } catch (error) {
      if (forceCreateTrip && !forceCreateTripFallbackUsed) {
        forceCreateTrip = false;
        forceCreateTripFallbackUsed = true;
        input.messages.push({
          role: "user",
          content:
            "工具调用校验：请立即调用 create_trip 落地当前完整方案；不要只返回文字。",
        });
        continue;
      }

      if (lastToolExecutionError) {
        const toolError =
          lastToolExecutionError instanceof Error
            ? lastToolExecutionError.message
            : String(lastToolExecutionError);
        throw new Error(
          `工具调用失败：${toolError}；模型未能继续修正：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      throw error;
    }
    const assistantMessage = completion.message;
    input.messages.push(assistantMessage);

    await createAssistantMessage({
      sessionId: input.sessionId,
      signal: input.signal,
      content: assistantMessage.content || "AI 已请求调用工具。",
      metadata: {
        toolCalls: assistantMessage.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
        })),
      },
    });

    const toolCalls = assistantMessage.toolCalls ?? [];
    if (toolCalls.length === 0) {
      if (
        input.requireCreateTrip &&
        !forceCreateTrip &&
        !forceCreateTripFallbackUsed
      ) {
        forceCreateTrip = true;
        input.messages.push({
          role: "user",
          content:
            "工具调用校验：证据已经足够。请立即调用 create_trip 落地完整行程，不要再解释或以纯文本结束。",
        });
        continue;
      }

      if (input.requireCreateTrip) {
        throw new Error("AI 结束了规划，但没有调用 create_trip。");
      }

      return {
        tripId: latestTripId,
        summary: assistantMessage.content,
      };
    }

    let hadToolExecutionError = false;

    for (const toolCall of toolCalls) {
      assertAgentRunActive(input.signal);

      if (toolCall.parseError) {
        hadToolExecutionError = true;
        if (input.requireCreateTrip && toolCall.name === "create_trip") {
          forceCreateTrip = true;
        }

        if (toolCall.name === "create_trip") {
          const parseFailure = new Error(
            toolCall.parseError || "工具参数无法解析。"
          );
          await recordFailedToolCall({
            agentSessionId: input.sessionId,
            name: "create_trip",
            request: {
              arguments: toolCall.arguments,
              parseError: toolCall.parseError,
            },
            error: parseFailure,
            signal: input.signal,
          });
          noteCreateTripFailure(parseFailure);
        }

        input.messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify({
            error:
              "工具参数无法解析。请立即重新调用该工具，并输出完整、合法且不截断的 JSON 参数。压缩叙述，避免重复路线和天气信息；自然景点最多 6 个、人文景点最多 3 个、住宿和美食各最多 4 个、避坑最多 8 条，每个自驾路段只保留 1 条 routeRisk。",
          }),
        });
        continue;
      }

      let result: unknown;
      const executionToolCall: AgentChatToolCall =
        toolCall.name === "create_trip" && lastCreateTripCandidate
          ? {
              ...toolCall,
              arguments: mergeCreateTripCandidate(
                lastCreateTripCandidate,
                toolCall.arguments
              ),
            }
          : toolCall;
      try {
        result = await executeToolCall(
          executionToolCall,
          input.context,
          input.settings
        );
      } catch (error) {
        assertAgentRunActive(input.signal);
        hadToolExecutionError = true;
        lastToolExecutionError = error;
        if (toolCall.name === "create_trip") {
          const currentCandidate: Record<string, unknown> =
            executionToolCall.arguments;
          if (Object.keys(currentCandidate).length > 0) {
            lastCreateTripCandidate = currentCandidate;
          }
        }
        input.messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: stringifyToolError(error),
        });
        if (toolCall.name === "create_trip") {
          noteCreateTripFailure(error);
        }
        continue;
      }
      const explicitTripId = readOptionalString(toolCall.arguments, "tripId");
      if (explicitTripId) {
        input.context.tripId = explicitTripId;
      }
      latestTripId = explicitTripId ?? input.context.tripId ?? latestTripId;
      input.messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: stringifyToolResult(result),
      });

      if (toolCall.name === "create_trip") {
        const trip = result as { id: string };
        latestTripId = trip.id;
        input.context.tripId = trip.id;

        if (input.requireCreateTrip) {
          await createAssistantMessage({
            sessionId: input.sessionId,
            signal: input.signal,
            content: "AI 已创建规划行程。",
            metadata: { tripId: trip.id },
          });

          return {
            tripId: trip.id,
            summary: "AI 已通过工具调用完成通勤规划。",
          };
        }
      }
    }

    if (hadToolExecutionError) {
      continue;
    }

    const travelEvidenceBudget = input.context.travelEvidenceBudget;
    if (
      input.context.purpose === "travel" &&
      travelEvidenceBudget &&
      travelEvidenceBudget.directPoiSearches >=
        travelEvidenceBudget.maxDirectPoiSearches &&
      !travelEvidenceBudget.exhaustionNudgeSent
    ) {
      travelEvidenceBudget.exhaustionNudgeSent = true;
      input.messages.push({
        role: "user",
        content:
          "旅行地点检索预算已用完。请停止 search_poi，不要再尝试新的空关键词；使用当前已经获得的自然景点、人文景点、住宿和美食证据，立即查询自驾与公共交通路线，然后调用 create_trip 落地完整行程。",
      });
    }

    if (shouldCompleteContinuationAfterTools(toolCalls, input.requireCreateTrip)) {
      const summary = "AI 已更新当前行程。";
      await createAssistantMessage({
        sessionId: input.sessionId,
        signal: input.signal,
        content: summary,
        metadata: { tripId: latestTripId },
      });

      return {
        tripId: latestTripId,
        summary,
      };
    }
  }
}

export async function startPlanningSession({
  currentLocation,
  purpose,
  userId,
  prompt,
}: StartPlanningSessionInput) {
  const normalizedPrompt = normalizePrompt(prompt);
  const currentLocationContext = buildCurrentLocationContext(currentLocation);
  const normalizedPurpose: AgentPlanningPurpose =
    purpose === "travel" ? "travel" : "planning";

  return prisma.agentSession.create({
    data: {
      userId,
      status: "running",
      purpose: normalizedPurpose,
      prompt: normalizedPrompt,
      timeoutMs: SESSION_TIMEOUT_MS,
      messages: {
        create: [
          ...(currentLocationContext
            ? [{ role: "system", content: currentLocationContext }]
            : []),
          {
            role: "user",
            content: normalizedPrompt,
          },
        ],
      },
    },
  });
}

export async function runPlanningSession(
  sessionId: string,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ attempt, signal }) =>
        runPlanningAttempt(sessionId, attempt, signal, options),
    });

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        retryCount: result.attempts - 1,
        tripId: result.value.tripId,
      },
    });

    return {
      sessionId,
      status: "completed",
      tripId: result.value.tripId,
    };
  } catch (error) {
    const timedOut = error instanceof AgentRunTimeoutError;
    const failed = await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: timedOut ? "timed_out" : "failed",
        messages: {
          create: {
            role: "assistant",
            content: formatPlanningFailureMessage(error),
          },
        },
      },
    });

    return {
      sessionId,
      status: timedOut ? "timed_out" : "failed",
      tripId: failed.tripId,
    };
  }
}

export async function continueAgentSession(
  input: ContinueAgentSessionInput,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  const accepted = await acceptAgentSessionMessage(input);
  return runAcceptedContinuationSession(accepted.id, options);
}

export async function acceptAgentSessionMessage({
  userId,
  sessionId,
  message,
}: ContinueAgentSessionInput) {
  const normalizedMessage = normalizePrompt(message);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.agentSession.updateMany({
      where: {
        id: sessionId,
        userId,
        status: { not: "running" },
      },
      data: { status: "running" },
    });

    if (claimed.count !== 1) {
      const existing = await tx.agentSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!existing) {
        throw new AgentSessionNotFoundError();
      }

      throw new AgentSessionAlreadyRunningError();
    }

    await tx.agentMessage.create({
      data: {
        agentSessionId: sessionId,
        role: "user",
        content: normalizedMessage,
      },
    });

    return tx.agentSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
  });
}

export async function runAcceptedContinuationSession(
  sessionId: string,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: session.timeoutMs || SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ signal }) =>
        runContinuationAttempt(sessionId, signal, options),
    });

    const completed = await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        retryCount: result.attempts - 1,
        tripId: result.value.tripId,
      },
    });

    return {
      sessionId,
      status: "completed",
      tripId: completed.tripId,
    };
  } catch (error) {
    const timedOut = error instanceof AgentRunTimeoutError;
    const failed = await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: timedOut ? "timed_out" : "failed",
        messages: {
          create: {
            role: "assistant",
            content: formatPlanningFailureMessage(error),
          },
        },
      },
    });

    return {
      sessionId,
      status: timedOut ? "timed_out" : "failed",
      tripId: failed.tripId,
    };
  }
}

async function runContinuationAttempt(
  sessionId: string,
  signal?: AbortSignal,
  options: RunPlanningSessionOptions = {}
): Promise<{ tripId: string | null; summary: string }> {
  assertAgentRunActive(signal);
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const settings = await loadPlanningSettings(session.userId);
  const chatClient = options.chatClient ?? createOpenAiChatClient();
  const context: ToolExecutionContext = {
    amap: options.amapClient ?? createAmapClient(),
    sessionId,
    userId: session.userId,
    prompt: session.prompt,
    purpose: session.purpose === "travel" ? "travel" : "planning",
    tripId: session.tripId,
    signal,
    toolResultCache: new Map(),
    travelEvidenceBudget: createTravelEvidenceBudget(
      session.purpose === "travel" ? "travel" : "planning",
      session.prompt
    ),
  };
  const messages = await createContinuationMessages(session);
  const result = await runConversationAttempt({
    sessionId,
    context,
    settings,
    messages,
    chatClient,
    signal,
    requireCreateTrip: false,
  });

  return {
    tripId: result.tripId ?? session.tripId,
    summary: result.summary,
  };
}

export async function runPlanningAttempt(
  sessionId: string,
  attempt = 1,
  signal?: AbortSignal,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningAttemptResult> {
  assertAgentRunActive(signal);
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const settings = await loadPlanningSettings(session.userId);
  const chatClient = options.chatClient ?? createOpenAiChatClient();
  const context: ToolExecutionContext = {
    amap: options.amapClient ?? createAmapClient(),
    sessionId,
    userId: session.userId,
    prompt: session.prompt,
    purpose: session.purpose === "travel" ? "travel" : "planning",
    signal,
    toolResultCache: new Map(),
    travelEvidenceBudget: createTravelEvidenceBudget(
      session.purpose === "travel" ? "travel" : "planning",
      session.prompt
    ),
  };
  const messages = await createInitialMessages(session, attempt);

  await createAssistantMessage({
    sessionId,
    signal,
    content: `第 ${attempt} 次规划尝试：AI 可以持续调用工具，直到创建最终行程。`,
  });

  const result = await runConversationAttempt({
    sessionId,
    context,
    settings,
    messages,
    chatClient,
    signal,
    requireCreateTrip: true,
  });

  if (!result.tripId) {
    throw new Error("AI 结束了规划，但没有创建行程。");
  }

  return {
    tripId: result.tripId,
    summary: result.summary,
  };
}
