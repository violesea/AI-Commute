import { AgentRunTimeoutError } from "@/lib/agent/runner";

export { AgentRunTimeoutError };

export class AgentSessionAlreadyRunningError extends Error {
  constructor() {
    super("Agent session is already running.");
    this.name = "AgentSessionAlreadyRunningError";
  }
}

export class AgentSessionNotFoundError extends Error {
  constructor() {
    super("Agent session not found.");
    this.name = "AgentSessionNotFoundError";
  }
}

export class AgentConversationLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConversationLimitError";
  }
}

export function formatPlanningFailureMessage(error: unknown) {
  if (error instanceof AgentRunTimeoutError) {
    return "规划失败：智能体规划超时，请稍后重试。";
  }

  if (error instanceof AgentConversationLimitError) {
    return `规划失败：${error.message}`;
  }

  if (error instanceof Error) {
    const knownMessages: Record<string, string> = {
      "Agent run aborted.": "规划失败：智能体运行已中止。",
      "timeoutMs must be greater than zero.":
        "规划失败：内部运行超时配置无效。",
      "maxAttempts must be greater than zero.":
        "规划失败：内部重试配置无效。",
      "Agent planning failed after all attempts.":
        "规划失败：多次尝试后仍未完成，请稍后重试。",
    };

    return knownMessages[error.message] ?? `规划失败：${error.message}`;
  }

  return "规划失败：请稍后重试。";
}
