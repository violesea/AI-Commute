export type TravelTransportMode = "driving" | "transit" | "mixed";

export type TravelAttractionCategory = "natural" | "cultural";

export type TravelWeatherRisk = "low" | "medium" | "high";

export type TravelRecommendationSource =
  | "amap_poi"
  | "amap_route"
  | "amap_weather"
  | "agent_inference"
  | "user_input";

export type TravelRecommendationVerification =
  | "provider_reference"
  | "needs_verification";

export type TravelAttractionRouteStatus = "planned" | "alternative";

export type TravelRouteCoverage = {
  plannedAttractions: string[];
  alternativeAttractions: string[];
  requestedNaturalTypes?: string[];
  unmetNaturalTypes?: string[];
  naturalPriority?: boolean;
  minimumPlannedNaturalAttractions?: number;
  plannedNaturalAttractions?: number;
  coverageNotes?: string[];
};

export type TravelRouteLegEvidence = {
  source: "amap_route" | "agent_estimate";
  status: "provider_verified" | "estimated";
  durationMinutes: number;
  modelDurationMinutes?: number;
  safetyMarginMinutes: number;
  observedAt?: string;
  summary: string;
  note: string;
  origin?: string;
  destination?: string;
};

export type TravelRouteEvidenceSummary = {
  totalDrivingLegs: number;
  verifiedDrivingLegs: number;
  estimatedDrivingLegs: number;
  safetyMarginMinutes: number;
  note: string;
};

export type TravelRecommendationEvidence = {
  source: TravelRecommendationSource;
  status: TravelRecommendationVerification;
  label: string;
  observedAt?: string;
  note?: string;
};

export type TravelWeatherForecast = {
  date?: string;
  day?: number;
  location?: string;
  summary: string;
  risk: TravelWeatherRisk;
  drivingAdvice?: string;
  outdoorAdvice?: string;
};

export type TravelWeatherLocation = {
  name: string;
  status: "queried" | "refresh_required";
  note?: string;
};

export type TravelWeatherRouteRisk = {
  legOrder?: number;
  day?: number;
  date?: string;
  route: string;
  summary: string;
  risk: TravelWeatherRisk;
  drivingAdvice: string;
  action?: string;
};

export type TravelPlanWeather = {
  city: string;
  summary: string;
  advice: string;
  source?: string;
  observedAt?: string;
  forecastAvailableThrough?: string;
  dynamicMonitoring?: boolean;
  refreshPolicy?: string;
  locations?: TravelWeatherLocation[];
  forecast?: TravelWeatherForecast[];
  routeRisks?: TravelWeatherRouteRisk[];
};

export type TravelTransportOption = {
  summary: string;
  reason: string;
  durationMinutes?: number;
  route?: string;
};

export type TravelTransport = {
  recommended: TravelTransportMode;
  reason: string;
  driving: TravelTransportOption;
  transit: TravelTransportOption;
  localMovement?: string;
};

export type TravelAttraction = {
  name: string;
  category: TravelAttractionCategory;
  reason: string;
  routeStatus?: TravelAttractionRouteStatus;
  naturalType?: string;
  address?: string;
  lngLat?: string;
  day?: number;
  stayMinutes?: number;
  bestTime?: string;
  weatherNote?: string;
  notes?: string;
  evidence?: TravelRecommendationEvidence;
};

export type TravelLodging = {
  name: string;
  area: string;
  reason: string;
  poiId?: string;
  address?: string;
  lngLat?: string;
  budget?: string;
  notes?: string;
  evidence?: TravelRecommendationEvidence;
};

export type TravelFood = {
  name: string;
  area?: string;
  mustTry: string;
  reason: string;
  poiId?: string;
  address?: string;
  lngLat?: string;
  budget?: string;
  notes?: string;
  evidence?: TravelRecommendationEvidence;
};

export type TravelBudgetItem = {
  category: string;
  amount: string;
  notes?: string;
};

export type TravelBudget = {
  currency: string;
  total: string;
  breakdown: TravelBudgetItem[];
  assumptions?: string;
};

export type TravelPitfall = {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
};

export type TravelPlan = {
  destination: string;
  summary: string;
  days?: number;
  routeCoverage?: TravelRouteCoverage;
  routeEvidence?: TravelRouteEvidenceSummary;
  weather: TravelPlanWeather;
  transport: TravelTransport;
  budget?: TravelBudget;
  attractions: TravelAttraction[];
  lodging: TravelLodging[];
  food: TravelFood[];
  pitfalls: TravelPitfall[];
};

export type TravelPlanRouteStop = {
  name: string;
  order?: number | null;
  address?: string | null;
  lngLat?: string | null;
  kind?: string | null;
  notes?: string | null;
};

export type TravelPlanRouteLeg = {
  order?: number | null;
  originName?: string | null;
  originLngLat?: string | null;
  destinationName?: string | null;
  destinationLngLat?: string | null;
  routeMinutes?: number | null;
  mode?: string | null;
};

export type TravelTransportRouteEvidence = {
  durationMinutes: number;
  summary: string;
};

export type TravelTransportEvidence = {
  driving: TravelTransportRouteEvidence;
  transit: TravelTransportRouteEvidence;
};

export type TravelRouteStatLeg = {
  order: number;
  routeMinutes: number;
  bufferMinutes: number;
  totalMinutes?: number | null;
  mode?: string | null;
  latestDepartAt?: Date | string | null;
  targetArriveAt?: Date | string | null;
};

export type TravelDailyDrivingStat = {
  date: string;
  minutes: number;
  legOrders: number[];
};

export type TravelRouteStats = {
  totalRouteMinutes: number;
  totalBufferMinutes: number;
  totalMinutes: number;
  totalDrivingMinutes: number;
  dailyDrivingMinutes: TravelDailyDrivingStat[];
};

export type TravelWeatherDateRange = {
  startDate: string;
  endDate: string;
};

const DRIVING_MODE_PATTERN = /driving|drive|car|auto|驾车|自驾/i;

function isDrivingMode(mode?: string | null) {
  return Boolean(mode && DRIVING_MODE_PATTERN.test(mode));
}

