/**
 * Task 15, Step 2 — format-only shipping address validation.
 *
 * EXPLICIT CAPABILITY BOUNDARY: this module checks that address fields are
 * well-formed and safe to store/forward. It does NOT check that the address
 * exists or is deliverable — only the configured shipping provider does that,
 * and the manual provider used for v1 does not validate at all (its
 * `validateAddressFunction` returns `isValid: true` unconditionally).
 *
 * Everything returned here is therefore labeled `validatedBy: "format-only"`,
 * and no UI copy may claim carrier/address validation on this basis. This is
 * a server-side gate, not a replacement for provider validation.
 */

export type AddressField =
  | "email"
  | "firstName"
  | "lastName"
  | "address1"
  | "city"
  | "postalCode"
  | "phone"
  | "countryCode";

export type AddressIssue = { field: AddressField; message: string };

export type AddressValidation =
  | { valid: true; validatedBy: "format-only"; normalized: ShippingAddressInput }
  | { valid: false; validatedBy: "format-only"; errors: AddressIssue[] };

export type ShippingAddressInput = {
  email: string;
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  postalCode: string;
  phone: string;
  countryCode: string;
};

/** Declared v1 market (plan §1.1, realized in lib/brand/site.ts). */
const MARKET_COUNTRY = "us";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Trims, strips control characters, and caps length; null when unusable. */
const cleanText = (value: unknown, maxLen: number): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? null : cleaned;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/;
const PHONE_PATTERN = /^[+]?[0-9 ()-]{7,20}$/;
const ISO2_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Validates a shipping address as format-only. Field rules are deliberately
 * conservative for the single US market; anything outside them is rejected
 * with a customer-actionable message rather than sent downstream.
 */
export function validateShippingAddressFormat(
  input: Partial<Record<AddressField, unknown>>
): AddressValidation {
  const errors: AddressIssue[] = [];
  const normalized: ShippingAddressInput = {
    email: "",
    firstName: "",
    lastName: "",
    address1: "",
    city: "",
    postalCode: "",
    phone: "",
    countryCode: "",
  };

  const email = cleanText(input.email, 254);
  if (!email || !EMAIL_PATTERN.test(email)) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  } else {
    normalized.email = email.toLowerCase();
  }

  const firstName = cleanText(input.firstName, 64);
  if (!firstName) {
    errors.push({ field: "firstName", message: "Enter a first name." });
  } else {
    normalized.firstName = firstName;
  }

  const lastName = cleanText(input.lastName, 64);
  if (!lastName) {
    errors.push({ field: "lastName", message: "Enter a last name." });
  } else {
    normalized.lastName = lastName;
  }

  const address1 = cleanText(input.address1, 200);
  if (!address1) {
    errors.push({
      field: "address1",
      message: "Enter a street address.",
    });
  } else {
    normalized.address1 = address1;
  }

  const city = cleanText(input.city, 100);
  if (!city) {
    errors.push({ field: "city", message: "Enter a city." });
  } else {
    normalized.city = city;
  }

  const postalCode = cleanText(input.postalCode, 12);
  if (!postalCode || !POSTAL_PATTERN.test(postalCode)) {
    errors.push({
      field: "postalCode",
      message: "Enter a valid ZIP or postal code.",
    });
  } else {
    normalized.postalCode = postalCode;
  }

  // Optional, but if given it must look like a phone number.
  const rawPhone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (rawPhone === "") {
    normalized.phone = "";
  } else {
    const phone = cleanText(rawPhone, 20);
    if (!phone || !PHONE_PATTERN.test(phone)) {
      errors.push({
        field: "phone",
        message: "Enter a valid phone number, or leave it blank.",
      });
    } else {
      normalized.phone = phone;
    }
  }

  const countryCode =
    typeof input.countryCode === "string" ? input.countryCode.trim() : "";
  if (!ISO2_PATTERN.test(countryCode)) {
    errors.push({ field: "countryCode", message: "Select a country." });
  } else if (countryCode.toLowerCase() !== MARKET_COUNTRY) {
    // v1 ships to the single declared market; be upfront rather than taking
    // an order we cannot fulfill.
    errors.push({
      field: "countryCode",
      message: "We currently ship to the United States only.",
    });
  } else {
    normalized.countryCode = countryCode.toLowerCase();
  }

  if (errors.length > 0) {
    return { valid: false, validatedBy: "format-only", errors };
  }
  return { valid: true, validatedBy: "format-only", normalized };
}
