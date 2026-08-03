import {
  BusFront,
  CarFront,
  CalendarDays,
  CloudSun,
  Hotel,
  Landmark,
  MapPin,
  RefreshCw,
  Trees,
  TriangleAlert,
  Utensils,
  Wallet,
} from "lucide-react";
import React, { type ReactNode } from "react";
import { GlassCard } from "@/components/glass-card";
import type {
  TravelAttraction,
  TravelPlan,
  TravelRecommendationEvidence,
  TravelRouteStats,
  TravelTransportMode,
  TravelWeatherDateRange,
} from "@/lib/trips/travel-plan";

function transportLabel(mode: TravelTransportMode) {
  if (mode === "driving") return "自驾优先";
  if (mode === "transit") return "公共交通优先";
  return "混合出行";
}

function transportIcon(mode: TravelTransportMode) {
  return mode === "transit" ? (
    <BusFront aria-hidden="true" className="size-5" />
  ) : (
    <CarFront aria-hidden="true" className="size-5" />
  );
}

function weatherRiskLabel(risk: "low" | "medium" | "high") {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需留意";
  return "较稳定";
}

function formatWeatherObservedAt(value?: string) {
  if (!value) return "未记录";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatWeatherCoverage(plan: TravelPlan) {
  if (plan.weather.forecastAvailableThrough) {
    return `截至 ${plan.weather.forecastAvailableThrough}`;
  }

  return "未记录当前预报边界，按每次刷新结果执行";
}

function calendarDayDifference(startDate: string, endDate: string) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((end - start) / 86_400_000);
}

function formatForecastDay(
  date: string | undefined,
  modelDay: number | undefined,
  itineraryDateRange?: TravelWeatherDateRange
) {
  if (date && itineraryDateRange) {
    if (
      date >= itineraryDateRange.startDate &&
      date <= itineraryDateRange.endDate
    ) {
      return `第 ${calendarDayDifference(itineraryDateRange.startDate, date) + 1} 天`;
    }

    return "参考天气";
  }

  return modelDay ? `第 ${modelDay} 天` : "行程天气";
}

function recommendationEvidenceLabel(
  evidence?: TravelRecommendationEvidence
) {
  if (evidence?.label) return evidence.label;
  if (evidence?.source === "user_input") return "用户提供，仍需现场核对";
  if (evidence?.source === "amap_poi") {
    return "高德地点检索参考，仍需核对开放与价格";
  }
  if (evidence?.source === "amap_route") return "高德路线参考，出发前刷新";
  if (evidence?.source === "amap_weather") return "高德天气参考，出发前刷新";
  return "AI建议，出发前核验";
}

function RecommendationEvidence({
  evidence,
}: {
  evidence?: TravelRecommendationEvidence;
}) {
  return (
    <p className="mt-2 text-[11px] font-semibold leading-5 text-[#5b6072]">
      证据：{recommendationEvidenceLabel(evidence)}
      {evidence?.observedAt
        ? ` · ${formatWeatherObservedAt(evidence.observedAt)}`
        : ""}
      {evidence?.note ? ` · ${evidence.note}` : ""}
    </p>
  );
}

