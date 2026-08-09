"use client";

import React, { useState } from "react";
import {
  CarFront,
  CloudSun,
  Landmark,
  MapPin,
  RefreshCw,
  Trees,
} from "lucide-react";
import type {
  TravelAttraction,
  TravelWeatherRouteRisk,
} from "@/lib/trips/travel-plan";
import { attractionMatchesStop } from "@/lib/trips/travel-plan";

export type DayCardStop = {
  id?: string;
  order: number;
  name: string;
  kind?: string | null;
  address?: string | null;
  lngLat?: string | null;
  targetArriveAt?: string | null;
  plannedStayMin?: number | null;
};

export type DayCardLeg = {
  id: string;
  order: number;
  originName: string | null;
  originLngLat: string | null;
  destinationName: string | null;
  destinationLngLat: string | null;
  routeMinutes: number;
  bufferMinutes: number;
  mode: string | null;
  latestDepartAt: string | null;
  targetArriveAt: string | null;
  routeTitle?: string | null;
};

export type DayCardProps = {
  dayNumber: number;
  date: string;
  legs: DayCardLeg[];
  stops: DayCardStop[];
  attractions: TravelAttraction[];
  weatherRisk?: TravelWeatherRouteRisk;
  weatherSummary?: string;
  timezone: string;
  tripId: string;
};

function formatTime(value: string | null | undefined, timezone: string) {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(date);
  } catch {
    return null;
  }
}

function formatWeekday(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  } catch {
    return "";
  }
}

function formatMinutes(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

function riskTone(risk: TravelWeatherRouteRisk["risk"]) {
  if (risk === "high")
    return { badge: "bg-[#fecaca] text-[#991b1b]", label: "高风险" };
  if (risk === "medium")
    return { badge: "bg-[#fed7aa] text-[#9a3412]", label: "需留意" };
  return { badge: "bg-[#bbf7d0] text-[#166534]", label: "较稳定" };
}

export function DayCard({
  dayNumber,
  date,
  legs,
  stops,
  attractions,
  weatherRisk,
  weatherSummary,
  timezone,
  tripId,
}: DayCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [legOverrides, setLegOverrides] = useState<
    Record<number, number>
  >({});

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const res = await fetch(`/api/trips/${tripId}/refresh-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "刷新失败");
      }
      const data = await res.json();
      if (data.updatedLegs) {
        const overrides: Record<number, number> = {};
        for (const leg of data.updatedLegs) {
          overrides[leg.legOrder] = leg.routeMinutes;
        }
        setLegOverrides(overrides);
      }
      setRefreshedAt(data.refreshedAt);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  const tone = weatherRisk ? riskTone(weatherRisk.risk) : null;

  return (
    <section className="rounded-2xl border border-[#c3c6d7]/40 bg-white/75 p-4 shadow-sm">
      {/* Day header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">
            Day {dayNumber}
          </p>
          <h3 className="mt-0.5 text-base font-bold text-[#191c1e]">
            {date.slice(5)} · {formatWeekday(date)}
          </h3>
        </div>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8edff] px-3 py-1.5 text-xs font-bold text-[#2563eb] transition hover:bg-[#c7d6ff] disabled:opacity-50"
          disabled={refreshing}
          onClick={handleRefresh}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>

      {/* Weather */}
      {weatherSummary || weatherRisk ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#f0f7ff] px-3 py-2">
          <CloudSun aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#2563eb]" />
          <div className="min-w-0">
            {weatherSummary ? (
              <p className="text-xs leading-5 text-[#1e40af]">{weatherSummary}</p>
            ) : null}
            {weatherRisk ? (
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone!.badge}`}
                >
                  {tone!.label}
                </span>
                <span className="text-[11px] text-[#5b6072]">
                  {weatherRisk.summary}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {refreshedAt ? (
        <p className="mt-2 text-[10px] font-semibold text-[#22c55e]">
          ✓ 已刷新（{formatTime(refreshedAt, timezone)}）
        </p>
      ) : null}
      {refreshError ? (
        <p className="mt-2 text-[10px] font-semibold text-[#ba1a1a]">
          刷新失败：{refreshError}
        </p>
      ) : null}

      {/* Route timeline for the day */}
      <div className="mt-3 grid grid-cols-[28px_minmax(0,1fr)] gap-x-2">
        {stops.map((stop, index) => {
          const isLast = index === stops.length - 1;
          // Find the leg arriving at this stop and departing from it.
          const arrivalLeg = legs.find(
            (leg) => leg.destinationName === stop.name || leg.order === stop.order
          );
          const departLeg = legs.find(
            (leg) => leg.originName === stop.name
          );
          const routeMinutes =
            (arrivalLeg && legOverrides[arrivalLeg.order]) ||
            arrivalLeg?.routeMinutes;
          const routeLabel = formatMinutes(
            typeof routeMinutes === "number" ? routeMinutes : arrivalLeg?.routeMinutes
          );
          const stopAttractions = attractions.filter(
            (attraction) => attractionMatchesStop(attraction, stop as never)
          );
          const isLodging =
            stop.kind === "lodging" ||
            /住宿|酒店|宾馆|民宿|客栈/.test(stop.name);

          return (
            <div className="contents" key={`${stop.name}-${index}`}>
              {/* Timeline dot + connector */}
              <div className="flex flex-col items-center gap-1 pt-2.5">
                {index > 0 && <div className="h-1 w-px bg-[#c3c6d7]" />}
                <div className="flex size-6 items-center justify-center rounded-full bg-[#e8edff] text-[#2563eb]">
                  {isLodging ? (
                    <span className="text-[10px]">🏨</span>
                  ) : (
                    <MapPin aria-hidden="true" className="size-3.5" />
                  )}
                </div>
                {!isLast && <div className="min-h-4 w-px grow bg-[#c3c6d7]" />}
              </div>

              {/* Stop content */}
              <div className="min-w-0 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-[#191c1e]">
                      {stop.name}
                    </p>
                    {stop.targetArriveAt ? (
                      <p className="text-[10px] text-[#737686]">
                        到达 {formatTime(stop.targetArriveAt, timezone)}
                        {stop.plannedStayMin
                          ? ` · 停留${stop.plannedStayMin}min`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  {arrivalLeg && routeLabel ? (
                    <span className="shrink-0 rounded-full bg-[#dae2fd] px-2 py-0.5 text-[10px] font-bold text-[#3f465c]">
                      <CarFront aria-hidden="true" className="mr-1 inline size-3" />
                      {routeLabel}
                    </span>
                  ) : null}
                </div>

                {/* Attractions at this stop */}
                {stopAttractions.length > 0 ? (
                  <div className="mt-1.5 space-y-1.5">
                    {stopAttractions.map((attraction) => {
                      const isNatural = attraction.category === "natural";
                      const Icon = isNatural ? Trees : Landmark;
                      return (
                        <div
                          className="flex items-start gap-1.5"
                          key={attraction.name}
                        >
                          <Icon
                            aria-hidden="true"
                            className={`mt-0.5 size-3.5 shrink-0 ${
                              isNatural ? "text-[#0f9f6e]" : "text-[#7c3aed]"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#191c1e]">
                              {attraction.name}
                              {attraction.naturalType
                                ? ` · ${attraction.naturalType}`
                                : ""}
                            </p>
                            <p className="text-[11px] leading-4 text-[#5b6072]">
                              {attraction.reason.slice(0, 80)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
