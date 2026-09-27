/**
 * Task 15, Step 1 — v1 shipping-pricing strategy.
 *
 * Pure module: it filters the `ShippingOption`s that Openfront's
 * `activeCartShippingOptions` query returns; it never computes prices itself.
 * That matters because a storefront must not quote a number it cannot stand
 * behind — the commerce system of record owns pricing, this module only
 * decides **which** of those options may be shown and bought in this market.
 *
 * Units: Openfront stores `ShippingOption.amount`, `subtotal`, and
 * `ShippingOptionRequirement.amount` in minor units (integer cents for USD;
 * see the `÷100` display convention in `activeCartShippingOptions`). Everything
 * here therefore compares minor units against minor units — no conversion.
 *
 * Strategy (plan §1.1 defaults, adapted to the declared store market in
 * `lib/brand/site.ts`):
 *  1. One market, one currency. Options priced outside `site.market.currency`
 *     or addressed outside `site.market.countryCode` are withheld — they are
 *     real data from another region, not a failure to hide.
 *  2. Honest pricing. `calculated` options carry no quotable amount until a
 *     live carrier rates them; showing "$0.00" or a stale number would be a
 *     fabricated price, so they are dropped rather than displayed.
 *  3. Cart thresholds. Openfront returns `min_subtotal`/`max_subtotal`
 *     requirements alongside the option but does **not** apply them against
 *     the cart; checkout would happily sell the free tier to a $5 cart. This
 *     module applies them (skipped only when no subtotal is available, so the
 *     door is never closed just because a field was missing).
 *  4. Malformed options are dropped, never thrown — one bad row from the
 *     backend must not blank the whole shipping step.
 */
import { site } from "@/lib/brand/site";

/** The `priceType` enum values Openfront stores on ShippingOption. */
export type ShippingPriceType = "flat_rate" | "calculated" | "free";

export type ShippingOptionInput = {
  id?: unknown;
  name?: unknown;
  amount?: unknown;
  priceType?: unknown;
  calculatedAmount?: unknown;
  shippingOptionRequirements?: Array<{
    type?: unknown;
    amount?: unknown;
  }> | null;
};

export type ShippingOptionOutput = {
  id: string;
  name: string;
  amount: number;
  priceType: ShippingPriceType;
  /**
   * Openfront's own formatted, tax-inclusive display price, passed through
   * verbatim — the commerce system of record owns pricing display.
   */
  calculatedAmount?: string;
};

export type ShippingSelection =
  | { status: "ok"; options: ShippingOptionOutput[] }
  | { status: "unsupported-currency"; options: [] }
  | { status: "unsupported-destination"; options: [] }
  | { status: "no-options"; options: [] };

const coerceMinorAmount = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
};

const coercePriceType = (value: unknown): ShippingPriceType | null => {
  return value === "flat_rate" || value === "calculated" || value === "free"
    ? value
    : null;
};

/** Applies a min/max subtotal band in minor units; null subtotal = no gate. */
const meetsRequirements = (
  requirements: ShippingOptionInput["shippingOptionRequirements"],
  subtotalCents: number | null
): boolean => {
  if (!Array.isArray(requirements)) return true;
  if (subtotalCents === null) return true;

  for (const requirement of requirements) {
    if (!requirement || typeof requirement.type !== "string") continue;
    const amount = coerceMinorAmount(requirement.amount);
    if (amount === null) continue;

    if (requirement.type === "min_subtotal" && subtotalCents < amount) {
      return false;
    }
    if (requirement.type === "max_subtotal" && subtotalCents > amount) {
      return false;
    }
  }
  return true;
};

/**
 * Filters the options Openfront returned for this cart down to the ones the
 * v1 strategy allows the customer to see and buy.
 *
 * @param options        raw `activeCartShippingOptions` rows (minor-unit amounts)
 * @param subtotalCents  cart subtotal in minor units, or null when unknown
 * @param currencyCode   the cart region's currency code, if known
 * @param countryCode    the cart's shipping destination, if known
 */
export function selectShippingOptions({
  options,
  subtotalCents = null,
  currencyCode = null,
  countryCode = null,
}: {
  options: ShippingOptionInput[];
  subtotalCents?: number | null;
  currencyCode?: string | null;
  countryCode?: string | null;
}): ShippingSelection {
  if (!Array.isArray(options)) {
    return { status: "no-options", options: [] };
  }

  // 1. Currency gate — never display prices in a currency we do not sell in.
  if (
    currencyCode !== null &&
    currencyCode.toUpperCase() !== site.market.currency.toUpperCase()
  ) {
    return { status: "unsupported-currency", options: [] };
  }

  // 2. Destination gate — v1 ships to the single declared market only.
  if (
    countryCode !== null &&
    countryCode.toLowerCase() !== site.market.countryCode.toLowerCase()
  ) {
    return { status: "unsupported-destination", options: [] };
  }

  const available: ShippingOptionOutput[] = [];
  for (const option of options) {
    if (!option || typeof option.id !== "string" || !option.id) continue;

    const priceType = coercePriceType(option.priceType);
    // 3. Honest pricing: a calculated option has no quotable amount yet.
    if (priceType === null || priceType === "calculated") continue;

    const amount = coerceMinorAmount(option.amount);
    if (amount === null || amount < 0) continue;

    const name =
      typeof option.name === "string" && option.name.trim()
        ? option.name.trim().slice(0, 120)
        : null;
    if (!name) continue;

    // 4. Thresholds: free is bought only by carts that actually qualify.
    if (!meetsRequirements(option.shippingOptionRequirements, subtotalCents)) {
      continue;
    }

    available.push({
      id: option.id,
      name,
      amount,
      priceType,
      ...(typeof option.calculatedAmount === "string"
        ? { calculatedAmount: option.calculatedAmount }
        : {}),
    });
  }

  if (available.length === 0) {
    return { status: "no-options", options: [] };
  }

  return { status: "ok", options: available };
}