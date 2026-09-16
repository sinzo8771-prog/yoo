"use server"
import { gql } from "graphql-request"
import { openfrontClient } from "../config"
import { getAuthHeaders } from "./cookies"
import { cache } from "react"

/**
 * Task 8 — account and customer order lookup.
 *
 * Safe order lookup contract:
 *  - Order IDs are validated client-side before any backend call, so garbage
 *    or traversal-style input never reaches Openfront.
 *  - Authorization (session ownership or guest `secretKey`) is enforced by the
 *    backend `getCustomerOrder` mutation; the store never re-implements it,
 *    it just translates backend rejections into `null` (→ 404).
 *  - Whatever the backend returns is passed through a customer-safe whitelist
 *    projection before it reaches the UI / RSC payload. Internal-only fields
 *    (secretKey, paymentDetails, fulfillmentDetails, user record, raw payment
 *    gateway payloads) are stripped here so they are never serialized to the
 *    client.
 */

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isWellFormedOrderId(id: unknown): id is string {
  return typeof id === "string" && ORDER_ID_PATTERN.test(id)
}

type AnyRecord = Record<string, any>

function projectAddress(address: AnyRecord | null): AnyRecord | null {
  if (!address) return null
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    country: address.country
      ? { id: address.country.id, iso2: address.country.iso2, name: address.country.name }
      : null,
    phone: address.phone,
  }
}

function projectLineItem(item: AnyRecord): AnyRecord {
  return {
    id: item.id,
    quantity: item.quantity,
    title: item.title,
    sku: item.sku,
    thumbnail: item.thumbnail,
    variantTitle: item.variantTitle,
    formattedUnitPrice: item.formattedUnitPrice,
    formattedTotal: item.formattedTotal,
    productData: item.productData ?? null,
    variantData: item.variantData ?? null,
  }
}

function projectPayment(payment: AnyRecord): AnyRecord {
  return {
    id: payment.id,
    amount: payment.amount,
    status: payment.status,
    createdAt: payment.createdAt,
    // The raw gateway payload (`data`) is intentionally replaced with an empty
    // object: it can contain processor IDs and card details the customer UI
    // does not need (`payment-details.tsx` only probes it for a stripe last4,
    // and falls back gracefully when it is empty).
    data: {},
    paymentCollection: payment.paymentCollection
      ? {
          paymentSessions: (payment.paymentCollection.paymentSessions ?? []).map(
            (session: AnyRecord) => ({
              id: session.id,
              isSelected: session.isSelected,
              paymentProvider: session.paymentProvider
                ? { id: session.paymentProvider.id, code: session.paymentProvider.code }
                : null,
            })
          ),
        }
      : null,
  }
}

function projectCustomerOrder(order: AnyRecord | null): AnyRecord | null {
  if (!order) return null
  return {
    id: order.id,
    displayId: order.displayId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt,
    email: order.email,
    subtotal: order.subtotal,
    shipping: order.shipping,
    discount: order.discount,
    tax: order.tax,
    total: order.total,
    formattedTotalPaid: order.formattedTotalPaid,
    region: order.region
      ? {
          id: order.region.id,
          name: order.region.name,
          currency: order.region.currency
            ? { code: order.region.currency.code }
            : null,
        }
      : null,
    lineItems: (order.lineItems ?? []).map(projectLineItem),
    unfulfilled: order.unfulfilled ?? [],
    fulfillments: (order.fulfillments ?? []).map((fulfillment: AnyRecord) => ({
      id: fulfillment.id,
      createdAt: fulfillment.createdAt,
      canceledAt: fulfillment.canceledAt,
      fulfillmentItems: (fulfillment.fulfillmentItems ?? []).map((fi: AnyRecord) => ({
        id: fi.id,
        quantity: fi.quantity,
        lineItem: fi.lineItem ? projectLineItem(fi.lineItem) : null,
      })),
      shippingLabels: (fulfillment.shippingLabels ?? []).map((label: AnyRecord) => ({
        id: label.id,
        labelUrl: label.labelUrl,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        carrier: label.carrier,
      })),
    })),
    shippingAddress: projectAddress(order.shippingAddress),
    billingAddress: projectAddress(order.billingAddress),
    shippingMethods: (order.shippingMethods ?? []).map((method: AnyRecord) => ({
      id: method.id,
      price: method.price,
      shippingOption: method.shippingOption
        ? { name: method.shippingOption.name }
        : null,
    })),
    payments: (order.payments ?? []).map(projectPayment),
  }
}

