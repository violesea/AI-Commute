import { NextResponse } from "next/server";
import { createAmapClient } from "@/lib/amap";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { parseTravelPlanJson } from "@/lib/trips/travel-plan";

type RouteContext = {
  params: Promise<{
    tripId: string;
  }>;
};

type RefreshDayBody = {
  date?: string;
};

function dateKeyInTimeZone(value: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  } catch {
    return undefined;
  }
}

/**
 * Derive a driving risk level from AMap weather forecast text.
 * Rain/storm/snow → high; wind/fog/haze → medium; clear/cloudy → low.
 */
function assessWeatherRisk(forecastText: string): {
  risk: "low" | "medium" | "high";
  summary: string;
  drivingAdvice: string;
} {
  const text = forecastText.toLowerCase();

  if (/暴雨|大雨|暴雪|大雪|雷暴|冰雹|沙尘暴|台风|rainstorm|heavy/.test(text)) {
    return {
      risk: "high",
      summary: `${forecastText}，自驾风险高`,
      drivingAdvice:
        "建议推迟出发或改道；如必须出行，减速慢行，保持车距，避开积水/结冰路段。",
    };
  }

  if (/小雨|中雨|阵雨|小雪|中雪|雨夹雪|light rain|moderate/.test(text)) {
    return {
      risk: "medium",
      summary: `${forecastText}，路面湿滑需留意`,
      drivingAdvice: "注意刹车距离延长，弯道减速，开启雾灯或近光灯。",
    };
  }

  if (/大风|狂风|6级|7级|8级|strong wind|gale/.test(text)) {
    return {
      risk: "medium",
      summary: `${forecastText}，注意侧风影响`,
      drivingAdvice: "高速和空旷路段注意侧风，握稳方向盘，货车和SUV格外小心。",
    };
  }

  if (/雾|霾|沙尘|fog|haze|smog|低能见/.test(text)) {
    return {
      risk: "medium",
      summary: `${forecastText}，能见度较低`,
      drivingAdvice: "开启雾灯和双闪，减速行驶，必要时驶入服务区等待。",
    };
  }

  return {
    risk: "low",
    summary: `${forecastText}，路况良好`,
    drivingAdvice: "正常驾驶，注意防晒和补充水分。",
  };
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { tripId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as RefreshDayBody;
  const targetDate = body.date?.trim();

  if (!targetDate) {
    return NextResponse.json({ error: "缺少 date 参数" }, { status: 400 });
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: user.id },
    include: {
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          routeCandidates: { orderBy: { createdAt: "asc" } },
        },
      },
      stops: { orderBy: { order: "asc" } },
    },
  });

  if (!trip) {
    return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  }

  const amap = createAmapClient();
  const updatedLegs: {
    legOrder: number;
    routeMinutes: number;
    summary: string;
  }[] = [];

  // Find legs whose departure falls on the target calendar day.
  const dayLegs = trip.legs.filter((leg) => {
    if (!leg.latestDepartAt) return false;
    return dateKeyInTimeZone(leg.latestDepartAt, trip.timezone) === targetDate;
  });

  // Refresh driving route minutes for each leg with usable coordinates.
  for (const leg of dayLegs) {
    const origin = leg.originLngLat;
    const destination = leg.destinationLngLat;
    if (!origin || !destination) continue;

    try {
      const result = await amap.getDrivingRoute({ origin, destination });
      if (
        Number.isFinite(result.durationMinutes) &&
        result.durationMinutes > 0
      ) {
        const candidate =
          leg.selectedCandidate ??
          leg.routeCandidates.find((c) => c.selected) ??
          leg.routeCandidates[0];
        if (candidate) {
          await prisma.routeCandidate.update({
            where: { id: candidate.id },
            data: {
              routeMinutes: Math.round(result.durationMinutes),
              totalMinutes:
                Math.round(result.durationMinutes) + candidate.bufferMinutes,
            },
          });
        }
        updatedLegs.push({
          legOrder: leg.order,
          routeMinutes: Math.round(result.durationMinutes),
          summary: result.summary,
        });
      }
    } catch {
      // Skip legs that fail; partial refresh is acceptable.
    }
  }

  // ---- Generate per-leg route risks from AMap weather ----
  let weatherSummary: string | null = null;
  const generatedRisks: Array<{
    legOrder: number;
    day?: number;
    date?: string;
    route: string;
    summary: string;
    risk: "low" | "medium" | "high";
    drivingAdvice: string;
    action: string;
  }> = [];

  // For each leg on this day, resolve the destination city and fetch weather.
  const cityWeatherCache = new Map<string, string>();

  for (const leg of dayLegs) {
    let city: string | undefined;

    // Resolve city via reverse geocode if we have coordinates.
    if (leg.destinationLngLat) {
      try {
        const geo = await amap.reverseGeocode({
          lngLat: leg.destinationLngLat,
        });
        city = geo.city?.trim() || undefined;
      } catch {
        // Fall through to using the destination name.
      }
    }

    if (!city && leg.destinationName) {
      city = leg.destinationName;
    }

    if (!city) continue;

    // Cache weather text per city to avoid duplicate calls.
    let forecastText: string | undefined;
    if (cityWeatherCache.has(city)) {
      forecastText = cityWeatherCache.get(city);
    } else {
      try {
        const weather = await amap.getWeather({ city });
        const fc = weather.forecast?.find(
          (f) => f.date === targetDate
        );
        const raw =
          fc?.dayWeather || fc?.summary || weather.summary || undefined;
        // If AMap returns no real data ("暂无天气信息" etc.), treat as unknown.
        if (raw && !/暂无|无天气|无预报|no data/i.test(raw)) {
          forecastText = raw;
        }
        cityWeatherCache.set(city, forecastText || "");

        if (!weatherSummary && weather.summary && !/暂无/.test(weather.summary)) {
          weatherSummary = weather.summary;
        }
      } catch {
        cityWeatherCache.set(city, "");
      }
    }

    if (!forecastText) continue;

    const assessed = assessWeatherRisk(forecastText);
    const route =
      [leg.originName, leg.destinationName].filter(Boolean).join("→") ||
      `第 ${leg.order} 段`;

    generatedRisks.push({
      legOrder: leg.order,
      date: targetDate,
      route,
      summary: assessed.summary,
      risk: assessed.risk,
      drivingAdvice: assessed.drivingAdvice,
      action:
        assessed.risk === "high"
          ? "建议改期或改道出行"
          : assessed.risk === "medium"
            ? "谨慎驾驶，关注实时路况"
            : "正常出行",
    });
  }

  // Merge generated risks into travelPlanJson.weather.routeRisks.
  const currentPlan = parseTravelPlanJson(trip.travelPlanJson);
  if (currentPlan && generatedRisks.length > 0) {
    const existingRisks = currentPlan.weather.routeRisks ?? [];
    // Replace risks for legs we just refreshed; keep others.
    const refreshedLegOrders = new Set(generatedRisks.map((r) => r.legOrder));
    const keptRisks = existingRisks.filter(
      (r) => !refreshedLegOrders.has(r.legOrder ?? -1)
    );
    const mergedRisks = [...keptRisks, ...generatedRisks].sort(
      (a, b) => (a.legOrder ?? 0) - (b.legOrder ?? 0)
    );

    const updatedPlan = {
      ...currentPlan,
      weather: {
        ...currentPlan.weather,
        routeRisks: mergedRisks,
        ...(weatherSummary
          ? {
              summary: weatherSummary,
              observedAt: new Date().toISOString(),
            }
          : {}),
      },
    };

    await prisma.trip.update({
      where: { id: tripId },
      data: { travelPlanJson: JSON.stringify(updatedPlan) },
    });
  } else if (currentPlan && weatherSummary) {
    // No driving legs but still update the weather summary.
    const updatedPlan = {
      ...currentPlan,
      weather: {
        ...currentPlan.weather,
        summary: weatherSummary,
        observedAt: new Date().toISOString(),
      },
    };
    await prisma.trip.update({
      where: { id: tripId },
      data: { travelPlanJson: JSON.stringify(updatedPlan) },
    });
  }

  return NextResponse.json({
    date: targetDate,
    updatedLegs,
    generatedRisks: generatedRisks.length,
    routeRisks: generatedRisks,
    weatherSummary,
    refreshedAt: new Date().toISOString(),
  });
}
