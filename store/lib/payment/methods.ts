import { site } from "@/lib/brand/site";
import { isManual, isPaypal, isStripe } from "@/features/storefront/lib/constants";

/**
 * Task 16, Step 1 — payment-method selection for the target market.
 *
 * Openfront's `activeCartPaymentProviders` returns whatever providers are
 * installed for the region; this module decides what the storefront is allowed
 * to OFFER, on the server, before anything renders. Rules — all evidence-based:
 *
 *  - Closed allowlist: only the provider codes this repo carries adapters for
 *    (`pp_stripe_*`, `pp_paypal*`, `pp_system_default`) are ever shown. An
 *    unknown code would currently leak as a raw id in the UI fallback
 *    (`paymentInfoMap[code]?.title || code`), so unknowns are hidden instead.
 *  - Market gate: the store launches as a single market (`site.market` =
 *    US/USD, pinned in `lib/brand/site.ts`). A cart whose region currency is
 *    anything else gets no methods — v1 has no cross-currency pricing to show.
 *  - Configured gate: the storefront can only render Stripe/PayPal UI with the
 *    public keys it actually holds (`NEXT_PUBLIC_STRIPE_KEY`,
 *    `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — the secret half lives in the Openfront
 *    backend, see store/.env.example). Unconfigured ⇒ hidden, never rendered
 *    as a method that then fails at submit time.
 *  - `pp_system_default` (manual / cash-on-delivery) is the development
 *    scaffold: the checkout UI itself badges it as test-only and the button
 *    component is literally `ManualTestPaymentButton`, and Openfront refuses
 *    to settle it (`Manual tender cannot complete storefront checkout`). It is
 *    therefore excluded in production and available everywhere else for local
 *    flows.
 *
 * Provider-specific logic itself stays behind Openfront's payment boundary
 * (`features/integrations/payment/*` adapters) — this module only filters the
 * provider list; it never talks to a gateway.
 *
 * Reason codes are a closed set so tests and operators share one vocabulary.
 */

export type PaymentMethodHiddenReason =
  | "unknown_provider"
  | "not_installed"
  | "unsupported_currency"
  | "not_configured"
  | "test_mode_only";

export type StorefrontPaymentProvider = {
  id: string;
  name?: string | null;
  code?: string | null;
  isInstalled?: boolean | null;
};

/** The public, client-safe payment env this deployment actually has. */
export type PaymentMethodEnv = {
  NEXT_PUBLIC_STRIPE_KEY?: string | null;
  NEXT_PUBLIC_PAYPAL_CLIENT_ID?: string | null;
};

export type PaymentMethodSelection<T extends StorefrontPaymentProvider> = {
  /** Providers safe to render, in the order Openfront returned them. */
  methods: T[];
  /** Every provider removed, with why — for tests, logs, and operator docs. */
  hidden: Array<{ code: string; reason: PaymentMethodHiddenReason }>;
};

export function selectPaymentMethods<T extends StorefrontPaymentProvider>(
  providers: readonly T[],
  options?: {
    /**
     * The cart's region currency. Falsy ⇒ treated as the market currency
     * (the middleware pins single-market regions, and completion re-verifies
     * currency server-side before any order is created).
     */
    currencyCode?: string | null;
    env?: PaymentMethodEnv;
    nodeEnv?: string;
  }
): PaymentMethodSelection<T> {
  const env = options?.env ?? (process.env as PaymentMethodEnv);
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const marketCurrency = site.market.currency.toUpperCase();
  const currency = (options?.currencyCode || site.market.currency).toUpperCase();

  const methods: T[] = [];
  const hidden: Array<{ code: string; reason: PaymentMethodHiddenReason }> = [];

  for (const provider of providers ?? []) {
    const code = provider.code ?? "";
    // Label for diagnostics only — never rendered (see unknown_provider rule).
    const label = String(code || provider.id);

    // Gate order is deliberate and pinned by tests: identity first (we must
    // know what the provider is before any other judgement applies), then
    // installation, market currency, configuration, production exclusion.
    if (!isStripe(code) && !isPaypal(code) && !isManual(code)) {
      hidden.push({ code: label, reason: "unknown_provider" });
      continue;
    }
    if (provider.isInstalled === false) {
      hidden.push({ code: label, reason: "not_installed" });
      continue;
    }
    if (currency !== marketCurrency) {
      hidden.push({ code: label, reason: "unsupported_currency" });
      continue;
    }
    const configured = isStripe(code)
      ? Boolean(env.NEXT_PUBLIC_STRIPE_KEY)
      : isPaypal(code)
        ? Boolean(env.NEXT_PUBLIC_PAYPAL_CLIENT_ID)
        : true; // manual needs no gateway credentials
    if (!configured) {
      hidden.push({ code: label, reason: "not_configured" });
      continue;
    }
    if (isManual(code) && nodeEnv === "production") {
      hidden.push({ code: label, reason: "test_mode_only" });
      continue;
    }
    methods.push(provider);
  }

  return { methods, hidden };
}
