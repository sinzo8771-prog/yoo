/**
 * Task 9 — checkout failure signal.
 *
 * `placeOrder` lives in a `"use server"` module, and Next.js only allows
 * async-function exports there — so this error class must live in a plain
 * (non-"use server") module. The action converts this internal signal to a
 * serializable failure result so production Next.js preserves the safe message.
 *
 * Semantics: thrown only when checkout genuinely cannot proceed (missing or
 * empty cart, backend rejection, unconfirmed payment, unusable redirect).
 * The message is always safe to show to the customer. Never fabricated as
 * success — an order id either exists (or must be told about honestly).
 */
export class CheckoutUnavailableError extends Error {
  /**
   * Sanitized machine-readable class for structured logs (Task 17, Step 2).
   * Set at throw sites from a closed vocabulary — the raw backend string may
   * embed provider/session internals and must never be logged directly.
   */
  errorClass?: string;

  constructor(message: string, errorClass?: string) {
    super(message);
    this.name = "CheckoutUnavailableError";
    this.errorClass = errorClass;
  }
}