function projectOrderSummary(order: AnyRecord | null): AnyRecord | null {
  if (!order) return null
  return {
    id: order.id,
    displayId: order.displayId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    total: order.total,
    formattedTotalPaid: order.formattedTotalPaid,
    createdAt: order.createdAt,
    region: order.region
      ? {
          id: order.region.id,
          currency: order.region.currency
            ? { code: order.region.currency.code }
            : null,
        }
      : null,
    lineItems: (order.lineItems ?? []).map((item: AnyRecord) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      thumbnail: item.thumbnail,
    })),
    shippingAddress: order.shippingAddress
      ? {
          country: order.shippingAddress.country
            ? { iso2: order.shippingAddress.country.iso2 }
            : null,
        }
      : null,
  }
}

export const retrieveOrder = cache(async function(id: string, secretKey?: string | null) {
  // Malformed IDs never reach the backend.
  if (!isWellFormedOrderId(id)) {
    return null
  }

  try {
    const query = gql`
      query GetCustomerOrder($id: ID!, $secretKey: String) {
        getCustomerOrder(orderId: $id, secretKey: $secretKey)
      }
    `;

    const { getCustomerOrder } = await openfrontClient.request(
      query,
      { id, secretKey: secretKey ?? null },
      await getAuthHeaders()
    );

    return projectCustomerOrder(getCustomerOrder);
  } catch (error) {
    // Backend enforces auth boundaries (wrong customer, bad secretKey,
    // unauthenticated) — every rejection becomes a 404 at the page level.
    console.error("Error retrieving order:", error);
    return null;
  }
});

export const listCustomerOrders = cache(async function(limit: number = 10, offset: number = 0) {
  try {
    const { getCustomerOrders } = await openfrontClient.request(
      gql`
        query GetCustomerOrders($limit: Int, $offset: Int) {
          getCustomerOrders(limit: $limit, offset: $offset)
        }
      `,
      { limit, offset },
      await getAuthHeaders()
    );

    return (getCustomerOrders ?? []).map(projectOrderSummary);
  } catch (error) {
    console.error("Error listing orders:", error);
    return null;
  }
});

// Placeholder function for accepting order transfer
export async function acceptTransferRequest(id: string, token: string): Promise<{ success: boolean; error: string | null }> {
  console.warn(`Placeholder: acceptTransferRequest called for order ${id} with token ${token}. Implement GraphQL mutation.`);
  await new Promise(resolve => setTimeout(resolve, 500));
  return { success: true, error: null };
}

// Placeholder function for declining order transfer
export async function declineTransferRequest(id: string, token: string): Promise<{ success: boolean; error: string | null }> {
  console.warn(`Placeholder: declineTransferRequest called for order ${id} with token ${token}. Implement GraphQL mutation.`);
  await new Promise(resolve => setTimeout(resolve, 500));
  return { success: true, error: null };
}

// Placeholder function for creating order transfer request
export async function createTransferRequest(
  prevState: { success: boolean; error: string | null; order?: { id: string; email: string } | null },
  formData: FormData
): Promise<{ success: boolean; error: string | null; order?: { id: string; email: string } | null }> {
  const orderId = formData.get("orderId") as string;
  const email = formData.get("email") as string;

  console.warn(`Placeholder: createTransferRequest called for order ${orderId} with email ${email}. Implement GraphQL mutation.`);

  if (!orderId || !email) {
    return { success: false, error: "Order ID and Email are required.", order: null };
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  return { success: true, error: null, order: { id: orderId, email: email } };
}
