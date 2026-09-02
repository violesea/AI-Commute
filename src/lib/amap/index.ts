import { readEnv } from "@/lib/env";
import { createRealAmapClient } from "./client";
import { createMockAmapClient } from "./mock";
import { createAmapThrottle } from "./throttle";
import type { AmapClient } from "./types";

type EnvSource = Partial<Record<string, string | undefined>>;

type AmapClientFactoryOptions = {
  realClient?: AmapClient;
};

const DEFAULT_REQUESTS_PER_SECOND = 3;
const MAX_REQUESTS_PER_SECOND = 3;

function readRequestsPerSecond(source: EnvSource) {
  const parsed = Number(source.AMAP_REQUESTS_PER_SECOND);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REQUESTS_PER_SECOND;
  }

  return Math.min(MAX_REQUESTS_PER_SECOND, Math.max(1, Math.floor(parsed)));
}

export function createAmapClient(
  source: EnvSource = process.env,
  options: AmapClientFactoryOptions = {}
): AmapClient {
  const env = readEnv(source);
  const mockClient = createMockAmapClient();

  if (!env.hasAmapKey) {
    return mockClient;
  }

  const apiKey = source.AMAP_API_KEY?.trim();

  if (!apiKey) {
    return mockClient;
  }

  const realClient =
    options.realClient ??
    createRealAmapClient({
      apiKey,
      throttle: createAmapThrottle({
        requestsPerSecond: readRequestsPerSecond(source),
      }),
    });

  return realClient;
}

export { createRealAmapClient } from "./client";
export { createMockAmapClient } from "./mock";
export { createAmapThrottle } from "./throttle";
export type {
  AmapClient,
  Poi,
  PoiDetailRequest,
  PoiSearchRequest,
  ReverseGeocodeRequest,
  ReverseGeocodeResult,
  RouteMode,
  RouteRequest,
  RouteResult,
  WeatherForecast,
  WeatherRequest,
  WeatherReference
} from "./types";
