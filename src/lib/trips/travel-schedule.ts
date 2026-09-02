import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import * as SunCalc from "suncalc";
import type {
  CreatePlannedTripInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";
import type { TravelLodging, TravelPlan } from "@/lib/trips/travel-plan";

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_FIRST_DAY_START = { hour: 7, minute: 0 };
const DEFAULT_DAY_START = { hour: 8, minute: 0 };
const DEFAULT_RETURN_DAY_START = { hour: 6, minute: 30 };
const MAX_DATE_RANGE_DAYS = 31;
const HIGH_DAILY_DRIVING_MINUTES = 8 * 60;
const MAX_TRUSTED_MODEL_TOTAL_DELTA_MINUTES = 2 * 60;
const LONG_DAYLIGHT_DRIVING_MINUTES = 90;
const DAYLIGHT_SAFETY_BUFFER_MINUTES = 30;

export type TravelDateRange = {
  startDate: string;
  endDate: string;
  days: number;
};

type PlainDate = {
  year: number;
  month: number;
  day: number;
};

export type NormalizeTravelScheduleInput = {
  prompt: string;
  timezone: string;
  targetArriveAt?: Date;
  stops: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
};

export type NormalizeTravelScheduleResult = {
  targetArriveAt?: Date;
  stops: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
  dateRange?: TravelDateRange;
};

function toDateKey(value: PlainDate) {
  return `${value.year.toString().padStart(4, "0")}-${value.month
    .toString()
    .padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`;
}

function parsePlainDate(value: PlainDate): string | null {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));

  if (
    date.getUTCFullYear() !== value.year ||
    date.getUTCMonth() !== value.month - 1 ||
    date.getUTCDate() !== value.day
  ) {
    return null;
  }

  return toDateKey(value);
}

function parseDateKey(value: string): PlainDate {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

const EXPLICIT_TIME_ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Model tool arguments usually contain wall-clock times without an offset.
 * Interpret those values in the trip timezone so the result is stable even
 * when the server process runs in UTC.
 */
export function parseDateTimeInTimeZone(
  value: string,
  timezone = DEFAULT_TIME_ZONE
) {
  const trimmed = value.trim();
  return EXPLICIT_TIME_ZONE_SUFFIX.test(trimmed)
    ? new Date(trimmed)
    : fromZonedTime(trimmed, timezone || DEFAULT_TIME_ZONE);
}

function addCalendarDays(value: PlainDate, days: number): PlainDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function calendarDayDifference(start: string, end: string) {
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  return Math.round(
    (Date.UTC(endDate.year, endDate.month - 1, endDate.day) -
      Date.UTC(startDate.year, startDate.month - 1, startDate.day)) /
      86_400_000
  );
}

function normalizeDateRange(
  start: PlainDate,
  end: PlainDate,
  endYearWasExplicit: boolean
): TravelDateRange | null {
  const startDate = parsePlainDate(start);
  if (!startDate) return null;

  let resolvedEnd = end;
  let endDate = parsePlainDate(resolvedEnd);

  if (!endDate || endDate < startDate) {
    if (!endYearWasExplicit) {
      resolvedEnd = {
        ...end,
        year: start.year + (end.month <= start.month ? 1 : 0),
      };
      endDate = parsePlainDate(resolvedEnd);
    }
  }

  if (!endDate || endDate < startDate) return null;

  const days = calendarDayDifference(startDate, endDate) + 1;
  if (days < 1 || days > MAX_DATE_RANGE_DAYS) return null;

  return { startDate, endDate, days };
}

export function parseTravelDateRange(
  prompt: string,
  referenceDate = new Date()
): TravelDateRange | null {
  const chineseRange = prompt.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:\s*(?:[（(][^）)]{0,16}[）)]|(?:周|星期)[一二三四五六日天])\s*)?(?:至|到|～|~|—|-)\s*(?:(\d{4})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日?/
  );

  if (chineseRange) {
    const [, year, month, day, endYear, endMonth, endDay] = chineseRange;
    return normalizeDateRange(
      { year: Number(year), month: Number(month), day: Number(day) },
      {
        year: Number(endYear ?? year),
        month: Number(endMonth ?? month),
        day: Number(endDay),
      },
      Boolean(endYear)
    );
  }

  const isoRange = prompt.match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(?:\s*(?:[（(][^）)]{0,16}[）)]|(?:周|星期)[A-Za-z一二三四五六日天]+)\s*)?(?:至|到|～|~|—|-)\s*(?:(\d{4})[-/])?(?:(\d{1,2})[-/])?(\d{1,2})/
  );

  if (isoRange) {
    const [, year, month, day, endYear, endMonth, endDay] = isoRange;
    return normalizeDateRange(
      { year: Number(year), month: Number(month), day: Number(day) },
      {
        year: Number(endYear ?? year),
        month: Number(endMonth ?? month),
        day: Number(endDay),
      },
      Boolean(endYear)
    );
  }

  // Users commonly omit the year for an upcoming trip, for example
  // "8月8日至12日". Resolve that shorthand against the current calendar year
  // so date-bound safety checks (daily driving, daylight, and reminders) still
  // run instead of silently accepting an unbounded itinerary.
  const chineseYearlessRange = prompt.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:至|到|～|~|—|-)\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日?/
  );
  const referenceYear = Number(
    formatInTimeZone(referenceDate, DEFAULT_TIME_ZONE, "yyyy")
  );

  if (chineseYearlessRange) {
    const [, month, day, endMonth, endDay] = chineseYearlessRange;
    return normalizeDateRange(
      { year: referenceYear, month: Number(month), day: Number(day) },
      {
        year: referenceYear,
        month: Number(endMonth ?? month),
        day: Number(endDay),
      },
      false
    );
  }

  const numericYearlessRange = prompt.match(
    /(\d{1,2})[\/]\s*(\d{1,2})\s*(?:至|到|～|~|—|-)\s*(?:(\d{1,2})[\/]\s*)?(\d{1,2})/
  );

  if (!numericYearlessRange) return null;

  const [, month, day, endMonth, endDay] = numericYearlessRange;
  return normalizeDateRange(
    { year: referenceYear, month: Number(month), day: Number(day) },
    {
      year: referenceYear,
      month: Number(endMonth ?? month),
      day: Number(endDay),
    },
    false
  );
}

