import React from "react";
import {
  CarFront,
  Footprints,
  Landmark,
  Train,
  Trees,
} from "lucide-react";
import type {
  TravelAttraction,
  TravelPlanRouteLeg,
  TravelPlanRouteStop,
  TravelRecommendationEvidence,
  TravelWeatherForecast,
  TravelWeatherRouteRisk,
} from "@/lib/trips/travel-plan";
import { attractionMatchesStop } from "@/lib/trips/travel-plan";

type ItineraryStopTime = {
  targetArriveAt?: string | null;
  latestDepartAt?: string | null;
};

export type ItineraryFlowLeg = TravelPlanRouteLeg & {
  latestDepartAt?: string | null;
  targetArriveAt?: string | null;
  bufferMinutes?: number | null;
  totalMinutes?: number | null;
};

export type ItineraryFlowProps = {
  stops: TravelPlanRouteStop[];
  legs: ItineraryFlowLeg[];
  attractions: TravelAttraction[];
  routeRisks?: TravelWeatherRouteRisk[];
  forecast?: TravelWeatherForecast[];
  timezone: string;
};

function travelModeIcon(mode?: string | null) {
  const normalized = (mode ?? "").toLowerCase();
  if (normalized.includes("train") || normalized.includes("metro")) {
    return <Train aria-hidden="true" className="size-4" />;
  }
  if (normalized.includes("walk")) {
    return <Footprints aria-hidden="true" className="size-4" />;
  }
  return <CarFront aria-hidden="true" className="size-4" />;
}

function formatMinutes(value?: number | null) {
  if (typeof value !== "number" || value <= 0) return null;
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0
    ? `${hours} 小时 ${minutes} 分钟`
    : `${hours} 小时`;
}

function formatStopTime(value: string | null | undefined, timezone: string) {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(date);
  } catch {
    return null;
  }
}

function riskTone(risk: TravelWeatherRouteRisk["risk"]) {
  if (risk === "high") {
    return {
      badge: "bg-[#fecaca] text-[#991b1b]",
      dot: "bg-[#dc2626]",
      label: "高风险",
    };
  }
  if (risk === "medium") {
    return {
      badge: "bg-[#fed7aa] text-[#9a3412]",
      dot: "bg-[#f97316]",
      label: "需留意",
    };
  }
  return {
    badge: "bg-[#bbf7d0] text-[#166534]",
    dot: "bg-[#22c55e]",
    label: "较稳定",
  };
}

function findLegForStop(
  legs: ItineraryFlowLeg[],
  stopOrder: number
): ItineraryFlowLeg | undefined {
  // The leg arriving at stop N is the one whose order is N-1 (legs are 1-based
  // in the model but stops may be 0-based or 1-based). Match by index: the leg
  // at position (stopOrder-1) arrives at stop (stopOrder) when origin is stop 0.
  return legs.find((leg) => (leg.order ?? 0) === stopOrder - 1);
}

