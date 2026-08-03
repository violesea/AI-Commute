import { describe, expect, it } from "vitest";
import {
  AgentRunTimeoutError,
  formatPlanningFailureMessage,
  stringifyToolError,
} from "@/lib/agent/planner";

describe("planning error display", () => {
  it("formats internal planning errors without leaking English implementation details", () => {
    expect(formatPlanningFailureMessage(new AgentRunTimeoutError(600000))).toBe(
      "规划失败：智能体规划超时，请稍后重试。"
    );

    expect(formatPlanningFailureMessage(new Error("Agent run aborted."))).toBe(
      "规划失败：智能体运行已中止。"
    );

    expect(
      formatPlanningFailureMessage(
        new Error("timeoutMs must be greater than zero.")
      )
    ).toBe("规划失败：内部运行超时配置无效。");
  });

  it("returns machine-readable route changes for daylight and daily limits", () => {
    const daylight = JSON.parse(
      stringifyToolError(
        new Error(
          "第 2 段 多伦湖 → 锡林九曲预计 18:59 到达，晚于当地日落 19:24 的安全线 18:54（已预留 30 分钟）。用户要求白天驾驶，不能把这段夜间自驾落盘。"
        )
      )
    );
    const daily = JSON.parse(
      stringifyToolError(
        new Error(
          "2026-08-08 累计自驾约 6.5 小时，超过用户指定的每日上限 6.0 小时。"
        )
      )
    );
    const budget = JSON.parse(
      stringifyToolError(
        new Error("旅行规划必须提供总预算和至少一项费用分解；未知价格请明确标注待核实。")
      )
    );

    expect(daylight.recovery).toMatchObject({
      constraintType: "daylight_driving",
      mustChange: expect.arrayContaining(["stops", "legs"]),
    });
    expect(daily.recovery).toMatchObject({
      constraintType: "daily_driving_limit",
      mustChange: expect.arrayContaining(["stops", "legs"]),
    });
    expect(budget.instruction).toContain("只需补齐 travelPlan.budget");
  });

  it("tells travel-model retries where the compact recommendation fields belong", () => {
    const missingAttractions = JSON.parse(
      stringifyToolError(new Error("travelPlan.attractions must be an array."))
    );

    expect(missingAttractions.instruction).toContain(
      "create_trip 顶层补齐 budget、attractions、lodging、food、pitfalls"
    );
    expect(missingAttractions.instruction).toContain("至少包含 4 个自然景观");
  });
});
