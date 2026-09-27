import Addresses from "@/features/storefront/modules/checkout/components/addresses";
import Shipping from "@/features/storefront/modules/checkout/components/shipping";
import Payment from "@/features/storefront/modules/checkout/components/payment";
import Review from "@/features/storefront/modules/checkout/components/review";
import { listCartPaymentMethods } from "@/features/storefront/lib/data/payment";
import { getCartShippingOptions } from "@/features/storefront/lib/data/shipping";
import { selectShippingOptions } from "@/lib/shipping/pricing";
import { selectPaymentMethods } from "@/lib/payment/methods";

interface CheckoutFormProps {
  cart: {
    id: string;
    /** Minor-unit subtotal (integer cents for USD) — matches option/requirement amounts. */
    subtotal?: number;
    region: {
      id: string;
      currency?: { code?: string | null } | null;
    };
    total: number;
    shippingMethods: any[];
    paymentCollection?: {
      paymentSessions?: Array<{
        isSelected: boolean;
        status?: string;
        paymentProvider: {
          code: string;
        };
      }>;
    };
    giftCards?: any[];
    /** Untyped pass-through for legacy consumers (Addresses/Review). */
    shippingAddress: any;
    billingAddress: any;
    email: string;
    shipping: string;
  };
  customer: any;
}

export default async function CheckoutForm({ cart, customer }: CheckoutFormProps) {
  if (!cart) {
    return null;
  }

  // get available shipping methods and payment methods
  const availableShippingMethods = await getCartShippingOptions(cart.id);
  const availablePaymentMethods = await listCartPaymentMethods(cart.region.id);

  if (!availableShippingMethods || !availablePaymentMethods) {
    return null;
  }

  // Task 15, Step 1 — apply the v1 shipping-pricing strategy before anything
  // is shown: single market/currency, no unquoted `calculated` prices, and
  // min/max subtotal requirements actually enforced against the cart
  // (Openfront returns requirements but does not apply them itself).
  const selection = selectShippingOptions({
    options: availableShippingMethods,
    subtotalCents: typeof cart.subtotal === "number" ? cart.subtotal : null,
    currencyCode: cart.region?.currency?.code ?? null,
    countryCode: cart.shippingAddress?.country?.iso2 ?? null,
  });
  const selectableShippingOptions = selection.options;

  // Task 16, Step 1 — only payment integrations supported by the target
  // market and actually configured in this deployment are offered (unknown
  // codes, wrong currency, missing public keys, and the manual/COD test
  // scaffold in production are all removed before render, with reasons).
  // The explicit shape argument keeps the filtered list assignable to
  // <Payment>'s `Array<{ id: string; code: string }>` prop.
  const paymentSelection = selectPaymentMethods<{ id: string; code: string }>(
    availablePaymentMethods,
    { currencyCode: cart.region?.currency?.code ?? null }
  );

  return (
    <div>
      <div className="w-full grid grid-cols-1 gap-y-8">
        <div>
          <Addresses cart={cart} customer={customer} />
        </div>

        <div>
          <Shipping cart={cart} availableShippingMethods={selectableShippingOptions} />
        </div>

        <div>
          <Payment cart={cart} availablePaymentMethods={paymentSelection.methods} />
        </div>

        <div>
          <Review cart={cart} />
        </div>
      </div>
    </div>
  );
}