function dateKeyInTimeZone(
  value: Date | string | null | undefined,
  timeZone: string
) {
  if (!value) return undefined;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

export function getTravelRouteStats(
  legs: readonly TravelRouteStatLeg[],
  timeZone = "Asia/Shanghai"
): TravelRouteStats {
  const orderedLegs = [...legs].sort((left, right) => left.order - right.order);
  const daily = new Map<string, TravelDailyDrivingStat>();
  let totalRouteMinutes = 0;
  let totalBufferMinutes = 0;
  let totalDrivingMinutes = 0;

  for (const leg of orderedLegs) {
    const routeMinutes = Math.max(0, Math.round(leg.routeMinutes));
    const bufferMinutes = Math.max(0, Math.round(leg.bufferMinutes));
    totalRouteMinutes += routeMinutes;
    totalBufferMinutes += bufferMinutes;

    if (!isDrivingMode(leg.mode)) continue;

    totalDrivingMinutes += routeMinutes;
    const date = dateKeyInTimeZone(
      leg.latestDepartAt ?? leg.targetArriveAt,
      timeZone
    );
    if (!date) continue;

    const current = daily.get(date) ?? { date, minutes: 0, legOrders: [] };
    current.minutes += routeMinutes;
    current.legOrders.push(leg.order);
    daily.set(date, current);
  }

  return {
    totalRouteMinutes,
    totalBufferMinutes,
    totalMinutes: totalRouteMinutes + totalBufferMinutes,
    totalDrivingMinutes,
    dailyDrivingMinutes: [...daily.values()].sort((left, right) =>
      left.date.localeCompare(right.date)
    ),
  };
}

export function summarizeTravelRouteEvidence(
  legs: readonly {
    mode?: string | null;
    routeEvidence?: TravelRouteLegEvidence;
  }[]
): TravelRouteEvidenceSummary | undefined {
  const drivingLegs = legs.filter((leg) => isDrivingMode(leg.mode));
  if (drivingLegs.length === 0) return undefined;

  const verifiedDrivingLegs = drivingLegs.filter(
    (leg) => leg.routeEvidence?.status === "provider_verified"
  ).length;
  const estimatedDrivingLegs = drivingLegs.length - verifiedDrivingLegs;
  const safetyMarginMinutes = drivingLegs.reduce(
    (total, leg) => total + Math.max(0, Math.round(leg.routeEvidence?.safetyMarginMinutes ?? 0)),
    0
  );

  return {
    totalDrivingLegs: drivingLegs.length,
    verifiedDrivingLegs,
    estimatedDrivingLegs,
    safetyMarginMinutes,
    note:
      estimatedDrivingLegs > 0
        ? `有 ${estimatedDrivingLegs} 段自驾未匹配到同起终点的高德路线，已加入 ${safetyMarginMinutes} 分钟安全余量；油费、过路费和出发时间需按临期地图重新核验。`
        : "每段自驾均匹配到同起终点的高德路线查询；出发前仍需刷新实时路况、天气和道路管制。",
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the same structural error as non-object input.
    }
  }

  return readRecord(value, label);
}

function readText(
  record: Record<string, unknown>,
  key: string,
  label: string,
  required = true
) {
  const value = record[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!required) {
    return undefined;
  }

  throw new Error(`${label}.${key} must be a non-empty string.`);
}

function readOptionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }

  return undefined;
}

function readArray(record: Record<string, unknown>, key: string, label: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label}.${key} must be an array.`);
  }

  return value;
}

function readOptionalArray(
  record: Record<string, unknown>,
  key: string,
  label: string
) {
  const value = record[key];
  if (value === undefined || value === null) {
    return [];
  }

  return readArray(record, key, label);
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string
) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label}.${key} must be an array.`);
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0
  )
    .map((item) => item.trim());
}

