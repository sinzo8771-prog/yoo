import { Suspense } from "react";

import { listRegions } from "@/features/storefront/lib/data/regions";

import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import CartButton from "@/features/storefront/modules/layout/components/cart-button";
import SideMenu from "@/features/storefront/modules/layout/components/side-menu";
import Logo from "@/features/storefront/modules/layout/components/logo";
import { site } from "@/lib/brand/site";

/**
 * SiteHeader (Task 3) — desktop and mobile navigation share the same source of
 * truth (`lib/brand/site.ts`). The mobile side menu additionally renders the
 * live Openfront category tree. Replaces the reference `Nav` template.
 */
export default async function SiteHeader() {
  const { regions } = await listRegions();

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      <header className="relative h-16 mx-auto border-b duration-200 bg-background border-border">
        <nav
          aria-label="Main"
          className={`${site.containerClass} text-muted-foreground flex items-center justify-between w-full h-full text-xs leading-5 font-normal`}
        >
          <div className="flex-1 basis-0 h-full flex items-center">
            <div className="h-full">
              <SideMenu regions={regions} />
            </div>
            {/* Desktop nav — labels/routes from brand config only */}
            <div className="hidden lg:flex items-center gap-x-6 h-full ml-8">
              {site.navLinks.map((link) => (
                <LocalizedClientLink
                  key={link.href}
                  href={link.href}
                  className="hover:text-foreground"
                >
                  {link.label}
                </LocalizedClientLink>
              ))}
            </div>
          </div>

          <div className="flex items-center h-full">
            <Logo />
          </div>

          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            <div className="hidden lg:flex items-center gap-x-6 h-full">
              <LocalizedClientLink
                className="hover:text-foreground"
                href="/account"
                data-testid="nav-account-link"
              >
                Account
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="hover:text-foreground flex gap-2"
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Cart (0)
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  );
}