/**
 * Task 16, Steps 2–3 — integration tests against Openfront's REAL
 * `handlePaymentProviderWebhook` mutation (vendored in this repo), which is
 * where payment webhook ingress terminates (`app/api/payment-webhooks/[providerId]`
 * → this mutation). Pinned behaviours:
 *
 *  Step 2 — provider verification runs BEFORE any persistence: an unverifiable
 *  event can never create idempotency rows, captures, or payment updates, and
 *  a tampered amount is rejected even with a valid adapter response.
 *  Step 3 — delivery is deduplicated on `provider-webhook:{providerId}:{eventId}`
 *  via the IdempotencyKey table: a redelivered event is acknowledged without
 *  advancing state a second time; a missing event id is refused outright; an
 *  in-flight lock blocks concurrent processing.
 *
 * The mutation specifier is assembled from parts ON PURPOSE: the store's tsc
 * program must not follow it into vendored sources (they carry pre-existing
 * implicit-any debt tracked in docs/architecture/current-state.md), while
 * vitest still executes the real file at runtime.
 *
 * Task 23 (CI follow-up): that vendored file lives in `../openfront/`, one of
 * the gitignored reference clones, so the import is skipped (with a reason) when
 * the clone is not checked out instead of failing on an unresolved specifier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

const clone: ReferenceClone = "openfront";
const cloneMissing = referenceCloneMissing(clone);
noteMissingReferenceClone(clone);
const MUTATION_SPEC = [
  "../../../../openfront/features/keystone/mutations/",
  "handlePaymentProviderWebhook.ts",
].join("");

type WebhookResult = { success: boolean; message: string };
type Mutation = (
  root: unknown,
  args: { providerId: string; event: unknown; headers: Record<string, unknown> },
  context: unknown
) => Promise<WebhookResult>;

let handlePaymentProviderWebhook: Mutation;

async function loadPinnedMutation() {
  if (handlePaymentProviderWebhook !== undefined) return;
  const mod = await import(MUTATION_SPEC);
  handlePaymentProviderWebhook = mod.default;
}

type Harness = {
  context: any;
  idempotency: Map<string, any>;
  captures: any[];
  paymentUpdates: any[];
  orderEvents: any[];
  prisma: any;
};

function makeHarness(options?: { handleWebhookFunction?: string }): Harness {
  const idempotency = new Map<string, any>();
  const captures: any[] = [];
  const paymentUpdates: any[] = [];
  const orderEvents: any[] = [];
  let seq = 0;

  const prisma: any = {
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: any) => idempotency.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (idempotency.has(data.idempotencyKey)) {
          throw new Error("Unique constraint failed on idempotencyKey");
        }
        const row = { id: `ik_${++seq}`, lockedAt: null as Date | null, ...data };
        idempotency.set(data.idempotencyKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = where.idempotencyKey
          ? idempotency.get(where.idempotencyKey)
          : [...idempotency.values()].find((r) => r.id === where.id);
        if (!row) throw new Error("idempotencyKey not found");
        Object.assign(row, data);
        return row;
      }),
      // Mirrors the mutation's lock acquisition: a held lock (fresh lockedAt)
      // returns count 0, which the mutation turns into a hard rejection.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = [...idempotency.values()].find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        const lockedAt = row.lockedAt ? new Date(row.lockedAt).getTime() : null;
        const held = lockedAt !== null && Date.now() - lockedAt < 5 * 60 * 1000;
        if (held) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    payment: {
      findUnique: vi.fn(async () => ({ amount: 2500, currencyCode: "USD" })),
      update: vi.fn(async ({ data }: any) => {
        paymentUpdates.push(data);
        return data;
      }),
    },
    capture: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        captures.push(data);
        return data;
      }),
    },
    order: {
      findUnique: vi.fn(async () => ({
        status: "pending",
        lineItems: [],
        fulfillments: [],
      })),
      update: vi.fn(async () => ({})),
    },
    orderEvent: {
      create: vi.fn(async ({ data }: any) => {
        orderEvents.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  const provider = {
    id: "prov_1",
    code: "pp_stripe_stripe",
    isInstalled: true,
    handleWebhookFunction: options?.handleWebhookFunction ?? "https://adapter.test/webhook",
    credentials: {},
  };

  const sudo = {
    query: {
      PaymentProvider: { findOne: vi.fn(async () => provider) },
      Cart: {
        findOne: vi.fn(async () => {
          throw new Error(
            "Cart lookup must not run when the event carries payment/order metadata"
          );
        }),
      },
    },
    prisma,
  };

  return {
    context: { sudo: () => sudo },
    idempotency,
    captures,
    paymentUpdates,
    orderEvents,
    prisma,
  };
}

/** Stub the http-adapter dispatch: executeAdapterFunction POSTs and json()s. */
function stubAdapterFetch(payloadFactory: () => unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payloadFactory(),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const goodEvent = () => ({
  isValid: true,
  type: "payment_intent.succeeded",
  resource: {
    id: "pi_1",
    amount: 2500,
    currency: "usd",
    metadata: { paymentId: "pay_1", orderId: "order_1" },
  },
  event: { id: "evt_dup_1" },
});

const callArgs = (event: unknown) => ({
  providerId: "prov_1",
  event,
  headers: {},
});


describe.skipIf(cloneMissing)("duplicate provider events (Task 16, Step 3)", () => {
  beforeEach(async () => {
    await loadPinnedMutation();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("processes a verified capture once and acknowledges the redelivery", async () => {
    const h = makeHarness();
    const fetchMock = stubAdapterFetch(goodEvent);

    const first = await handlePaymentProviderWebhook(
      null,
      callArgs({ id: "client_evt_1" }),
      h.context
    );
    expect(first).toEqual({ success: true, message: "Provider event reconciled" });
    expect(h.captures).toHaveLength(1);
    expect(h.paymentUpdates).toHaveLength(1);
    expect(h.paymentUpdates[0]).toMatchObject({ status: "captured" });
    expect(h.orderEvents.filter((e) => e.type === "PAYMENT_CAPTURED")).toHaveLength(1);
    expect(h.idempotency.get("provider-webhook:prov_1:evt_dup_1")).toMatchObject({
      recoveryPoint: "completed",
    });

    // Redelivery of the SAME provider event id.
    const second = await handlePaymentProviderWebhook(
      null,
      callArgs({ id: "client_evt_1" }),
      h.context
    );
    expect(second).toEqual({ success: true, message: "Duplicate event acknowledged" });

    // Nothing advanced on the second delivery — asserted via call counts, not
    // just the message string.
    expect(h.prisma.capture.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.payment.update).toHaveBeenCalledTimes(1);
    expect(h.orderEvents.filter((e) => e.type === "PAYMENT_CAPTURED")).toHaveLength(1);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);

    // Verification itself is NOT skipped on redelivery (auth runs every time).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses an event with no provider event id before touching persistence", async () => {
    const h = makeHarness();
    stubAdapterFetch(() => ({
      isValid: true,
      type: "payment_intent.succeeded",
      resource: {
        amount: 2500,
        currency: "usd",
        metadata: { paymentId: "pay_1", orderId: "order_1" },
      },
      event: {}, // no id anywhere: verified.event?.id || event?.id || resource.id
    }));

    await expect(
      handlePaymentProviderWebhook(null, callArgs({ data: {} }), h.context)
    ).rejects.toThrow("Provider event ID is required");

    expect(h.idempotency.size).toBe(0);
    expect(h.prisma.idempotencyKey.create).not.toHaveBeenCalled();
    expect(h.captures).toHaveLength(0);
  });

  it("rejects a delivery that arrives while an earlier one is in flight", async () => {
    const h = makeHarness();
    stubAdapterFetch(() => ({
      ...goodEvent(),
      event: { id: "evt_inflight" },
    }));
    h.idempotency.set("provider-webhook:prov_1:evt_inflight", {
      id: "ik_inflight",
      idempotencyKey: "provider-webhook:prov_1:evt_inflight",
      recoveryPoint: "payment_confirmed",
      lockedAt: new Date(), // fresh lock — another worker holds it
    });

    await expect(
      handlePaymentProviderWebhook(null, callArgs({ id: "c" }), h.context)
    ).rejects.toThrow("Event is already being processed");

    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.captures).toHaveLength(0);
  });
});

describe.skipIf(cloneMissing)("webhook authentication (Task 16, Step 2)", () => {
  beforeEach(async () => {
    await loadPinnedMutation();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("rejects an unverifiable event and persists nothing at all", async () => {
    const h = makeHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Bad Signature",
        json: async () => ({}),
      }))
    );

    await expect(
      handlePaymentProviderWebhook(null, callArgs({ id: "evt_forged" }), h.context)
    ).rejects.toThrow("HTTP request failed: Bad Signature");

    // Verification precedes dedupe and state: nothing may exist afterwards.
    expect(h.idempotency.size).toBe(0);
    expect(h.prisma.idempotencyKey.create).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.captures).toHaveLength(0);
    expect(h.paymentUpdates).toHaveLength(0);
  });

  it("rejects a tampered amount even when the adapter response otherwise looks valid", async () => {
    const h = makeHarness();
    stubAdapterFetch(() => ({
      ...goodEvent(),
      resource: {
        id: "pi_1",
        amount: 1, // lies: the payment on file is 2500
        currency: "usd",
        metadata: { paymentId: "pay_1", orderId: "order_1" },
      },
      event: { id: "evt_amt_1" },
    }));

    await expect(
      handlePaymentProviderWebhook(null, callArgs({ id: "c" }), h.context)
    ).rejects.toThrow("Provider webhook amount or currency mismatch");

    expect(h.paymentUpdates).toHaveLength(0);
    expect(h.captures).toHaveLength(0);
    // The dedupe row stays un-completed: a corrected retry may still process.
    expect(h.idempotency.get("provider-webhook:prov_1:evt_amt_1")).toMatchObject({
      recoveryPoint: "verified",
    });
  });

  it("cannot receive ingress for the manual provider at all (real vendored adapter)", async () => {
    const h = makeHarness({ handleWebhookFunction: "manual" });

    await expect(
      handlePaymentProviderWebhook(null, callArgs({ id: "evt_m" }), h.context)
    ).rejects.toThrow("Manual payment providers do not accept webhook ingress");

    expect(h.idempotency.size).toBe(0);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
