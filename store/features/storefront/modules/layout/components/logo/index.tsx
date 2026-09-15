import { cn } from '@/lib/utils';
import { Tektur } from 'next/font/google';
import LocalizedClientLink from '@/features/storefront/modules/common/components/localized-client-link';
import { getStore } from '@/features/storefront/lib/data/store';
import { site } from '@/lib/brand/site';

const tektur = Tektur({
  subsets: ['latin'],
  display: 'swap',
  adjustFontFallback: false,
});

// Openfront store records may define a logoIcon; keep that capability but the
// brand config owns the default wordmark (Task 3: lib/brand is the source of truth).
const DEFAULT_LOGO = '<svg fill="none" height="100%" viewBox="0 0 44 48" width="100%" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M12 18h20M12 24h20M12 30h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

export default async function Logo() {
  const store = await getStore();
  const storeName = site.name || store?.name || 'Store';
  const logoSvg = store?.logoIcon || DEFAULT_LOGO;
  const logoColor = store?.logoColor || '0';

  return (
    <LocalizedClientLink
      href="/"
      className={cn(
        tektur.className,
        'flex items-center gap-2 text-2xl text-foreground hover:text-muted-foreground opacity-75'
      )}
      data-testid="nav-store-link"
    >
      <div
        dangerouslySetInnerHTML={{ __html: logoSvg }}
        style={{ filter: `hue-rotate(${logoColor}deg)` }}
        className="size-4 sm:size-5"
        aria-hidden="true"
      />
      <span className="flex items-center tracking-wide text-base sm:text-lg">
        <span className="font-medium">{storeName.toLowerCase()}</span>
      </span>
    </LocalizedClientLink>
  );
}
