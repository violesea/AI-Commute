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
});
