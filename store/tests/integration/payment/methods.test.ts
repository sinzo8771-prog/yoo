/**
 * Task 16, Step 1 — payment-method selection at boundaries.
 *
 * Covers the market gate (US/USD), configured-key gating (the storefront can
 * only render providers whose public keys this deployment holds), the
 * production exclusion of the manual/COD test scaffold, unknown/uninstalled
 * providers, gate precedence, and input immutability.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { selectPaymentMethods } from "@/lib/payment/methods";

const stripe = { id: "prov_s", name: "Stripe", code: "pp_stripe_stripe", isInstalled: true };
const paypal = { id: "prov_p", name: "PayPal", code: "pp_paypal_paypal", isInstalled: true };
const manual = { id: "prov_m", name: "Cash on Delivery", code: "pp_system_default", isInstalled: true };

const fullEnv = {
  NEXT_PUBLIC_STRIPE_KEY: "pk_test_123",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "paypal-client-id",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("selectPaymentMethods (Task 16, Step 1)", () => {
  it("offers every configured market provider in Openfront's order", () => {
    const providers = [stripe, paypal, manual];
    const result = selectPaymentMethods(providers, {
      currencyCode: "USD",
      env: fullEnv,
      nodeEnv: "test",
    });

    expect(result.methods).toEqual(providers);
    expect(result.hidden).toEqual([]);
  });

  it("hides Stripe when this deployment has no public key (not_configured)", () => {
    const result = selectPaymentMethods([stripe, paypal], {
      currencyCode: "USD",
      env: { NEXT_PUBLIC_PAYPAL_CLIENT_ID: "cid" },
      nodeEnv: "test",
    });

    expect(result.methods).toEqual([paypal]);
    expect(result.hidden).toEqual([
      { code: "pp_stripe_stripe", reason: "not_configured" },
    ]);
  });

  it("hides PayPal when its client id is missing (not_configured)", () => {
    const result = selectPaymentMethods([stripe, paypal], {
      currencyCode: "USD",
      env: { NEXT_PUBLIC_STRIPE_KEY: "pk_test_123" },
      nodeEnv: "test",
    });

    expect(result.methods).toEqual([stripe]);
    expect(result.hidden).toEqual([
      { code: "pp_paypal_paypal", reason: "not_configured" },
    ]);
  });

  it("excludes the manual/COD test scaffold from production (test_mode_only)", () => {
    const result = selectPaymentMethods([stripe, paypal, manual], {
      currencyCode: "USD",
      env: fullEnv,
      nodeEnv: "production",
    });

    expect(result.methods).toEqual([stripe, paypal]);
    expect(result.hidden).toEqual([
      { code: "pp_system_default", reason: "test_mode_only" },
    ]);
  });

  it("keeps manual available outside production for local flows", () => {
    for (const nodeEnv of ["test", "development"]) {
      const result = selectPaymentMethods([manual], {
        currencyCode: "USD",
        env: fullEnv,
        nodeEnv,
      });
      expect(result.methods).toEqual([manual]);
      expect(result.hidden).toEqual([]);
    }
  });

  it("offers nothing when the cart currency is outside the market (unsupported_currency)", () => {
    const result = selectPaymentMethods([stripe, paypal, manual], {
      currencyCode: "EUR",
      env: fullEnv,
      nodeEnv: "test",
    });

    expect(result.methods).toEqual([]);
    expect(result.hidden.map((h) => h.reason)).toEqual([
      "unsupported_currency",
      "unsupported_currency",
      "unsupported_currency",
    ]);
  });

  it.each([["USD"], [undefined], [null], [""]])(
    "treats currency %j as the market currency (single-market launch fallback)",
    (currencyCode) => {
      const result = selectPaymentMethods([stripe], {
        currencyCode: currencyCode as string | null | undefined,
        env: fullEnv,
        nodeEnv: "test",
      });
      expect(result.methods).toEqual([stripe]);
      expect(result.hidden).toEqual([]);
    }
  );

  it("never offers an unknown provider code (unknown_provider)", () => {
    const result = selectPaymentMethods(
      [
        { id: "prov_x", code: "pp_wechat_pay", isInstalled: true },
        { id: "prov_y", code: "", isInstalled: true },
        { id: "prov_z", isInstalled: true },
      ],
      { currencyCode: "USD", env: fullEnv, nodeEnv: "test" }
    );

    expect(result.methods).toEqual([]);
    expect(result.hidden).toEqual([
      { code: "pp_wechat_pay", reason: "unknown_provider" },
      { code: "prov_y", reason: "unknown_provider" },
      { code: "prov_z", reason: "unknown_provider" },
    ]);
  });

  it("applies identity before any other gate (unknown code on a foreign currency is unknown_provider)", () => {
    const result = selectPaymentMethods([{ id: "x", code: "pp_other", isInstalled: true }], {
      currencyCode: "EUR",
      env: fullEnv,
      nodeEnv: "production",
    });

    expect(result.hidden).toEqual([{ code: "pp_other", reason: "unknown_provider" }]);
  });

  it("hides explicitly uninstalled providers but tolerates a missing flag", () => {
    const result = selectPaymentMethods(
      [
        { ...stripe, isInstalled: false },
        { ...paypal, isInstalled: null },
        { ...manual, isInstalled: undefined },
      ],
      { currencyCode: "USD", env: fullEnv, nodeEnv: "test" }
    );

    // Compare ids: the kept objects carry the null/undefined flags they
    // arrived with (the module never rewrites provider records).
    expect(result.methods.map((m) => m.id)).toEqual(["prov_p", "prov_m"]);
    expect(result.hidden).toEqual([
      { code: "pp_stripe_stripe", reason: "not_installed" },
    ]);
  });

  it("returns the original provider objects without mutating the input", () => {
    const providers = [stripe, paypal, manual];
    const snapshot = [...providers];

    const result = selectPaymentMethods(providers, {
      currencyCode: "USD",
      env: fullEnv,
      nodeEnv: "production",
    });

    expect(providers).toEqual(snapshot);
    expect(result.methods.every((m) => providers.includes(m))).toBe(true);
    expect(result.methods).not.toBe(providers);
  });

  it("reads process.env and NODE_ENV by default", () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_KEY", "pk_test_default");
    vi.stubEnv("NODE_ENV", "production");

    const result = selectPaymentMethods([stripe, manual], { currencyCode: "USD" });

    expect(result.methods).toEqual([stripe]);
    expect(result.hidden).toEqual([
      { code: "pp_system_default", reason: "test_mode_only" },
    ]);
  });
});
