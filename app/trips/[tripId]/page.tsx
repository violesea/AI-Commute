import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  Bot,
  Clock3,
  Map,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { BufferList } from "@/components/trips/buffer-list";
import { MonitoringActions } from "@/components/trips/monitoring-actions";
import { RouteTimeline } from "@/components/trips/route-timeline";
import { DayCard, type DayCardLeg, type DayCardStop } from "@/components/trips/day-card";
import { TravelPlanCard } from "@/components/trips/travel-plan-card";
import { TripDeleteButton } from "@/components/trips/trip-delete-button";
import { TripShareButton } from "@/components/trips/trip-share-button";
import { getCurrentUser } from "@/lib/auth/session";
import { getAgentConversationHref } from "@/lib/app-routes";
import { prisma } from "@/lib/db";
import { getTripDetailHistoryHref } from "@/lib/history/day-filter";
import {
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
} from "@/lib/time-format";
import {
  formatReminderStatus,
  getMonitoringStatusDisplay,
  getMonitoringSummary,
  isTripMonitoringCancellable,
} from "@/lib/trips/monitoring";
import { buildMapPath } from "@/lib/trips/map-path";
import { toPublicTripShareData } from "@/lib/trips/share-view";
import {
  alignTravelPlanPitfallsWithSchedule,
  normalizeScheduledText,
  parseTravelDateRange,
} from "@/lib/trips/travel-schedule";
import {
  alignTravelPlanAttractionsWithRoute,
  ensureTravelPlanWeatherLocations,
  getTravelRouteStats,
  parseTravelPlanJson,
} from "@/lib/trips/travel-plan";

type TripPageProps = {
  params: Promise<{
    tripId: string;
  }>;
  searchParams?: Promise<{
    historyDate?: string;
  }>;
};

function formatReminderKind(kind: string) {
  const labels: Record<string, string> = {
    depart_now: "现在出发",
    recheck: "路线复查",
    weather_refresh: "天气刷新",
  };

  return labels[kind] ?? kind;
}

function formatTrigger(trigger?: string | null) {
  const labels: Record<string, string> = {
    manual: "手动",
    reminder: "提醒",
    recheck: "路线复查",
    weather_refresh: "天气刷新",
    scheduler: "调度器",
  };

  return trigger ? labels[trigger] ?? trigger : "未知";
}

function formatRecalculationStatus(status?: string | null) {
  const labels: Record<string, string> = {
    completed: "已完成",
    failed: "失败",
    running: "运行中",
    sent: "已发送",
    skipped: "已跳过",
  };

  return status ? labels[status] ?? status : "未知";
}

function samePlacePart(reference: string, candidate?: string | null) {
  if (!candidate) return false;
  const ref = reference.toLowerCase().replace(/[\s（）()【】[\]·,，。]/g, "");
  const cand = candidate.toLowerCase().replace(/[\s（）()【】[\]·,，。]/g, "");
  if (!ref || !cand) return false;
  return ref.includes(cand) || cand.includes(ref);
}

