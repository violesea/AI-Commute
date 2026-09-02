import type { AgentChatToolCall } from "@/lib/agent/chat-client";

export function stringifyToolResult(result: unknown) {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (_key === "raw") {
      return undefined;
    }

    return value;
  });
}

export function stringifyToolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let instruction =
    "工具调用未执行成功。请根据错误修正参数后重新调用同一个工具，不要只返回文字。";
  let recovery:
    | {
        constraintType:
          | "daylight_driving"
          | "daily_driving_limit"
          | "overnight_continuity";
        mustChange: string[];
        preserve: string[];
      }
    | undefined;

  if (
    message.includes("不能把这段夜间自驾落盘") ||
    (message.includes("日落") && message.includes("安全线"))
  ) {
    instruction =
      "本次 create_trip 因白天驾驶安全线被拒绝。下一次调用必须实际改变对应 stops 和 legs：提前出发或提前返程并在安全线前到达，或增加途中住宿拆分路段，或缩短/删除非用户点名的远端景点；不能重复被拒的到达时间和路线。原始请求点名的自然类型应优先保留，但如果重新核算后在当前日期、每日驾驶上限和日落安全线下确实不可执行，不得强行保留：把该景点留在 alternative，填写 routeCoverage.unmetNaturalTypes，并在 coverageNotes 写清具体超时/安全计算和已安排的自然景观替代方案。优先减少停留时长、提前离开，或用已取证的同类型近距离景点替换。travelPlan 的天气、景点、住宿、美食、预算和避坑可以沿用，只需同步变更后的自驾路段天气风险。请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "daylight_driving",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
        "travelPlan.routeCoverage",
      ],
    };
  } else if (
    message.includes("停靠点和路段数量不一致") ||
    message.includes("与相邻停靠点")
  ) {
    instruction =
      "本次旅行路线因 stops 与 legs 端点不连续而未落盘。下一次必须实际修正结构：按 stops 的顺序让每一段连接相邻停靠点，给景点或住宿补入缺失 stop，或删除不在路线中的 stop/leg；每个 leg 的 originName/originLngLat 必须对应 stops[i]，destinationName/destinationLngLat 必须对应 stops[i+1]。保留完整 travelPlan 的天气、交通、景点、住宿、美食、预算和避坑后立即重新调用完整 create_trip。";
  } else if (
    message.includes("跨自然日") &&
    message.includes("住宿")
  ) {
    instruction =
      "本次 create_trip 因跨自然日路线缺少住宿或返城连接而未落盘。下一次调用必须实际修改对应 stops 和 legs：如果下一自然日从景点继续出发，补充景点附近住宿，并在该景点 stop 和 lodging 推荐中明确对应安排；或者在前一日的 legs 中显式加入返回城市的连接段及住宿 stop。不能只修改说明文字或继续沿用缺失的路线连接；请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "overnight_continuity",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
      ],
    };
  } else if (message.includes("超过用户指定的每日上限")) {
    instruction =
      "本次 create_trip 因单日自驾总时长超过用户上限被拒绝。先读取 error 中列出的日期、累计分钟数和逐段违规路段，重新逐段相加并留出安全余量。下一次调用必须实际改变对应 stops、legs、日期和住宿连续性：把转场拆到下一天并在实际停靠点安排住宿，或减少/删除远端景点；住宿推荐不等于必须新增一段本地驾车，不能只改文字、segmentTitle 或重复同一组 stops/legs。travelPlan 的其他完整区块可以沿用，并同步变更后的自驾路段天气风险。请立即重新调用完整 create_trip。";
    recovery = {
      constraintType: "daily_driving_limit",
      mustChange: ["stops", "legs", "对应路段的 travelPlan.weather.routeRisks"],
      preserve: [
        "travelPlan.destination",
        "travelPlan.weather",
        "travelPlan.transport",
        "travelPlan.budget",
        "travelPlan.attractions",
        "travelPlan.lodging",
        "travelPlan.food",
        "travelPlan.pitfalls",
      ],
    };
  } else if (
    message.includes("用户明确要求的自然景观类型") &&
    message.includes("已有候选")
  ) {
    instruction =
      "本次 create_trip 因用户点名的自然景观类型已有候选，但候选没有进入主路线。先根据已查询的路线分钟数、日期、每日驾驶上限和日落安全线判断是否可执行；可执行时把该类型的真实候选加入 stops，并在相邻 legs 中实际经过。若确实不可执行，不得强行改成夜间或超时路线：将候选保留为 alternative，在 routeCoverage.unmetNaturalTypes 中列出该类型，并在 coverageNotes 写明具体取舍计算及已安排的自然景观替代方案。无论哪种情况都要同步补齐对应 routeRisks，保持住宿连接和安全约束，然后立即重新调用完整 create_trip。";
  } else if (message.includes("自然风光优先要求")) {
    instruction =
      "本次 create_trip 因用户要求优先自然风光，但主路线中的自然景点数量不足。保留上一版完整 travelPlan、住宿、美食、预算和避坑，把足够数量的真实自然景点从 attractions 加入 stops，并为每个新增 stop 增加相邻 legs、停留时间和对应 routeRisks；不要只修改 routeCoverage 或文字说明。重新检查每日驾驶上限、白天驾驶和跨日住宿连接后，立即重新调用完整 create_trip。";
  } else if (message.includes("旅行规划的自然景观至少需要覆盖")) {
    instruction =
      "本次 create_trip 的自然景观类型校验失败。请保留完整 travelPlan 和路线，仅修正每个自然景点的 naturalType：使用 lake、wetland、grassland、mountain、river、volcanic、forest、canyon、waterfall、park 或 viewpoint 等规范英文类型；不要使用 other、unknown 或把所有景点写成同一种类型。类型也必须能从景点名称、理由或检索证据得到支持。请立即重新调用完整 create_trip。";
  } else if (message.includes("必须提供总预算")) {
    instruction =
      "上一版旅行计划的住宿、美食、景点、天气和路线可以保留；本次只需补齐 travelPlan.budget。budget 必须是对象，包含 currency、total 和至少一项 breakdown（每项含 category、amount；未知价格写明待核实），不能只把 budget 放在 travelPlan 外。请立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.weather.summary")) {
    instruction =
      "保留上一版完整 travelPlan 的 destination、weather、transport、budget、attractions、lodging、food、pitfalls；只修正 weather.summary。weather.summary 必须是非空纯文本字符串，不能省略 weather 或 transport，不能把对象写成字符串。请立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.weather")) {
    instruction =
      "保留上一版完整 travelPlan；weather 必须是对象，包含 city、summary、advice、dynamicMonitoring、refreshPolicy、forecast、routeRisks。不要只提交 weather 或 stops/legs，压缩文字后立即重新调用完整 create_trip。";
  } else if (message.includes("travelPlan.transport")) {
    instruction =
      "保留上一版完整 travelPlan；transport 必须是对象，包含 recommended、reason、driving、transit，且 driving/transit 各自包含 summary、reason、durationMinutes、route。不要只提交 transport 或 stops/legs，立即重新调用完整 create_trip。";
  } else if (
    message.includes("travelPlan.attractions") ||
    message.includes("travelPlan.lodging") ||
    message.includes("travelPlan.food") ||
    message.includes("travelPlan.pitfalls")
  ) {
    instruction =
      "本次 create_trip 缺少旅行推荐数组。请保留 travelPlan.destination、summary、weather、transport 和现有 stops/legs；在 create_trip 顶层补齐 budget、attractions、lodging、food、pitfalls 五个字段。attractions 至少包含 4 个自然景观和 1 个人文景点，lodging、food 各至少 1 项，pitfalls 至少 3 项；数组要精简但不能省略，立即重新调用完整 create_trip。";
  } else if (message.includes("结构化 travelPlan") || message.includes("travelPlan.")) {
    instruction =
      "旅行模式的 create_trip 必须在本次调用中包含完整旅行计划：travelPlan 内提供 destination、summary、weather、transport；create_trip 顶层提供 budget、attractions、lodging、food、pitfalls。不要只提交 stops 和 legs；请压缩文字后立即重新调用一次完整 create_trip。";
  }

  return JSON.stringify({
    error: message,
    instruction,
    ...(recovery ? { recovery } : {}),
  });
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingCandidateValue(value: unknown) {
  return value === undefined || value === null;
}

