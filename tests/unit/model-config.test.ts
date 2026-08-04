import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_PLANNING_MODEL_OPTIONS,
  DEFAULT_PLANNING_MODEL,
  getDefaultPlanningModel,
  getPlanningModelOptions,
  isSupportedPlanningModel,
  PLANNING_MODEL_OPTIONS,
} from "@/lib/agent/model-config";

describe("planning model configuration", () => {
  it("uses DeepSeek V4 Flash as the default for the official DeepSeek endpoint", () => {
    const env = { OPENAI_BASE_URL: "https://api.deepseek.com/v1" };

    expect(getDefaultPlanningModel(env)).toBe("deepseek-v4-flash");
    expect(getPlanningModelOptions(env)).toEqual(DEEPSEEK_PLANNING_MODEL_OPTIONS);
    expect(isSupportedPlanningModel("gpt-4o-mini", env)).toBe(false);
    expect(isSupportedPlanningModel("deepseek-v4-flash", env)).toBe(true);
  });

  it("keeps the generic catalog for another OpenAI-compatible endpoint", () => {
    const env = { OPENAI_BASE_URL: "https://provider.example/v1" };

    expect(getDefaultPlanningModel(env)).toBe(DEFAULT_PLANNING_MODEL);
    expect(getPlanningModelOptions(env)).toEqual(PLANNING_MODEL_OPTIONS);
    expect(isSupportedPlanningModel("gpt-4o-mini", env)).toBe(true);
  });
});