function dateKeyInTimeZone(
  value: Date | null | undefined,
  timeZone: string
) {
  if (!value) return undefined;

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

function inferItineraryDateRange(
  rawPrompt: string,
  legs: readonly {
    latestDepartAt: Date | null;
    targetArriveAt: Date | null;
  }[],
  timeZone: string
) {
  const parsed = parseTravelDateRange(rawPrompt);
  if (parsed) {
    return { startDate: parsed.startDate, endDate: parsed.endDate };
  }

  const dates = legs
    .flatMap((leg) => [leg.latestDepartAt, leg.targetArriveAt])
    .map((value) => dateKeyInTimeZone(value, timeZone))
    .filter((value): value is string => Boolean(value))
    .sort();

  if (dates.length === 0) return undefined;

  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

export default async function TripDetailPage({
  params,
  searchParams,
}: TripPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const historyHref = getTripDetailHistoryHref(query?.historyDate);
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: user.id },
    include: {
      agentSessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          routeCandidates: {
            orderBy: { createdAt: "asc" },
          },
          routeSegments: {
            orderBy: { order: "asc" },
          },
          bufferComponents: {
            orderBy: { order: "asc" },
          },
          reminderJobs: {
            orderBy: { scheduledFor: "asc" },
          },
          recalculations: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      reminderJobs: {
        orderBy: { scheduledFor: "asc" },
      },
      recalculations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      stops: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!trip) {
    redirect("/history");
  }

  const tripTimeZone = trip.timezone;
  const primaryLeg = trip.legs[0];
  const isTravelTrip = trip.agentSessions[0]?.purpose === "travel";
  const selectedRouteLegs = trip.legs.flatMap((leg) => {
    const candidate =
      leg.selectedCandidate ??
      leg.routeCandidates.find((routeCandidate) => routeCandidate.selected) ??
      leg.routeCandidates[0];

    return candidate
      ? [
          {
            order: leg.order,
            title: candidate.title,
            routeMinutes: candidate.routeMinutes,
            bufferMinutes: candidate.bufferMinutes,
            totalMinutes: candidate.totalMinutes,
            mode: candidate.mode,
            latestDepartAt: leg.latestDepartAt,
            targetArriveAt: leg.targetArriveAt,
          },
        ]
      : [];
  });
  const routeStats = getTravelRouteStats(selectedRouteLegs, tripTimeZone);
  const selectedCandidates = selectedRouteLegs;
  const totalRouteMinutes = routeStats.totalRouteMinutes;
  const totalBufferMinutes = routeStats.totalBufferMinutes;
  const routeGroups = trip.legs.map((leg) => ({
    id: leg.id,
    title: `${leg.originName} 到 ${leg.destinationName}`,
    subtitle: [
      leg.latestDepartAt
        ? `${
            isTravelTrip
              ? formatDateTimeInTimeZone(leg.latestDepartAt, tripTimeZone)
              : formatTimeInTimeZone(leg.latestDepartAt, tripTimeZone)
          } 前出发`
        : null,
      leg.targetArriveAt
        ? `${
            isTravelTrip
              ? formatDateTimeInTimeZone(leg.targetArriveAt, tripTimeZone)
              : formatTimeInTimeZone(leg.targetArriveAt, tripTimeZone)
          } 前到达`
        : null,
    ]
      .filter(Boolean)
      .join(" / "),
    segments: leg.routeSegments.map((segment) => ({
      id: segment.id,
      mode: segment.mode,
      title: normalizeScheduledText(segment.title) || "路线分段",
      detail: normalizeScheduledText(segment.detail ?? undefined),
      minutes: segment.minutes,
    })),
  }));
  const buffers = trip.legs.flatMap((leg) =>
    leg.bufferComponents.map((buffer) => ({
      id: buffer.id,
      category: buffer.category,
      label:
        trip.legs.length > 1
          ? `${leg.destinationName}: ${buffer.label}`
          : buffer.label,
      minutes: buffer.minutes,
      reason: buffer.reason,
      source: buffer.source,
    }))
  );
  const reminders = trip.reminderJobs;
  const now = new Date();
  const monitoringSummary = getMonitoringSummary({
    createdAt: trip.createdAt,
    now,
    scheduledReminderCount: reminders.filter(
      (reminder) => reminder.status === "scheduled"
    ).length,
  });
  const latestRecalculation = [
    ...trip.recalculations,
    ...trip.legs.flatMap((leg) => leg.recalculations),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const monitoringStatusDisplay = getMonitoringStatusDisplay({
    tripStatus: trip.status,
    targetArriveAt: trip.targetArriveAt,
    now,
    latestRecalculation,
  });
  const canCancelMonitoring = isTripMonitoringCancellable({
    status: trip.status,
    targetArriveAt: trip.targetArriveAt,
    now,
  });
  const agentSessionId = trip.agentSessions[0]?.id ?? trip.agentSessionId;

  // Fetch sibling trips from the same planning session (multi-route variants).
  const variantTrips = agentSessionId
    ? await prisma.trip.findMany({
        where: {
          agentSessionId,
          id: { not: trip.id },
          userId: user.id,
        },
        select: {
          id: true,
          title: true,
          finalStopName: true,
          status: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const itineraryDateRange = isTravelTrip
    ? inferItineraryDateRange(trip.rawPrompt, trip.legs, tripTimeZone)
    : undefined;
  const routeTitle =
    selectedCandidates.length > 1
      ? `已选择 ${selectedCandidates.length} 段路线`
      : selectedCandidates[0]?.title;
  const mapPath = buildMapPath(primaryLeg?.originName, trip.stops);
  const publicTrip = toPublicTripShareData(trip);
  const parsedTravelPlan = parseTravelPlanJson(trip.travelPlanJson);
  const travelPlanLegs = trip.legs.map((leg) => {
    const candidate =
      leg.selectedCandidate ??
      leg.routeCandidates.find((routeCandidate) => routeCandidate.selected) ??
      leg.routeCandidates[0];
    return {
      order: leg.order,
      originName: leg.originName ?? undefined,
      originLngLat: leg.originLngLat ?? undefined,
      destinationName: leg.destinationName ?? undefined,
      destinationLngLat: leg.destinationLngLat ?? undefined,
      routeMinutes: candidate?.routeMinutes ?? 0,
      mode: candidate?.mode,
      latestDepartAt: leg.latestDepartAt ?? undefined,
      targetArriveAt: leg.targetArriveAt ?? undefined,
    };
  });
  const itineraryLegs: DayCardLeg[] = trip.legs.map((leg) => {
    const candidate =
      leg.selectedCandidate ??
      leg.routeCandidates.find((routeCandidate) => routeCandidate.selected) ??
      leg.routeCandidates[0];
    return {
      id: leg.id,
      order: leg.order,
      originName: leg.originName,
      originLngLat: leg.originLngLat,
      destinationName: leg.destinationName,
      destinationLngLat: leg.destinationLngLat,
      routeMinutes: candidate?.routeMinutes ?? 0,
      bufferMinutes: candidate?.bufferMinutes ?? 0,
      mode: candidate?.mode ?? null,
      latestDepartAt: leg.latestDepartAt?.toISOString() ?? null,
      targetArriveAt: leg.targetArriveAt?.toISOString() ?? null,
      routeTitle: candidate?.title ?? null,
    };
  });

  // Group legs by calendar day in the trip timezone.
  const dayGroups: { date: string; legs: DayCardLeg[] }[] = [];
  for (const leg of itineraryLegs) {
    if (!leg.latestDepartAt) continue;
    const dayKey = dateKeyInTimeZone(new Date(leg.latestDepartAt), tripTimeZone);
    if (!dayKey) continue;
    let group = dayGroups.find((g) => g.date === dayKey);
    if (!group) {
      group = { date: dayKey, legs: [] };
      dayGroups.push(group);
    }
    group.legs.push(leg);
  }

  const displayTravelPlan = parsedTravelPlan
    ? alignTravelPlanPitfallsWithSchedule(
        parsedTravelPlan,
        travelPlanLegs,
        trip.rawPrompt,
        tripTimeZone
      )
    : null;
  const displayRouteStops = trip.stops.map((stop) => ({
    order: stop.order,
    name: stop.name,
    address: stop.address,
    lngLat: stop.lngLat,
    kind: stop.kind,
    notes: stop.notes,
  }));
  const travelPlan = displayTravelPlan
    ? ensureTravelPlanWeatherLocations(
        alignTravelPlanAttractionsWithRoute(
          displayTravelPlan,
          displayRouteStops,
          travelPlanLegs
        ),
        displayRouteStops
      )
    : null;

  // Map stops to day groups via the arrival leg's targetArriveAt date.
  const dayCardsData = dayGroups.map((group, dayIndex) => {
    const dayStops: DayCardStop[] = [];
    for (const stop of trip.stops) {
      const arrivalLeg = itineraryLegs.find(
        (leg) => leg.destinationName === stop.name
      );
      const stopDate = arrivalLeg?.targetArriveAt
        ? dateKeyInTimeZone(new Date(arrivalLeg.targetArriveAt), tripTimeZone)
        : null;
      if (stop.order === 0 && dayIndex === 0) {
        dayStops.push({
          id: stop.id,
          order: stop.order,
          name: stop.name,
          kind: stop.kind,
          address: stop.address,
          lngLat: stop.lngLat,
          targetArriveAt: stop.targetArriveAt?.toISOString() ?? null,
          plannedStayMin: stop.plannedStayMin,
        });
      } else if (stopDate === group.date) {
        dayStops.push({
          id: stop.id,
          order: stop.order,
          name: stop.name,
          kind: stop.kind,
          address: stop.address,
          lngLat: stop.lngLat,
          targetArriveAt: stop.targetArriveAt?.toISOString() ?? null,
          plannedStayMin: stop.plannedStayMin,
        });
      }
    }
    for (const leg of group.legs) {
      const originStop = trip.stops.find(
        (s) =>
          s.name === leg.originName &&
          !dayStops.some((ds) => ds.name === s.name)
      );
      if (originStop) {
        dayStops.push({
          id: originStop.id,
          order: originStop.order,
          name: originStop.name,
          kind: originStop.kind,
          address: originStop.address,
          lngLat: originStop.lngLat,
          targetArriveAt: originStop.targetArriveAt?.toISOString() ?? null,
          plannedStayMin: originStop.plannedStayMin,
        });
      }
    }
    dayStops.sort((a, b) => a.order - b.order);

    const dayRisk = travelPlan?.weather.routeRisks?.find((risk) =>
      group.legs.some((leg) => leg.order === risk.legOrder)
    );

    // Weather APIs (AMap, Caiyun free) only cover ~3 days ahead. Days beyond
    // that should not show a misleading risk badge — tell the user to refresh
    // closer to departure.
    const todayKey = dateKeyInTimeZone(now, tripTimeZone) ?? "";
    const dayOffset = Math.round(
      (new Date(group.date).getTime() - new Date(todayKey).getTime()) /
        86_400_000
    );
    const withinForecastRange = dayOffset <= 3;
    const dayNum = dayIndex + 1;
    const dayForecast = travelPlan?.weather.forecast?.find(
      (f) => f.date === group.date || f.day === dayNum
    );

    // Filter lodging/food/pitfalls to this day.
    // Priority 1: notes contain D{dayNum} / 第{dayNum}天 marker.
    // Priority 2: area or name matches one of the day's stop names.
    const stopNames = dayStops.map((s) => s.name);
    const dayMarker = new RegExp(`D${dayNum}\\b|第${dayNum}天`, "i");

    const matchesDay = (item: { area?: string; name: string; notes?: string }) => {
      // Check notes for explicit day markers like "D2晚餐" or "D1/D8夜宿".
      if (item.notes && dayMarker.test(item.notes)) return true;
      // Fallback: match by area/name against stop names.
      return stopNames.some(
        (name) =>
          samePlacePart(name, item.area) ||
          samePlacePart(name, item.name) ||
          (item.notes ? samePlacePart(name, item.notes) : false)
      );
    };

    const dayLodging = travelPlan
      ? travelPlan.lodging.filter(matchesDay)
      : [];
    const dayFood = travelPlan ? travelPlan.food.filter(matchesDay) : [];
    const dayPitfalls = travelPlan
      ? travelPlan.pitfalls.filter((item) =>
          dayMarker.test(item.detail + " " + item.title)
        )
      : [];

    return {
      dayNumber: dayNum,
      date: group.date,
      legs: group.legs,
      stops: dayStops,
      weatherRisk: dayRisk,
      weatherSummary: dayIndex === 0 ? travelPlan?.weather.summary : undefined,
      forecast: withinForecastRange ? dayForecast : undefined,
      withinForecastRange,
      lodging: dayLodging,
      food: dayFood,
      pitfalls: dayPitfalls,
    };
  });

  return (
    <AppShell active="history">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-4">
          <Link
            className="text-sm font-bold text-[#2563eb] hover:text-[#004ac6]"
            href={historyHref}
          >
            返回历史
          </Link>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
                已选路线
              </p>
              <h1 className="mt-1 break-words text-3xl font-bold leading-tight text-[#191c1e]">
                {trip.title}
              </h1>
              <p className="mt-2 text-sm text-[#434655]">
                目标到达{" "}
                {formatDateTimeInTimeZone(trip.targetArriveAt, tripTimeZone)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TripShareButton trip={publicTrip} tripId={trip.id} />
              {agentSessionId ? (
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2563eb] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#004ac6]"
                  href={getAgentConversationHref(agentSessionId)}
                >
                  <Bot aria-hidden="true" className="size-4" />
                  智能体对话
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        {variantTrips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#93c5fd]/55 bg-[#eff6ff] px-4 py-3">
            <span className="text-xs font-bold text-[#1e40af]">其他路线：</span>
            {variantTrips.map((variant, index) => (
              <Link
                className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#2563eb] transition hover:bg-white"
                href={`/trips/${variant.id}`}
                key={variant.id}
              >
                路线 {index + 2} · {variant.finalStopName ?? variant.title}
              </Link>
            ))}
          </div>
        ) : null}

        {travelPlan ? (
          <TravelPlanCard
            plan={travelPlan}
            routeStats={isTravelTrip ? routeStats : undefined}
            itineraryDateRange={itineraryDateRange}
            hideRouteRisks={isTravelTrip}
            showOnlyAlternativeAttractions={isTravelTrip}
          />
        ) : null}

        <GlassCard className="p-5">
          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="min-w-0 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-[#f2f4f6] text-[#191c1e]">
                  <Clock3 aria-hidden="true" className="size-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#434655]">
                    最晚出发时间
                  </p>
                  <p className="text-2xl font-bold text-[#191c1e]">
                    {formatTimeInTimeZone(
                      primaryLeg?.latestDepartAt,
                      tripTimeZone
                    )}
                  </p>
                </div>
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-[#434655]">
                  {routeTitle ?? "路线方案待定"}
                </p>
                <p className="mt-1 text-base font-semibold text-[#191c1e]">
                  {selectedCandidates.length > 0
                    ? `路程 ${totalRouteMinutes} 分钟 + 缓冲 ${totalBufferMinutes} 分钟`
                    : "智能体尚未选择路线。"}
                </p>
              </div>
            </div>
            <div className="min-h-36 min-w-0 rounded-2xl bg-[linear-gradient(135deg,rgba(219,225,255,0.9),rgba(255,255,255,0.35)),linear-gradient(35deg,transparent_0_38%,rgba(37,99,235,0.45)_38.5%,transparent_40%_100%),linear-gradient(120deg,transparent_0_58%,rgba(195,198,215,0.8)_58.5%,transparent_60%_100%)] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
                <Map aria-hidden="true" className="size-5 text-[#2563eb]" />
                地图参考
              </div>
              <p className="mt-10 break-words text-sm font-medium text-[#434655]">
                {mapPath.length > 1
                  ? mapPath.join(" -> ")
                  : `${primaryLeg?.originName ?? "出发点"} 到 ${
                      trip.finalStopName ??
                      primaryLeg?.destinationName ??
                      "目的地"
                    }`}
              </p>
            </div>
          </div>
        </GlassCard>

        {isTravelTrip && travelPlan && dayCardsData.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#191c1e]">每日行程</h2>
            {dayCardsData.map((day) => (
              <DayCard
                attractions={travelPlan.attractions}
                date={day.date}
                dayNumber={day.dayNumber}
                food={day.food}
                forecast={day.forecast}
                key={day.date}
                legs={day.legs}
                lodging={day.lodging}
                pitfalls={day.pitfalls}
                stops={day.stops}
                timezone={tripTimeZone}
                tripId={trip.id}
                weatherRisk={day.weatherRisk}
                weatherSummary={day.weatherSummary}
                withinForecastRange={day.withinForecastRange}
              />
            ))}
          </div>
        ) : (
          <GlassCard className="p-5">
            <h2 className="text-lg font-bold text-[#191c1e]">路线分段</h2>
            <div className="mt-3">
              <RouteTimeline groups={routeGroups} />
            </div>
          </GlassCard>
        )}

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-[#2563eb]" />
            <h2 className="text-lg font-bold text-[#191c1e]">缓冲时间</h2>
          </div>
          <div className="mt-4">
            <BufferList buffers={buffers} />
          </div>
        </GlassCard>

        <section className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Bell aria-hidden="true" className="size-5 text-[#2563eb]" />
              <h2 className="text-lg font-bold text-[#191c1e]">提醒计划</h2>
            </div>
            <div className="mt-4 space-y-3">
              {reminders.length === 0 ? (
                <p className="text-sm font-medium text-[#434655]">
                  暂无提醒计划。
                </p>
              ) : (
                reminders.map((reminder) => (
                  <div
                    className="flex items-center justify-between gap-4 rounded-2xl bg-white/65 p-4"
                    key={reminder.id}
                  >
                    <div>
                      <p className="text-sm font-bold text-[#191c1e]">
                        {formatReminderKind(reminder.kind)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#434655]">
                        {formatDateTimeInTimeZone(
                          reminder.scheduledFor,
                          tripTimeZone
                        )}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-bold text-[#434655]">
                      {formatReminderStatus({
                        status: reminder.status,
                        kind: reminder.kind,
                        scheduledFor: reminder.scheduledFor,
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <RefreshCw aria-hidden="true" className="size-5 text-[#2563eb]" />
              <h2 className="text-lg font-bold text-[#191c1e]">
                监控状态
              </h2>
            </div>
            <div className="mt-4 rounded-2xl bg-[#d3e4fe] p-4">
              <p className="text-sm font-bold text-[#0b1c30]">
                {monitoringStatusDisplay.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-[#38485d]">
                {monitoringStatusDisplay.description}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/65 p-3">
                  <p className="font-medium text-[#38485d]">已监控</p>
                  <p className="mt-1 font-bold text-[#0b1c30]">
                    {monitoringSummary.monitoredFor}
                  </p>
                </div>
                <div className="rounded-xl bg-white/65 p-3">
                  <p className="font-medium text-[#38485d]">待提醒</p>
                  <p className="mt-1 font-bold text-[#0b1c30]">
                    {monitoringSummary.scheduledReminderCount}
                  </p>
                </div>
              </div>
              {latestRecalculation ? (
                <div className="mt-3 space-y-1 text-xs font-semibold uppercase tracking-[0.05em] text-[#38485d]">
                  <p>最近复算：{formatRecalculationStatus(latestRecalculation.status)}</p>
                  {latestRecalculation.summary ? (
                    <p className="normal-case tracking-normal">
                      {latestRecalculation.summary}
                    </p>
                  ) : null}
                  <p>触发来源：{formatTrigger(latestRecalculation.trigger)}</p>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-start gap-2">
                {canCancelMonitoring ? (
                  <MonitoringActions tripId={trip.id} status={trip.status} />
                ) : null}
                <TripDeleteButton tripId={trip.id} />
              </div>
            </div>
          </GlassCard>
        </section>
      </div>
    </AppShell>
  );
}
