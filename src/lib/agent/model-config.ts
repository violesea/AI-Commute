export const DEFAULT_PLANNING_MODEL = "gpt-4o-mini";
export const TRAVEL_PLANNING_MODEL = "deepseek-v4-flash";

export const DEEPSEEK_PLANNING_MODEL_OPTIONS = [
  ["deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["deepseek-v4-pro", "DeepSeek V4 Pro"],
] as const;

export const PLANNING_MODEL_OPTIONS = [
  ["gpt-4o-mini", "GPT-4o mini"],
  ["deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["deepseek-v4-pro", "DeepSeek V4 Pro"],
] as const;

type ModelEnvironment = Partial<Record<string, string | undefined>>;

function isDeepSeekBaseUrl(value?: string) {
  return /^https?:\/\/api\.deepseek\.com(?:\/(?:v1|beta))?\/?$/i.test(
    value?.trim() ?? ""
  );
}

export function getDefaultPlanningModel(
  env: ModelEnvironment = process.env
) {
  return (
    env.OPENAI_MODEL?.trim() ||
    (isDeepSeekBaseUrl(env.OPENAI_BASE_URL)
      ? TRAVEL_PLANNING_MODEL
      : DEFAULT_PLANNING_MODEL)
  );
}

export function getPlanningModelOptions(
  env: ModelEnvironment = process.env
) {
  return isDeepSeekBaseUrl(env.OPENAI_BASE_URL)
    ? DEEPSEEK_PLANNING_MODEL_OPTIONS
    : PLANNING_MODEL_OPTIONS;
}

export function isSupportedPlanningModel(
  value: string,
  env: ModelEnvironment = process.env
) {
  return getPlanningModelOptions(env).some(([model]) => model === value);
}
