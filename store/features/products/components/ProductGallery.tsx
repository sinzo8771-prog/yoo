/**
 * Product image gallery (Task 6, step 1).
 *
 * Reads images from the catalog record only — never invents URLs. When the
 * merchant has not uploaded an image we show a neutral placeholder rather
 * than a broken-image icon. Zoom opens a modal overlay that respects
 * `prefers-reduced-motion`.
 */
"use client";

import { useState } from "react";
import type { CatalogProduct, CatalogVariant } from "@/lib/openfront/catalog";

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
        <img
          src={primary.url}
          alt={primary.alt ?? product.title}
          className="h-full w-full object-cover"
          loading="eager"
          sizes="(max-width: 1024px) 100vw, 50vw"
          onClick={() => setZoomSrc(primary.url)}
        />
        {selectedVariant && !selectedVariant.available ? (
          <span className="absolute left-3 top-3 rounded-sm bg-background/95 px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Unavailable
          </span>
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2">
          {images.map((image, i) => (
            <li key={image.url + i}>
              <button
                type="button"
                onClick={() => setZoomSrc(image.url)}
                className="aspect-square w-full overflow-hidden rounded-md border border-border bg-secondary"
              >
                <img
                  src={image.url}
                  alt={image.alt ?? `${product.title} view ${i + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 motion-safe:data-[open=false]:animate-in motion-safe:data-[open=false]:fade-out-0"
      data-open={true}
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain"
        loading="eager"
      />
    </div>
  );
}
