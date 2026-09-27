/**
 * Money formatting for catalog values (Task 5).
 *
 * Openfront stores `MoneyAmount.amount` in **minor units** (2400 = 24.00 USD),
 * but `Intl.NumberFormat` formats *major* units. Getting this wrong shows $2,400
 * instead of $24.00, so the conversion lives here, in one tested place.
 *
 * Zero-decimal currencies (JPY, KRW, …) are not divided — reusing the reference
 * storefront's `noDivisionCurrencies` list so both clients agree.
 */
import { noDivisionCurrencies } from "@/features/storefront/lib/constants";

const DEFAULT_LOCALE = "en-US";

/** True when the currency has no minor unit (so amounts are whole units). */
export function isZeroDecimalCurrency(currencyCode?: string | null): boolean {
  if (!currencyCode) return false;
  return noDivisionCurrencies.includes(currencyCode.toLowerCase());
}

/** Convert a minor-unit amount into the major unit `Intl` expects. */
export function toMajorUnits(
  amount: number,
  currencyCode?: string | null
): number {
  if (!Number.isFinite(amount)) return 0;
  return isZeroDecimalCurrency(currencyCode) ? amount : amount / 100;
}

/**
 * Convert a major-unit amount (the shape Openfront returns for `order.total`,
 * e.g. `"45.00"`) into the minor units the analytics funnel and JSON-LD expect.
 *
 * Returns `undefined` for anything that is not a plain non-negative number —
 * a missing total is omitted, never reported as a fabricated `0`.
 */
export function toMinorUnits(
  amount: string | number | null | undefined,
  currencyCode?: string | null
): number | undefined {
  if (amount === null || amount === undefined) return undefined;

  const normalized =
    typeof amount === "number" ? String(amount) : String(amount).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return undefined;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;

  const minor = isZeroDecimalCurrency(currencyCode) ? parsed : parsed * 100;
  return Math.round(minor);
}

/**
 * Format a minor-unit amount as a localized currency string.
 * Returns `null` for missing/invalid input so callers can decide what to render
 * rather than printing a misleading "0".
 */
export function formatMinorUnits(
  amount: number | null | undefined,
  currencyCode: string | null | undefined,
  locale: string = DEFAULT_LOCALE
): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;

  const major = toMajorUnits(amount, currencyCode);

  if (!currencyCode) return major.toString();

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(major);
  } catch {
    // Unknown/invalid ISO code — never throw inside a render.
    return major.toString();
  }
}