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
          "2026-08-08 累计自驾 390 分钟（约 6.5 小时），超过用户指定的每日上限 360 分钟（6.0 小时），超出 30 分钟。违规路段：第 1 段 北京→元上都遗址 342 分钟；第 2 段 元上都遗址→多伦 48 分钟。"
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
    expect(daylight.instruction).toContain("不能为修正日落而把它退回备选");
    expect(daylight.recovery.preserve).toContain(
      "用户点名的自然类型至少各保留一个已安排景点"
    );
    expect(daily.recovery).toMatchObject({
      constraintType: "daily_driving_limit",
      mustChange: expect.arrayContaining(["stops", "legs"]),
    });
    expect(daily.instruction).toContain("逐段相加");
    expect(daily.instruction).toContain("住宿推荐不等于必须新增一段本地驾车");
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

  it("explains the canonical natural type repair when model labels are generic", () => {
    const naturalTypes = JSON.parse(
      stringifyToolError(
        new Error(
          "旅行规划的自然景观至少需要覆盖 3 种不同类型（当前只有 1 种（已识别：other））。"
        )
      )
    );

    expect(naturalTypes.instruction).toContain("naturalType");
    expect(naturalTypes.instruction).toContain("不要使用 other");
    expect(naturalTypes.instruction).toContain("lake");
  });

  it("requires a requested natural candidate to enter the main route", () => {
    const routeCoverage = JSON.parse(
      stringifyToolError(
        new Error(
          "用户明确要求的自然景观类型 volcanic 已有候选，但没有进入主路线。请把对应景点加入 stops/legs；若确实放弃，必须先调整请求或给出可执行替代路线。"
        )
      )
    );

    expect(routeCoverage.instruction).toContain("加入 stops");
    expect(routeCoverage.instruction).toContain("相邻 legs");
    expect(routeCoverage.instruction).not.toContain("仅修正每个自然景点的 naturalType");
  });

  it("explains how to repair a cross-day itinerary without an overnight link", () => {
    const overnight = JSON.parse(
      stringifyToolError(
        new Error(
          "旅行路线跨自然日从 火山公园 继续出发，但前一日终点未明确住宿或返城连接。请在该处补充住宿，或加入返回城市的连接段。"
        )
      )
    );

    expect(overnight.instruction).toContain("跨自然日");
    expect(overnight.instruction).toContain("补充景点附近住宿");
    expect(overnight.instruction).toContain("返回城市");
  });
});