function normalizeWeatherRisk(value: unknown): TravelWeatherRisk {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeWeatherForecast(value: unknown): TravelWeatherForecast {
  const record = readRecord(value, "travelPlan.weather.forecast[]");

  return {
    date: readText(
      record,
      "date",
      "travelPlan.weather.forecast[]",
      false
    ),
    day: readOptionalNumber(record, "day"),
    location: readText(
      record,
      "location",
      "travelPlan.weather.forecast[]",
      false
    ),
    summary: readText(
      record,
      "summary",
      "travelPlan.weather.forecast[]"
    )!,
    risk: normalizeWeatherRisk(record.risk),
    drivingAdvice: readText(
      record,
      "drivingAdvice",
      "travelPlan.weather.forecast[]",
      false
    ),
    outdoorAdvice: readText(
      record,
      "outdoorAdvice",
      "travelPlan.weather.forecast[]",
      false
    ),
  };
}

function normalizeWeatherLocation(value: unknown): TravelWeatherLocation {
  const record = readRecord(value, "travelPlan.weather.locations[]");
  const status = readText(
    record,
    "status",
    "travelPlan.weather.locations[]",
    false
  );

  return {
    name: readText(record, "name", "travelPlan.weather.locations[]")!,
    status: status === "queried" ? "queried" : "refresh_required",
    note: readText(record, "note", "travelPlan.weather.locations[]", false),
  };
}

function normalizeWeatherRouteRisk(value: unknown): TravelWeatherRouteRisk {
  const record = readRecord(value, "travelPlan.weather.routeRisks[]");

  return {
    legOrder: readOptionalNumber(record, "legOrder"),
    day: readOptionalNumber(record, "day"),
    date: readText(record, "date", "travelPlan.weather.routeRisks[]", false),
    route: readText(record, "route", "travelPlan.weather.routeRisks[]")!,
    summary: readText(
      record,
      "summary",
      "travelPlan.weather.routeRisks[]"
    )!,
    risk: normalizeWeatherRisk(record.risk),
    drivingAdvice: readText(
      record,
      "drivingAdvice",
      "travelPlan.weather.routeRisks[]"
    )!,
    action: readText(
      record,
      "action",
      "travelPlan.weather.routeRisks[]",
      false
    ),
  };
}

const RECOMMENDATION_SOURCES = new Set<TravelRecommendationSource>([
  "amap_poi",
  "amap_route",
  "amap_weather",
  "agent_inference",
  "user_input",
]);

function defaultRecommendationEvidence(
  source: TravelRecommendationSource
): Pick<TravelRecommendationEvidence, "label" | "status"> {
  if (source === "agent_inference") {
    return {
      label: "AI建议，出发前核验",
      status: "needs_verification",
    };
  }

  if (source === "user_input") {
    return {
      label: "用户提供，仍需现场核对",
      status: "needs_verification",
    };
  }

  if (source === "amap_weather") {
    return {
      label: "高德天气参考，出发前刷新",
      status: "provider_reference",
    };
  }

  return {
    label: "高德地点检索参考，仍需核对开放与价格",
    status: "provider_reference",
  };
}

function normalizeRecommendationEvidence(
  value: unknown,
  label: string
): TravelRecommendationEvidence {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const requestedSource = readText(record, "source", label, false);
  const source = RECOMMENDATION_SOURCES.has(
    requestedSource as TravelRecommendationSource
  )
    ? (requestedSource as TravelRecommendationSource)
    : "agent_inference";
  const defaults = defaultRecommendationEvidence(source);
  const requestedStatus = readText(record, "status", label, false);
  const status: TravelRecommendationVerification =
    source === "agent_inference" || source === "user_input"
      ? "needs_verification"
      : requestedStatus === "needs_verification"
        ? "needs_verification"
        : defaults.status;

  return {
    source,
    status,
    label: readText(record, "label", label, false) ?? defaults.label,
    observedAt: readText(record, "observedAt", label, false),
    note: readText(record, "note", label, false),
  };
}

function normalizeAttraction(value: unknown): TravelAttraction {
  const record = readRecord(value, "travelPlan.attractions[]");
  const category = readText(record, "category", "travelPlan.attractions[]");
  const normalizedCategory: TravelAttractionCategory =
    category === "natural" || category === "nature" ? "natural" : "cultural";

  return {
    name: readText(record, "name", "travelPlan.attractions[]")!,
    category: normalizedCategory,
    reason: readText(record, "reason", "travelPlan.attractions[]")!,
    routeStatus:
      record.routeStatus === "planned" || record.routeStatus === "alternative"
        ? record.routeStatus
        : undefined,
    naturalType: readText(
      record,
      "naturalType",
      "travelPlan.attractions[]",
      false
    ),
    address: readText(record, "address", "travelPlan.attractions[]", false),
    lngLat: readText(record, "lngLat", "travelPlan.attractions[]", false),
    day: readOptionalNumber(record, "day"),
    stayMinutes: readOptionalNumber(record, "stayMinutes"),
    bestTime: readText(record, "bestTime", "travelPlan.attractions[]", false),
    weatherNote: readText(
      record,
      "weatherNote",
      "travelPlan.attractions[]",
      false
    ),
    notes: readText(record, "notes", "travelPlan.attractions[]", false),
    evidence: normalizeRecommendationEvidence(
      record.evidence,
      "travelPlan.attractions[].evidence"
    ),
  };
}

function normalizeTransportOption(
  value: unknown,
  label: "driving" | "transit"
): TravelTransportOption {
  const record = readRecord(value, `travelPlan.transport.${label}`);

  return {
    summary: readText(record, "summary", `travelPlan.transport.${label}`)!,
    reason: readText(record, "reason", `travelPlan.transport.${label}`)!,
    durationMinutes: readOptionalNumber(record, "durationMinutes"),
    route: readText(record, "route", `travelPlan.transport.${label}`, false),
  };
}

function normalizeLodging(value: unknown): TravelLodging {
  const record = readRecord(value, "travelPlan.lodging[]");

  return {
    name: readText(record, "name", "travelPlan.lodging[]")!,
    area: readText(record, "area", "travelPlan.lodging[]")!,
    reason: readText(record, "reason", "travelPlan.lodging[]")!,
    poiId: readText(record, "poiId", "travelPlan.lodging[]", false),
    address: readText(record, "address", "travelPlan.lodging[]", false),
    lngLat: readText(record, "lngLat", "travelPlan.lodging[]", false),
    budget: readText(record, "budget", "travelPlan.lodging[]", false),
    notes: readText(record, "notes", "travelPlan.lodging[]", false),
    evidence: normalizeRecommendationEvidence(
      record.evidence,
      "travelPlan.lodging[].evidence"
    ),
  };
}

function normalizeFood(value: unknown): TravelFood {
  const record = readRecord(value, "travelPlan.food[]");

  return {
    name: readText(record, "name", "travelPlan.food[]")!,
    area: readText(record, "area", "travelPlan.food[]", false),
    mustTry: readText(record, "mustTry", "travelPlan.food[]")!,
    reason: readText(record, "reason", "travelPlan.food[]")!,
    poiId: readText(record, "poiId", "travelPlan.food[]", false),
    address: readText(record, "address", "travelPlan.food[]", false),
    lngLat: readText(record, "lngLat", "travelPlan.food[]", false),
    budget: readText(record, "budget", "travelPlan.food[]", false),
    notes: readText(record, "notes", "travelPlan.food[]", false),
    evidence: normalizeRecommendationEvidence(
      record.evidence,
      "travelPlan.food[].evidence"
    ),
  };
}

function normalizeBudgetItem(value: unknown): TravelBudgetItem {
  const record = readRecord(value, "travelPlan.budget.breakdown[]");

  return {
    category: readText(
      record,
      "category",
      "travelPlan.budget.breakdown[]"
    )!,
    amount: readText(
      record,
      "amount",
      "travelPlan.budget.breakdown[]"
    )!,
    notes: readText(
      record,
      "notes",
      "travelPlan.budget.breakdown[]",
      false
    ),
  };
}

function normalizeBudget(value: unknown): TravelBudget {
  const record = readRecord(value, "travelPlan.budget");

  return {
    currency: readText(record, "currency", "travelPlan.budget")!,
    total: readText(record, "total", "travelPlan.budget")!,
    breakdown: readArray(
      record,
      "breakdown",
      "travelPlan.budget"
    ).map(normalizeBudgetItem),
    assumptions: readText(
      record,
      "assumptions",
      "travelPlan.budget",
      false
    ),
  };
}

function normalizePitfall(value: unknown): TravelPitfall {
  const record = readRecord(value, "travelPlan.pitfalls[]");
  const severity = readText(record, "severity", "travelPlan.pitfalls[]", false);

  return {
    title: readText(record, "title", "travelPlan.pitfalls[]")!,
    detail: readText(record, "detail", "travelPlan.pitfalls[]")!,
    severity:
      severity === "high" || severity === "low" ? severity : "medium",
  };
}

export function normalizeTravelPlan(value: unknown): TravelPlan {
  const record = readRecord(value, "travelPlan");
  const destination = readText(record, "destination", "travelPlan")!;
  const summary = readText(record, "summary", "travelPlan")!;
  const routeCoverageRecord = isRecord(record.routeCoverage)
    ? record.routeCoverage
    : undefined;
  const routeEvidenceRecord = isRecord(record.routeEvidence)
    ? record.routeEvidence
    : undefined;
  const weather = readJsonRecord(record.weather, "travelPlan.weather");
  const transport = readJsonRecord(record.transport, "travelPlan.transport");
  const recommended = readText(
    transport,
    "recommended",
    "travelPlan.transport"
  );
  const budget =
    record.budget === undefined
      ? undefined
      : normalizeBudget(record.budget);
  const forecast = readOptionalArray(
    weather,
    "forecast",
    "travelPlan.weather"
  ).map(normalizeWeatherForecast);
  const weatherSummary =
    readText(weather, "summary", "travelPlan.weather", false) ??
    readText(weather, "advice", "travelPlan.weather", false) ??
    forecast[0]?.summary;

  if (!weatherSummary) {
    throw new Error(
      "travelPlan.weather.summary must be a non-empty string and weather.advice or weather.forecast must provide fallback text."
    );
  }

  return {
    destination,
    summary,
    days: readOptionalNumber(record, "days"),
    routeCoverage: routeCoverageRecord
      ? {
          plannedAttractions:
            readOptionalStringArray(
              routeCoverageRecord,
              "plannedAttractions",
              "travelPlan.routeCoverage"
            ) ?? [],
          alternativeAttractions:
            readOptionalStringArray(
              routeCoverageRecord,
              "alternativeAttractions",
              "travelPlan.routeCoverage"
            ) ?? [],
          requestedNaturalTypes: readOptionalStringArray(
            routeCoverageRecord,
            "requestedNaturalTypes",
            "travelPlan.routeCoverage"
          ),
          unmetNaturalTypes: readOptionalStringArray(
            routeCoverageRecord,
            "unmetNaturalTypes",
            "travelPlan.routeCoverage"
          ),
          naturalPriority: readOptionalBoolean(
            routeCoverageRecord,
            "naturalPriority"
          ),
          minimumPlannedNaturalAttractions: readOptionalNumber(
            routeCoverageRecord,
            "minimumPlannedNaturalAttractions"
          ),
          plannedNaturalAttractions: readOptionalNumber(
            routeCoverageRecord,
            "plannedNaturalAttractions"
          ),
          coverageNotes: readOptionalStringArray(
            routeCoverageRecord,
            "coverageNotes",
            "travelPlan.routeCoverage"
          ),
        }
      : undefined,
    routeEvidence: routeEvidenceRecord
      ? {
          totalDrivingLegs:
            readOptionalNumber(routeEvidenceRecord, "totalDrivingLegs") ?? 0,
          verifiedDrivingLegs:
            readOptionalNumber(routeEvidenceRecord, "verifiedDrivingLegs") ?? 0,
          estimatedDrivingLegs:
            readOptionalNumber(routeEvidenceRecord, "estimatedDrivingLegs") ?? 0,
          safetyMarginMinutes:
            readOptionalNumber(routeEvidenceRecord, "safetyMarginMinutes") ?? 0,
          note:
            readText(
              routeEvidenceRecord,
              "note",
              "travelPlan.routeEvidence",
              false
            ) ?? "路线时长按已记录的路段证据核对。",
        }
      : undefined,
    weather: {
      city: readText(weather, "city", "travelPlan.weather")!,
      summary: weatherSummary,
      advice: readText(weather, "advice", "travelPlan.weather")!,
      source: readText(weather, "source", "travelPlan.weather", false),
      observedAt: readText(
        weather,
        "observedAt",
        "travelPlan.weather",
        false
      ),
      forecastAvailableThrough: readText(
        weather,
        "forecastAvailableThrough",
        "travelPlan.weather",
        false
      ),
      dynamicMonitoring:
        readOptionalBoolean(weather, "dynamicMonitoring"),
      refreshPolicy: readText(
        weather,
        "refreshPolicy",
        "travelPlan.weather",
        false
      ),
      locations: readOptionalArray(
        weather,
        "locations",
        "travelPlan.weather"
      ).map(normalizeWeatherLocation),
      forecast,
      routeRisks: readOptionalArray(
        weather,
        "routeRisks",
        "travelPlan.weather"
      ).map(normalizeWeatherRouteRisk),
    },
    transport: {
      recommended:
        recommended === "driving" || recommended === "transit"
          ? recommended
          : "mixed",
      reason: readText(transport, "reason", "travelPlan.transport")!,
      driving: normalizeTransportOption(transport.driving, "driving"),
      transit: normalizeTransportOption(transport.transit, "transit"),
      localMovement: readText(
        transport,
        "localMovement",
        "travelPlan.transport",
        false
      ),
    },
    budget,
    attractions: readArray(record, "attractions", "travelPlan").map(
      normalizeAttraction
    ),
    lodging: readArray(record, "lodging", "travelPlan").map(normalizeLodging),
    food: readArray(record, "food", "travelPlan").map(normalizeFood),
    pitfalls: readArray(record, "pitfalls", "travelPlan").map(normalizePitfall),
  };
}

function normalizePlaceName(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(
      /(?:住宿|酒店|宾馆|民宿|客栈|过夜|返(?:回)?驻地|驻地|第?\d+天|d\d+)/gi,
      ""
    )
    .replace(/[\s（）()【】［］[\]·•,，。:：/\\_\-—]/g, "");
}

function samePlace(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizePlaceName(left);
  const normalizedRight = normalizePlaceName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const shorterLength = Math.min(
    normalizedLeft.length,
    normalizedRight.length
  );
  return (
    shorterLength >= 3 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function displayWeatherLocationName(value?: string | null) {
  return (value ?? "")
    .trim()
    .replace(/(?:住宿|酒店|宾馆|民宿|客栈|过夜|驻地)$/g, "")
    .trim();
}

function normalizeWeatherLocationName(value?: string | null) {
  return displayWeatherLocationName(value)
    .replace(/[（）()【】［］[\]·•,，。:：/\\_\-—\s]/g, "")
    .toLowerCase();
}

function sameWeatherLocation(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeWeatherLocationName(left);
  const normalizedRight = normalizeWeatherLocationName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const shorterLength = Math.min(
    normalizedLeft.length,
    normalizedRight.length
  );
  return (
    shorterLength >= 3 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

/**
 * Keeps the weather overview honest for a route that crosses multiple places.
 * Only cities passed from completed provider calls are marked as queried;
 * model-authored forecast locations and status values are not query evidence.
 */
export function ensureTravelPlanWeatherLocations(
  plan: TravelPlan,
  stops: readonly TravelPlanRouteStop[],
  queriedWeatherLocations: readonly string[] = [plan.weather.city]
): TravelPlan {
  const routeNames = uniqueStrings(
    stops.map((stop) => displayWeatherLocationName(stop.name))
  );
  const queriedNames = uniqueStrings(queriedWeatherLocations);

  if (routeNames.length === 0 && queriedNames.length === 0) {
    return plan;
  }

  const names = [...routeNames];
  for (const queriedName of queriedNames) {
    if (!names.some((name) => sameWeatherLocation(name, queriedName))) {
      names.unshift(queriedName);
    }
  }

  const locations = names.map((name) => {
    const queried = queriedNames.some((queriedName) =>
      sameWeatherLocation(name, queriedName)
    );

    return {
      name,
      status: queried ? ("queried" as const) : ("refresh_required" as const),
      note: queried
        ? "已查询当前天气；行程日期和其他路段仍需出发前刷新。"
        : "路线经过该点，但当前天气查询未覆盖；出发前按路段刷新。",
    };
  });

  return {
    ...plan,
    weather: {
      ...plan.weather,
      locations,
    },
  };
}

function sameLngLat(left?: string | null, right?: string | null) {
  return Boolean(
    left &&
      right &&
      left
        .split(",")
        .map((part) => part.trim())
        .join(",") ===
        right
          .split(",")
          .map((part) => part.trim())
          .join(",")
  );
}

function parseLngLat(value?: string | null) {
  const parts = value?.split(",").map((part) => Number(part.trim()));
  if (
    !parts ||
    parts.length !== 2 ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[0] < -180 ||
    parts[0] > 180 ||
    parts[1] < -90 ||
    parts[1] > 90
  ) {
    return undefined;
  }

  return { longitude: parts[0], latitude: parts[1] };
}

function distanceInMeters(left?: string | null, right?: string | null) {
  const leftPoint = parseLngLat(left);
  const rightPoint = parseLngLat(right);
  if (!leftPoint || !rightPoint) return undefined;

  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(rightPoint.latitude - leftPoint.latitude);
  const longitudeDelta = toRadians(rightPoint.longitude - leftPoint.longitude);
  const leftLatitude = toRadians(leftPoint.latitude);
  const rightLatitude = toRadians(rightPoint.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 *
      Math.cos(leftLatitude) *
      Math.cos(rightLatitude);

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function sameLngLatWithin(
  left?: string | null,
  right?: string | null,
  maxMeters = 80
) {
  const distance = distanceInMeters(left, right);
  return distance !== undefined && distance <= maxMeters;
}

const CONCRETE_ATTRACTION_STOP_PATTERN =
  /草原|草甸|牧场|湖|湿地|森林|公园|景区|旅游区|火山|地质|山|峰|岭|河|峡谷|瀑布|观景|遗址|古城|寺|博物馆|纪念馆|故居|lake|wetland|forest|park|mountain|river|canyon|waterfall|viewpoint|museum|ruins/i;

function isAttractionRouteStop(
  attraction: TravelAttraction | undefined,
  stop: TravelPlanRouteStop
) {
  if (!attraction) return false;

  const matchesAttraction =
    samePlace(attraction.name, stop.name) ||
    sameLngLatWithin(attraction.lngLat, stop.lngLat, 250);
  if (!matchesAttraction) return false;

  return CONCRETE_ATTRACTION_STOP_PATTERN.test(
    [attraction.name, attraction.reason, stop.name, stop.address]
      .filter(Boolean)
      .join(" ")
  );
}

function isGenericRouteStop(
  stop: TravelPlanRouteStop,
  attraction?: TravelAttraction
) {
  // A stop can be both a scenic waypoint and an overnight transition point.
  // Let the concrete attraction identity win over lodging metadata so route
  // coverage reflects what the traveler actually visits.
  if (isAttractionRouteStop(attraction, stop)) {
    return false;
  }

  const text = [stop.name, stop.address, stop.kind, stop.notes]
    .filter(Boolean)
    .join(" ");
  return (
    /origin|start|出发|起点/i.test(stop.kind ?? "") ||
    /lodging|hotel|accommodation|住宿|酒店|宾馆|民宿|客栈/i.test(text) ||
    /市区|城区|市中心|县城|区域|镇区|服务区|机场|车站|高铁|收费站/i.test(
      text
    )
  );
}

function hasUsableRouteLeg(leg: TravelPlanRouteLeg) {
  const routeMinutes = Number(leg.routeMinutes);
  return Number.isFinite(routeMinutes) && routeMinutes > 0;
}

function hasRouteForStop(
  stop: TravelPlanRouteStop,
  stopIndex: number,
  legs: readonly TravelPlanRouteLeg[]
) {
  const explicitEndpoints = legs.some(
    (leg) =>
      Boolean(leg.originName || leg.originLngLat) ||
      Boolean(leg.destinationName || leg.destinationLngLat)
  );

  return legs.some((leg, legIndex) => {
    if (!hasUsableRouteLeg(leg)) return false;
    if (!explicitEndpoints) {
      return legIndex === stopIndex - 1 || legIndex === stopIndex;
    }

    return (
      samePlace(stop.name, leg.originName) ||
      samePlace(stop.name, leg.destinationName) ||
      sameLngLat(stop.lngLat, leg.originLngLat) ||
      sameLngLat(stop.lngLat, leg.destinationLngLat)
    );
  });
}

function isPlannedAttraction(
  attraction: TravelAttraction,
  stops: readonly TravelPlanRouteStop[],
  legs: readonly TravelPlanRouteLeg[]
) {
  return stops.some(
    (stop, stopIndex) =>
      !isGenericRouteStop(stop, attraction) &&
      (samePlace(attraction.name, stop.name) ||
        sameLngLatWithin(attraction.lngLat, stop.lngLat, 250)) &&
      hasRouteForStop(stop, stopIndex, legs)
  );
}

function isExactRouteStopMatch(
  attraction: TravelAttraction,
  stops: readonly TravelPlanRouteStop[]
) {
  const attractionName = normalizePlaceName(attraction.name);

  return stops.some((stop) => {
    if (isGenericRouteStop(stop, attraction)) return false;

    return (
      (Boolean(attractionName) && attractionName === normalizePlaceName(stop.name)) ||
      sameLngLatWithin(attraction.lngLat, stop.lngLat, 120)
    );
  });
}

function isMuseumAttraction(attraction: TravelAttraction) {
  return /博物馆/.test(
    [attraction.name, attraction.address, attraction.reason]
      .filter(Boolean)
      .join(" ")
  );
}

function sameAttractionIdentity(
  left: TravelAttraction,
  right: TravelAttraction
) {
  if (sameLngLatWithin(left.lngLat, right.lngLat, 80)) {
    return true;
  }

  // A broad substring match is useful for provider aliases, but do not
  // collapse a park and a museum merely because one name contains the other.
  if (isMuseumAttraction(left) !== isMuseumAttraction(right)) {
    return false;
  }

  return samePlace(left.name, right.name);
}

function mergeDuplicateAttractions(
  existing: TravelAttraction,
  incoming: TravelAttraction,
  stops: readonly TravelPlanRouteStop[]
) {
  const existingIsExactRouteStop = isExactRouteStopMatch(existing, stops);
  const incomingIsExactRouteStop = isExactRouteStopMatch(incoming, stops);
  let preferred = existing;

  if (incomingIsExactRouteStop && !existingIsExactRouteStop) {
    preferred = incoming;
  } else if (
    !incomingIsExactRouteStop &&
    existingIsExactRouteStop
  ) {
    preferred = existing;
  } else if (
    incoming.routeStatus === "planned" &&
    existing.routeStatus !== "planned"
  ) {
    preferred = incoming;
  }

  const fallback = preferred === existing ? incoming : existing;

  return {
    ...fallback,
    ...preferred,
    routeStatus:
      existing.routeStatus === "planned" || incoming.routeStatus === "planned"
        ? ("planned" as const)
        : ("alternative" as const),
    address: preferred.address ?? fallback.address,
    lngLat: preferred.lngLat ?? fallback.lngLat,
    naturalType: preferred.naturalType ?? fallback.naturalType,
    day: preferred.day ?? fallback.day,
    stayMinutes: preferred.stayMinutes ?? fallback.stayMinutes,
    bestTime: preferred.bestTime ?? fallback.bestTime,
    weatherNote: preferred.weatherNote ?? fallback.weatherNote,
    notes: preferred.notes ?? fallback.notes,
    evidence: preferred.evidence ?? fallback.evidence,
  } satisfies TravelAttraction;
}

function deduplicateAttractions(
  attractions: TravelAttraction[],
  stops: readonly TravelPlanRouteStop[]
) {
  const deduplicated: TravelAttraction[] = [];

  for (const attraction of attractions) {
    const duplicateIndex = deduplicated.findIndex((existing) =>
      sameAttractionIdentity(existing, attraction)
    );

    if (duplicateIndex < 0) {
      deduplicated.push(attraction);
      continue;
    }

    deduplicated[duplicateIndex] = mergeDuplicateAttractions(
      deduplicated[duplicateIndex],
      attraction,
      stops
    );
  }

  return deduplicated;
}

type NamedPlaceRecommendation = {
  name: string;
  poiId?: string;
  address?: string;
  lngLat?: string;
  evidence?: TravelRecommendationEvidence;
};

function isProviderBackedRecommendation(item: NamedPlaceRecommendation) {
  return item.evidence?.source === "amap_poi";
}

function sameRecommendationIdentity(
  left: NamedPlaceRecommendation,
  right: NamedPlaceRecommendation
) {
  if (left.poiId && right.poiId && left.poiId === right.poiId) {
    return true;
  }

  if (sameLngLatWithin(left.lngLat, right.lngLat, 50)) {
    return true;
  }

  const namesMatch =
    normalizePlaceName(left.name).length >= 4 &&
    samePlace(left.name, right.name);
  const addressesMatch =
    Boolean(left.address && right.address) && samePlace(left.address, right.address);

  return namesMatch || (addressesMatch && namesMatch);
}

function mergeNamedRecommendations<T extends NamedPlaceRecommendation>(
  existing: T,
  incoming: T
) {
  const preferred =
    isProviderBackedRecommendation(incoming) &&
    !isProviderBackedRecommendation(existing)
      ? incoming
      : existing;
  const fallback = preferred === existing ? incoming : existing;

  return {
    ...fallback,
    ...preferred,
    poiId: preferred.poiId ?? fallback.poiId,
    address: preferred.address ?? fallback.address,
    lngLat: preferred.lngLat ?? fallback.lngLat,
    evidence: preferred.evidence ?? fallback.evidence,
  } as T;
}

function deduplicateNamedRecommendations<T extends NamedPlaceRecommendation>(
  items: T[]
) {
  const deduplicated: T[] = [];

  for (const item of items) {
    const duplicateIndex = deduplicated.findIndex((existing) =>
      sameRecommendationIdentity(existing, item)
    );
    if (duplicateIndex < 0) {
      deduplicated.push(item);
    } else {
      deduplicated[duplicateIndex] = mergeNamedRecommendations(
        deduplicated[duplicateIndex],
        item
      );
    }
  }

  return deduplicated;
}

export function deduplicateTravelRecommendations(plan: TravelPlan): TravelPlan {
  return {
    ...plan,
    lodging: deduplicateNamedRecommendations(plan.lodging),
    food: deduplicateNamedRecommendations(plan.food),
  };
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function alignTravelPlanAttractionsWithRoute(
  plan: TravelPlan,
  stops: readonly TravelPlanRouteStop[],
  legs: readonly TravelPlanRouteLeg[],
  prompt?: string
): TravelPlan {
  const attractions = deduplicateAttractions(
    plan.attractions.map((attraction) => ({
      ...attraction,
      routeStatus: isPlannedAttraction(attraction, stops, legs)
        ? ("planned" as const)
        : ("alternative" as const),
    })),
    stops
  );

  const requestedNaturalTypes = uniqueStrings([
    ...(plan.routeCoverage?.requestedNaturalTypes ?? []),
    ...(prompt ? parseRequestedNaturalTypes(prompt) : []),
  ]);
  const plannedNaturalTypes = new Set(
    attractions
      .filter(
        (attraction) =>
          attraction.category === "natural" &&
          attraction.routeStatus === "planned"
      )
      .flatMap(naturalAttractionTypes)
  );
  const availableNaturalTypes = new Set(
    attractions
      .filter((attraction) => attraction.category === "natural")
      .flatMap(naturalAttractionTypes)
  );
  const unmetNaturalTypes = requestedNaturalTypes.filter(
    (type) => !plannedNaturalTypes.has(type)
  );
  const naturalPriority =
    plan.routeCoverage?.naturalPriority === true ||
    hasNaturalSceneryPriority(prompt);
  const minimumPlannedNaturalAttractions = naturalPriority
    ? requiredPlannedNaturalAttractionCount(plan.days)
    : undefined;
  const plannedNaturalAttractions = attractions.filter(
    (attraction) =>
      attraction.category === "natural" && attraction.routeStatus === "planned"
  ).length;
  const coverageNotes = [...(plan.routeCoverage?.coverageNotes ?? [])];
  for (const type of unmetNaturalTypes) {
    if (!availableNaturalTypes.has(type)) {
      coverageNotes.push(
        `未找到有证据支持的${type}主路线候选，当前以其他自然景观替代，出发前可根据天气和路况重新安排。`
      );
    }
  }
  if (
    naturalPriority &&
    minimumPlannedNaturalAttractions !== undefined &&
    plannedNaturalAttractions < minimumPlannedNaturalAttractions
  ) {
    coverageNotes.push(
      `自然风光优先要求至少 ${minimumPlannedNaturalAttractions} 个自然景点进入主路线，当前已安排 ${plannedNaturalAttractions} 个；若无法满足，必须说明天气、路况、开放或驾驶上限造成的取舍，并给出替代方案。`
    );
  }

  const routeCoverage: TravelRouteCoverage = {
    plannedAttractions: attractions
      .filter((attraction) => attraction.routeStatus === "planned")
      .map((attraction) => attraction.name),
    alternativeAttractions: attractions
      .filter((attraction) => attraction.routeStatus === "alternative")
      .map((attraction) => attraction.name),
    ...(naturalPriority
      ? {
          naturalPriority: true,
          minimumPlannedNaturalAttractions,
          plannedNaturalAttractions,
        }
      : {}),
  };
  if (requestedNaturalTypes.length > 0) {
    routeCoverage.requestedNaturalTypes = requestedNaturalTypes;
    routeCoverage.unmetNaturalTypes = unmetNaturalTypes;
    routeCoverage.coverageNotes = uniqueStrings(coverageNotes);
  }

  return {
    ...deduplicateTravelRecommendations(plan),
    attractions,
    routeCoverage,
  };
}

function readPayloadOption(value: unknown) {
  return isRecord(value) ? value : {};
}

function optionFallback(
  currentValue: unknown,
  evidence: TravelTransportRouteEvidence,
  label: string
) {
  const current = readPayloadOption(currentValue);
  return {
    ...current,
    summary:
      typeof current.summary === "string" && current.summary.trim()
        ? current.summary
        : `${label}约 ${evidence.durationMinutes} 分钟`,
    reason:
      typeof current.reason === "string" && current.reason.trim()
        ? current.reason
        : "根据本次会话已查询的路线结果填写，出发前需重新刷新。",
    durationMinutes: evidence.durationMinutes,
    route:
      typeof current.route === "string" && current.route.trim()
        ? current.route
        : evidence.summary,
  };
}

export function completeTravelPlanTransportPayload(
  value: unknown,
  evidence: TravelTransportEvidence
) {
  if (!evidence.driving || !evidence.transit) {
    throw new Error(
      "无法自动补全 travelPlan.transport：当前会话缺少自驾和公共交通两种已查询路线证据。"
    );
  }

  const plan = readRecord(value, "travelPlan");
  const currentTransport = readPayloadOption(plan.transport);
  const driving = optionFallback(
    currentTransport.driving,
    evidence.driving,
    "自驾"
  );
  const transit = optionFallback(
    currentTransport.transit,
    evidence.transit,
    "公共交通"
  );
  const recommended =
    evidence.driving.durationMinutes <= evidence.transit.durationMinutes
      ? "driving"
      : "transit";

  return {
    ...plan,
    transport: {
      ...currentTransport,
      recommended,
      reason:
        typeof currentTransport.reason === "string" &&
        currentTransport.reason.trim()
          ? currentTransport.reason
          : `已比较已查询路线：自驾约 ${evidence.driving.durationMinutes} 分钟，公共交通约 ${evidence.transit.durationMinutes} 分钟。`,
      driving,
      transit,
    },
  };
}

const TRAVEL_PLAN_ARRAY_FIELDS = [
  "attractions",
  "lodging",
  "food",
  "pitfalls",
] as const;

/**
 * Recover the recommendation arrays when a model flattens them alongside
 * travelPlan even though the tool contract nests them inside travelPlan.
 */
export function completeTravelPlanArrayPayload(
  value: unknown,
  fallback: Partial<
    Record<(typeof TRAVEL_PLAN_ARRAY_FIELDS)[number], unknown>
  > & { budget?: unknown }
) {
  const plan = readRecord(value, "travelPlan");
  const completed = { ...plan };

  for (const field of TRAVEL_PLAN_ARRAY_FIELDS) {
    if (!Array.isArray(completed[field]) && Array.isArray(fallback[field])) {
      completed[field] = fallback[field];
    }
  }

  if (!isRecord(completed.budget) && isRecord(fallback.budget)) {
    completed.budget = fallback.budget;
  }

  return completed;
}

function enumerateDateKeys(dateRange: TravelWeatherDateRange) {
  const start = new Date(`${dateRange.startDate}T00:00:00Z`);
  const end = new Date(`${dateRange.endDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end && dates.length <= 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function ensureTravelPlanWeatherCoverage(
  plan: TravelPlan,
  dateRange?: TravelWeatherDateRange
) {
  if (!dateRange) {
    return plan;
  }

  const itineraryDates = enumerateDateKeys(dateRange);
  if (itineraryDates.length === 0) {
    return plan;
  }

  const forecast = plan.weather.forecast ?? [];
  const forecastByDate = new Map<string, TravelWeatherForecast>();
  for (const item of forecast) {
    if (item.date && !forecastByDate.has(item.date)) {
      forecastByDate.set(item.date, item);
    }
  }

  const itineraryForecast = itineraryDates.map(
    (date): TravelWeatherForecast =>
      forecastByDate.get(date) ?? {
        date,
        location: plan.weather.city,
        summary: "当前预报未覆盖该日期，天气未知；出发前刷新",
        risk: "medium",
        drivingAdvice: "出发前刷新天气和路况，再决定当天的自驾时段",
        outdoorAdvice: "根据刷新后的降雨和大风预警调整户外景点",
      }
  );
  const itineraryDateSet = new Set(itineraryDates);
  const referenceForecast = forecast.filter(
    (item) => !item.date || !itineraryDateSet.has(item.date)
  );

  return {
    ...plan,
    weather: {
      ...plan.weather,
      forecast: [...itineraryForecast, ...referenceForecast],
    },
  };
}

export function requiredNaturalAttractionCount(days?: number) {
  return days && days >= 4 ? 4 : 3;
}

const NATURAL_SCENERY_PRIORITY_PATTERN =
  /(?:优先|重点|主打|以|偏向)[^。！？\n]{0,12}(?:自然风光|自然景观|自然景色|山水风景)|(?:自然风光|自然景观|自然景色|山水风景)[^。！？\n]{0,12}(?:优先|为主|为重点|多安排)/i;

export function hasNaturalSceneryPriority(prompt?: string) {
  return Boolean(prompt?.trim() && NATURAL_SCENERY_PRIORITY_PATTERN.test(prompt));
}

export function requiredPlannedNaturalAttractionCount(days?: number) {
  return days && days >= 4 ? 4 : 2;
}

const NATURAL_TYPE_PATTERNS = [
  ["wetland", /湿地|沼泽|芦苇|wetland|marsh|swamp/],
  ["lake", /湖|湖泊|水库|lake|reservoir/],
  ["volcanic", /火山|熔岩|地质|volcanic|geological|lava/],
  ["grassland", /草原|草甸|牧场|grassland|steppe|prairie|meadow|pasture/],
  ["forest", /森林|林场|原始林|forest|woods/],
  ["coast", /海|海岸|海滨|海岛|海滩|滨海|coast|coastal|island|beach|seaside/],
  ["river", /河流|河道|水系|溪流|江|river|stream|waterway|riverbank/],
  ["canyon", /峡谷|沟|峪|河谷|canyon|gorge/],
  ["waterfall", /瀑布|飞瀑|waterfall/],
  ["mountain", /山|峰|岭|山口|mountain|peak|ridge|hill/],
  ["park", /公园|植物园|风景区|景区|park|garden|scenic area/],
  ["viewpoint", /观景台|观景|台地|草原天路|viewpoint|lookout|panorama/],
] as const;

const LODGING_LIKE_ATTRACTION_NAME_PATTERN =
  /住宿|酒店|宾馆|旅馆|旅店|民宿|客栈|hotel|hostel|inn/i;

const REQUESTED_NATURAL_TYPE_PATTERNS = [
  ["wetland", /湿地|沼泽|芦苇|wetland|marsh|swamp/],
  ["lake", /湖泊?|水库|湖边|lake|reservoir/],
  ["volcanic", /火山|熔岩|火山地质|volcanic|lava/],
  ["grassland", /草原|草甸|牧场|grassland|steppe|prairie|meadow|pasture/],
  ["forest", /森林|林地|原始林|森林公园|forest|woods/],
  ["coast", /海岸|海滨|海岛|海滩|滨海|coast|coastal|island|beach|seaside/],
  ["river", /河流|河谷|溪流|水系|river|stream|waterway|riverbank/],
  ["canyon", /峡谷|沟|峪|canyon|gorge/],
  ["waterfall", /瀑布|飞瀑|waterfall/],
  ["mountain", /山地|山景|山脉|山峰|mountain|peak|ridge|hill/],
  ["park", /自然公园|国家公园|植物园|park|garden/],
  ["viewpoint", /观景台|观景点|viewpoint|lookout|panorama/],
] as const;

export function parseRequestedNaturalTypes(prompt: string) {
  const text = prompt.trim().toLowerCase();
  return REQUESTED_NATURAL_TYPE_PATTERNS.filter(([, pattern]) =>
    pattern.test(text)
  ).map(([type]) => type);
}

function naturalAttractionTypes(attraction: TravelAttraction): string[] {
  const explicitType = attraction.naturalType?.trim();
  const text = [
    explicitType,
    attraction.name,
    attraction.reason,
    attraction.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const types = NATURAL_TYPE_PATTERNS.filter(([, pattern]) =>
    pattern.test(text)
  ).map(([type]) => type);

  return types.length > 0 ? types : (["other"] as const);
}

export function assertTravelPlanAttractionCoverage(
  plan: TravelPlan,
  options: { prompt?: string; requirePlannedRequestedTypes?: boolean } = {}
) {
  const lodgingMisclassifiedAsNatural = plan.attractions.filter(
    (attraction) =>
      attraction.category === "natural" &&
      LODGING_LIKE_ATTRACTION_NAME_PATTERN.test(attraction.name)
  );
  if (lodgingMisclassifiedAsNatural.length > 0) {
    throw new Error(
      `自然景观候选不能使用住宿地点名称：${lodgingMisclassifiedAsNatural
        .map((attraction) => attraction.name)
        .join("、")}。请把它替换为有地点证据的真实自然景点。`
    );
  }

  const naturalCount = plan.attractions.filter(
    (attraction) => attraction.category === "natural"
  ).length;
  const culturalCount = plan.attractions.filter(
    (attraction) => attraction.category === "cultural"
  ).length;
  const requiredNaturalCount = requiredNaturalAttractionCount(plan.days);

  if (naturalCount < requiredNaturalCount) {
    throw new Error(
      `旅行规划至少需要 ${requiredNaturalCount} 个自然景观候选，当前只有 ${naturalCount} 个。请扩大自然景观搜索范围后重试。`
    );
  }

  if (culturalCount < 1) {
    throw new Error("旅行规划至少需要 1 个人文景点候选。");
  }

  const naturalTypes = new Set(
    plan.attractions
      .filter((attraction) => attraction.category === "natural")
      .flatMap(naturalAttractionTypes)
  );
  const requiredNaturalTypeCount = naturalCount >= 4 ? 3 : 2;
  if (naturalTypes.size < requiredNaturalTypeCount) {
    const detectedTypes = [...naturalTypes].join("、") || "未识别";
    throw new Error(
      `旅行规划的自然景观至少需要覆盖 ${requiredNaturalTypeCount} 种不同类型（例如湖泊、山地、森林、湿地或草原），当前只有 ${naturalTypes.size} 种（已识别：${detectedTypes}）。请扩大自然景观搜索范围后重试。`
    );
  }

  if (!options.requirePlannedRequestedTypes) return;

  const requestedNaturalTypes = uniqueStrings([
    ...(plan.routeCoverage?.requestedNaturalTypes ?? []),
    ...(options.prompt ? parseRequestedNaturalTypes(options.prompt) : []),
  ]);

  if (hasNaturalSceneryPriority(options.prompt)) {
    const minimumPlannedNaturalAttractions =
      plan.routeCoverage?.minimumPlannedNaturalAttractions ??
      requiredPlannedNaturalAttractionCount(plan.days);
    const plannedNaturalAttractions = plan.attractions.filter(
      (attraction) =>
        attraction.category === "natural" &&
        attraction.routeStatus === "planned"
    ).length;

    if (plannedNaturalAttractions < minimumPlannedNaturalAttractions) {
      throw new Error(
        `自然风光优先要求至少 ${minimumPlannedNaturalAttractions} 个自然景点进入主路线，当前只有 ${plannedNaturalAttractions} 个。请把更多自然景点加入 stops/legs；如果确实受天气、开放、路况或每日驾驶上限限制，必须写明取舍原因和自然景观替代方案。`
      );
    }
  }

  if (requestedNaturalTypes.length === 0) return;

  for (const type of requestedNaturalTypes) {
    const candidates = plan.attractions.filter(
      (attraction) =>
        attraction.category === "natural" &&
        naturalAttractionTypes(attraction).includes(type)
    );
    const planned = candidates.some(
      (attraction) => attraction.routeStatus === "planned"
    );
    if (planned) continue;

    if (candidates.length > 0) {
      throw new Error(
        `用户明确要求的自然景观类型 ${type} 已有候选，但没有进入主路线。请把对应景点加入 stops/legs；若确实放弃，必须先调整请求或给出可执行替代路线。`
      );
    }

    const unmet = plan.routeCoverage?.unmetNaturalTypes?.includes(type);
    const hasReason = plan.routeCoverage?.coverageNotes?.some((note) =>
      note.toLowerCase().includes(type.toLowerCase())
    );
    const hasAlternative =
      (plan.routeCoverage?.alternativeAttractions.length ?? 0) > 0;
    if (!unmet || !hasReason || !hasAlternative) {
      throw new Error(
        `用户明确要求的自然景观类型 ${type} 没有可执行覆盖。请补充该类型的检索证据和路线停靠点，或在 routeCoverage 中写明放弃原因并提供备选自然景观。`
      );
    }
  }
}

export function assertTravelPlanOperationalCompleteness(
  plan: TravelPlan,
  options: { drivingLegOrders?: number[] } = {}
) {
  if (plan.weather.dynamicMonitoring !== true) {
    throw new Error(
      "旅行规划必须明确开启动态天气监控（weather.dynamicMonitoring=true）。"
    );
  }

  if (!plan.weather.refreshPolicy?.trim()) {
    throw new Error(
      "旅行规划必须提供天气刷新策略（weather.refreshPolicy），说明出发前和路线复查时如何更新天气。"
    );
  }

  const drivingLegOrders = options.drivingLegOrders ?? [];
  const routeRisks = plan.weather.routeRisks ?? [];
  if (routeRisks.length === 0) {
    throw new Error(
      "旅行规划必须为自驾路段提供 weather.routeRisks，并写明驾驶建议和具体动作。"
    );
  }

  if (drivingLegOrders.length > 0) {
    const riskOrders = new Set(
      routeRisks
        .map((risk) => risk.legOrder)
        .filter((order): order is number => order !== undefined)
    );
    if (
      routeRisks.length < drivingLegOrders.length ||
      riskOrders.size < drivingLegOrders.length ||
      drivingLegOrders.some((order) => !riskOrders.has(order))
    ) {
      throw new Error(
        `旅行规划必须为每个自驾路段提供天气风险（当前 ${routeRisks.length} 条，要求覆盖 ${drivingLegOrders.length} 个路段）。`
      );
    }
  }

  for (const [label, option] of [
    ["自驾", plan.transport.driving],
    ["公共交通", plan.transport.transit],
  ] as const) {
    if (!option.durationMinutes || option.durationMinutes <= 0) {
      throw new Error(`旅行规划必须提供${label}方案的有效预计时长。`);
    }

    if (!option.route?.trim()) {
      throw new Error(`旅行规划必须提供${label}方案的路线依据。`);
    }
  }

  if (plan.lodging.length === 0) {
    throw new Error("旅行规划至少需要 1 条住宿建议。");
  }

  if (plan.food.length === 0) {
    throw new Error("旅行规划至少需要 1 条美食建议。");
  }

  if (plan.pitfalls.length < 3) {
    throw new Error(
      `旅行规划至少需要 3 条具体避坑建议，当前只有 ${plan.pitfalls.length} 条。`
    );
  }
}

export function assertTravelPlanBudget(plan: TravelPlan) {
  if (!plan.budget || plan.budget.breakdown.length === 0) {
    throw new Error(
      "旅行规划必须提供总预算和至少一项费用分解；未知价格请明确标注待核实。"
    );
  }
}

export function parseTravelPlanJson(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return normalizeTravelPlan(JSON.parse(value));
  } catch {
    return null;
  }
}
