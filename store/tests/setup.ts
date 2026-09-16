/**
 * Vitest global setup.
 *
 * Minting/verifying a cart proof requires a signing secret of at least 32
 * characters — the same contract the Openfront backend enforces. Tests set a
 * fixed throwaway value so the crypto is exercised for real rather than stubbed.
 */
process.env.SESSION_SECRET ??=
  "test-session-secret-0123456789abcdef0123456789";