function candidateArrayItemKey(value: unknown) {
  if (!isRecordValue(value)) return undefined;

  if (typeof value.name === "string" && value.name.trim()) {
    return `name:${value.name.trim().toLowerCase()}`;
  }

  if (typeof value.title === "string" && value.title.trim()) {
    return `title:${value.title.trim().toLowerCase()}`;
  }

  if (typeof value.date === "string" && value.date.trim()) {
    return `date:${value.date.trim()}`;
  }

  if (typeof value.legOrder === "number" && Number.isFinite(value.legOrder)) {
    return `leg:${value.legOrder}`;
  }

  if (typeof value.category === "string" && value.category.trim()) {
    return `category:${value.category.trim().toLowerCase()}`;
  }

  return undefined;
}

function mergeCreateTripCandidateValue(
  previous: unknown,
  current: unknown,
  path: string
): unknown {
  if (isMissingCandidateValue(current)) {
    return previous;
  }

  if (isRecordValue(previous) && isRecordValue(current)) {
    const merged: Record<string, unknown> = { ...previous };
    for (const [key, value] of Object.entries(current)) {
      merged[key] = mergeCreateTripCandidateValue(
        previous[key],
        value,
        path ? `${path}.${key}` : key
      );
    }
    return merged;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    const usedPreviousIndexes = new Set<number>();
    const mergedCurrent = current.map((currentItem, index) => {
      const currentKey = candidateArrayItemKey(currentItem);
      let previousIndex = currentKey
        ? previous.findIndex(
            (previousItem, previousItemIndex) =>
              !usedPreviousIndexes.has(previousItemIndex) &&
              candidateArrayItemKey(previousItem) === currentKey
          )
        : -1;

      if (previousIndex < 0 && !currentKey && index < previous.length) {
        previousIndex = index;
      }

      if (previousIndex < 0) {
        return currentItem;
      }

      usedPreviousIndexes.add(previousIndex);
      return mergeCreateTripCandidateValue(
        previous[previousIndex],
        currentItem,
        `${path}[${index}]`
      );
    });

    // Route risks are keyed to the current route. Keeping an unreferenced old
    // risk would make a route replacement look weather-covered when it is not.
    if (path.endsWith("weather.routeRisks")) {
      return mergedCurrent;
    }

    // Recommendation and forecast arrays may be truncated by a model repair.
    // Retain unmentioned prior items so coverage validation still sees the
    // previously complete candidate; explicit current items always win.
    return [
      ...mergedCurrent,
      ...previous.filter((_, index) => !usedPreviousIndexes.has(index)),
    ];
  }

  return current;
}

export function mergeCreateTripCandidate(
  previous: Record<string, unknown>,
  current: Record<string, unknown>
) {
  const merged = mergeCreateTripCandidateValue(previous, current, "") as Record<
    string,
    unknown
  >;

  // A route repair is the model's explicit decision. Never merge stop/leg
  // items by index, because doing so could silently restore the unsafe route.
  for (const key of ["stops", "legs"] as const) {
    if (Array.isArray(current[key])) {
      merged[key] = current[key];
    } else if (isMissingCandidateValue(current[key])) {
      merged[key] = previous[key];
    }
  }

  return merged;
}

const CONTINUATION_COMPLETION_TOOL_NAMES = new Set([
  "replace_trip_stops",
  "replace_trip_legs",
  "cancel_trip_monitoring",
]);

export function shouldCompleteContinuationAfterTools(
  toolCalls: AgentChatToolCall[],
  requireCreateTrip: boolean
) {
  return (
    !requireCreateTrip &&
    toolCalls.some((toolCall) =>
      CONTINUATION_COMPLETION_TOOL_NAMES.has(toolCall.name)
    )
  );
}
