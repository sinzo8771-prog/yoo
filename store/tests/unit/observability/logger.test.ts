/**
 * Task 17, Step 2 — structured logs.
 *
 * The load-bearing property: a sensitive KEY never reaches the line at any
 * depth, correlation can only carry the closed keys, tokens (operation/
 * status) cannot smuggle payloads, strings are bounded, and errors lose
 * their stacks. Plus: sink routing, duration clamping, withLogging's
 * exactly-one-line and rethrow-unchanged contract.
 */
import { describe, expect, it, vi } from "vitest";

import {
  MAX_FIELD_STRING_LENGTH,
  formatLogLine,
  logEvent,
  sanitizeFields,
  withLogging,
} from "@/lib/observability/logger";

describe("formatLogLine", () => {
  it("emits ts/level/operation with duration and status when given", () => {
    const { level, line } = formatLogLine(
      {
        operation: "checkout.complete",
        level: "info",
        status: "ok",
        durationMs: 1234.7,
        correlation: { sourceOrderId: "of_1" },
        fields: { attempts: 2 },
      },
      new Date("2026-09-19T00:00:00.000Z")
    );

    expect(level).toBe("info");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-09-19T00:00:00.000Z",
      level: "info",
      operation: "checkout.complete",
      durationMs: 1235,
      status: "ok",
      sourceOrderId: "of_1",
      attempts: 2,
    });
  });

  it("drops sensitive keys wholesale, at every depth", () => {
    const secretValue = "sk-live-DO-NOT-LOG-1";
    const proofValue = "proof-DO-NOT-LOG-2";
    const { line } = formatLogLine({
      operation: "order.ingest",
      correlation: { sourceOrderId: "of_1", secretKey: secretValue },
      fields: {
        headers: { authorization: secretValue, cookie: "sid=1" },
        paymentSession: { clientSecret: secretValue },
        proof: proofValue,
        nested: { deeper: { apiKey: secretValue, safe: "kept" } },
        providerStatus: "succeeded",
      },
    });

    expect(line).not.toContain(secretValue);
    expect(line).not.toContain(proofValue);
    expect(line).not.toMatch(/authorization|cookie|apiKey/);
    expect(JSON.parse(line).providerStatus).toBe("succeeded");
    expect(JSON.parse(line).nested.deeper.safe).toBe("kept");
  });

  it("enforces token shape on operation and status", () => {
    const bad = formatLogLine({
      operation: "bad op {\"inject\":1}",
      status: "succeeded but with a story",
    });
    expect(JSON.parse(bad.line).operation).toBe("invalid");
    expect(JSON.parse(bad.line).status).toBe("invalid");
  });

  it("bounds strings and clamps/nan-proofs durations", () => {
    const { line } = formatLogLine({
      operation: "x",
      durationMs: -5,
      fields: { note: "a".repeat(MAX_FIELD_STRING_LENGTH * 4) },
    });
    const parsed = JSON.parse(line);
    expect(parsed.durationMs).toBe(0);
    expect(parsed.note).toHaveLength(MAX_FIELD_STRING_LENGTH + 1);

    const nan = formatLogLine({ operation: "x", durationMs: NaN });
    expect(JSON.parse(nan.line).durationMs).toBeUndefined();
  });

  it("keeps only name+message from errors — never the stack", () => {
    const { line } = formatLogLine({
      operation: "x",
      level: "error",
      fields: { error: new Error("boom at internal/path.ts:12") },
    });
    const parsed = JSON.parse(line);
    expect(parsed.error).toEqual({
      name: "Error",
      message: "boom at internal/path.ts:12",
    });
    expect(parsed.error.stack).toBeUndefined();
    expect(line).not.toContain("node:internal");
  });

  it("survives circular and deep structures", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const deep = { a: { b: { c: { d: { e: { secret: "nope" } } } } } };

    const { line } = formatLogLine({ operation: "x", fields: { circular, deep } });
    const parsed = JSON.parse(line);
    expect(parsed.circular.self).toBe("[circular]");
    expect(JSON.stringify(parsed)).not.toContain("nope");
  });
});

describe("sanitizeFields", () => {
  it("returns {} for junk input and drops function values", () => {
    expect(sanitizeFields(null)).toEqual({});
    expect(sanitizeFields(undefined)).toEqual({});
    expect(sanitizeFields({ fn: () => 1, ok: "v" })).toEqual({ ok: "v" });
  });
});

describe("logEvent", () => {
  it("routes to the sink by level and returns the line", () => {
    const sink = vi.fn();
    const line = logEvent({ operation: "op.x", level: "warn" }, sink);
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith("warn", line);
    expect(JSON.parse(line).operation).toBe("op.x");
  });
});

describe("withLogging", () => {
  it("logs exactly one success line with duration and returns the value", async () => {
    const sink = vi.fn();
    const result = await withLogging(
      { operation: "op.ok", correlation: { cartId: "c-1" } },
      async () => 42,
      sink
    );
    expect(result).toBe(42);
    expect(sink).toHaveBeenCalledOnce();
    const [level, line] = sink.mock.calls[0];
    expect(level).toBe("info");
    expect(JSON.parse(line)).toMatchObject({ operation: "op.ok", status: "ok", cartId: "c-1" });
    expect(typeof JSON.parse(line).durationMs).toBe("number");
  });

  it("logs one error line and rethrows the SAME error", async () => {
    const sink = vi.fn();
    const boom = new Error("boom");
    await expect(
      withLogging({ operation: "op.fail" }, async () => {
        throw boom;
      }, sink)
    ).rejects.toBe(boom);

    expect(sink).toHaveBeenCalledOnce();
    const [level, line] = sink.mock.calls[0];
    expect(level).toBe("error");
    expect(JSON.parse(line)).toMatchObject({
      operation: "op.fail",
      status: "failed",
      error: { name: "Error", message: "boom" },
    });
  });
});
