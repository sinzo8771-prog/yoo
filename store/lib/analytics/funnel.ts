/**
 * Task 19, Step 4 — funnel counts, held in memory, tied to nobody.
 *
 * The aggregator stores per-UTC-day counters and nothing else: no visitor id,
 * no session id, no IP, no user agent, no order reference. That is what makes
 * "measure the funnel without storing unnecessary personal information"
 * checkable rather than aspirational — the `snapshot()` shape is asserted by
 * tests, so adding an identifier later breaks them.
 *
 * Honest limits (documented in `docs/analytics/events.md`):
 *  - Counts are per process/isolate and reset on deploy, like the Task 18 rate
 *    limiter. They are a directional signal, not billing data: Openfront's
 *    order rows are the authoritative purchase count.
 *  - `purchase` is counted per *view of the confirmation page*, so a refresh is
 *    counted twice. That is visible in the numbers rather than hidden.
 */

import {
  ANALYTICS_EVENT_SET,
  FUNNEL_STAGES,
  type AnalyticsEventName,
  type FunnelStage,
} from "./events";

/** Days of counters retained; older days are evicted. */
export const DEFAULT_FUNNEL_RETENTION_DAYS = 30;

export type FunnelStageResult = {
  stage: FunnelStage;
  count: number;
  /** count / previous stage, or null when the previous stage is 0 (never invented). */
  fromPrevious: number | null;
  /** count / first stage, or null when the first stage is 0. */
  fromStart: number | null;
};

export type FunnelSnapshot = {
  totals: Partial<Record<AnalyticsEventName, number>>;
  stages: FunnelStageResult[];
  /** Minor units observed from `purchase` events. */
  purchaseValueMinor: number;
  /** Currency codes seen (a snapshot is only meaningful within one currency). */
  currencies: string[];
  /** UTC day keys currently retained, ascending. */
  days: string[];
  recorded: number;
};

type DayBucket = {
  totals: Partial<Record<AnalyticsEventName, number>>;
  purchaseValueMinor: number;
  currencies: Set<string>;
};

export type FunnelAggregator = {
  record(
    input: { event: AnalyticsEventName; props?: Record<string, unknown> | null },
    now?: Date
  ): void;
  snapshot(): FunnelSnapshot;
  reset(): void;
  dayCount(): number;
};

/** `2026-09-23` — UTC, because the deploy may not be in the visitor's zone. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Rounded to 4 decimals, null when the denominator is 0. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function emptyBucket(): DayBucket {
  return { totals: {}, purchaseValueMinor: 0, currencies: new Set<string>() };
}

export function createFunnelAggregator(
  options: { maxDays?: number } = {}
): FunnelAggregator {
  const maxDays = Math.max(1, Math.trunc(options.maxDays ?? DEFAULT_FUNNEL_RETENTION_DAYS));
  const buckets = new Map<string, DayBucket>();

  /** Keep the newest `maxDays` day keys; evict the oldest first. */
  function evict() {
    if (buckets.size <= maxDays) return;
    const keys = [...buckets.keys()].sort();
    while (keys.length > maxDays) {
      const oldest = keys.shift();
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }

  return {
    record(input, now = new Date()) {
      // Defence in depth: an unknown name is ignored rather than counted under
      // a made-up key. The route's sanitizer already rejects those.
      if (!ANALYTICS_EVENT_SET.has(input.event)) return;

      const key = utcDayKey(now);
      const bucket = buckets.get(key) ?? emptyBucket();
      bucket.totals[input.event] = (bucket.totals[input.event] ?? 0) + 1;

      const props = input.props ?? {};
      if (input.event === "purchase") {
        const value = props.valueMinor;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          bucket.purchaseValueMinor += value;
        }
      }
      const currency = props.currency;
      if (typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency)) {
        bucket.currencies.add(currency.toUpperCase());
      }

      // Re-insert so Map order tracks recency for eviction.
      buckets.delete(key);
      buckets.set(key, bucket);
      evict();
    },

    snapshot() {
      const totals: Partial<Record<AnalyticsEventName, number>> = {};
      let purchaseValueMinor = 0;
      const currencies = new Set<string>();

      for (const bucket of buckets.values()) {
        for (const [name, count] of Object.entries(bucket.totals)) {
          const key = name as AnalyticsEventName;
          totals[key] = (totals[key] ?? 0) + (count ?? 0);
        }
        purchaseValueMinor += bucket.purchaseValueMinor;
        for (const code of bucket.currencies) currencies.add(code);
      }

      const counts = FUNNEL_STAGES.map((stage) => totals[stage] ?? 0);
      const stages: FunnelStageResult[] = FUNNEL_STAGES.map((stage, index) => ({
        stage,
        count: counts[index],
        fromPrevious: index === 0 ? null : ratio(counts[index], counts[index - 1]),
        fromStart: index === 0 ? null : ratio(counts[index], counts[0]),
      }));

      return {
        totals,
        stages,
        purchaseValueMinor,
        currencies: [...currencies].sort(),
        days: [...buckets.keys()].sort(),
        recorded: Object.values(totals).reduce<number>((sum, count) => sum + (count ?? 0), 0),
      };
    },

    reset() {
      buckets.clear();
    },

    dayCount() {
      return buckets.size;
    },
  };
}

/**
 * Process-wide aggregator used by the collect route. In-memory by design: the
 * plan forbids storing more than the counts, and a shared counter store would
 * be the same follow-up as the rate limiter's (§residual risks).
 */
export const analyticsFunnel: FunnelAggregator = createFunnelAggregator();
