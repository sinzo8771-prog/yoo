## Task 9 validation status

Checkout handoff implementation is ready for test-payment integration:
- Signed cart proof/session headers are forwarded for completion and shipping options.
- Cart contents and currency are re-read before completion.
- Confirmation paths are built from validated fields and checked before navigation.
- Expected errors cross the Next.js server-action boundary as safe failure results.
- Unknown payment/order outcomes never claim that no charge occurred.

Validation on 2026-09-17:
- Full storefront suite: 128 tests passed; focused checkout/cart suite: 39 passed.
- Production build: exit 0. This does not imply a clean TypeScript baseline.
- Local checkout e2e: signed checkout 200, anonymous 404, unsigned and invalid-payment
  completion rejected, line item retained, retry returns the same rejection.
- The development backend masks public GraphQL errors; exact gate checks use
  `extensions.originalError.message` when provided. Masking is not disabled.

**Task 9 Step 5 remains partial:** no settled test payment was available because
Stripe/PayPal test credentials were not configured. This script does not establish
exactly-once paid-order creation, inventory release, or browser payment interaction.
Configure a supported test gateway and verify a settled order plus retry before
marking that step complete. Never substitute production credentials for this test.

Run from the storefront directory: `npm test` and `npm run build`.
Start the local backend on port 3001 and built storefront on port 3000, then run
`node --experimental-strip-types scripts/verify-checkout-e2e.mjs` from repository root.
The verifier creates guest test carts and leaves them in the local database.
