/**
 * Product rationale for merchandising surfaces (Task 5, step 3).
 *
 * The plan requires one *real* use case/benefit per featured product,
 * "grounded in catalog data or approved copy". We therefore never invent copy:
 * the rationale is the merchant-authored `subtitle` (Openfront's dedicated
 * short-description field) and falls back to the first sentence of the product
 * description. If the catalog has neither, we return `null` and the caller
 * renders nothing rather than making something up.
 */
import type { CatalogProduct } from "@/lib/openfront/catalog";

/** Longest rationale we will render, so cards stay balanced. */
export const RATIONALE_MAX_LENGTH = 140;

/** First sentence of a paragraph of text (falls back to the whole string). */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";

  const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (match ? match[0] : trimmed).trim();
  return sentence;
}

/**
 * Rationale for a product, or `null` when the catalog gives us nothing real to
 * say. Precedence: merchant `subtitle` → first sentence of the description.
 */
export function productRationale(
  product: Pick<CatalogProduct, "subtitle" | "description">,
  maxLength: number = RATIONALE_MAX_LENGTH
): string | null {
  const subtitle = product.subtitle?.trim();
  const candidate =
    subtitle && subtitle.length > 0
      ? subtitle
      : firstSentence(product.description ?? "");

  if (candidate.length === 0) return null;
  if (maxLength > 0 && candidate.length > maxLength) {
    return `${candidate.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return candidate;
}