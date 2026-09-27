"use server"
import { gql } from "graphql-request"
import { openfrontClient } from "../config"
import { getAuthHeaders } from "./cookies"
import { cache } from "react"
import { withLogging } from "@/lib/observability/logger"

export const getCartShippingOptions = cache(async function (cartId: string) {
  const GET_SHIPPING_OPTIONS = gql`
    query GetShippingOptions($cartId: ID!) {
      activeCartShippingOptions(cartId: $cartId) {
        id
        name
        amount
        calculatedAmount
        isTaxInclusive
        priceType
        data
      }
    }
  `;

  // Task 17, Step 2 — checkout-critical read: one structured line with the
  // cart correlation and duration, sanitized by the shared logger.
  return withLogging(
    { operation: "cart.shippingOptions", correlation: { cartId } },
    async () => {
      const { activeCartShippingOptions } = await openfrontClient.request(
        GET_SHIPPING_OPTIONS,
        { cartId },
        await getAuthHeaders()
      );
      return activeCartShippingOptions;
    }
  );
});
