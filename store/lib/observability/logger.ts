/**
 * Task 17, Step 2 — structured, sanitized log lines.
 *
 * Every line is single-line JSON: `{ ts, level, operation, durationMs?,
 * status?, ...correlation, ...fields }`. Sanitization is DENY-BY-KEY at every
 * nesting level: a key that looks like a secret never emits — not its value,
 * not a truncated version of it, nothing. Strings are bounded, structures are
 * depth/cycle-capped, and `operation`/`status` are enforced to a token shape
 * so a payload can't ride in through the fields that must stay grep-able.
 *
 * Never logged (enforced below, pinned by tests): auth headers, cookies,
 * signatures, cart proofs, tokens, credentials, payment session data, or raw
 * provider payloads — callers pass IDs, operation names, durations, and
 * already-sanitized provider status, or the sanitizer drops the rest.
 */

import { buildCorrelation, type CorrelationIds } from "./correlation";

export type LogLevel = "info" | "warn" | "error";

/** Keys whose values are dropped entirely, at any depth. */
export const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|authorization|cookie|signature|proof|card|cvv|cvc|credential|api[-_]?key|session|payload|body)/i;

/** operation / status must be grep-able tokens — anything else is replaced. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export const MAX_FIELD_STRING_LENGTH = 300;
const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 20;

/** A field sink: takes the finished single line. Default writes to console. */
export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

function enforceToken(value: unknown, fallback: string): string {
  if (typeof value === "string" && TOKEN_PATTERN.test(value)) return value;
  return fallback;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null) return null;
  if (typeof value === "string") {
    return value.length > MAX_FIELD_STRING_LENGTH
      ? `${value.slice(0, MAX_FIELD_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === undefined) return undefined;

  if (value instanceof Error) {
    // Name + bounded message only: stacks can embed payloads and paths.
    return { name: value.name, message: sanitizeValue(value.message, depth, seen) };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    if (depth >= MAX_DEPTH) return "[depth]";
    seen.add(value);
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_LENGTH)
        .map((item) => {
          const sanitized = sanitizeValue(item, depth + 1, seen);
          return sanitized === undefined ? null : sanitized;
        });
      if (value.length > MAX_ARRAY_LENGTH)
        items.push(`[…${value.length - MAX_ARRAY_LENGTH} more]`);
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue; // dropped wholesale
      const sanitized = sanitizeValue(item, depth + 1, seen);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return undefined;
}

/** Sanitize a caller-provided fields/correlation bag. */
export function sanitizeFields(
  fields: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!fields || typeof fields !== "object") return {};
  const sanitized = sanitizeValue(fields, 0, new WeakSet());
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

export type LogEntry = {
  level?: LogLevel;
  /** Required, token-validated (invalid → "invalid"). */
  operation: string;
  durationMs?: number | null;
  /** Sanitized provider/status token (invalid → "invalid"). */
  status?: string | null;
  /** Correlation bag — passed through buildCorrelation (closed keys). */
  correlation?: CorrelationIds | Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
};

export function formatLogLine(
  entry: LogEntry,
  now: Date = new Date()
): { level: LogLevel; line: string } {
  const level: LogLevel = entry.level ?? "info";
  const record: Record<string, unknown> = {
    ts: now.toISOString(),
    level,
    operation: enforceToken(entry.operation, "invalid"),
  };
  if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)) {
    record.durationMs = Math.max(0, Math.round(entry.durationMs));
  }
  if (entry.status !== undefined && entry.status !== null) {
    record.status = enforceToken(entry.status, "invalid");
  }
  Object.assign(record, sanitizeFields(buildCorrelation(entry.correlation)));
  Object.assign(record, sanitizeFields(entry.fields));
  return { level, line: JSON.stringify(record) };
}

export function logEvent(entry: LogEntry, sink: LogSink = defaultSink): string {
  const { level, line } = formatLogLine(entry);
  sink(level, line);
  return line;
}

/**
 * Run an async operation, logging exactly one line: success with duration,
 * or failure with a bounded error summary — then rethrow unchanged so the
 * caller's error handling (and tests) see the same error.
 */
export async function withLogging<T>(
  meta: {
    operation: string;
    correlation?: CorrelationIds | Record<string, unknown> | null;
  },
  fn: () => Promise<T>,
  sink: LogSink = defaultSink
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logEvent(
      { ...meta, level: "info", status: "ok", durationMs: Date.now() - startedAt },
      sink
    );
    return result;
  } catch (error) {
    logEvent(
      {
        ...meta,
        level: "error",
        status: "failed",
        durationMs: Date.now() - startedAt,
        fields: { error: error instanceof Error ? error : String(error) },
      },
      sink
    );
    throw error;
  }
}
