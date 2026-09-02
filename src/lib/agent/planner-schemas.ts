import type { AgentChatToolDefinition } from "@/lib/agent/chat-client";
import type { AgentPlanningPurpose } from "@/lib/agent/types";

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

const travelRouteCoverageSchema = objectParameters({
  plannedAttractions: arrayOfItems({ type: "string" }),
  alternativeAttractions: arrayOfItems({ type: "string" }),
  requestedNaturalTypes: arrayOfItems({ type: "string" }),
  unmetNaturalTypes: arrayOfItems({ type: "string" }),
  naturalPriority: { type: "boolean" },
  minimumPlannedNaturalAttractions: { type: "number" },
  plannedNaturalAttractions: { type: "number" },
  coverageNotes: arrayOfItems({ type: "string" }),
});

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
    routeCoverage: travelRouteCoverageSchema,
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
    routeCoverage: travelRouteCoverageSchema,
    weather: travelWeatherSchema,
    transport: travelTransportSchema,
  },
  ["destination", "summary", "weather", "transport"]
);

export const TOOL_DEFINITIONS: AgentChatToolDefinition[] = [
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
