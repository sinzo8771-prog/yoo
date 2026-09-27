/**
 * Task 19, Step 3 — the first-party analytics collector route.
 *
 * A thin adapter: the pipeline (rate limiting, bounded read, validation,
 * counting, logging) lives in `lib/analytics/collect.ts` so it can be unit
 * tested without the Next runtime. See that module for the security reasoning —
 * in short, `/api` is excluded from the Task 18 middleware guard, so this path
 * applies its own limiter and validation.
 *
 * Responses are always empty and uncached: `204` on success, `400`, `413`, `429`
 * otherwise. Nothing about a rejected payload is ever echoed.
 */

import { NextResponse } from "next/server";

import { collectAnalyticsEvent } from "@/lib/analytics/collect";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { status, headers } = await collectAnalyticsEvent({
    headers: request.headers,
    body: request.body,
  });
  return new NextResponse(null, { status, headers });
}

/** Anything but POST is answered without touching the ingest pipeline. */
export async function GET(): Promise<Response> {
  return new NextResponse(null, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
