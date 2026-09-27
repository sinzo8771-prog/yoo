/**
 * Task 15, Step 1 + Step 4 — shipping pricing strategy boundary tests.
 *
 * selectShippingOptions is the only thing standing between Openfront's raw
 * activeCartShippingOptions rows and what a customer is shown, so its gates
 * are pinned at their boundaries: currency, destination, price honesty,
 * min/max subtotal thresholds (which Openfront returns but does not apply),
 * and malformed-row tolerance.
 */
import { describe, expect, it } from "vitest";
import {
  selectShippingOptions,
  type ShippingOptionInput,
} from "@/lib/shipping/pricing";
import { site } from "@/lib/brand/site";

const option = (overrides: Partial<ShippingOptionInput> = {}): ShippingOptionInput => ({
  id: "so_1",
  name: "Standard",
  amount: 799,
  priceType: "flat_rate",
  calculatedAmount: "$7.99",
  shippingOptionRequirements: [],
  ...overrides,
});

const ok = (options: ShippingOptionInput[], subtotal: number | null = 10000) =>
  selectShippingOptions({
    options,
    subtotalCents: subtotal,
    currencyCode: "USD",
    countryCode: "us",
  });

describe("selectShippingOptions — happy path", () => {
  it("returns flat and free options with display price passed through verbatim", () => {
    const result = ok([
      option({ id: "a", amount: 799, calculatedAmount: "$7.99" }),
      option({ id: "b", amount: 0, priceType: "free", calculatedAmount: "$0.00" }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.options).toHaveLength(2);
    expect(result.options[0]).toEqual({
      id: "a",
      name: "Standard",
      amount: 799,
      priceType: "flat_rate",
      calculatedAmount: "$7.99",
    });
  });

  it("is deterministic for identical input", () => {
    const input = [option()];
    expect(ok(input)).toEqual(ok([...input]));
  });

  it("rounds fractional minor amounts rather than trusting them blindly", () => {
    const result = ok([option({ amount: 799.4 })]);
    expect(result.options[0].amount).toBe(799);
  });

  it("sells the free tier only to carts that qualify, alongside paid options", () => {
    const freeTier = option({
      id: "free",
      amount: 0,
      priceType: "free",
      calculatedAmount: "$0.00",
      shippingOptionRequirements: [{ type: "min_subtotal", amount: 7500 }],
    });
    const paid = option({ id: "paid" });

    const small = ok([freeTier, paid], 7499);
    expect(small.options.map((o) => o.id)).toEqual(["paid"]);

    const big = ok([freeTier, paid], 7500);
    expect(big.options.map((o) => o.id)).toEqual(["free", "paid"]);
  });
});

describe("selectShippingOptions — honest pricing gate", () => {
  it("drops calculated options: no quotable amount may be shown", () => {
    const result = ok([
      option({ id: "calc", priceType: "calculated", amount: 0, calculatedAmount: undefined }),
      option({ id: "flat" }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.options.map((o) => o.id)).toEqual(["flat"]);
  });

  it("drops unknown priceType values rather than guessing", () => {
    const result = ok([option({ priceType: "mystery" }), option({ id: "flat" })]);
    expect(result.options.map((o) => o.id)).toEqual(["flat"]);
  });

  it("drops options with no usable amount", () => {
    expect(
      ok([option({ amount: undefined })]).status,
    ).toBe("no-options");
    expect(
      ok([option({ amount: Number.NaN })]).status,
    ).toBe("no-options");
    expect(ok([option({ amount: -1 })]).status).toBe("no-options");
  });

  it("drops options without a usable name and trims/caps real names", () => {
    const result = ok([
      option({ id: "noname", name: "   " }),
      option({ id: "long", name: "x".repeat(300) }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.options[0].name).toHaveLength(120);
  });
});
describe("selectShippingOptions â€” market gates", () => {
  it("withholds everything when the cart currency is not the store market", () => {
    const result = selectShippingOptions({
      options: [option()],
      subtotalCents: 10000,
      currencyCode: "EUR",
      countryCode: "us",
    });
    expect(result).toEqual({ status: "unsupported-currency", options: [] });
  });

  it("accepts the market currency case-insensitively", () => {
    const result = selectShippingOptions({
      options: [option()],
      subtotalCents: 10000,
      currencyCode: "usd",
      countryCode: "us",
    });
    expect(result.status).toBe("ok");
  });

  it("withholds everything outside the single declared market", () => {
    const result = selectShippingOptions({
      options: [option()],
      subtotalCents: 10000,
      currencyCode: "USD",
      countryCode: "ca",
    });
    expect(result).toEqual({ status: "unsupported-destination", options: [] });
  });

  it("does not close the door when the destination is simply unknown", () => {
    const result = selectShippingOptions({
      options: [option()],
      subtotalCents: 10000,
      currencyCode: "USD",
      countryCode: null,
    });
    expect(result.status).toBe("ok");
  });
});

describe("selectShippingOptions â€” subtotal thresholds", () => {
  const freeWithMin = () =>
    option({
      id: "free",
      amount: 0,
      priceType: "free",
      shippingOptionRequirements: [{ type: "min_subtotal", amount: 5000 }],
    });

  it("hides the free tier from a cart below its min_subtotal", () => {
    const result = ok([freeWithMin()], 4999);
    expect(result.status).toBe("no-options");
  });

  it("shows the free tier exactly at the min_subtotal boundary", () => {
    const result = ok([freeWithMin()], 5000);
    expect(result.status).toBe("ok");
    expect(result.options[0].id).toBe("free");
  });

  it("applies max_subtotal against carts above the band", () => {
    const result = ok(
      [option({ shippingOptionRequirements: [{ type: "max_subtotal", amount: 20000 }] })],
      20001,
    );
    expect(result.status).toBe("no-options");
  });

  it("keeps the option exactly at the max_subtotal boundary", () => {
    const result = ok(
      [option({ shippingOptionRequirements: [{ type: "max_subtotal", amount: 20000 }] })],
      20000,
    );
    expect(result.status).toBe("ok");
  });

  it("applies every requirement, not just the first", () => {
    const result = ok(
      [
        option({
          shippingOptionRequirements: [
            { type: "min_subtotal", amount: 5000 },
            { type: "max_subtotal", amount: 9000 },
          ],
        }),
      ],
      9500,
    );
    expect(result.status).toBe("no-options");
  });

  it("skips thresholds rather than blocking when no subtotal is available", () => {
    const result = ok([freeWithMin()], null);
    expect(result.status).toBe("ok");
  });
});

describe("selectShippingOptions â€” malformed input tolerance", () => {
  it("returns no-options for a non-array payload instead of throwing", () => {
    expect(
      selectShippingOptions({
        options: null as unknown as ShippingOptionInput[],
        subtotalCents: 10000,
      }).status,
    ).toBe("no-options");
  });

  it("drops individual bad rows and keeps the good ones", () => {
    const result = ok([
      null,
      {},
      option({ id: "" }),
      option({ id: "keep-me" }),
    ] as unknown as ShippingOptionInput[]);
    expect(result.status).toBe("ok");
    expect(result.options.map((o) => o.id)).toEqual(["keep-me"]);
  });

  it("reports no-options when every row is unusable", () => {
    expect(ok([null, {}] as unknown as ShippingOptionInput[]).status).toBe(
      "no-options",
    );
  });
});

describe("selectShippingOptions â€” market wiring", () => {
  it("reads the declared market from the brand site config", () => {
    // If the market ever changes, these gates must change with it â€” this pin
    // makes that coupling visible instead of accidental.
    expect(site.market).toEqual({ countryCode: "us", currency: "USD" });
  });
});

