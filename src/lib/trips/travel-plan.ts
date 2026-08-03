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
  budget?: string;
  notes?: string;
  evidence?: TravelRecommendationEvidence;
};

export type TravelFood = {
  name: string;
  area?: string;
  mustTry: string;
  reason: string;
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
  weather: TravelPlanWeather;
  transport: TravelTransport;
  budget?: TravelBudget;
  attractions: TravelAttraction[];
  lodging: TravelLodging[];
  food: TravelFood[];
  pitfalls: TravelPitfall[];
};

export type TravelWeatherDateRange = {
  startDate: string;
  endDate: string;
};

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
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
  const weather = readRecord(record.weather, "travelPlan.weather");
  const transport = readRecord(record.transport, "travelPlan.transport");
  const recommended = readText(
    transport,
    "recommended",
    "travelPlan.transport"
  );
  const budget =
    record.budget === undefined
      ? undefined
      : normalizeBudget(record.budget);

  return {
    destination: readText(record, "destination", "travelPlan")!,
    summary: readText(record, "summary", "travelPlan")!,
    days: readOptionalNumber(record, "days"),
    weather: {
      city: readText(weather, "city", "travelPlan.weather")!,
      summary: readText(weather, "summary", "travelPlan.weather")!,
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
        readOptionalBoolean(weather, "dynamicMonitoring") ?? true,
      refreshPolicy: readText(
        weather,
        "refreshPolicy",
        "travelPlan.weather",
        false
      ),
      forecast: readOptionalArray(
        weather,
        "forecast",
        "travelPlan.weather"
      ).map(normalizeWeatherForecast),
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

export function assertTravelPlanAttractionCoverage(plan: TravelPlan) {
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
