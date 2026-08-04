import { NextResponse } from "next/server";
import { createOpenAiChatClient } from "@/lib/agent/chat-client";
import { isSupportedPlanningModel } from "@/lib/agent/model-config";
import { getCurrentUser } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";

const MODEL_TEST_TIMEOUT_MS = 15_000;

function readModel(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "模型请求失败";

  return message
    .replace(/https?:\/\/[^\s)]+/gi, "[服务地址]")
    .replace(/(?:sk|rk|key)[-_a-z0-9.]+/gi, "[凭证已隐藏]")
    .slice(0, 240);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const model = readModel(body.model);

  if (!isSupportedPlanningModel(model)) {
    return NextResponse.json(
      { error: "不支持该 AI 模型" },
      { status: 400 }
    );
  }

  const env = readEnv();

  if (!env.hasOpenAiKey) {
    return NextResponse.json(
      {
        result: {
          status: "not_configured",
          model,
          error: "服务器未配置 OPENAI_API_KEY，当前使用内置 fallback planner。",
        },
      },
      { status: 503 }
    );
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("模型接入测试超时"));
  }, MODEL_TEST_TIMEOUT_MS);

  try {
    const client = createOpenAiChatClient();
    await client.complete({
      model,
      messages: [
        {
          role: "user",
          content: "Reply with OK only. This is a connectivity test.",
        },
      ],
      tools: [],
      signal: controller.signal,
    });

    return NextResponse.json({
      result: {
        status: "connected",
        model,
        latencyMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const timeoutError = controller.signal.aborted
      ? "模型接入测试超时（15 秒），请检查服务器网络或模型服务状态。"
      : safeErrorMessage(error);
    return NextResponse.json(
      {
        result: {
          status: "failed",
          model,
          error: timeoutError,
        },
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
