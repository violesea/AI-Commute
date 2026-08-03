import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import * as SunCalc from "suncalc";
import type {
  CreatePlannedTripInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";
import type { TravelPlan } from "@/lib/trips/travel-plan";

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

export function parseTravelDateRange(prompt: string): TravelDateRange | null {
  const chineseRange = prompt.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:至|到|～|~|—|-)\s*(?:(\d{4})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日?/
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
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(?:至|到|～|~|—|-)\s*(?:(\d{4})[-/])?(?:(\d{1,2})[-/])?(\d{1,2})/
  );

  if (!isoRange) return null;

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

function readDayMarker(value?: string) {
  if (!value) return undefined;

  const match =
    value.match(/\bD\s*(\d{1,2})\b/i) ?? value.match(/第\s*(\d{1,2})\s*天/);
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

function normalizeScheduledText(value?: string) {
  if (!value) return value;

  return EXPLICIT_CLOCK_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "按行程结构化时间"),
    value
  )
    .replace(/按行程结构化时间\s+/g, "按行程结构化时间")
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
}) {
  const dateRange = parseTravelDateRange(input.prompt);
  if (!dateRange) return;

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
      departDate < dateRange.startDate ||
      departDate > dateRange.endDate
    ) {
      throw new Error("旅行路线时间超出用户提供的旅行日期范围。");
    }

    previousArrival = leg.targetArriveAt;
  }

  const daylightViolation = findDaylightDrivingViolation(input);
  if (daylightViolation) {
    throw new Error(
      formatDaylightConstraintError(daylightViolation, input.timezone)
    );
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
