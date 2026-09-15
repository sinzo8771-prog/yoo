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