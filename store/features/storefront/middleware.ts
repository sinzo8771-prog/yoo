import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { openfrontClient } from "@/features/storefront/lib/config";
import { isTrustedActionRequest } from "@/lib/security/csrf";
import { applySecurityHeaders } from "@/lib/security/headers";
import {
  classifyRequest,
  clientKeyFromHeaders,
  edgeRateLimiter,
  rateLimitHeaders,
} from "@/lib/security/rate-limit";

const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us";

const regionMapCache = {
  regionMap: new Map<string, any>(),
  regionMapUpdated: Date.now(),
};

// Fetches and caches the region map from the GraphQL API
async function getRegionMap(request: NextRequest) {
  const { regionMap, regionMapUpdated } = regionMapCache;

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    try {
      const headers = {
        cookie: request.headers.get("cookie") || "",
      };
      
      const { regions } = await openfrontClient.request(
        `query {
          regions {
            code
            countries {
              id
              iso2
              iso3
            }
          }
        }`,
        {},
        headers
      );

      regionMapCache.regionMap.clear();
      if (regions?.length) {
        regions.forEach((region: { code: string; countries: any[] }) => {
          // Map region code to region
          regionMapCache.regionMap.set(region.code.toLowerCase(), region);
          // Also map each country ISO2 code to the same region
          region.countries.forEach((country: { iso2: string }) => {
            regionMapCache.regionMap.set(country.iso2.toLowerCase(), region);
          });
        });
      } else {
        regionMapCache.regionMap.set("us", { countries: [{ iso2: "US" }] });
      }
    } catch (error) {
      console.error("Error fetching regions:", error);
      if (!regionMapCache.regionMap.size) {
        regionMapCache.regionMap.set("us", { countries: [{ iso2: "US" }] });
      }
    }

    regionMapCache.regionMapUpdated = Date.now();
  }

  return regionMapCache.regionMap;
}

// Determines the appropriate country code based on URL, headers, and defaults
async function getCountryCode(request: NextRequest, regionMap: Map<string, any>) {
  try {
    let countryCode;
    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase();
    const urlCode = request.nextUrl.pathname
      .split("/")[1]
      ?.toLowerCase();

    if (urlCode && regionMap.has(urlCode)) {
      countryCode = urlCode;
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode;
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION;
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value;
    }

    return countryCode;
  } catch (error) {
    console.error("Error getting the country code:", error);
  }
}

/**
 * Task 18 — ingress guards, applied before any storefront work happens.
 *
 * Reached from `store/proxy.ts` (Next.js 16's middleware entry), whose matcher
 * excludes `/api`, `_next/*` and static asset paths; everything else — pages and
 * server-action POSTs alike — passes through here first.
 *
 * Order matters: a cross-site server-action POST is refused outright (403) and
 * only then is a bucket's budget spent (429), so forged cross-site requests
 * cannot burn a victim's allowance. Both responses carry the standard security
 * headers, and the limiter reports its state so operators can tell throttling
 * apart from an outage (see `docs/ops/incident-runbook.md`).
 */
function guardRequest(request: NextRequest): NextResponse | null {
  if (
    !isTrustedActionRequest({
      method: request.method,
      nextAction: request.headers.get("next-action"),
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    const forbidden = new NextResponse("Forbidden", { status: 403 });
    forbidden.headers.set("X-CSRF-Rejected", "1");
    applySecurityHeaders(forbidden.headers);
    return forbidden;
  }

  const bucket = classifyRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
  });
  if (!bucket) return null;

  const verdict = edgeRateLimiter.consume(
    bucket,
    clientKeyFromHeaders((name) => request.headers.get(name))
  );
  if (verdict.allowed) return null;

  const limited = new NextResponse("Too Many Requests", { status: 429 });
  for (const [name, value] of Object.entries(rateLimitHeaders(verdict))) {
    limited.headers.set(name, value);
  }
  applySecurityHeaders(limited.headers);
  return limited;
}

// Handles country code redirects and cart management for storefront routes
export async function handleStorefrontRoutes(request: NextRequest, user: any | null) {
  // User is passed from the main middleware only for dashboard routes

  // Task 18: refuse cross-site server actions and over-budget sources first.
  const guarded = guardRequest(request);
  if (guarded) return guarded;

  const regionMap = await getRegionMap(request);
  const countryCode = await getCountryCode(request, regionMap);
  const cartId = request.nextUrl.searchParams.get("cart_id");
  const cartIdCookie = request.cookies.get("_openfront_cart_id");

  let response;

  // Handle country code redirect
  const urlHasCountryCode = countryCode && request.nextUrl.pathname.split("/")[1]?.includes(countryCode);
  if (!urlHasCountryCode && countryCode) {
    const redirectPath = request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname;
    const queryString = request.nextUrl.search ? request.nextUrl.search : "";
    const redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`;
    response = NextResponse.redirect(redirectUrl);
  } else {
    response = NextResponse.next();
  }

  // Handle cart_id in URL
  if (cartId && !cartIdCookie) {
    const redirectUrl = `${request.nextUrl.href}&step=address`;
    response = NextResponse.redirect(redirectUrl);
    // Task 18: explicit cookie policy. `httpOnly` is deliberately NOT set: the
    // legacy client cart hook reads this cookie, and its value is a cart proof
    // that the server re-verifies on every mutation, so a forged value fails
    // closed. `SameSite=Lax` (not Strict) so returning from an off-site payment
    // redirect still sends it.
    response.cookies.set("_openfront_cart_id", cartId, {
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  // Task 18: every storefront response leaves with the security header set.
  applySecurityHeaders(response.headers);

  return response;
}