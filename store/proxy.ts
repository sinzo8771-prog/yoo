import type { NextRequest } from "next/server";
import { handleStorefrontRoutes } from "@/features/storefront/middleware";

// Main middleware function that handles all routes
export async function proxy(request: NextRequest) {
  // Only handle storefront routes
  return handleStorefrontRoutes(request, null);
}

export const config = {
  matcher: [
    // `robots.txt` / `sitemap.xml` are root-only metadata routes (app/robots.ts,
    // app/sitemap.ts). They have no country-prefixed variant, so letting the
    // region redirect run would send crawlers to /us/robots.txt → 404. Excluded
    // here alongside the static assets, exactly like favicon.svg.
    "/((?!api|_next/static|_next/image|favicon.svg|robots.txt|sitemap.xml|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
};
