/**
 * Task 15, Step 2 + Step 4 — format-only address validation tests.
 *
 * The manual shipping provider performs no deliverability validation, so this
 * gate is explicitly "format-only". These tests pin both the field rules and
 * the honesty contract: every result is labeled validatedBy "format-only",
 * and the messages never claim the address was carrier-validated.
 */
import { describe, expect, it } from "vitest";
import { validateShippingAddressFormat } from "@/lib/shipping/address";

const validInput = {
  email: "Jordan.Example@Gmail.com",
  firstName: "  Jordan  ",
  lastName: "Rivera",
  address1: "123 Main Street, Apt 4B",
  city: "Portland",
  postalCode: "97201",
  phone: "+1 (503) 555-0100",
  countryCode: "US",
};

describe("validateShippingAddressFormat — acceptance", () => {
  it("accepts a well-formed US address and normalizes it", () => {
    const result = validateShippingAddressFormat(validInput);
    expect(result.valid).toBe(true);
    // The honesty contract: this is a format gate, never a carrier check.
    expect(result.validatedBy).toBe("format-only");
    if (result.valid) {
      expect(result.normalized).toEqual({
        email: "jordan.example@gmail.com",
        firstName: "Jordan",
        lastName: "Rivera",
        address1: "123 Main Street, Apt 4B",
        city: "Portland",
        postalCode: "97201",
        phone: "+1 (503) 555-0100",
        countryCode: "us",
      });
    }
  });

  it("accepts a missing optional phone", () => {
    const result = validateShippingAddressFormat({ ...validInput, phone: "" });
    expect(result.valid).toBe(true);
  });

  it("accepts a ZIP+4 postal code", () => {
    const result = validateShippingAddressFormat({
      ...validInput,
      postalCode: "97201-1234",
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateShippingAddressFormat — rejection", () => {
  const expectInvalid = (overrides: Record<string, unknown>, field: string) => {
    const result = validateShippingAddressFormat({
      ...validInput,
      ...overrides,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === field)).toBe(true);
      // Customer-actionable: every message is a readable sentence, not a code.
      for (const error of result.errors) {
        expect(error.message.length).toBeGreaterThan(5);
      }
    }
    return result;
  };

  it("rejects missing or malformed email", () => {
    expectInvalid({ email: "" }, "email");
    expectInvalid({ email: "not-an-email" }, "email");
    expectInvalid({ email: "a@b" }, "email");
  });

  it("rejects missing names, street, and city", () => {
    expectInvalid({ firstName: "" }, "firstName");
    expectInvalid({ lastName: "" }, "lastName");
    expectInvalid({ address1: "" }, "address1");
    expectInvalid({ city: "" }, "city");
  });

  it("rejects postal codes that are too short or contain junk", () => {
    expectInvalid({ postalCode: "AB" }, "postalCode");
    expectInvalid({ postalCode: "9720!!!" }, "postalCode");
    expectInvalid({ postalCode: 97201 }, "postalCode");
  });

  it("rejects malformed phone but allows blank", () => {
    expectInvalid({ phone: "call me maybe" }, "phone");
    expect(validateShippingAddressFormat({ ...validInput, phone: "" }).valid).toBe(true);
  });
});

describe("validateShippingAddressFormat — market gate", () => {
  it("rejects a missing country with a select prompt", () => {
    const result = validateShippingAddressFormat({ ...validInput, countryCode: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toBe("Select a country.");
    }
  });

  it("rejects out-of-market destinations upfront", () => {
    const result = validateShippingAddressFormat({ ...validInput, countryCode: "GB" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain("United States");
    }
  });

  it("accepts the market country case-insensitively and normalizes to lowercase", () => {
    for (const code of ["us", "US", "Us"]) {
      const result = validateShippingAddressFormat({ ...validInput, countryCode: code });
      expect(result.valid).toBe(true);
    }
  });
});

describe("validateShippingAddressFormat — safety", () => {
  it("strips control characters from text fields", () => {
    const result = validateShippingAddressFormat({
      ...validInput,
      city: "Port\u0000land\n",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.normalized.city).toBe("Portland");
    }
  });

  it("rejects absurdly long fields instead of storing them", () => {
    const result = validateShippingAddressFormat({
      ...validInput,
      address1: "a".repeat(500),
    });
    expect(result.valid).toBe(false);
  });

  it("never labels a result as provider/carrier validation", () => {
    const invalid = validateShippingAddressFormat({ ...validInput, email: "" });
    const valid = validateShippingAddressFormat(validInput);
    expect(valid.validatedBy).toBe("format-only");
    expect(invalid.validatedBy).toBe("format-only");
  });
});
