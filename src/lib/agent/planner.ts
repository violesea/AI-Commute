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
  alignTravelPlanDrivingDuration,
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
  normalizeTravelItinerarySchedule,
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
const ROUTE_EVIDENCE_QUOTA_RETRY_DELAY_MS = 1_100;
const ORIGIN_REQUIRED_MESSAGE =
  "请先在设置中选择默认出发点，或在本次请求中提供出发点。";
const NATURAL_ATTRACTION_SEARCH_GROUPS = [
  "山,峰,森林,森林公园,国家公园",
  "湖,湿地,溪流,瀑布,峡谷",
  "海,海岛,海滩,滨海,湾",
  "公园,植物园,观景台,风景区",
] as const;

export {
  AgentConversationLimitError,
  AgentRunTimeoutError,
  AgentSessionAlreadyRunningError,
  AgentSessionNotFoundError,
  formatPlanningFailureMessage,
} from "@/lib/agent/planner-errors";
import {
  AgentConversationLimitError,
  AgentSessionAlreadyRunningError,
  AgentSessionNotFoundError,
  formatPlanningFailureMessage,
} from "@/lib/agent/planner-errors";

type PlanningSettings = {
  defaultCity: string;
  timezone: string;
  model: string;
  originName: string;
  originLngLat: string;
  routePreference: string;
};

export type TravelEvidenceBudget = {
  maxDirectPoiSearches: number;
  directPoiSearches: number;
  exhaustionNudgeSent: boolean;
};

export type RunPlanningSessionOptions = {
  chatClient?: AgentChatClient;
  amapClient?: AmapClient;
};

export type ToolExecutionContext = {
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

import {
  annotateTravelRouteEvidence,
  attachRouteEvidenceSummary,
  createTravelEvidenceBudget,
  enrichTravelPlanWithToolEvidence,
  getTravelDrivingLegOrders,
  isTravelTransportValidationError,
  loadCompletedWeatherReferenceCities,
  loadTravelTransportEvidence,
  parseRecordJson,
  recordCachedToolCall,
  resolveRouteEndpoint,
} from "@/lib/agent/planner-evidence";
export {
  enrichTravelPlanWithLatestWeatherEvidence,
  loadCompletedWeatherReferenceCities,
} from "@/lib/agent/planner-evidence";

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

import {
  TOOL_DEFINITIONS,
  getAgentToolDefinitions,
} from "@/lib/agent/planner-schemas";
export { getAgentToolDefinitions } from "@/lib/agent/planner-schemas";

import {
  buildCurrentLocationContext,
  createContinuationMessages,
  createInitialMessages,
  getSystemPrompt,
} from "@/lib/agent/planner-prompts";

import {
  firstNonEmptyString,
  getToolCacheKey,
  normalizeCacheValue,
  normalizeLngLat,
  readArray,
  readNumber,
  readOptionalArray,
  readOptionalDate,
  readOptionalNumber,
  readOptionalString,
  readString,
  requireObject,
} from "@/lib/agent/planner-readers";

function getToolName(name: string): AgentToolName {
  const allowed = new Set(
    TOOL_DEFINITIONS.map((tool) => tool.name as AgentToolName)
  );

  if (!allowed.has(name as AgentToolName)) {
    throw new Error(`Unknown agent tool: ${name}`);
  }

  return name as AgentToolName;
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
      context
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
    travelPlan = alignTravelPlanDrivingDuration(
      travelPlan,
      schedule.legs.map((leg, index) => ({
        order: leg.order ?? index,
        routeMinutes: leg.routeMinutes,
        bufferMinutes: leg.bufferMinutes ?? 0,
        totalMinutes: leg.totalMinutes,
        mode: leg.mode,
        latestDepartAt: leg.latestDepartAt,
        targetArriveAt: leg.targetArriveAt,
      })),
      timezone
    );
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
      context
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
    travelPlan = alignTravelPlanDrivingDuration(
      travelPlan,
      schedule.legs.map((leg, index) => ({
        order: leg.order ?? index,
        routeMinutes: leg.routeMinutes,
        bufferMinutes: leg.bufferMinutes ?? 0,
        totalMinutes: leg.totalMinutes,
        mode: leg.mode,
        latestDepartAt: leg.latestDepartAt,
        targetArriveAt: leg.targetArriveAt,
      })),
      current.trip.timezone
    );
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

import {
  mergeCreateTripCandidate,
  shouldCompleteContinuationAfterTools,
  stringifyToolError,
  stringifyToolResult,
} from "@/lib/agent/planner-recovery";
export {
  stringifyToolError,
  stringifyToolResult,
} from "@/lib/agent/planner-recovery";

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
