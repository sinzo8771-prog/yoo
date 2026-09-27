/**
 * Task 17, Step 4 — alert thresholds.
 *
 * The plan's six minimum signals, as a closed vocabulary with default
 * thresholds: provider errors, webhook signature failures, unmatched
 * products, stale orders, repeated retry failures, and database/connectivity
 * errors. Pure: signals come from wherever counting happens (ingestion logs,
 * triage sweeps, health checks); this module only decides whether a count
 * crosses a line and how loudly to say it.
 *
 * Severity policy: signature failures and database/connectivity errors are
 * CRITICAL (a signature failure is an attempted auth bypass; a dead database
 * stops every operation); the rest are WARNING until they scale.
 */

export const ALERT_TYPE = {
  PROVIDER_ERRORS: "provider_errors",
  WEBHOOK_SIGNATURE_FAILURES: "webhook_signature_failures",
  UNMATCHED_PRODUCTS: "unmatched_products",
  STALE_ORDERS: "stale_orders",
  REPEATED_RETRY_FAILURES: "repeated_retry_failures",
  DB_CONNECTIVITY_ERRORS: "db_connectivity_errors",
} as const;

export type AlertType = (typeof ALERT_TYPE)[keyof typeof ALERT_TYPE];

export const ALL_ALERT_TYPES: AlertType[] = Object.values(ALERT_TYPE);

/** Any signature failure is an alert; retries are only "repeated" at 3+. */
export const DEFAULT_THRESHOLDS: Record<AlertType, number> = {
  provider_errors: 5,
  webhook_signature_failures: 1,
  unmatched_products: 1,
  stale_orders: 1,
  repeated_retry_failures: 3,
  db_connectivity_errors: 2,
};

export const CRITICAL_ALERT_TYPES: AlertType[] = [
  ALERT_TYPE.WEBHOOK_SIGNATURE_FAILURES,
  ALERT_TYPE.DB_CONNECTIVITY_ERRORS,
];

export type AlertSignal = {
  type: AlertType;
  /** Count inside `windowMs` (window optional — carry it for the report). */
  count: number;
  windowMs?: number;
  /** One correlation id from the newest occurrence, for the runbook grep. */
  sampleCorrelation?: string;
};

export type ActiveAlert = {
  type: AlertType;
  severity: "critical" | "warning";
  count: number;
  threshold: number;
  windowMs?: number;
  sampleCorrelation?: string;
};

/**
 * Evaluate signals against thresholds. Unknown types and nonsensical counts
 * throw: an alerting vocabulary that silently accepts junk is worse than no
 * alerting, because operators learn to ignore it.
 */
export function evaluateAlerts(
  signals: readonly AlertSignal[],
  options?: {
    thresholds?: Partial<Record<AlertType, number>>;
  }
): ActiveAlert[] {
  const thresholds: Record<AlertType, number> = {
    ...DEFAULT_THRESHOLDS,
    ...(options?.thresholds ?? {}),
  };

  const active: ActiveAlert[] = [];
  for (const signal of signals ?? []) {
    if (!ALL_ALERT_TYPES.includes(signal?.type)) {
      throw new Error(`Unknown alert type: ${String(signal?.type)}`);
    }
    if (
      typeof signal.count !== "number" ||
      !Number.isFinite(signal.count) ||
      signal.count < 0
    ) {
      throw new Error(
        `Alert count must be a finite non-negative number for ${signal.type}`
      );
    }
    const threshold = thresholds[signal.type];
    if (signal.count < threshold) continue;

    active.push({
      type: signal.type,
      severity: CRITICAL_ALERT_TYPES.includes(signal.type)
        ? "critical"
        : "warning",
      count: signal.count,
      threshold,
      ...(signal.windowMs !== undefined ? { windowMs: signal.windowMs } : {}),
      ...(signal.sampleCorrelation
        ? { sampleCorrelation: signal.sampleCorrelation }
        : {}),
    });
  }
  return active;
}

/** True when at least one alert is critical — the runbook's page/notify gate. */
export function hasCriticalAlert(alerts: readonly ActiveAlert[]): boolean {
  return alerts.some((alert) => alert.severity === "critical");
}
