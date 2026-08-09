import type { AgentToolName } from "@/lib/agent/types";
import {
  isTravelDayMarker,
  parseDateTimeInTimeZone,
} from "@/lib/trips/travel-schedule";

const LNG_LAT_PATTERN = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;

export function requireObject(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function readString(
  value: Record<string, unknown>,
  key: string,
  fallback?: string
) {
  const raw = value[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing string tool argument: ${key}`);
}

export function readOptionalString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function readOptionalNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Tool argument ${key} must be a number.`);
  }

  return numeric;
}

export function readNumber(value: Record<string, unknown>, key: string) {
  const numeric = readOptionalNumber(value, key);
  if (numeric === undefined) {
    throw new Error(`Missing number tool argument: ${key}`);
  }

  return numeric;
}

export function readOptionalDate(
  value: Record<string, unknown>,
  key: string,
  timezone?: string,
  options: { allowDayMarker?: boolean } = {}
) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  if (options.allowDayMarker && isTravelDayMarker(raw)) {
    return undefined;
  }

  const date = timezone ? parseDateTimeInTimeZone(raw, timezone) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Tool argument ${key} is not a valid date.`);
  }

  return date;
}

export function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const raw = value[key];
  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

export function readOptionalArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

export function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

export function normalizeLngLat(value: string) {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const normalized = parts.join(",");
  if (!LNG_LAT_PATTERN.test(normalized)) {
    return null;
  }

  const [lng, lat] = parts.map(Number);
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null;
  }

  return normalized;
}

export function normalizeCacheValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  if (Array.isArray(value)) {
    return value.map(normalizeCacheValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeCacheValue(nested)])
    );
  }

  return value;
}

export function getToolCacheKey(name: AgentToolName, request: unknown) {
  if (
    name !== "search_poi" &&
    name !== "search_natural_attractions" &&
    name !== "get_poi_detail" &&
    name !== "get_transit_route" &&
    name !== "get_driving_route" &&
    name !== "get_walking_route" &&
    name !== "get_bicycling_route"
  ) {
    return null;
  }

  return `${name}:${JSON.stringify(normalizeCacheValue(request))}`;
}