const DAILY_DRIVING_LIMIT_PATTERN =
  /(?:每天|每日|单日|日均)[^。！？\n]{0,24}?(?:自驾|驾车|驾驶|开车|行车)[^。！？\n]{0,12}?(?:不超过|最多|上限(?:为)?|控制在)[^。！？\n]{0,8}?(\d+(?:\.\d+)?)\s*(小时|h|分钟|min)/i;
const DAILY_DRIVING_LIMIT_REVERSED_PATTERN =
  /(?:每天|每日|单日|日均)[^。！？\n]{0,24}?(?:不超过|最多|上限(?:为)?|控制在)[^。！？\n]{0,8}?(\d+(?:\.\d+)?)\s*(小时|h|分钟|min)[^。！？\n]{0,12}?(?:自驾|驾车|驾驶|开车|行车)/i;

function durationToMinutes(value: string, unit: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;

  const normalizedUnit = unit.toLowerCase();
  const minutes = normalizedUnit === "小时" || normalizedUnit === "h"
    ? numeric * 60
    : numeric;

  return minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : undefined;
}

/**
 * Reads an explicit daily self-drive ceiling from the user's request.
 * An omitted ceiling deliberately remains undefined so ordinary travel plans
 * keep the existing comfort-threshold warning instead of being rejected.
 */
export function parseDailyDrivingLimitMinutes(prompt: string) {
  const compactPrompt = prompt.replace(/\s+/g, "");
  const match = compactPrompt.match(DAILY_DRIVING_LIMIT_PATTERN);
  const reversedMatch = compactPrompt.match(DAILY_DRIVING_LIMIT_REVERSED_PATTERN);
  const captured = match ?? reversedMatch;

  if (!captured) return undefined;

  const [, value, unit] = captured;
  return durationToMinutes(value, unit);
}

function parsePromptStartClock(prompt: string) {
  const clockMatch = prompt.match(
    /(?:出发|启程|开始|返程|回程)[^\n，。；;]{0,12}?(\d{1,2})[:：](\d{2})/
  );

  if (clockMatch) {
    const hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return undefined;
}

function buildZonedDate(
  date: string,
  clock: { hour: number; minute: number },
  timezone: string
) {
  try {
    return fromZonedTime(
      `${date} ${clock.hour.toString().padStart(2, "0")}:${clock.minute
        .toString()
        .padStart(2, "0")}:00`,
      timezone || DEFAULT_TIME_ZONE
    );
  } catch {
    return fromZonedTime(
      `${date} ${clock.hour.toString().padStart(2, "0")}:${clock.minute
        .toString()
        .padStart(2, "0")}:00`,
      DEFAULT_TIME_ZONE
    );
  }
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + Math.max(0, minutes) * 60_000);
}

export function isTravelDayMarker(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return false;

  return (
    /^(?:D|Day)\s*\d{1,2}$/i.test(normalized) ||
    /^第\s*\d{1,2}\s*天$/.test(normalized)
  );
}

function readDayMarker(value?: string) {
  if (!value) return undefined;

  const match =
    value.match(/\b(?:D|Day)\s*(\d{1,2})\b/i) ??
    value.match(/第\s*(\d{1,2})\s*天/);
  return match ? Number(match[1]) : undefined;
}

function legText(leg: PlannedTripLegInput) {
  return [
    leg.routeTitle,
    leg.segmentTitle,
    leg.segmentDetail,
    leg.routeRationale,
  ]
    .filter(Boolean)
    .join(" ");
}

const EXPLICIT_CLOCK_PATTERNS = [
  /(?:(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜间)\s*)?(?:[01]?\d|2[0-3])[:：][0-5]\d/g,
  /(?:(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜间)\s*)?(?:[01]?\d|2[0-3])\s*(?:点|时)(?:\s*[0-5]?\d\s*分)?/g,
] as const;

const SCHEDULE_CLOCK_TOKEN = "__SCHEDULE_CLOCK__";
const STRUCTURED_SCHEDULE_PLACEHOLDER = /按行程结构化时间\s*[-–—至]\s*按行程结构化时间(?:\s*游览)?/g;

