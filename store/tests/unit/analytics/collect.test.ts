import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 3 (unit) — the analytics ingest pipeline.
 *
 * `/api` is the one path the Task 18 middleware guard does not cover, so these
 * tests assert that the compensating controls are really there: its own rate
 * limit bucket, a bounded body read, whole-payload validation, and log lines
 * that never contain what the visitor typed.
 */

import {
  MAX_COLLECT_BODY_BYTES,
  collectAnalyticsEvent,
  readBoundedBody,
  type CollectInput,
} from "@/lib/analytics/collect";
import { createFunnelAggregator } from "@/lib/analytics/funnel";
import type { LogSink } from "@/lib/observability/logger";
import { RATE_LIMITS, createRateLimiter } from "@/lib/security/rate-limit";

const IP_A = "203.0.113.10";
const IP_B = "203.0.113.11";

function makeInput(
  body: unknown,
  headers: Record<string, string> = { "x-forwarded-for": IP_A }
): CollectInput {
  const payload =
    typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body);
  return {
    headers: new Headers({ "content-type": "application/json", ...headers }),
    body: new Blob([payload]).stream(),
  };
}

function harness() {
  const lines: string[] = [];
  return {
    funnel: createFunnelAggregator(),
    limiter: createRateLimiter({ maxKeys: 100 }),
    lines,
    sink: ((_level, line) => lines.push(line)) as LogSink,
  };
}

describe("collectAnalyticsEvent", () => {
  it("accepts a valid event, counts it and logs one line", async () => {
    const { funnel, limiter, lines, sink } = harness();

    const result = await collectAnalyticsEvent(
      makeInput({
        event: "add_to_cart",
        path: "/us/products/oak-board",
        props: { productId: "prod_1", quantity: 1, currency: "usd", valueMinor: 4500 },
      }),
      { funnel, limiter, sink }
    );

    expect(result.status).toBe(204);
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(result.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(result.headers["X-RateLimit-Bucket"]).toBe("analytics");
    expect("body" in result).toBe(false);

    expect(funnel.snapshot().totals.add_to_cart).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "info",
      operation: "analytics.event",
      status: "add_to_cart",
      pagePath: "/us/products/oak-board",
      currency: "USD",
      valueMinor: 4500,
    });
  });

  it("rejects an unknown event without counting it, and never echoes the payload", async () => {
    const { funnel, limiter, lines, sink } = harness();

    const result = await collectAnalyticsEvent(
      makeInput({ event: "page_view", props: { email: "shopper@example.com" } }),
      { funnel, limiter, sink }
    );

    expect(result.status).toBe(400);
    expect(funnel.snapshot().recorded).toBe(0);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "warn",
      operation: "analytics.event",
      status: "invalid",
    });
    expect(lines[0]).not.toContain("shopper@example.com");
  });

  it("rejects an out-of-bounds prop whole", async () => {
    const { funnel, limiter, sink } = harness();
    const result = await collectAnalyticsEvent(
      makeInput({ event: "add_to_cart", props: { valueMinor: 4.99 } }),
      { funnel, limiter, sink }
    );
    expect(result.status).toBe(400);
    expect(funnel.snapshot().recorded).toBe(0);
  });

  it("strips unknown props and never logs personal data", async () => {
    const { funnel, limiter, lines, sink } = harness();

    const result = await collectAnalyticsEvent(
      makeInput({
        event: "begin_checkout",
        props: {
          itemCount: 2,
          currency: "USD",
          valueMinor: 9000,
          email: "shopper@example.com",
          phone: "+15550100",
          firstName: "Ada",
          address: "1 Analytical Way",
          cardNumber: "4242424242424242",
        },
      }),
      { funnel, limiter, sink }
    );

    expect(result.status).toBe(204);
    expect(funnel.snapshot().totals.begin_checkout).toBe(1);
    const line = lines.join("\n");
    for (const secret of [
      "shopper@example.com",
      "+15550100",
      "Ada",
      "1 Analytical Way",
      "4242",
    ]) {
      expect(line.includes(secret), secret).toBe(false);
    }
    expect(JSON.parse(lines[0])).toMatchObject({ itemCount: 2, valueMinor: 9000 });
  });
});

describe("collectAnalyticsEvent limits", () => {
  it("rejects malformed JSON", async () => {
    const { funnel, limiter, sink } = harness();
    const result = await collectAnalyticsEvent(makeInput("{not json"), {
      funnel,
      limiter,
      sink,
    });
    expect(result.status).toBe(400);
    expect(funnel.snapshot().recorded).toBe(0);
  });

  it("refuses a body larger than the cap, by declared length", async () => {
    const { funnel, limiter, sink } = harness();
    const result = await collectAnalyticsEvent(
      makeInput(
        { event: "view_cart" },
        {
          "x-forwarded-for": IP_A,
          "content-length": String(MAX_COLLECT_BODY_BYTES + 1),
        }
      ),
      { funnel, limiter, sink }
    );
    expect(result.status).toBe(413);
    expect(funnel.snapshot().recorded).toBe(0);
  });

  it("refuses a streamed body past the cap without a content-length", async () => {
    const { funnel, limiter, sink } = harness();
    const huge = JSON.stringify({
      event: "view_cart",
      pad: "x".repeat(MAX_COLLECT_BODY_BYTES * 2),
    });
    const result = await collectAnalyticsEvent(
      {
        headers: new Headers({ "x-forwarded-for": IP_A }),
        body: new Blob([huge]).stream(),
      },
      { funnel, limiter, sink }
    );
    expect(result.status).toBe(413);
    expect(funnel.snapshot().recorded).toBe(0);
  });

  it("rate limits each client address independently", async () => {
    const { funnel, limiter, lines, sink } = harness();
    const budget = RATE_LIMITS.analytics.limit;

    for (let i = 0; i < budget; i += 1) {
      const result = await collectAnalyticsEvent(makeInput({ event: "view_cart" }), {
        funnel,
        limiter,
        sink,
      });
      expect(result.status).toBe(204);
    }

    const blocked = await collectAnalyticsEvent(makeInput({ event: "view_cart" }), {
      funnel,
      limiter,
      sink,
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
    expect(funnel.snapshot().totals.view_cart).toBe(budget);
    expect(blocked.headers["X-RateLimit-Remaining"]).toBe("0");

    // A different address still has its own allowance.
    const other = await collectAnalyticsEvent(
      makeInput({ event: "view_cart" }, { "x-forwarded-for": IP_B }),
      { funnel, limiter, sink }
    );
    expect(other.status).toBe(204);
    expect(lines.length).toBe(budget + 1);
  });

  it("gives the analytics bucket a real budget", () => {
    expect(RATE_LIMITS.analytics).toMatchObject({ limit: 120, windowMs: 60_000 });
  });
});

describe("readBoundedBody", () => {
  it("returns an empty string for a request with no body", async () => {
    await expect(readBoundedBody(null, 0)).resolves.toBe("");
  });

  it("reads a body up to the cap", async () => {
    const payload = JSON.stringify({ event: "view_cart" });
    const text = await readBoundedBody(new Blob([payload]).stream(), payload.length);
    expect(text).toBe(payload);
  });

  it("returns null past the cap", async () => {
    const payload = "x".repeat(64);
    await expect(readBoundedBody(new Blob([payload]).stream(), 0, 16)).resolves.toBeNull();
  });

  it("returns null when the declared length already exceeds the cap", async () => {
    await expect(readBoundedBody(null, 4096, 16)).resolves.toBeNull();
  });
});
