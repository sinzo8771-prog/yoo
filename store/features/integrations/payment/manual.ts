export async function handleWebhookFunction({ event, headers }) {
  // Task 16, Step 2 — the manual (cash-on-delivery) provider has NO webhook
  // channel: there is no provider signature to verify, so no payload can be
  // authenticated. The previous stub answered `isValid: true` for whatever it
  // was handed — that would have accepted a forged event as verified and let
  // it advance payment state. Openfront's runtime adapter throws for exactly
  // this reason (see openfront/features/integrations/payment/manual.ts:
  // "Manual payment providers do not accept webhook ingress"), so this copy
  // now behaves identically: the ingress rejects, nothing is persisted, and
  // COD state can only change through explicit storefront/operator actions.
  throw new Error("Manual payment providers do not accept webhook ingress");
}

export async function createPaymentFunction({ cart, amount, currency }) {
  // For Cash on Delivery payments, we just need to return a success status
  return {
    status: 'pending',
    data: {
      status: 'pending',
      amount,
      currency: currency.toLowerCase(),
    }
  };
}

export async function capturePaymentFunction({ paymentId, amount }) {
  // Cash on Delivery payments are considered captured immediately
  return {
    status: 'captured',
    amount,
    data: {
      status: 'captured',
      amount,
      captured_at: new Date().toISOString(),
    }
  };
}

export async function refundPaymentFunction({ paymentId, amount }) {
  // Cash on Delivery refunds need to be tracked manually
  return {
    status: 'refunded',
    amount,
    data: {
      status: 'refunded',
      amount,
      refunded_at: new Date().toISOString(),
    }
  };
}

export async function getPaymentStatusFunction({ paymentId }) {
  // Cash on Delivery payments are always considered successful unless manually marked otherwise
  return {
    status: 'succeeded',
    data: {
      status: 'succeeded',
    }
  };
}

export async function generatePaymentLinkFunction({ paymentId }) {
  // Cash on Delivery payments don't have external links
  return null;
}

// ... existing code ...
