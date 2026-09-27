/**
 * Task 19, Step 3 — the browser side of analytics.
 *
 * Opt-in, first-party and privacy-aware:
 *  - Off unless `NEXT_PUBLIC_ANALYTICS_ENABLED === "true"`. No script tag, no
 *    third-party SDK and no request is created by default.
 *  - Honours `navigator.doNotTrack` and `navigator.globalPrivacyControl`
 *    (re-read per event, so a visitor who turns GPC on mid-session is obeyed).
 *  - Sends only the sanitized envelope from `./events` — the same allowlist the
 *    server re-validates — to our own `/api/analytics/collect`, with
 *    `credentials: "omit"` so no cookie travels with it.
 *  - Never throws and never blocks the UI: transport failures are swallowed
 *    (`sendBeacon` first, `fetch` with `keepalive` as fallback).
 */

import {
  MAX_ANALYTICS_PATH_LENGTH,
  isAnalyticsEventName,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsPath,
  type AnalyticsEventName,
} from "./events";

export const ANALYTICS_COLLECT_PATH = "/api/analytics/collect";
export const ANALYTICS_ENABLED_ENV = "NEXT_PUBLIC_ANALYTICS_ENABLED";

/** Hard cap on the serialized payload; anything larger is dropped, not sent. */
export const MAX_ANALYTICS_PAYLOAD_LENGTH = 2048;

export type PrivacySignals = {
  doNotTrack?: string | number | null;
  globalPrivacyControl?: boolean | null;
};

export type AnalyticsTransport = (payload: string, path: string) => boolean;

/** Read the visitor's privacy signals, if this environment has them. */
export function readPrivacySignals(): PrivacySignals | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    doNotTrack: nav.doNotTrack ?? null,
    globalPrivacyControl: nav.globalPrivacyControl ?? null,
  };
}

/**
 * Enabled only when explicitly switched on *and* the visitor has not asked to
 * be left alone. DNT values vary by browser (`"1"`, `"yes"`, or a boolean), so
 * all of them are honoured.
 */
export function isAnalyticsEnabled(
  options: {
    env?: Record<string, string | undefined>;
    signals?: PrivacySignals | null;
  } = {}
): boolean {
  const env =
    options.env ?? (typeof process !== "undefined" ? process.env : {});
  if (env[ANALYTICS_ENABLED_ENV] !== "true") return false;

  const signals = options.signals ?? readPrivacySignals();
  if (!signals) return true;
  const dnt = signals.doNotTrack;
  if (dnt === "1" || dnt === 1 || dnt === "yes") return false;
  if (signals.globalPrivacyControl === true) return false;
  return true;
}

/** Pathname only: query strings can carry emails or tokens from other pages. */
function currentPathname(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const path = sanitizeAnalyticsPath(window.location.pathname);
  return path && path.length <= MAX_ANALYTICS_PATH_LENGTH ? path : undefined;
}

/** `sendBeacon` first (survives navigation), `fetch` keepalive as fallback. */
export function beaconTransport(payload: string, path: string): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const body = new Blob([payload], { type: "application/json" });
      return navigator.sendBeacon(path, body);
    } catch {
      return false;
    }
  }
  if (typeof fetch === "function") {
    try {
      void fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
        credentials: "omit",
        mode: "same-origin",
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export type AnalyticsClient = {
  track(
    event: AnalyticsEventName,
    props?: Record<string, unknown>,
    attributedPath?: string
  ): boolean;
};

export type AnalyticsClientOptions = {
  /** Re-evaluated per event so a changed privacy signal is honoured. */
  isEnabled?: () => boolean;
  transport?: AnalyticsTransport;
  path?: string;
  pathname?: () => string | undefined;
};

export function createAnalyticsClient(
  options: AnalyticsClientOptions = {}
): AnalyticsClient {
  const isEnabled = options.isEnabled ?? (() => isAnalyticsEnabled());
  const transport = options.transport ?? beaconTransport;
  const path = options.path ?? ANALYTICS_COLLECT_PATH;
  const pathname = options.pathname ?? currentPathname;

  return {
    track(event, props, attributedPath) {
      if (!isAnalyticsEventName(event)) return false;
      if (!isEnabled()) return false;

      // Sanitize before sending: an invalid prop drops the event here rather
      // than producing a 400 the caller would never see.
      const sanitized = sanitizeAnalyticsEvent({
        event,
        path: attributedPath ?? pathname(),
        props: props ?? {},
      });
      if (!sanitized) return false;

      const payload = JSON.stringify(sanitized);
      if (payload.length > MAX_ANALYTICS_PAYLOAD_LENGTH) return false;
      try {
        return transport(payload, path);
      } catch {
        return false;
      }
    },
  };
}

/** Client used by `TrackEvent` and by page-level wiring. */
const defaultClient = createAnalyticsClient();

/** Fire an analytics event. Returns whether it was actually handed to transport. */
export function track(
  event: AnalyticsEventName,
  props?: Record<string, unknown>,
  attributedPath?: string
): boolean {
  return defaultClient.track(event, props, attributedPath);
}