export function normalizeScheduledText(value?: string) {
  if (!value) return value;

  let text = EXPLICIT_CLOCK_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, SCHEDULE_CLOCK_TOKEN),
    value
  );

  const tokenPattern = new RegExp(
    `${SCHEDULE_CLOCK_TOKEN}\\s*(?:[-–—~至]\\s*${SCHEDULE_CLOCK_TOKEN})+`,
    "g"
  );

  return text
    .replace(STRUCTURED_SCHEDULE_PLACEHOLDER, "按行程安排")
    .replaceAll("按行程结构化时间", "按行程安排")
    .replace(tokenPattern, "")
    .replace(
      new RegExp(
        `(?:于|在|约|大约)\\s*${SCHEDULE_CLOCK_TOKEN}`,
        "g"
      ),
      ""
    )
    .replace(
      new RegExp(`${SCHEDULE_CLOCK_TOKEN}\\s*(?:左右|前|后)`, "g"),
      ""
    )
    .replaceAll(SCHEDULE_CLOCK_TOKEN, "")
    .replace(/\s+([，。；：、,.!?！？])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isReturnLeg(leg: PlannedTripLegInput) {
  return /返程|返京|回北京|返回北京|回程/.test(legText(leg));
}

function totalLegMinutes(leg: PlannedTripLegInput) {
  const componentMinutes = (leg.bufferComponents ?? []).reduce(
    (total, component) => total + Math.max(0, Math.round(component.minutes)),
    0
  );
  const bufferMinutes = Math.max(
    0,
    Math.round(leg.bufferMinutes ?? componentMinutes)
  );
  const routeAndBufferMinutes =
    Math.max(0, Math.round(leg.routeMinutes)) + bufferMinutes;
  const modelTotalMinutes = Math.round(leg.totalMinutes ?? 0);
  const modelDelta = modelTotalMinutes - routeAndBufferMinutes;

  // A small delta can be a legitimate venue or transfer buffer supplied by the
  // model. A large delta often comes from copying a comparison duration (for
  // example, an overnight transit option); that value must not turn the
  // selected driving leg into an accidental cross-midnight segment.
  return modelDelta >= 0 && modelDelta <= MAX_TRUSTED_MODEL_TOTAL_DELTA_MINUTES
    ? modelTotalMinutes
    : routeAndBufferMinutes;
}

function isExplicitScheduleSafe(
  input: NormalizeTravelScheduleInput,
  dateRange: TravelDateRange
) {
  if (
    input.legs.some(
      (leg) => !leg.latestDepartAt || !leg.targetArriveAt
    )
  ) {
    return false;
  }

  let previousArrival: Date | undefined;

  for (const [index, leg] of input.legs.entries()) {
    const latestDepartAt = leg.latestDepartAt!;
    const targetArriveAt = leg.targetArriveAt!;
    const departureDate = formatInTimeZone(
      latestDepartAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    const arrivalDate = formatInTimeZone(
      targetArriveAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    const scheduledMinutes = Math.round(
      (targetArriveAt.getTime() - latestDepartAt.getTime()) / 60_000
    );

    const previousLeg = input.legs[index - 1];
    const previousDestinationIndex = previousLeg
      ? findDestinationStopIndex(
          input.stops,
          previousLeg,
          Math.min(index, input.stops.length - 1)
        )
      : -1;
    const requiredStopStayMinutes =
      previousDestinationIndex >= 0
        ? Math.max(
            0,
            Math.round(
              input.stops[previousDestinationIndex]?.plannedStayMin ?? 0
            )
          )
        : 0;
    const earliestNextDeparture = previousArrival
      ? addMinutes(previousArrival, requiredStopStayMinutes)
      : undefined;

    if (
      targetArriveAt <= latestDepartAt ||
      (previousArrival && latestDepartAt < previousArrival) ||
      (earliestNextDeparture && latestDepartAt < earliestNextDeparture) ||
      departureDate !== arrivalDate ||
      departureDate < dateRange.startDate ||
      departureDate > dateRange.endDate ||
      scheduledMinutes < totalLegMinutes(leg)
    ) {
      return false;
    }

    previousArrival = targetArriveAt;
  }

  return true;
}

function normalizeExplicitTravelItinerarySchedule(
  input: NormalizeTravelScheduleInput,
  dateRange: TravelDateRange
): NormalizeTravelScheduleResult | null {
  if (!isExplicitScheduleSafe(input, dateRange)) {
    return null;
  }

  const legs = input.legs.map((leg) => ({
    ...leg,
    routeTitle: normalizeScheduledText(leg.routeTitle),
    routeRationale: normalizeScheduledText(leg.routeRationale),
    segmentTitle: normalizeScheduledText(leg.segmentTitle),
    segmentDetail: normalizeScheduledText(leg.segmentDetail),
  }));
  const destinationArrivals = new Map<number, Date>();

  legs.forEach((leg, index) => {
    const destinationIndex = findDestinationStopIndex(
      input.stops,
      leg,
      Math.min(index + 1, input.stops.length - 1)
    );
    if (destinationIndex >= 0 && leg.targetArriveAt) {
      destinationArrivals.set(destinationIndex, leg.targetArriveAt);
    }
  });

  const stops = input.stops.map((stop, index) => {
    const target = destinationArrivals.get(index);
    return target ? { ...stop, targetArriveAt: target } : stop;
  });

  return {
    targetArriveAt: legs.at(-1)?.targetArriveAt ?? input.targetArriveAt,
    stops,
    legs,
    dateRange,
  };
}

function stopMatches(
  stop: PlannedTripStopInput,
  name?: string,
  lngLat?: string
) {
  const normalizedStopName = stop.name.trim().toLowerCase();
  const normalizedName = name?.trim().toLowerCase();
  const normalizedStopLngLat = stop.lngLat?.trim();
  const normalizedLngLat = lngLat?.trim();

  return Boolean(
    (normalizedName && normalizedStopName === normalizedName) ||
      (normalizedLngLat && normalizedStopLngLat === normalizedLngLat)
  );
}

function findDestinationStopIndex(
  stops: PlannedTripStopInput[],
  leg: PlannedTripLegInput,
  minimumIndex: number
) {
  return stops.findIndex(
    (stop, index) => index >= minimumIndex && stopMatches(
      stop,
      leg.destinationName,
      leg.destinationLngLat
    )
  );
}

function hasOvernightAccommodation(stop?: PlannedTripStopInput) {
  if (!stop) return false;

  return /lodging|hotel|accommodation|overnight|住宿|酒店|宾馆|民宿|客栈|过夜/i.test(
    [stop.name, stop.address, stop.kind, stop.notes]
      .filter(Boolean)
      .join(" ")
  );
}

function normalizeAccommodationText(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/(?:住宿|酒店|宾馆|民宿|客栈|过夜|返(?:回)?驻地|驻地)/g, "")
    .replace(/[\s（）()【】［］[\]·•,，。:：/\\_\-—]/g, "");
}

function lodgingMatchesStop(lodging: TravelLodging, stop: PlannedTripStopInput) {
  const stopText = normalizeAccommodationText(
    [stop.name, stop.address, stop.notes].filter(Boolean).join(" ")
  );
  const lodgingText = normalizeAccommodationText(
    [lodging.name, lodging.area, lodging.address, lodging.notes, lodging.reason]
      .filter(Boolean)
      .join(" ")
  );

  if (!stopText || !lodgingText) return false;
  return (
    lodgingText.includes(stopText) ||
    stopText.includes(lodgingText) ||
    (stopText.length >= 3 && lodgingText.includes(stopText.slice(0, 3)))
  );
}

function hasPlanAccommodationAtStop(
  stop: PlannedTripStopInput | undefined,
  lodging: readonly TravelLodging[]
) {
  return Boolean(
    stop && lodging.some((recommendation) => lodgingMatchesStop(recommendation, stop))
  );
}

function isAttractionLikeStop(stop?: PlannedTripStopInput) {
  if (!stop) return false;

  return /草原|草甸|牧场|湖|湿地|森林|公园|景区|旅游区|火山|地质|山|峰|岭|河|峡谷|瀑布|观景|景点|遗址|古城|寺|博物馆|纪念馆|故居|lake|wetland|forest|park|mountain|river|canyon|waterfall|viewpoint|museum|ruins/i.test(
    [stop.name, stop.address, stop.kind, stop.notes]
      .filter(Boolean)
      .join(" ")
  );
}

function destinationStopForLeg(
  stops: PlannedTripStopInput[],
  leg: PlannedTripLegInput,
  legIndex: number
) {
  const destinationIndex = findDestinationStopIndex(
    stops,
    leg,
    Math.min(legIndex + 1, stops.length - 1)
  );
  return destinationIndex >= 0 ? stops[destinationIndex] : stops[legIndex + 1];
}

function assertCrossDayOvernightContinuity(input: {
  stops: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
  timezone: string;
  lodging?: readonly TravelLodging[];
}) {
  if (input.stops.length < 2 || input.legs.length < 2) return;

  let previousArrivalDate: string | undefined;
  let previousDestination: PlannedTripStopInput | undefined;

  for (const [index, leg] of input.legs.entries()) {
    if (!leg.latestDepartAt || !leg.targetArriveAt) continue;

    const departureDate = formatInTimeZone(
      leg.latestDepartAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    if (
      previousArrivalDate &&
      departureDate !== previousArrivalDate &&
      isAttractionLikeStop(previousDestination) &&
      !hasOvernightAccommodation(previousDestination) &&
      !hasPlanAccommodationAtStop(previousDestination, input.lodging ?? [])
    ) {
      throw new Error(
        `旅行路线跨自然日从 ${previousDestination?.name ?? "该景点"} 继续出发，但前一日终点未明确住宿或返城连接。请在该处补充景点附近住宿，或在前一日加入返回城市的连接段后再继续下一日路线。`
      );
    }

    previousArrivalDate = formatInTimeZone(
      leg.targetArriveAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    previousDestination = destinationStopForLeg(input.stops, leg, index);
  }
}

function orderedRouteItems<T extends { order?: number }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (left.order ?? items.indexOf(left)) -
      (right.order ?? items.indexOf(right))
  );
}

function endpointLabel(name?: string, lngLat?: string) {
  return name?.trim() || lngLat?.trim() || "未提供";
}

/**
 * A structured travel plan is rendered twice: once from ordered stops and
 * once from ordered legs. Rejecting non-adjacent endpoints here prevents the
 * map, route cards, driving totals, and weather risks from describing
 * different itineraries.
 *
 * A single destination stop remains valid for a travel plan whose origin is an
 * external place (for example, "从酒店去景区"). Multi-stop travel plans must
 * have one leg for every adjacent stop pair.
 */
export function assertTravelItineraryRouteContinuity(input: {
  stops?: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
}) {
  const stops = orderedRouteItems(input.stops ?? []);
  const legs = orderedRouteItems(input.legs);

  if (stops.length <= 1 || legs.length === 0) return;

  if (legs.length !== stops.length - 1) {
    throw new Error(
      `旅行路线的停靠点和路段数量不一致：${stops.length} 个停靠点需要 ${stops.length - 1} 段相邻路线，当前为 ${legs.length} 段。请补齐或删除对应 stops/legs，确保每一段都连接相邻停靠点。`
    );
  }

  for (const [index, leg] of legs.entries()) {
    const fromStop = stops[index];
    const toStop = stops[index + 1];
    const legOrder = leg.order ?? index;

    if (
      (leg.originName || leg.originLngLat) &&
      !stopMatches(fromStop, leg.originName, leg.originLngLat)
    ) {
      throw new Error(
        `旅行路线第 ${legOrder} 段起点 ${endpointLabel(
          leg.originName,
          leg.originLngLat
        )} 与相邻停靠点 ${fromStop.name} 不一致。请把该段起点改为 ${fromStop.name}，或在 stops 中补入缺失的中途停靠点。`
      );
    }

    if (
      (leg.destinationName || leg.destinationLngLat) &&
      !stopMatches(toStop, leg.destinationName, leg.destinationLngLat)
    ) {
      throw new Error(
        `旅行路线第 ${legOrder} 段终点 ${endpointLabel(
          leg.destinationName,
          leg.destinationLngLat
        )} 与相邻停靠点 ${toStop.name} 不一致。请把该段终点改为 ${toStop.name}，或在 stops 中补入缺失的中途停靠点。`
      );
    }
  }
}

export function normalizeTravelItinerarySchedule(
  input: NormalizeTravelScheduleInput
): NormalizeTravelScheduleResult {
  const dateRange = parseTravelDateRange(input.prompt);
  if (!dateRange || input.legs.length === 0) {
    return {
      targetArriveAt: input.targetArriveAt,
      stops: input.stops,
      legs: input.legs,
    };
  }

  const explicitSchedule = normalizeExplicitTravelItinerarySchedule(
    input,
    dateRange
  );
  if (explicitSchedule) {
    return explicitSchedule;
  }

  const promptStartClock = parsePromptStartClock(input.prompt);
  const legs: PlannedTripLegInput[] = [];
  const destinationArrivals = new Map<number, Date>();
  let previousDay = 1;
  let currentDay = 0;
  let cursor: Date | undefined;

  input.legs.forEach((leg, index) => {
    const marker = readDayMarker(legText(leg));
    let day = Math.min(
      dateRange.days,
      Math.max(
        1,
        marker ?? (index === 0 ? 1 : Math.min(dateRange.days, previousDay + 1))
      )
    );
    previousDay = day;

    if (day !== currentDay || !cursor) {
      const date = addCalendarDays(parseDateKey(dateRange.startDate), day - 1);
      const dateKey = toDateKey(date);
      const clock =
        day === dateRange.days || isReturnLeg(leg)
          ? DEFAULT_RETURN_DAY_START
          : day === 1
            ? promptStartClock ?? DEFAULT_FIRST_DAY_START
            : DEFAULT_DAY_START;
      cursor = buildZonedDate(dateKey, clock, input.timezone);
      currentDay = day;
    }

    const durationMinutes = totalLegMinutes(leg);
    let latestDepartAt = cursor;
    let targetArriveAt = addMinutes(latestDepartAt, durationMinutes);
    const departureDate = formatInTimeZone(
      latestDepartAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    const arrivalDate = formatInTimeZone(
      targetArriveAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );

    if (arrivalDate !== departureDate && day < dateRange.days) {
      day += 1;
      previousDay = day;
      currentDay = day;
      const date = addCalendarDays(
        parseDateKey(dateRange.startDate),
        day - 1
      );
      const dateKey = toDateKey(date);
      const clock =
        day === dateRange.days || isReturnLeg(leg)
          ? DEFAULT_RETURN_DAY_START
          : DEFAULT_DAY_START;
      latestDepartAt = buildZonedDate(dateKey, clock, input.timezone);
      targetArriveAt = addMinutes(latestDepartAt, durationMinutes);
      cursor = latestDepartAt;
    }

    const scheduledLeg = {
      ...leg,
      routeTitle: normalizeScheduledText(leg.routeTitle),
      routeRationale: normalizeScheduledText(leg.routeRationale),
      segmentTitle: normalizeScheduledText(leg.segmentTitle),
      segmentDetail: normalizeScheduledText(leg.segmentDetail),
      latestDepartAt,
      targetArriveAt,
    };
    legs.push(scheduledLeg);
    const destinationIndex = findDestinationStopIndex(
      input.stops,
      leg,
      Math.min(index + 1, input.stops.length - 1)
    );
    if (destinationIndex >= 0) {
      destinationArrivals.set(destinationIndex, targetArriveAt);
      cursor = addMinutes(
        targetArriveAt,
        Math.max(0, input.stops[destinationIndex].plannedStayMin ?? 0)
      );
    } else {
      cursor = targetArriveAt;
    }
  });

  const stops = input.stops.map((stop, index) => {
    const target = destinationArrivals.get(index);
    return target ? { ...stop, targetArriveAt: target } : stop;
  });

  return {
    targetArriveAt: legs.at(-1)?.targetArriveAt ?? input.targetArriveAt,
    stops,
    legs,
    dateRange,
  };
}

export function assertTravelItinerarySchedule(input: {
  prompt: string;
  timezone: string;
  stops?: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
  lodging?: readonly TravelLodging[];
}) {
  assertTravelItineraryRouteContinuity({
    stops: input.stops,
    legs: input.legs,
  });

  const dateRange = parseTravelDateRange(input.prompt);
  const hasScheduledTimes = input.legs.some(
    (leg) => leg.latestDepartAt || leg.targetArriveAt
  );

  if (hasScheduledTimes) {
    let previousArrival: Date | undefined;
    for (const leg of input.legs) {
      if (!leg.latestDepartAt || !leg.targetArriveAt) {
        throw new Error("旅行路线每一段都必须有明确的出发和到达时间。");
      }

      if (leg.targetArriveAt <= leg.latestDepartAt) {
        throw new Error("旅行路线存在到达时间不晚于出发时间的路段。");
      }

      if (previousArrival && leg.latestDepartAt < previousArrival) {
        throw new Error("旅行路线的路段时间不是按顺序衔接的。");
      }

      const departDate = formatInTimeZone(
        leg.latestDepartAt,
        input.timezone || DEFAULT_TIME_ZONE,
        "yyyy-MM-dd"
      );
      const arriveDate = formatInTimeZone(
        leg.targetArriveAt,
        input.timezone || DEFAULT_TIME_ZONE,
        "yyyy-MM-dd"
      );
      if (departDate !== arriveDate) {
        throw new Error("旅行路线包含跨午夜驾驶路段，请拆分或调整到白天。");
      }

      if (
        dateRange &&
        (departDate < dateRange.startDate || departDate > dateRange.endDate)
      ) {
        throw new Error("旅行路线时间超出用户提供的旅行日期范围。");
      }

      previousArrival = leg.targetArriveAt;
    }
  }

  assertCrossDayOvernightContinuity({
    stops: input.stops ?? [],
    legs: input.legs,
    timezone: input.timezone,
    lodging: input.lodging,
  });

  const daylightViolation = findDaylightDrivingViolation(input);
  if (daylightViolation) {
    throw new Error(
      formatDaylightConstraintError(daylightViolation, input.timezone)
    );
  }

  const dailyDrivingViolation = findDailyDrivingLimitViolation(input);
  if (dailyDrivingViolation) {
    throw new Error(formatDailyDrivingConstraintError(dailyDrivingViolation));
  }
}

function isDrivingLeg(leg: PlannedTripLegInput) {
  return /drive|car|driving|驾车|自驾|开车|驾驶|行车/i.test(
    [
      leg.mode,
      leg.routeTitle,
      leg.routeRationale,
      leg.segmentTitle,
      leg.segmentDetail,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function ensureTravelPlanRouteRiskCoverage(
  plan: TravelPlan,
  legs: PlannedTripLegInput[],
  timezone: string,
  prompt?: string
): TravelPlan {
  const drivingLegs = legs.flatMap((leg, index) =>
    isDrivingLeg(leg) ? [{ leg, order: index + 1 }] : []
  );
  if (drivingLegs.length === 0) {
    return plan;
  }

  const existingRisks = plan.weather.routeRisks ?? [];
  const dateRange = prompt ? parseTravelDateRange(prompt) : undefined;
  const routeRisks = drivingLegs.map(({ leg, order }) => {
    const date = leg.latestDepartAt
      ? formatInTimeZone(
          leg.latestDepartAt,
          timezone || DEFAULT_TIME_ZONE,
          "yyyy-MM-dd"
        )
      : undefined;
    const day =
      date && dateRange
        ? calendarDayDifference(dateRange.startDate, date) + 1
        : undefined;
    const route =
      [leg.originName, leg.destinationName].filter(Boolean).join("→") ||
      leg.routeTitle ||
      leg.segmentTitle ||
      `第 ${order} 段自驾`;

    const existing = existingRisks.find((risk) => risk.legOrder === order);
    return {
      legOrder: order,
      day,
      date,
      route,
      summary:
        existing?.summary?.trim() ||
        "该路段未返回独立天气风险，按未知风险处理；当前预报和路况不能覆盖此路段。",
      risk: existing?.risk ?? ("medium" as const),
      drivingAdvice:
        existing?.drivingAdvice?.trim() ||
        "出发前 1 小时刷新天气、路况和道路通行状态，完成刷新前不要按当前路线出发。",
      action:
        existing?.action?.trim() ||
        "按未知风险保守执行；若出现降雨、大风、低能见度或道路管制，延后、改道或取消该段。",
    };
  });

  return {
    ...plan,
    weather: {
      ...plan.weather,
      routeRisks,
    },
  };
}

export type DailyDrivingLimitViolation = {
  date: string;
  drivingMinutes: number;
  limitMinutes: number;
  legs: Array<{
    order: number;
    route: string;
    routeMinutes: number;
  }>;
};

function getTravelDrivingLegDetails(
  legs: readonly PlannedTripLegInput[],
  timezone: string
) {
  const dailyDriving = new Map<
    string,
    Array<{ order: number; route: string; routeMinutes: number }>
  >();

  for (const [index, leg] of legs.entries()) {
    if (!isDrivingLeg(leg) || !leg.latestDepartAt) continue;

    const date = formatInTimeZone(
      leg.latestDepartAt,
      timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    const routeMinutes = Math.max(0, Math.round(leg.routeMinutes));
    const route =
      [leg.originName, leg.destinationName].filter(Boolean).join("→") ||
      leg.routeTitle ||
      leg.segmentTitle ||
      `第 ${leg.order ?? index + 1} 段`;
    const dayLegs = dailyDriving.get(date) ?? [];
    dayLegs.push({
      order: leg.order ?? index,
      route,
      routeMinutes,
    });
    dailyDriving.set(date, dayLegs);
  }

  return dailyDriving;
}

export function getTravelDailyDrivingMinutes(
  legs: readonly PlannedTripLegInput[],
  timezone: string
) {
  const dailyDriving = new Map<string, number>();

  for (const leg of legs) {
    if (!isDrivingLeg(leg) || !leg.latestDepartAt) continue;

    const date = formatInTimeZone(
      leg.latestDepartAt,
      timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    dailyDriving.set(
      date,
      (dailyDriving.get(date) ?? 0) + Math.max(0, Math.round(leg.routeMinutes))
    );
  }

  return dailyDriving;
}

export function findDailyDrivingLimitViolation(input: {
  prompt: string;
  timezone: string;
  legs: PlannedTripLegInput[];
}): DailyDrivingLimitViolation | undefined {
  const limitMinutes = parseDailyDrivingLimitMinutes(input.prompt);
  if (!limitMinutes) return undefined;

  const dailyDrivingLegs = getTravelDrivingLegDetails(
    input.legs,
    input.timezone
  );

  const violation = [...dailyDrivingLegs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, legs]) => ({
      date,
      legs,
      drivingMinutes: legs.reduce(
        (total, leg) => total + leg.routeMinutes,
        0
      ),
    }))
    .find(({ drivingMinutes }) => drivingMinutes > limitMinutes);

  return violation
    ? {
        date: violation.date,
        drivingMinutes: violation.drivingMinutes,
        limitMinutes,
        legs: violation.legs,
      }
    : undefined;
}

function formatDailyDrivingConstraintError(
  violation: DailyDrivingLimitViolation
) {
  const drivingHours = (violation.drivingMinutes / 60).toFixed(1);
  const limitHours = (violation.limitMinutes / 60).toFixed(1);
  const legDetails = violation.legs
    .map(
      (leg) =>
        `第 ${leg.order + 1} 段 ${leg.route} ${leg.routeMinutes} 分钟`
    )
    .join("；");
  return `${violation.date} 累计自驾 ${violation.drivingMinutes} 分钟（约 ${drivingHours} 小时），超过用户指定的每日上限 ${violation.limitMinutes} 分钟（${limitHours} 小时），超出 ${violation.drivingMinutes - violation.limitMinutes} 分钟。违规路段：${legDetails}。请按这些路段重新计算日期：把转场拆到下一天并在实际停靠点安排住宿，或减少/删除远端景点；住宿推荐不等于必须新增本地驾车段，不能只修改文字或重复同一组 stops/legs，修正后重新调用 create_trip。`;
}

const DAYLIGHT_DRIVING_PATTERNS = [
  /白天.{0,12}(?:驾车|驾驶|开车|自驾|行车)/,
  /(?:驾车|驾驶|开车|自驾|行车).{0,12}白天/,
  /(?:避免|不走|不安排|不要|不想|不希望|不接受).{0,10}(?:夜间|夜路|晚上|夜车|天黑后)/,
  /(?:日落|天黑).{0,8}(?:前|之前|前到达)/,
] as const;

export function requiresDaylightDriving(prompt: string) {
  return DAYLIGHT_DRIVING_PATTERNS.some((pattern) => pattern.test(prompt));
}

type Coordinates = {
  longitude: number;
  latitude: number;
};

export type DaylightDrivingViolation = {
  legIndex: number;
  route: string;
  reason: "late_arrival" | "missing_coordinates";
  arrivalAt?: Date;
  safeArrivalAt?: Date;
  sunsetAt?: Date;
};

function parseLngLat(value?: string | null): Coordinates | null {
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
    return null;
  }

  return { longitude: parts[0], latitude: parts[1] };
}

function findStopCoordinate(
  stops: PlannedTripStopInput[],
  name?: string,
  lngLat?: string
) {
  return parseLngLat(lngLat) ??
    parseLngLat(
      stops.find((stop) => stopMatches(stop, name, lngLat))?.lngLat
    );
}

function getSunsetAt(dateKey: string, coordinates: Coordinates, timezone: string) {
  const localNoon = buildZonedDate(
    dateKey,
    { hour: 12, minute: 0 },
    timezone
  );
  const times = SunCalc.getTimes(
    localNoon,
    coordinates.latitude,
    coordinates.longitude
  );
  const sunset = times.sunset ?? times.dusk;
  return sunset instanceof Date && !Number.isNaN(sunset.getTime())
    ? sunset
    : undefined;
}

function daylightViolationRoute(leg: PlannedTripLegInput) {
  return (
    [leg.originName, leg.destinationName].filter(Boolean).join(" → ") ||
    leg.routeTitle ||
    "未命名路线"
  );
}

export function findDaylightDrivingViolation(input: {
  prompt: string;
  timezone: string;
  stops?: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
}): DaylightDrivingViolation | undefined {
  if (!requiresDaylightDriving(input.prompt)) return undefined;

  for (const [legIndex, leg] of input.legs.entries()) {
    if (
      !isDrivingLeg(leg) ||
      Math.max(0, Math.round(leg.routeMinutes)) < LONG_DAYLIGHT_DRIVING_MINUTES
    ) {
      continue;
    }

    const coordinates = [
      findStopCoordinate(input.stops ?? [], leg.originName, leg.originLngLat),
      findStopCoordinate(
        input.stops ?? [],
        leg.destinationName,
        leg.destinationLngLat
      ),
    ].filter((value): value is Coordinates => Boolean(value));
    if (coordinates.length === 0) {
      return {
        legIndex,
        route: daylightViolationRoute(leg),
        reason: "missing_coordinates",
      };
    }

    if (!leg.targetArriveAt) continue;
    const arrivalDate = formatInTimeZone(
      leg.targetArriveAt,
      input.timezone || DEFAULT_TIME_ZONE,
      "yyyy-MM-dd"
    );
    const sunsets = coordinates
      .map((coordinates) => getSunsetAt(arrivalDate, coordinates, input.timezone))
      .filter((value): value is Date => Boolean(value));
    if (sunsets.length === 0) continue;

    const sunsetAt = new Date(
      Math.min(...sunsets.map((value) => value.getTime()))
    );
    const safeArrivalAt = new Date(
      sunsetAt.getTime() - DAYLIGHT_SAFETY_BUFFER_MINUTES * 60_000
    );
    if (leg.targetArriveAt > safeArrivalAt) {
      return {
        legIndex,
        route: daylightViolationRoute(leg),
        reason: "late_arrival",
        arrivalAt: leg.targetArriveAt,
        safeArrivalAt,
        sunsetAt,
      };
    }
  }

  return undefined;
}

function formatDaylightConstraintError(
  violation: DaylightDrivingViolation,
  timezone: string
) {
  const segment = `第 ${violation.legIndex + 1} 段 ${violation.route}`;
  if (violation.reason === "missing_coordinates") {
    return `${segment}是长途自驾，但缺少起点或终点坐标，无法计算当地日落。白天驾驶约束不能在缺少坐标时放行，请先补齐 POI 坐标后重新规划。可执行方案：提前返程、增加途中住宿并拆分路线，或缩短/删除远端景点。`;
  }

  const arrival = formatInTimeZone(
    violation.arrivalAt!,
    timezone || DEFAULT_TIME_ZONE,
    "yyyy-MM-dd HH:mm"
  );
  const safeArrival = formatInTimeZone(
    violation.safeArrivalAt!,
    timezone || DEFAULT_TIME_ZONE,
    "yyyy-MM-dd HH:mm"
  );
  const sunset = formatInTimeZone(
    violation.sunsetAt!,
    timezone || DEFAULT_TIME_ZONE,
    "HH:mm"
  );
  return `${segment}预计 ${arrival} 到达，晚于当地日落 ${sunset} 的安全线 ${safeArrival}（已预留 30 分钟）。用户要求白天驾驶，不能把这段夜间自驾落盘。请重新规划为可执行方案：提前返程并在安全线前到达；或增加途中住宿并拆分路线；或缩短/删除远端景点。`;
}

export function addTravelSchedulePitfall(
  plan: TravelPlan,
  legs: PlannedTripLegInput[],
  timezone: string
): TravelPlan {
  const dailyDriving = getTravelDailyDrivingMinutes(legs, timezone);

  const longest = [...dailyDriving.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0];
  if (!longest || longest[1] <= HIGH_DAILY_DRIVING_MINUTES) {
    return plan;
  }

  if (plan.pitfalls.some((pitfall) => /驾驶强度|长途返程/.test(pitfall.title))) {
    return plan;
  }

  return {
    ...plan,
    pitfalls: [
      ...plan.pitfalls,
      {
        title: "单日驾驶强度偏高",
        detail: `${longest[0]} 规划驾驶约 ${Math.round(
          longest[1] / 60
        )} 小时，超过 8 小时舒适阈值。建议改为分段返程或增加一晚；若必须执行，06:30 前出发、每 2 小时休息，并在出发前确认驾驶人状态。`,
        severity: "high",
      },
    ],
  };
}

const DAILY_DRIVING_PITFALL_PATTERN =
  /(?:每日|每天|单日|日均)[^。！？\n]{0,80}(?:自驾|驾车|驾驶|开车|行车)|(?:自驾|驾车|驾驶|开车|行车)[^。！？\n]{0,80}(?:每日|每天|单日|日均)/i;

function isDailyDrivingPitfall(pitfall: TravelPlan["pitfalls"][number]) {
  return DAILY_DRIVING_PITFALL_PATTERN.test(
    `${pitfall.title} ${pitfall.detail}`
  );
}

function formatDrivingMinutes(minutes: number) {
  return `${minutes} 分钟（约 ${(minutes / 60).toFixed(1)} 小时）`;
}

/**
 * Replace model-written daily-limit warnings with one statement generated
 * from the same dated leg totals used by the hard validation.
 */
export function alignTravelPlanPitfallsWithSchedule(
  plan: TravelPlan,
  legs: readonly PlannedTripLegInput[],
  prompt: string,
  timezone: string
): TravelPlan {
  const limitMinutes = parseDailyDrivingLimitMinutes(prompt);
  if (!limitMinutes) return plan;

  const dailyDriving = getTravelDailyDrivingMinutes(legs, timezone);
  if (dailyDriving.size === 0) return plan;

  const dailySummary = [...dailyDriving.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, minutes]) => `${date} ${formatDrivingMinutes(minutes)}`)
    .join("；");
  const hasViolation = [...dailyDriving.values()].some(
    (minutes) => minutes > limitMinutes
  );
  const limitLabel = formatDrivingMinutes(limitMinutes);
  const detail = hasViolation
    ? `按结构化路线核对，每日自驾为：${dailySummary}；用户上限为 ${limitLabel}。当前路线不应落盘，需拆分日期、增加住宿或删减远端景点。`
    : `按结构化路线核对，每日自驾为：${dailySummary}；用户上限为 ${limitLabel}，当前没有超过上限。不同日期的路段不能相加；出发前仍需刷新天气和路况，必要时缩短户外安排或增加休息。`;

  return {
    ...plan,
    pitfalls: [
      {
        title: "每日自驾上限（结构化核对）",
        detail,
        severity: hasViolation ? ("high" as const) : ("medium" as const),
      },
      ...plan.pitfalls.filter((pitfall) => !isDailyDrivingPitfall(pitfall)),
    ],
  };
}

export function normalizeTravelScheduleInput(
  input: CreatePlannedTripInput
): NormalizeTravelScheduleResult {
  return normalizeTravelItinerarySchedule({
    prompt: input.rawPrompt,
    timezone: input.timezone,
    targetArriveAt: input.targetArriveAt,
    stops: input.stops,
    legs: input.legs ?? [],
  });
}
