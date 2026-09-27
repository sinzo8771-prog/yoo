/**
 * Variant selector (Task 6, step 2).
 *
 * The Task 4 catalog model is intentionally flat: each `CatalogVariant` has a
 * `title` (e.g. "Blue / Large") and an `available` flag, with no nested
 * `productOptions`/`productOptionValues` graph. We therefore present variants
 * as a radio list rather than building option swatches from a schema relation
 * we do not have.
 *
 * Rules:
 *  - The selected variant ID is emitted into the URL (`?variant=<id>`) so the
 *    choice is shareable and survives reloads.
 *  - Selecting a variant the catalog reports as unavailable is blocked — the
 *    UI never silently substitutes a different variant.
 */
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useId } from "react";
import type { CatalogProduct, CatalogVariant } from "@/lib/openfront/catalog";
import { track } from "@/lib/analytics/client";

export function VariantSelector({
  product,
  defaultVariantId,
}: {
  product: CatalogProduct;
  defaultVariantId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = useId();
  const name = "variant";

    const variants = product.variants;
  const selectedId = searchParams?.get("variant") ?? defaultVariantId ?? "";
  const [selected, setSelected] = useState<string>(selectedId);

  // Keep internal state in sync when the URL changes (back/forward nav).
  useEffect(() => {
    const current = searchParams?.get("variant") ?? defaultVariantId ?? "";
    setSelected(current);
  }, [searchParams, defaultVariantId]);

  if (variants.length === 0) {
    return null;
  }

  // Single variant: no selector needed, but still expose the ID for the
  // AddToCart form via state.
  if (variants.length === 1) {
    return <input type="hidden" name={name} value={variants[0].id} />;
  }

  const onSelect = (variant: CatalogVariant) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSelected(value);
    // Task 19, Step 3: recorded on the visitor's action, not on render — a
    // preselected default variant is not a selection the visitor made.
    track("select_variant", { productId: product.id, variantId: value });
    const url = new URLSearchParams(searchParams?.toString() ?? "");
    url.set("variant", value);
    router.replace(`?${url.toString()}`, { scroll: false });
  };

  return (
    <fieldset className="flex flex-col gap-2" data-testid="variant-selector">
      <legend className="text-sm font-medium text-foreground">Variant</legend>
      {variants.map((variant) => {
        const disabled = !variant.available;
        const checked = selected === variant.id;
        return (
          <label
            key={variant.id}
            className="flex items-center gap-3 text-sm"
          >
            <input
              type="radio"
              name={id + "-" + name}
              value={variant.id}
              checked={checked}
              disabled={disabled}
              onChange={onSelect(variant)}
              aria-describedby={disabled ? `${id}-unavail` : undefined}
              className="h-4 w-4"
            />
            <span className={disabled ? "text-muted-foreground line-through" : "text-foreground"}>
              {variant.title}
            </span>
            {disabled ? (
              <span
                id={`${id}-unavail`}
                className="text-xs text-muted-foreground"
                aria-hidden="true"
              >
                (unavailable)
              </span>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}

/** Expose the currently-selected variant ID for the AddToCart form to read. */
export function useSelectedVariantId(): string | undefined {
  // This hook is consumed by AddToCartForm (a sibling client component that
  // reads the same search param) so we don't share React state across roots.
  const searchParams = useSearchParams();
    return searchParams?.get("variant") ?? undefined;
}