function AttractionDetail({
  attraction,
}: {
  attraction: TravelAttraction;
}) {
  const isNatural = attraction.category === "natural";
  const Icon = isNatural ? Trees : Landmark;
  const accent = isNatural ? "text-[#0f9f6e]" : "text-[#7c3aed]";

  return (
    <article className="rounded-2xl border border-[#c3c6d7]/40 bg-white/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon aria-hidden="true" className={`size-4 shrink-0 ${accent}`} />
            <h3 className="break-words text-sm font-bold text-[#191c1e]">
              {attraction.name}
            </h3>
          </div>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#737686]">
            {isNatural ? "自然景观" : "人文历史"}
            {attraction.naturalType ? ` · ${attraction.naturalType}` : ""}
          </p>
          {attraction.address ? (
            <p className="mt-1 break-words text-xs text-[#737686]">
              {attraction.address}
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#434655]">
        {attraction.reason}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-[#5b6072]">
        {attraction.stayMinutes ? (
          <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1">
            建议停留 {formatMinutes(attraction.stayMinutes) ?? `${attraction.stayMinutes} 分钟`}
          </span>
        ) : null}
        {attraction.bestTime ? (
          <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1">
            {attraction.bestTime}
          </span>
        ) : null}
      </div>
      {attraction.weatherNote || attraction.notes ? (
        <p className="mt-2 text-xs leading-5 text-[#737686]">
          {attraction.weatherNote ?? attraction.notes}
        </p>
      ) : null}
      <EvidenceNote evidence={attraction.evidence} />
    </article>
  );
}

function evidenceLabel(evidence?: TravelRecommendationEvidence) {
  if (evidence?.label) return evidence.label;
  if (evidence?.source === "user_input") return "用户提供，仍需现场核对";
  if (evidence?.source === "amap_poi")
    return "高德地点检索参考，仍需核对开放与价格";
  if (evidence?.source === "amap_route") return "高德路线参考，出发前刷新";
  if (evidence?.source === "amap_weather") return "高德天气参考，出发前刷新";
  return "AI建议，出发前核验";
}

function EvidenceNote({
  evidence,
}: {
  evidence?: TravelRecommendationEvidence;
}) {
  if (!evidence) return null;
  return (
    <p className="mt-2 text-[11px] font-semibold leading-5 text-[#5b6072]">
      证据：{evidenceLabel(evidence)}
    </p>
  );
}

export function ItineraryFlow({
  stops,
  legs,
  attractions,
  routeRisks = [],
  forecast = [],
  timezone,
}: ItineraryFlowProps) {
  if (stops.length === 0) {
    return (
      <p className="rounded-2xl bg-white/60 px-4 py-5 text-sm font-medium text-[#434655]">
        智能体完成规划后会显示行程流。
      </p>
    );
  }

  const orderedStops = [...stops].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  const plannedAttractions = attractions.filter(
    (attraction) => attraction.routeStatus !== "alternative"
  );

  return (
    <div className="space-y-1">
      {orderedStops.map((stop, index) => {
        const isFirst = index === 0;
        const isOrigin = stop.kind === "origin";
        const arrivalLeg = isFirst
          ? undefined
          : findLegForStop(legs, stop.order ?? index);
        const departLeg = orderedStops[index + 1]
          ? legs.find(
              (leg) => (leg.order ?? 0) === (stop.order ?? index)
            )
          : undefined;
        const stopAttractions = plannedAttractions.filter((attraction) =>
          attractionMatchesStop(attraction, stop)
        );
        const arriveLabel = formatStopTime(
          arrivalLeg?.targetArriveAt,
          timezone
        );
        const departLabel = formatStopTime(departLeg?.latestDepartAt, timezone);
        const arrivalRisk =
          arrivalLeg?.order != null
            ? routeRisks.find((entry) => entry.legOrder === arrivalLeg.order)
            : undefined;

        return (
          <div className="contents" key={`${stop.name}-${index}`}>
            {/* Stop card */}
            <section className="rounded-2xl bg-white/70 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">
                    第 {index + 1} 站{isOrigin ? " · 出发地" : ""}
                  </p>
                  <h3 className="mt-1 break-words text-base font-bold text-[#191c1e]">
                    {stop.name}
                  </h3>
                  {stop.address ? (
                    <p className="mt-1 break-words text-xs text-[#737686]">
                      {stop.address}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs font-semibold text-[#5b6072]">
                  {arriveLabel ? (
                    <p>
                      <span className="text-[#737686]">到达 </span>
                      {arriveLabel}
                    </p>
                  ) : null}
                  {departLabel ? (
                    <p className="mt-1">
                      <span className="text-[#737686]">出发 </span>
                      {departLabel}
                    </p>
                  ) : null}
                </div>
              </div>
              {stop.notes ? (
                <p className="mt-2 text-xs leading-5 text-[#737686]">
                  {stop.notes}
                </p>
              ) : null}

              {/* Arrival leg + weather risk */}
              {arrivalLeg ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#f2f4f6] px-3 py-2 text-xs font-semibold text-[#434655]">
                  <CarFront aria-hidden="true" className="size-4 text-[#2563eb]" />
                  <span>
                    从 {arrivalLeg.originName || "上一站"} 自驾
                    {formatMinutes(arrivalLeg.routeMinutes)
                      ? ` ${formatMinutes(arrivalLeg.routeMinutes)}`
                      : ""}
                  </span>
                  {arrivalLeg.bufferMinutes ? (
                    <span className="text-[#737686]">
                      + 缓冲 {arrivalLeg.bufferMinutes}min
                    </span>
                  ) : null}
                </div>
              ) : null}
              {arrivalRisk ? (
                <div className="mt-2 rounded-xl border border-[#fdba74]/50 bg-[#fff7ed] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#7c2d12]">
                      {arrivalRisk.route}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${riskTone(arrivalRisk.risk).badge}`}
                    >
                      {riskTone(arrivalRisk.risk).label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#7c2d12]">
                    {arrivalRisk.summary}
                  </p>
                  {arrivalRisk.drivingAdvice ? (
                    <p className="mt-0.5 text-xs leading-5 text-[#9a3412]">
                      自驾：{arrivalRisk.drivingAdvice}
                    </p>
                  ) : null}
                  {arrivalRisk.action ? (
                    <p className="mt-0.5 text-xs leading-5 text-[#9a3412]">
                      {arrivalRisk.action}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Attractions at this stop */}
              {stopAttractions.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {stopAttractions.map((attraction) => (
                    <AttractionDetail
                      attraction={attraction}
                      key={`${attraction.name}-${attraction.category}`}
                    />
                  ))}
                </div>
              ) : !isOrigin ? (
                <p className="mt-3 text-xs font-medium text-[#737686]">
                  途经点 / 中转，无推荐景点。
                </p>
              ) : null}
            </section>

            {/* Connector leg between stops */}
            {departLeg ? (
              <div className="flex items-center gap-3 px-2 py-1">
                <div className="flex flex-col items-center">
                  <div className="h-2 w-px bg-[#c3c6d7]" />
                  <div className="flex size-7 items-center justify-center rounded-full bg-[#e8edff] text-[#2563eb]">
                    {travelModeIcon(departLeg.mode)}
                  </div>
                  <div className="min-h-5 w-px grow bg-[#c3c6d7]" />
                </div>
                <div className="min-w-0 py-1">
                  <p className="text-xs font-bold text-[#2563eb]">
                    {formatMinutes(departLeg.routeMinutes) ?? "待定路程"}
                  </p>
                  <p className="break-words text-[11px] text-[#737686]">
                    {departLeg.originName || stop.name} →{" "}
                    {departLeg.destinationName || "下一站"}
                  </p>
                  {departLeg.latestDepartAt ? (
                    <p className="text-[11px] text-[#5b6072]">
                      {formatStopTime(departLeg.latestDepartAt, timezone)} 出发
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