function AttractionList({
  attractions,
  category,
  title,
  icon,
}: {
  attractions: TravelAttraction[];
  category: "natural" | "cultural";
  title: string;
  icon: ReactNode;
}) {
  const items = attractions.filter((attraction) => attraction.category === category);

  return (
    <div className="rounded-2xl bg-white/60 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
        {icon}
        {title}
      </div>
      <div className="mt-3 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm font-medium text-[#737686]">暂无明确推荐</p>
        ) : (
          items.map((attraction) => (
            <article className="border-b border-[#c3c6d7]/45 pb-3 last:border-0 last:pb-0" key={`${category}-${attraction.name}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-bold text-[#191c1e]">
                    {attraction.name}
                  </h3>
                  {attraction.address ? (
                    <p className="mt-1 break-words text-xs font-medium text-[#737686]">
                      {attraction.address}
                    </p>
                  ) : null}
                </div>
                {attraction.day ? (
                  <span className="shrink-0 rounded-full bg-[#dae2fd] px-2.5 py-1 text-xs font-bold text-[#3f465c]">
                    第 {attraction.day} 天
                  </span>
                ) : null}
              </div>
              <span
                className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  attraction.routeStatus === "planned"
                    ? "bg-[#dcfce7] text-[#166534]"
                    : "bg-[#fef3c7] text-[#92400e]"
                }`}
              >
                {attraction.routeStatus === "planned"
                  ? "已安排进路线"
                  : "备选 / 顺路可选"}
              </span>
              <p className="mt-2 text-sm leading-6 text-[#434655]">
                {attraction.reason}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-[#5b6072]">
                {attraction.stayMinutes ? (
                  <span className="rounded-full bg-[#f2f4f6] px-2.5 py-1">
                    建议停留 {attraction.stayMinutes} 分钟
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
              <RecommendationEvidence evidence={attraction.evidence} />
            </article>
          ))
        )}
      </div>
    </div>
  );
}

export function TravelPlanCard({
  plan,
  routeStats,
  itineraryDateRange,
}: {
  plan: TravelPlan;
  routeStats?: TravelRouteStats;
  itineraryDateRange?: TravelWeatherDateRange;
}) {
  return (
    <div className="space-y-5">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-[#2563eb]">
              <MapPin aria-hidden="true" className="size-5" />
              旅行规划
            </div>
            <h2 className="mt-2 break-words text-2xl font-bold text-[#191c1e]">
              {plan.destination}
              {plan.days ? ` · ${plan.days} 天` : ""}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#434655]">
              AI 规划说明：{plan.summary}
            </p>
            {plan.routeCoverage ? (
              <div className="mt-3 rounded-2xl border border-[#86efac]/60 bg-[#f0fdf4] px-4 py-3 text-xs leading-5 text-[#166534]">
                <p className="font-bold">本次路线覆盖</p>
                <p className="mt-1">
                  {plan.routeCoverage.plannedAttractions.length > 0
                    ? plan.routeCoverage.plannedAttractions.join("、")
                    : "暂无景点已安排进结构化路线"}
                </p>
                {plan.routeCoverage.alternativeAttractions.length > 0 ? (
                  <p className="mt-1 text-[#92400e]">
                    备选，不计入本次覆盖：{plan.routeCoverage.alternativeAttractions.join("、")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {routeStats ? (
              <div className="mt-4 rounded-2xl border border-[#93c5fd]/60 bg-[#eff6ff] px-4 py-3 text-xs leading-5 text-[#1e40af]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">结构化路线事实</span>
                  <span className="font-semibold">以已落盘路线明细为准</span>
                </div>
                <p className="mt-1 font-semibold">
                  自驾 {routeStats.totalDrivingMinutes} 分钟 · 路程 {routeStats.totalRouteMinutes} 分钟 · 缓冲 {routeStats.totalBufferMinutes} 分钟 · 合计 {routeStats.totalMinutes} 分钟
                </p>
                {routeStats.dailyDrivingMinutes.length > 0 ? (
                  <p className="mt-1">
                    每日自驾：{routeStats.dailyDrivingMinutes
                      .map((item) => `${item.date} ${item.minutes} 分钟`)
                      .join(" · ")}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px]">
                  上方 AI 摘要只作行程说明，不覆盖结构化路线分钟数。
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-2 rounded-2xl bg-[#fff4d6] px-3 py-2 text-[#7a4f00]">
            <CloudSun aria-hidden="true" className="mt-0.5 size-5" />
            <div className="min-w-0">
              <p className="text-xs font-bold">天气参考 · {plan.weather.city}</p>
              <p className="mt-1 max-w-xs text-xs leading-5">{plan.weather.summary}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm leading-6 text-[#434655]">
          {plan.weather.advice}
          {plan.weather.source ? (
            <span className="ml-2 text-xs font-semibold text-[#737686]">
              来源：{plan.weather.source}
            </span>
          ) : null}
        </div>
        {plan.weather.dynamicMonitoring || plan.weather.refreshPolicy ? (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-[#93c5fd]/55 bg-[#eff6ff] px-4 py-3 text-xs leading-5 text-[#1e40af]">
            <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              自驾天气动态监控已开启
              {plan.weather.refreshPolicy
                ? `：${plan.weather.refreshPolicy}`
                : "，每次路线复查时重新评估。"}
            </span>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 rounded-2xl border border-[#c3c6d7]/50 bg-white/60 px-4 py-3 text-xs font-semibold leading-5 text-[#5b6072] sm:grid-cols-2">
          <span>
            最近天气刷新：{formatWeatherObservedAt(plan.weather.observedAt)}
          </span>
          <span>当前可用预报：{formatWeatherCoverage(plan)}</span>
        </div>
        {plan.weather.forecast?.length ? (
          <div className="mt-4 rounded-2xl bg-white/60 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
              <CalendarDays aria-hidden="true" className="size-5 text-[#2563eb]" />
              行程天气与自驾影响
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {plan.weather.forecast.map((forecast, index) => (
                <article
                  className="rounded-2xl border border-[#c3c6d7]/45 bg-[#f8fafc] p-3"
                  key={`${forecast.date ?? "day"}-${forecast.day ?? index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-[#191c1e]">
                        {formatForecastDay(
                          forecast.date,
                          forecast.day,
                          itineraryDateRange
                        )}
                        {forecast.date ? ` · ${forecast.date}` : ""}
                      </p>
                      {forecast.location ? (
                        <p className="mt-1 text-[11px] font-semibold text-[#737686]">
                          {forecast.location}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-[#fff4d6] px-2 py-1 text-[11px] font-bold text-[#7a4f00]">
                      {weatherRiskLabel(forecast.risk)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-[#434655]">
                    {forecast.summary}
                  </p>
                  {forecast.drivingAdvice ? (
                    <p className="mt-2 text-xs leading-5 text-[#5b6072]">
                      自驾：{forecast.drivingAdvice}
                    </p>
                  ) : null}
                  {forecast.outdoorAdvice ? (
                    <p className="mt-1 text-xs leading-5 text-[#5b6072]">
                      户外：{forecast.outdoorAdvice}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : null}
        {plan.weather.routeRisks?.length ? (
          <div className="mt-3 rounded-2xl border border-[#fdba74]/55 bg-[#fff7ed] p-4">
            <p className="text-sm font-bold text-[#7c2d12]">自驾路段天气风险</p>
            <div className="mt-3 space-y-2">
              {plan.weather.routeRisks.map((risk, index) => (
                <div className="rounded-xl bg-white/70 px-3 py-2" key={`${risk.route}-${risk.legOrder ?? index}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-bold text-[#431407]">
                      {risk.route}
                    </p>
                    <span className="shrink-0 text-[11px] font-bold text-[#9a3412]">
                      {weatherRiskLabel(risk.risk)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#7c2d12]">
                    {risk.summary} · {risk.drivingAdvice}
                    {risk.action ? ` ${risk.action}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <Wallet aria-hidden="true" className="size-5 text-[#2563eb]" />
          <h2 className="text-lg font-bold text-[#191c1e]">预算参考</h2>
        </div>
        {plan.budget ? (
          <>
            <div className="mt-4 rounded-2xl bg-[#e8f5e9] px-4 py-4">
              <p className="text-xs font-bold text-[#276749]">预计总计</p>
              <p className="mt-1 text-2xl font-bold text-[#1f5133]">
                {plan.budget.total}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#4b6b52]">
                币种：{plan.budget.currency}
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {plan.budget.breakdown.map((item) => (
                <article
                  className="rounded-2xl bg-white/60 p-4"
                  key={`${item.category}-${item.amount}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-bold text-[#191c1e]">
                      {item.category}
                    </h3>
                    <span className="shrink-0 text-sm font-bold text-[#2563eb]">
                      {item.amount}
                    </span>
                  </div>
                  {item.notes ? (
                    <p className="mt-2 text-xs leading-5 text-[#737686]">
                      {item.notes}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
            {plan.budget.assumptions ? (
              <p className="mt-3 rounded-2xl bg-[#f2f4f6] px-4 py-3 text-xs leading-5 text-[#5b6072]">
                估算口径：{plan.budget.assumptions}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-4 rounded-2xl bg-[#fff4d6] px-4 py-3 text-sm leading-6 text-[#7a4f00]">
            当前计划没有总预算，价格信息需要重新核实。
          </p>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
              出行决策
            </p>
            <h2 className="mt-1 text-lg font-bold text-[#191c1e]">
              {transportLabel(plan.transport.recommended)}
            </h2>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[#d3e4fe] px-3 py-2 text-sm font-bold text-[#0b1c30]">
            {transportIcon(plan.transport.recommended)}
            {plan.transport.recommended === "mixed" ? "自驾 + 公共交通" : transportLabel(plan.transport.recommended)}
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#434655]">{plan.transport.reason}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[#c3c6d7]/55 bg-white/60 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
              <CarFront aria-hidden="true" className="size-5 text-[#2563eb]" />
              自驾方案
            </div>
            <p className="mt-2 text-sm leading-6 text-[#434655]">
              {plan.transport.driving.summary}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#737686]">
              {plan.transport.driving.reason}
              {plan.transport.driving.route ? ` · ${plan.transport.driving.route}` : ""}
            </p>
          </div>
          <div className="rounded-2xl border border-[#c3c6d7]/55 bg-white/60 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
              <BusFront aria-hidden="true" className="size-5 text-[#2563eb]" />
              公共交通方案
            </div>
            <p className="mt-2 text-sm leading-6 text-[#434655]">
              {plan.transport.transit.summary}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#737686]">
              {plan.transport.transit.reason}
              {plan.transport.transit.route ? ` · ${plan.transport.transit.route}` : ""}
            </p>
          </div>
        </div>
        {plan.transport.localMovement ? (
          <p className="mt-3 rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm leading-6 text-[#434655]">
            市内移动：{plan.transport.localMovement}
          </p>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-5 text-[#2563eb]" />
          <h2 className="text-lg font-bold text-[#191c1e]">景点推荐与理由</h2>
        </div>
        <div className="mt-3 rounded-2xl border border-[#93c5fd]/55 bg-[#eff6ff] px-4 py-3 text-xs leading-5 text-[#1e40af]">
          <p className="font-bold">
            本次路线已安排 {plan.attractions.filter((attraction) => attraction.routeStatus === "planned").length} 个景点，备选 / 顺路可选 {plan.attractions.filter((attraction) => attraction.routeStatus !== "planned").length} 个景点。
          </p>
          <p className="mt-1">
            “已安排”只认结构化 stops 和关联路线段；未进入实际路线的推荐仅供调整行程时选择，不计入本次覆盖。
          </p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <AttractionList
            attractions={plan.attractions}
            category="natural"
            icon={<Trees aria-hidden="true" className="size-5 text-[#0f9f6e]" />}
            title="自然景观"
          />
          <AttractionList
            attractions={plan.attractions}
            category="cultural"
            icon={<Landmark aria-hidden="true" className="size-5 text-[#7c3aed]" />}
            title="人文历史"
          />
        </div>
      </GlassCard>

      <section className="grid gap-5 md:grid-cols-2">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <Hotel aria-hidden="true" className="size-5 text-[#2563eb]" />
            <h2 className="text-lg font-bold text-[#191c1e]">住宿建议</h2>
          </div>
          <div className="mt-4 space-y-3">
            {plan.lodging.length === 0 ? (
              <p className="text-sm font-medium text-[#737686]">暂无明确住宿建议</p>
            ) : (
              plan.lodging.map((lodging) => (
                <article className="rounded-2xl bg-white/60 p-4" key={`${lodging.area}-${lodging.name}`}>
                  <h3 className="text-sm font-bold text-[#191c1e]">{lodging.name}</h3>
                  <p className="mt-1 text-xs font-semibold text-[#737686]">{lodging.area}</p>
                  <p className="mt-2 text-sm leading-6 text-[#434655]">{lodging.reason}</p>
                  {lodging.budget || lodging.notes ? (
                    <p className="mt-2 text-xs leading-5 text-[#737686]">
                      {[lodging.budget, lodging.notes].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  <RecommendationEvidence evidence={lodging.evidence} />
                </article>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <Utensils aria-hidden="true" className="size-5 text-[#2563eb]" />
            <h2 className="text-lg font-bold text-[#191c1e]">美食建议</h2>
          </div>
          <div className="mt-4 space-y-3">
            {plan.food.length === 0 ? (
              <p className="text-sm font-medium text-[#737686]">暂无明确美食建议</p>
            ) : (
              plan.food.map((food) => (
                <article className="rounded-2xl bg-white/60 p-4" key={`${food.name}-${food.mustTry}`}>
                  <h3 className="text-sm font-bold text-[#191c1e]">{food.name}</h3>
                  {food.area ? (
                    <p className="mt-1 text-xs font-semibold text-[#737686]">{food.area}</p>
                  ) : null}
                  <p className="mt-2 text-sm font-bold leading-6 text-[#191c1e]">
                    推荐尝试：{food.mustTry}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#434655]">{food.reason}</p>
                  {food.budget || food.notes ? (
                    <p className="mt-2 text-xs leading-5 text-[#737686]">
                      {[food.budget, food.notes].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  <RecommendationEvidence evidence={food.evidence} />
                </article>
              ))
            )}
          </div>
        </GlassCard>
      </section>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <TriangleAlert aria-hidden="true" className="size-5 text-[#b45309]" />
          <h2 className="text-lg font-bold text-[#191c1e]">避坑提醒</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {plan.pitfalls.length === 0 ? (
            <p className="text-sm font-medium text-[#737686]">暂无明确避坑提醒</p>
          ) : (
            plan.pitfalls.map((pitfall) => (
              <article className="rounded-2xl bg-[#fff4d6] p-4" key={`${pitfall.title}-${pitfall.detail}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-bold text-[#7a4f00]">{pitfall.title}</h3>
                  <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold text-[#7a4f00]">
                    {pitfall.severity === "high" ? "优先确认" : pitfall.severity === "low" ? "顺手留意" : "建议确认"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#7a4f00]">{pitfall.detail}</p>
              </article>
            ))
          )}
        </div>
      </GlassCard>
    </div>
  );
}
