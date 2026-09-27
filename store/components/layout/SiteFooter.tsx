import { cn } from "@/lib/utils";
import { getCategoriesList } from "@/features/storefront/lib/data/categories";
import { getCollectionsList } from "@/features/storefront/lib/data/collections";
import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import Logo from "@/features/storefront/modules/layout/components/logo";
import { getStore } from "@/features/storefront/lib/data/store";
import { site } from "@/lib/brand/site";

/**
 * SiteFooter (Task 3). Link groups: DB-driven categories/collections plus the
 * static groups from `lib/brand/site.ts`. Policy links render from the
 * `available` trust entries in `lib/brand/site.ts` (Task 15 added
 * shipping/returns; Task 21 will add privacy/terms) — do not add ad-hoc links
 * in this component.
 */
export default async function SiteFooter() {
  const { collections } = await getCollectionsList(0, 6);
  const { productCategories } = await getCategoriesList(0, 6);
  const store = await getStore();
  const storeName = store?.name || site.name;

  return (
    <footer className="border-t border-border w-full">
      <div className={`${site.containerClass} flex flex-col`}>
        <div className="flex flex-col gap-y-6 sm:flex-row items-start justify-between py-16">
          <div>
            <Logo />
            <p className="mt-3 text-[0.8125rem] leading-[1.375rem] text-muted-foreground max-w-xs">
              {site.tagline}
            </p>
          </div>
          <div className="text-xs leading-5 font-normal gap-10 md:gap-x-16 grid grid-cols-2 sm:grid-cols-3">
            {productCategories && productCategories?.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="text-[0.8125rem] leading-[1.375rem] font-medium text-foreground">
                  Categories
                </span>
                <ul className="grid grid-cols-1 gap-2">
                  {productCategories?.slice(0, 6).map((c: any) =>
                    c.parentCategory ? null : (
                      <li
                        className="flex flex-col text-muted-foreground text-[0.8125rem] leading-[1.375rem] font-normal"
                        key={c.id}
                      >
                        <LocalizedClientLink
                          className={cn("hover:text-foreground")}
                          href={`/categories/${c.handle}`}
                        >
                          {c.title}
                        </LocalizedClientLink>
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}
            {collections && collections.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="text-[0.8125rem] leading-[1.375rem] font-medium text-foreground">
                  Collections
                </span>
                <ul
                  className={cn(
                    "grid grid-cols-1 gap-2 text-muted-foreground text-[0.8125rem] leading-[1.375rem] font-normal",
                    { "grid-cols-2": (collections?.length || 0) > 3 }
                  )}
                >
                  {collections?.slice(0, 6).map((c: any) => (
                    <li key={c.id}>
                      <LocalizedClientLink
                        className="hover:text-foreground"
                        href={`/collections/${c.handle}`}
                      >
                        {c.title}
                      </LocalizedClientLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-y-2">
              <span className="text-[0.8125rem] leading-[1.375rem] font-medium text-foreground">
                Support
              </span>
              <ul className="grid grid-cols-1 gap-y-2 text-muted-foreground text-[0.8125rem] leading-[1.375rem] font-normal">
                {site.footer.support.map((link) =>
                  link.href.startsWith("mailto:") ? (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="hover:text-foreground"
                        rel="noreferrer"
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.href}>
                      <LocalizedClientLink
                        className="hover:text-foreground"
                        href={link.href}
                      >
                        {link.label}
                      </LocalizedClientLink>
                    </li>
                  )
                )}
              </ul>
            </div>
            <div className="flex flex-col gap-y-2">
              <span className="text-[0.8125rem] leading-[1.375rem] font-medium text-foreground">
                Policies
              </span>
              <ul className="grid grid-cols-1 gap-y-2 text-muted-foreground text-[0.8125rem] leading-[1.375rem] font-normal">
                {site.trust.items
                  .filter((item) => item.available && item.href.startsWith("/policies/"))
                  .map((item) => (
                    <li key={item.href}>
                      <LocalizedClientLink
                        className="hover:text-foreground"
                        href={item.href}
                      >
                        {item.label}
                      </LocalizedClientLink>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="flex w-full mb-16 justify-center text-muted-foreground">
          <p className="text-[0.8125rem] leading-5 font-normal">
            <span suppressHydrationWarning>
              © {new Date().getFullYear()} {storeName}. All rights reserved.
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}