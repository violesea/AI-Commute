// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, expect, it } from "vitest";
import { TravelPlanCard } from "@/components/trips/travel-plan-card";
import type { TravelPlan } from "@/lib/trips/travel-plan";

const plan: TravelPlan = {
  destination: "锡林郭勒",
  summary: "按天气动态调整",
  days: 3,
  routeCoverage: {
    plannedAttractions: ["达里诺尔湖"],
    alternativeAttractions: ["贝子庙"],
  },
  weather: {
    city: "锡林郭勒",
    summary: "天气参考",
    advice: "出发前刷新",
    dynamicMonitoring: true,
    refreshPolicy: "每段出发前刷新",
  },
  transport: {
    recommended: "driving",
    reason: "景点分散",
    driving: {
      summary: "自驾 4 小时",
      reason: "更灵活",
      durationMinutes: 240,
      route: "高德驾车路线",
    },
    transit: {
      summary: "公共交通 7 小时",
      reason: "班次较少",
      durationMinutes: 420,
      route: "高德公交路线",
    },
  },
  attractions: [
    {
      name: "达里诺尔湖",
      category: "natural",
      reason: "湖泊景观",
      routeStatus: "planned",
    },
    {
      name: "贝子庙",
      category: "cultural",
      reason: "人文景观",
      routeStatus: "alternative",
    },
  ],
  lodging: [],
  food: [],
  pitfalls: [],
};

describe("TravelPlanCard route coverage", () => {
  it("shows planned attractions and excludes alternatives from coverage", () => {
    render(<TravelPlanCard plan={plan} />);

    expect(screen.getByText("本次路线覆盖")).toBeInTheDocument();
    expect(screen.getByText("达里诺尔湖", { selector: "p" })).toBeInTheDocument();
    expect(
      screen.getByText("备选，不计入本次覆盖：贝子庙")
    ).toBeInTheDocument();
    expect(screen.getByText(/本次路线已安排 1 个景点，备选/)).toBeInTheDocument();
  });

  it("shows explicitly requested natural types that are not covered", () => {
    render(
      <TravelPlanCard
        plan={{
          ...plan,
          routeCoverage: {
            plannedAttractions: plan.routeCoverage?.plannedAttractions ?? [],
            alternativeAttractions:
              plan.routeCoverage?.alternativeAttractions ?? [],
            requestedNaturalTypes: ["volcanic", "mountain"],
            unmetNaturalTypes: ["mountain"],
          },
        }}
      />
    );

    expect(
      screen.getByText("用户点名自然类型：volcanic、mountain；未覆盖：mountain")
    ).toBeInTheDocument();
    expect(screen.queryByText(/均已进入主路线/)).not.toBeInTheDocument();
  });

  it("labels itinerary weather relative to the trip and separates baseline weather", () => {
    render(
      <TravelPlanCard
        plan={{
          ...plan,
          weather: {
            ...plan.weather,
            forecast: [
              {
                date: "2026-08-08",
                day: 5,
                summary: "行程日天气未知",
                risk: "medium",
              },
              {
                date: "2026-08-04",
                day: 1,
                summary: "基线天气",
                risk: "low",
              },
            ],
          },
        }}
        itineraryDateRange={{
          startDate: "2026-08-08",
          endDate: "2026-08-12",
        }}
      />
    );

    expect(screen.getByText("第 1 天 · 2026-08-08")).toBeInTheDocument();
    expect(screen.getByText("参考天气 · 2026-08-04")).toBeInTheDocument();
    expect(screen.queryByText("第 5 天 · 2026-08-08")).not.toBeInTheDocument();
  });
});
