"use client";

/**
 * Task 19, Step 3 — fire one analytics event when a unit of UI becomes visible.
 *
 * Renders nothing (no wrapper element, no layout impact). Fires once per mount
 * even under React strict mode's double-invoked effects, because a double count
 * would corrupt the funnel it is supposed to measure.
 */

import { useEffect, useRef } from "react";

import { track } from "@/lib/analytics/client";
import type { AnalyticsEventName } from "@/lib/analytics/events";

export type TrackEventProps = {
  event: AnalyticsEventName;
  /** Allowlisted props only — see `lib/analytics/events.ts`. */
  props?: Record<string, unknown>;
  /** Attributed path override; defaults to the current pathname. */
  path?: string;
};

export function TrackEvent({ event, props, path }: TrackEventProps) {
  const fired = useRef(false);
  // Props objects are re-created on every render, so the effect keys off a
  // by-value signature instead of object identity, and reads the latest values
  // through a ref (that keeps the dependency array honest without re-firing).
  const latest = useRef({ event, props, path });
  latest.current = { event, props, path };
  const signature = `${event}|${path ?? ""}|${JSON.stringify(props ?? {})}`;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const current = latest.current;
    track(current.event, current.props, current.path);
  }, [signature]);

  return null;
}
