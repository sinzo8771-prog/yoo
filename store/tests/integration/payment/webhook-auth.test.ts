/**
 * Task 16, Step 2 — webhook authentication at this repo's provider-adapter
 * boundary. Verification failures must THROW (that is the contract Openfront's
 * `handlePaymentProviderWebhook` relies on: `executeAdapterFunction` rethrows,
 * the HTTP ingress 500s, and no payment state is ever advanced) — never
 * return a payload claiming `isValid` for something unauthenticated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

import { handleWebhookFunction as manualWebhook } from "@/features/integrations/payment/manual";
import { handleWebhookFunction as stripeWebhook } from "@/features/integrations/payment/stripe";
import { handleWebhookFunction as paypalWebhook } from "@/features/integrations/payment/paypal";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manual adapter — no webhook channel exists", () => {
  it("rejects any payload, including one shaped like a verified event", async () => {
    // The pre-Task-16 stub answered { isValid: true } for literally anything.
    const forged = {
      event: { type: "payment_intent.succeeded", data: { object: { id: "pi_forged" } } },
      headers: {},
    };

    await expect(manualWebhook(forged)).rejects.toThrow(
      "Manual payment providers do not accept webhook ingress"
    );
  });
});

describe("stripe adapter — signature verification", () => {
  const secret = "whsec_test_0123456789abcdef";
  const event = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: 2500, currency: "usd" } },
  };
  const sign = (payload: string, key = secret) =>
    new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: key });

  it("fails closed when no webhook secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);

    await expect(
      stripeWebhook({ event, headers: { "stripe-signature": "whatever" } })
    ).rejects.toThrow("Stripe webhook secret is not configured");
  });

  it("accepts an event carrying a valid signature", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy"); // client construction
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify(event);

    const result = await stripeWebhook({
      event,
      headers: { "stripe-signature": sign(payload) },
    });

    expect(result).toMatchObject({
      isValid: true,
      type: "payment_intent.succeeded",
      resource: event.data.object,
    });
    expect(result.event.id).toBe("evt_1");
  });

  it("rejects a body that does not match the signature", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy"); // client construction
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    // Signed a different body — classic replay/tamper attempt.
    const foreignPayload = JSON.stringify({ id: "evt_other" });

    await expect(
      stripeWebhook({ event, headers: { "stripe-signature": sign(foreignPayload) } })
    ).rejects.toThrow("Webhook signature verification failed");
  });

  it("rejects a missing signature header", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy"); // client construction
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);

    await expect(stripeWebhook({ event, headers: {} })).rejects.toThrow(
      "Webhook signature verification failed"
    );
  });
});

describe("paypal adapter — verify-webhook-signature API", () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert.pem",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-09-19T00:00:00Z",
  };
  const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "cap_1" } };

  const stubFetch = (verificationStatus: string) => {
    const calls: Array<{ url: string; body?: any }> = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      // OAuth uses a form-encoded body; verification uses JSON.
      let body: any;
      try {
        body = init?.body ? JSON.parse(init.body) : undefined;
      } catch {
        body = undefined;
      }
      calls.push({ url: String(url), body });
      if (String(url).includes("/oauth2/token")) {
        return { json: async () => ({ access_token: "tok_1" }) };
      }
      if (String(url).includes("verify-webhook-signature")) {
        return { json: async () => ({ verification_status: verificationStatus }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  };

  it("fails closed when no webhook id is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID", "cid");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", undefined);

    await expect(paypalWebhook({ event, headers })).rejects.toThrow(
      "PayPal webhook ID is not configured"
    );
  });

  it("accepts only when PayPal's verification API answers SUCCESS", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID", "cid");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "wh-1");
    const calls = stubFetch("SUCCESS");

    const result = await paypalWebhook({ event, headers });

    expect(result).toMatchObject({
      isValid: true,
      type: "PAYMENT.CAPTURE.COMPLETED",
      resource: event.resource,
    });
    // The verification request must actually reach PayPal with our webhook id.
    const verifyCall = calls.find((c) => c.url.includes("verify-webhook-signature"));
    expect(verifyCall).toBeTruthy();
    expect(verifyCall!.body.webhook_id).toBe("wh-1");
    expect(verifyCall!.body.webhook_event).toEqual(event);
  });

  it("throws when PayPal reports the signature invalid", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID", "cid");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "wh-1");
    stubFetch("FAILURE");

    await expect(paypalWebhook({ event, headers })).rejects.toThrow(
      "Invalid webhook signature"
    );
  });
});
