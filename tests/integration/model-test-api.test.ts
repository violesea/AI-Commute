import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/session";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

const getCurrentUserMock = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
const completeMock = vi.hoisted(() => vi.fn());
const readEnvMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/agent/chat-client", () => ({
  createOpenAiChatClient: vi.fn(() => ({ complete: completeMock })),
}));

vi.mock("@/lib/env", () => ({
  readEnv: readEnvMock,
}));

describe("model connection test API", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    completeMock.mockReset();
    readEnvMock.mockReset();
    readEnvMock.mockReturnValue({ hasOpenAiKey: true });
    getCurrentUserMock.mockResolvedValue({ id: "user-model-test" } as CurrentUser);
    completeMock.mockResolvedValue({
      message: { role: "assistant", content: "OK" },
    });
  });

  it("requires authentication before testing a model", async () => {
    const { POST } = await import("@app/api/settings/test-model/route");
    getCurrentUserMock.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/settings/test-model", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4-flash" }),
      })
    );

    expect(response.status).toBe(401);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported models without calling the provider", async () => {
    const { POST } = await import("@app/api/settings/test-model/route");

    const response = await POST(
      new Request("http://localhost/api/settings/test-model", {
        method: "POST",
        body: JSON.stringify({ model: "unknown-model" }),
      })
    );

    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("reports a successful provider call for the selected model", async () => {
    const { POST } = await import("@app/api/settings/test-model/route");

    const response = await POST(
      new Request("http://localhost/api/settings/test-model", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4-flash" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      status: "connected",
      model: "deepseek-v4-flash",
    });
    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "user",
            content: "Reply with OK only. This is a connectivity test.",
          },
        ],
        tools: [],
        signal: expect.anything(),
      })
    );
  });

  it("does not claim a connection when the server key is missing", async () => {
    const { POST } = await import("@app/api/settings/test-model/route");
    readEnvMock.mockReturnValue({ hasOpenAiKey: false });

    const response = await POST(
      new Request("http://localhost/api/settings/test-model", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4-flash" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.result).toMatchObject({
      status: "not_configured",
      model: "deepseek-v4-flash",
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns a bounded provider error without exposing credentials", async () => {
    const { POST } = await import("@app/api/settings/test-model/route");
    completeMock.mockRejectedValue(
      new Error("401 https://provider.example/v1?api_key=sk-secret-token")
    );

    const response = await POST(
      new Request("http://localhost/api/settings/test-model", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4-flash" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.result.status).toBe("failed");
    expect(body.result.error).not.toContain("sk-secret-token");
    expect(body.result.error).not.toContain("provider.example");
  });
});
