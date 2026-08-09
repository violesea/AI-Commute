import { prisma } from "@/lib/db";
import { assertAgentRunActive, recordToolCall } from "@/lib/agent/tools";
import { getToolCacheKey, normalizeLngLat } from "@/lib/agent/planner-readers";
import type {
  AgentPlanningPurpose,
  AgentToolName,
} from "@/lib/agent/types";
import type {
  BufferComponentInput,
  PlannedTripLegInput,
} from "@/lib/trips/types";
import { parseTravelDateRange } from "@/lib/trips/travel-schedule";
import {
  summarizeTravelRouteEvidence,
  type TravelPlan,
  type TravelRecommendationEvidence,
  type TravelRouteLegEvidence,
  type TravelTransportEvidence,
  type TravelWeatherForecast,
} from "@/lib/trips/travel-plan";
import type { ToolExecutionContext, TravelEvidenceBudget } from "@/lib/agent/planner";

const ROUTE_EVIDENCE_QUOTA_RETRY_DELAY_MS = 1_100;

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

export async function enrichTravelPlanWithToolEvidence(
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

export function createTravelEvidenceBudget(
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

export async function recordCachedToolCall<T>(input: {
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

export async function resolveRouteEndpoint(input: {
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

function isTravelDrivingLeg(leg: PlannedTripLegInput) {
  return /driving|drive|car|驾车|自驾|开车|驾驶/i.test(
    [leg.mode, leg.routeTitle, leg.segmentTitle, leg.segmentDetail]
      .filter(Boolean)
      .join(" ")
  );
}

export function getTravelDrivingLegOrders(legs: PlannedTripLegInput[]) {
  return legs.reduce<number[]>((orders, leg, index) => {
    if (isTravelDrivingLeg(leg)) {
      orders.push(index + 1);
    }
    return orders;
  }, []);
}

export function isTravelTransportValidationError(error: unknown) {
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

export async function loadTravelTransportEvidence(sessionId: string) {
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

export function parseRecordJson(value: string | null | undefined) {
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

function isRouteEvidenceQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /CUQPS_HAS_EXCEEDED_THE_LIMIT|10021|QPS/i.test(message);
}

function waitForRouteEvidenceQuotaRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ROUTE_EVIDENCE_QUOTA_RETRY_DELAY_MS);
  });
}

/**
 * The model is encouraged to query every major route, but a successful
 * create_trip must not depend on the model remembering that instruction.
 * For coordinate-complete driving legs, fetch a provider route here as a
 * best-effort evidence pass. Legs that lack usable endpoints or hit a
 * provider error remain explicit estimates and receive the existing safety
 * margin.
 */
async function ensureTravelDrivingRouteEvidence(
  legs: PlannedTripLegInput[],
  context: ToolExecutionContext
) {
  const existingEvidence = await loadTravelDrivingRouteEvidence(
    context.sessionId
  );

  for (const leg of legs) {
    if (!isTravelDrivingLeg(leg) || leg.routeMinutes <= 0) continue;
    if (existingEvidence.some((candidate) => routeEvidenceMatches(leg, candidate))) {
      continue;
    }

    const origin = normalizeLngLat(leg.originLngLat ?? "");
    const destination = normalizeLngLat(leg.destinationLngLat ?? "");
    if (!origin || !destination) continue;

    const request = { origin, destination };
    const fetchRouteEvidence = () =>
      recordCachedToolCall({
        context,
        name: "get_driving_route",
        request,
        run: async () => {
          const result = await context.amap.getDrivingRoute(request);
          return {
            ...result,
            origin,
            destination,
            requestedOrigin: leg.originName ?? origin,
            requestedDestination: leg.destinationName ?? destination,
          };
        },
      });

    let route;
    try {
      route = await fetchRouteEvidence();
    } catch (error) {
      assertAgentRunActive(context.signal);
      if (!isRouteEvidenceQuotaError(error)) {
        continue;
      }

      await waitForRouteEvidenceQuotaRetry();
      assertAgentRunActive(context.signal);
      try {
        route = await fetchRouteEvidence();
      } catch (retryError) {
        assertAgentRunActive(context.signal);
        continue;
      }
    }

    if (!route) continue;

    if (
      Number.isFinite(route.durationMinutes) &&
      route.durationMinutes > 0 &&
      route.summary.trim()
    ) {
      existingEvidence.push({
        origin,
        destination,
        requestedOrigin: leg.originName ?? origin,
        requestedDestination: leg.destinationName ?? destination,
        durationMinutes: Math.round(route.durationMinutes),
        summary: route.summary,
        observedAt: new Date().toISOString(),
      });
    }
  }

  return existingEvidence;
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

export async function annotateTravelRouteEvidence(
  legs: PlannedTripLegInput[],
  context: ToolExecutionContext
) {
  const evidence = await ensureTravelDrivingRouteEvidence(legs, context);
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

export function attachRouteEvidenceSummary(
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
