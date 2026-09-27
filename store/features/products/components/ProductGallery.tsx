/**
 * Product image gallery (Task 6, step 1; Task 20, step 2 responsive delivery).
 *
 * Reads images from the catalog record only — never invents URLs. When the
 * merchant has not uploaded an image we show a neutral placeholder rather
 * than a broken-image icon. Zoom opens a modal overlay that respects
 * `prefers-reduced-motion` (see the `motion-safe:` guards on the dialog).
 */
"use client";

import { useState } from "react";
import type { CatalogProduct, CatalogVariant } from "@/lib/openfront/catalog";

import { ProductImage } from "@/components/media/ProductImage";

export function ProductGallery({
  product,
  selectedVariant,
}: {
  product: CatalogProduct;
  selectedVariant: CatalogVariant | null;
}) {
  const images = product.images.length > 0 ? product.images : [];
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  if (images.length === 0) {
    return (
      <div
        className="aspect-square w-full rounded-md border border-border bg-secondary flex items-center justify-center"
        aria-label="No product image available"
      >
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          No image
        </span>
      </div>
    );
  }

  const primary = images[0];

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-secondary">
        <button
          type="button"
          onClick={() => setZoomSrc(primary.url)}
          aria-label={`Zoom product image: ${primary.alt ?? product.title}`}
          className="absolute inset-0 h-full w-full cursor-zoom-in"
        >
          {/* Task 20: single reviewed image renderer — optimizer when the host
              is allowlisted, plain <img> when it is not. LCP image, so it
              loads eagerly with high fetch priority. */}
          <ProductImage
            src={primary.url}
            alt={primary.alt ?? product.title}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
        </button>
        {selectedVariant && !selectedVariant.available ? (
          <span className="absolute left-3 top-3 rounded-sm bg-background/95 px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Unavailable
          </span>
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2">
          {images.map((image, i) => (
            <li key={image.url + i} className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-secondary">
              <button
                type="button"
                onClick={() => setZoomSrc(image.url)}
                aria-label={`Zoom ${image.alt ?? `${product.title} view ${i + 1}`}`}
                className="absolute inset-0 h-full w-full cursor-zoom-in"
              >
                <ProductImage
                  src={image.url}
                  alt={image.alt ?? `${product.title} view ${i + 1}`}
                  sizes="(max-width: 1024px) 25vw, 12vw"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {zoomSrc ? (
        <ZoomModal src={zoomSrc} alt={primary.alt ?? product.title} onClose={() => setZoomSrc(null)} />
      ) : null}
    </div>
  );
}

function ZoomModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Zoomed image: ${alt}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 motion-safe:data-[open=false]:animate-in motion-safe:data-[open=false]:fade-out-0"
      data-open={true}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close zoomed image"
        className="flex max-h-[90vh] max-w-[90vw] cursor-zoom-out items-center justify-center"
      >
        <ProductImage src={src} alt={alt} sizes="90vw" priority />
      </button>
    </div>
  );
}
