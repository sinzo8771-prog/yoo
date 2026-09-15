/**
 * Add to cart form (Task 6, step 3).
 *
 * Submits the exact variant ID selected by the user (via `useSelectedVariantId`
 * reading the URL param that `VariantSelector` writes) plus the quantity, to
 * the same `addToCart` cart client used elsewhere. The button is disabled
 * during submission and on double-click — duplicate submissions are impossible.
 *
 * Quantity is clamped to `[1, 99]` and to availability when the catalog gives
 * us a stock figure (Task 4 catalog exposes `available`; we do not invent a
 * stock level).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { addToCart } from "@/features/storefront/lib/data/cart";
import { useSelectedVariantId } from "../components/VariantSelector";
import type { CatalogProduct } from "@/lib/openfront/catalog";
import { Button } from "@/components/ui/button";
import { RiLoader2Fill } from "@remixicon/react";

export function AddToCartForm({
  product,
}: {
  product: CatalogProduct;
}) {
  const router = useRouter();
  const variantId = useSelectedVariantId();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-derive availability for the chosen variant so the button stays correct.
  const selectedVariant = product.variants.find((v) => v.id === variantId);
  const canAdd = selectedVariant?.available ?? product.variants.length === 1;

  const increment = () => setQuantity((q) => Math.min(q + 1, 99));
  const decrement = () => setQuantity((q) => Math.max(q - 1, 1));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!variantId || isAdding) return;
    if (!canAdd) return;

    try {
      setIsAdding(true);
      setError(null);
      await addToCart({
        variantId,
        quantity,
        countryCode: "us", // TODO(Task 9): derive from country segment when available
      });
      router.push("/cart");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add to cart");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="add-to-cart">
      <div className="flex items-center gap-2">
        <label htmlFor="quantity" className="text-sm text-muted-foreground">
          Qty
        </label>
        <input
          id="quantity"
          type="number"
          min={1}
          max={99}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
          disabled={isAdding || !canAdd}
          className="w-14 px-2 py-1 text-center text-sm border border-border rounded"
        />
      </div>

      <Button
        type="submit"
        disabled={!variantId || isAdding || !canAdd}
        className="w-full h-10"
      >
        {isAdding ? (
          <>
            <RiLoader2Fill className="mr-2 h-4 w-4 animate-spin" />
            Adding…
          </>
        ) : !canAdd ? (
          "Out of stock"
        ) : !variantId && product.variants.length > 1 ? (
          "Select a variant"
        ) : (
          "Add to cart"
        )}
      </Button>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
