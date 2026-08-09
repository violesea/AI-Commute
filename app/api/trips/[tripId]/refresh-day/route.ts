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

  // Refresh weather for the cities covered by this day's stops.
  let weatherSummary: string | null = null;
  const cities = new Set<string>();
  for (const leg of dayLegs) {
    if (leg.destinationName) cities.add(leg.destinationName);
  }
  // Use the first city as the weather query point (AMap needs a city name).
  const primaryCity = [...cities][0];
  if (primaryCity) {
    try {
      const weather = await amap.getWeather({ city: primaryCity });
      weatherSummary = weather.summary || null;

      // Update travelPlanJson weather.summary if we have a plan.
      const currentPlan = parseTravelPlanJson(trip.travelPlanJson);
      if (currentPlan && weatherSummary) {
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
    } catch {
      // Weather refresh failure is non-fatal.
    }
  }

  return NextResponse.json({
    date: targetDate,
    updatedLegs,
    weatherSummary,
    refreshedAt: new Date().toISOString(),
  });
}
