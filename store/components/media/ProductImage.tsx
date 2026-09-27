import Image from "next/image";

import { cn } from "@/lib/utils";
import { collectImageHosts, isOptimizableImageUrl } from "@/lib/media/images";

/**
 * ProductImage (Task 20, Step 2) — the only place the storefront renders a
 * catalog photograph.
 *
 * Why one component: the site ships whatever URL the commerce backend (and
 * later a supplier feed) returns, so the decision "can Next's optimizer resize
 * this, or do we have to hand the browser the original file?" has to be made
 * the same way everywhere. `lib/media/images.ts` owns that decision; this
 * component applies it.
 *
 * Layout contract (CLS): the caller must provide a relatively-positioned box
 * with a reserved aspect ratio (`relative aspect-square` …) and pass a `sizes`
 * hint that matches the layout slots the image occupies. The intrinsic
 * dimensions of a supplier asset are unknown, and inventing numbers for
 * `width`/`height` would be worse than having none — the reserved box is what
 * actually prevents layout shift, and `sizes` is what stops a 4000px original
 * being sent to a phone.
 *
 * Interactive callers (zoom overlays, galleries) must not attach handlers to
 * this element: wrap it in a real `<button>` so the control is keyboard
 * reachable and has an accessible name.
 */
export function ProductImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
}: {
  /** Catalog image URL. A missing/blank URL renders nothing. */
  src?: string | null;
  /** Meaningful alt text, or `""` when the surrounding link already names it. */
  alt: string;
  /** Required responsive hint, e.g. `(max-width: 1023px) 100vw, 50vw`. */
  sizes: string;
  /** `object-fit` / rounding / hover treatments owned by the call site. */
  className?: string;
  /** Above-the-fold hero image only (LCP). Everything else loads lazily. */
  priority?: boolean;
}) {
  const value = typeof src === "string" ? src.trim() : "";
  if (value.length === 0) return null;

  // Recomputed per render on purpose: it is a pure parse of a handful of env
  // values, and caching it would keep a stale allowlist after an env change.
  if (isOptimizableImageUrl(value, collectImageHosts())) {
    return (
      <Image
        src={value}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        // `fill` already positions the image absolutely inside the caller's
        // aspect box, so only the fit treatment is threaded through here.
        className={cn("object-cover", className)}
      />
    );
  }

  // Fallback: the host is not on the optimizer allowlist (or the URL is not
  // absolute http/https). We still reserve the box via the caller's aspect
  // ratio and still never render a broken-image icon — but the browser gets the
  // original file, which is exactly why docs/performance/budget.md tells
  // operators to declare supplier hosts in NEXT_PUBLIC_IMAGE_HOSTS.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={value}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}

export default ProductImage;
