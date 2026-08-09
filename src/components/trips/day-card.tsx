"use client";

import React, { useState } from "react";
import {
  CarFront,
  CloudSun,
  Hotel,
  Landmark,
  MapPin,
  RefreshCw,
  Trees,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import type {
  TravelAttraction,
  TravelFood,
  TravelLodging,
  TravelPitfall,
  TravelWeatherForecast,
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
  lodging: TravelLodging[];
  food: TravelFood[];
  pitfalls: TravelPitfall[];
  weatherRisk?: TravelWeatherRouteRisk;
  weatherSummary?: string;
  forecast?: TravelWeatherForecast;
  withinForecastRange?: boolean;
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

function placeMatches(reference: string, candidate: string | undefined) {
  if (!candidate) return false;
  const ref = reference.toLowerCase().replace(/[\s（）()【】[\]·,，。]/g, "");
  const cand = candidate.toLowerCase().replace(/[\s（）()【】[\]·,，。]/g, "");
  if (!ref || !cand) return false;
  return ref.includes(cand) || cand.includes(ref);
}

export function DayCard({
  dayNumber,
  date,
  legs,
  stops,
  attractions,
  lodging,
  food,
  pitfalls,
  weatherRisk,
  weatherSummary,
  forecast,
  withinForecastRange = true,
  timezone,
  tripId,
}: DayCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [legOverrides, setLegOverrides] = useState<Record<number, number>>({});
  const [riskOverride, setRiskOverride] = useState<TravelWeatherRouteRisk | null>(null);
  const [summaryOverride, setSummaryOverride] = useState<string | null>(null);

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
      // Update weather risk from generated risks — pick the highest risk
      // among the refreshed legs to display as the day's risk badge.
      if (data.routeRisks && data.routeRisks.length > 0) {
        const priority = { high: 3, medium: 2, low: 1 };
        const worst = data.routeRisks.reduce((prev: TravelWeatherRouteRisk, curr: TravelWeatherRouteRisk) =>
          (priority[curr.risk as keyof typeof priority] ?? 0) >
          (priority[prev.risk as keyof typeof priority] ?? 0)
            ? curr
            : prev
        );
        setRiskOverride(worst);
      }
      if (data.weatherSummary) {
        setSummaryOverride(data.weatherSummary);
      }
      setRefreshedAt(data.refreshedAt);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  const activeRisk = riskOverride ?? weatherRisk;
  const activeSummary = summaryOverride ?? weatherSummary;

  const tone = activeRisk ? riskTone(activeRisk.risk) : null;

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
      {!withinForecastRange ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff7ed] px-3 py-2">
          <CloudSun aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#ea580c]" />
          <p className="text-xs leading-5 text-[#9a3412]">
            天气预报仅覆盖未来 3 天，此日天气请临近出发时点击刷新获取。
          </p>
        </div>
      ) : forecast || activeSummary || activeRisk ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#f0f7ff] px-3 py-2">
          <CloudSun aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#2563eb]" />
          <div className="min-w-0 flex-1">
            {/* Concrete weather data: temperature, conditions, wind */}
            {forecast?.summary ? (
              <p className="text-xs font-bold leading-5 text-[#1e40af]">
                {forecast.summary}
              </p>
            ) : activeSummary ? (
              <p className="text-xs leading-5 text-[#1e40af]">{activeSummary}</p>
            ) : null}
            {forecast?.location ? (
              <p className="mt-0.5 text-[10px] text-[#5b6072]">
                📍 {forecast.location}
              </p>
            ) : null}
            {/* Risk badge + driving advice */}
            {activeRisk ? (
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone!.badge}`}
                >
                  {tone!.label}
                </span>
                <span className="text-[11px] text-[#5b6072]">
                  {activeRisk.summary}
                </span>
              </div>
            ) : null}
            {activeRisk?.drivingAdvice ? (
              <p className="mt-0.5 text-[11px] leading-4 text-[#5b6072]">
                🚗 {activeRisk.drivingAdvice}
              </p>
            ) : null}
            {forecast?.outdoorAdvice ? (
              <p className="mt-0.5 text-[11px] leading-4 text-[#5b6072]">
                🌿 {forecast.outdoorAdvice}
              </p>
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

          // Match lodging and food to this stop by area/name.
          const stopLodging = lodging.filter(
            (item) =>
              placeMatches(stop.name, item.area) ||
              placeMatches(stop.name, item.name) ||
              (item.notes && placeMatches(stop.name, item.notes))
          );
          const stopFood = food.filter(
            (item) =>
              placeMatches(stop.name, item.area) ||
              placeMatches(stop.name, item.name) ||
              (item.notes && placeMatches(stop.name, item.notes))
          );

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

                {/* Attractions at this stop — full detail */}
                {stopAttractions.length > 0 ? (
                  <div className="mt-2 space-y-3">
                    {stopAttractions.map((attraction) => {
                      const isNatural = attraction.category === "natural";
                      const Icon = isNatural ? Trees : Landmark;
                      return (
                        <div
                          className="rounded-lg bg-[#f8fafc] p-2.5"
                          key={attraction.name}
                        >
                          <div className="flex items-start gap-1.5">
                            <Icon
                              aria-hidden="true"
                              className={`mt-0.5 size-4 shrink-0 ${
                                isNatural ? "text-[#0f9f6e]" : "text-[#7c3aed]"
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#191c1e]">
                                {attraction.name}
                                {attraction.naturalType
                                  ? ` · ${attraction.naturalType}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <p className="mt-1.5 pl-5.5 text-[11px] leading-5 text-[#434655]">
                            {attraction.reason}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5.5">
                            {attraction.stayMinutes ? (
                              <span className="rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[10px] font-semibold text-[#5b6072]">
                                停留 {formatMinutes(attraction.stayMinutes)}
                              </span>
                            ) : null}
                            {attraction.bestTime ? (
                              <span className="rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[10px] font-semibold text-[#5b6072]">
                                {attraction.bestTime}
                              </span>
                            ) : null}
                          </div>
                          {attraction.weatherNote ? (
                            <p className="mt-1 pl-5.5 text-[10px] leading-4 text-[#737686]">
                              🌤 {attraction.weatherNote}
                            </p>
                          ) : null}
                          {attraction.notes ? (
                            <p className="mt-0.5 pl-5.5 text-[10px] leading-4 text-[#737686]">
                              {attraction.notes}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Lodging at this stop */}
                {stopLodging.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {stopLodging.map((item) => (
                      <div
                        className="flex items-start gap-1.5 rounded-lg bg-[#fff7ed]/60 p-2"
                        key={`lodging-${item.name}`}
                      >
                        <Hotel aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#ea580c]" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-[#191c1e]">
                            🏨 {item.name}
                            {item.budget ? ` · ${item.budget}` : ""}
                          </p>
                          <p className="text-[10px] leading-4 text-[#5b6072]">
                            {item.reason}
                          </p>
                          {item.address ? (
                            <p className="text-[10px] leading-4 text-[#737686]">
                              {item.address}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Food at this stop */}
                {stopFood.length > 0 ? (
                  <div className="mt-1.5 space-y-1.5">
                    {stopFood.map((item) => (
                      <div
                        className="flex items-start gap-1.5 rounded-lg bg-[#fef3c7]/40 p-2"
                        key={`food-${item.name}`}
                      >
                        <Utensils aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#d97706]" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-[#191c1e]">
                            🍽 {item.name}
                            {item.budget ? ` · ${item.budget}` : ""}
                          </p>
                          <p className="text-[10px] font-semibold text-[#92400e]">
                            必尝：{item.mustTry}
                          </p>
                          <p className="text-[10px] leading-4 text-[#5b6072]">
                            {item.reason}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pitfalls relevant to this day */}
      {pitfalls.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-[#c3c6d7]/30 pt-2.5">
          {pitfalls.map((pitfall) => (
            <div
              className="flex items-start gap-1.5 rounded-lg bg-[#fff4d6]/50 p-2"
              key={`pitfall-${pitfall.title}`}
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#b45309]" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] font-bold text-[#7a4f00]">
                    {pitfall.title}
                  </p>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                      pitfall.severity === "high"
                        ? "bg-[#fecaca] text-[#991b1b]"
                        : pitfall.severity === "low"
                          ? "bg-[#bbf7d0] text-[#166534]"
                          : "bg-[#fed7aa] text-[#9a3412]"
                    }`}
                  >
                    {pitfall.severity === "high"
                      ? "优先确认"
                      : pitfall.severity === "low"
                        ? "顺手留意"
                        : "建议确认"}
                  </span>
                </div>
                <p className="text-[10px] leading-4 text-[#7a4f00]">
                  {pitfall.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
