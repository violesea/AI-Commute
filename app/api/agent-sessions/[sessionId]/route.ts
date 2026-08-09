import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type SelectBody = {
  selectedTripId?: string | null;
};

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = await prisma.agentSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id,
    },
    include: {
      messages: {
        where: { role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
      },
      toolCalls: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "未找到智能体会话" }, { status: 404 });
  }

  // Fetch variant trips linked to this session (multi-route travel planning).
  const variantTrips = await prisma.trip.findMany({
    where: { agentSessionId: session.id },
    select: {
      id: true,
      title: true,
      status: true,
      finalStopName: true,
      targetArriveAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let routeThemes: { label: string; focus: string }[] | null = null;
  if (session.routeThemesJson) {
    try {
      const parsed = JSON.parse(session.routeThemesJson);
      if (Array.isArray(parsed)) {
        routeThemes = parsed;
      }
    } catch {
      routeThemes = null;
    }
  }

  return NextResponse.json({
    session: {
      id: session.id,
      userId: session.userId,
      tripId: session.tripId,
      selectedTripId: session.selectedTripId,
      status: session.status,
      purpose: session.purpose,
      prompt: session.prompt,
      retryCount: session.retryCount,
      timeoutMs: session.timeoutMs,
      canContinue: session.status !== "running",
      messageHref: `/api/agent-sessions/${session.id}/messages`,
      hasTrip: Boolean(session.tripId),
      routeThemes,
      variantTrips,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages,
      toolCalls: session.toolCalls,
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SelectBody;

  // Verify the session belongs to the user.
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });

  if (!session) {
    return NextResponse.json({ error: "未找到智能体会话" }, { status: 404 });
  }

  // If selecting a specific trip, verify it belongs to this user AND this session.
  if (body.selectedTripId) {
    const trip = await prisma.trip.findFirst({
      where: {
        id: body.selectedTripId,
        userId: user.id,
        agentSessionId: sessionId,
      },
      select: { id: true },
    });

    if (!trip) {
      return NextResponse.json(
        { error: "该路线不属于当前会话" },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.agentSession.update({
    where: { id: sessionId },
    data: { selectedTripId: body.selectedTripId ?? null },
    select: { id: true, selectedTripId: true },
  });

  return NextResponse.json({
    sessionId: updated.id,
    selectedTripId: updated.selectedTripId,
  });
}
