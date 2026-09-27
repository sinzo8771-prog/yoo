/**
 * Task 18 — security response headers.
 *
 * Pins the header set, that applying it overwrites a weaker upstream value, and
 * the two deliberate omissions (no CSP yet without a nonce; no disabling of the
 * Payment Request API, which would break wallets).
 */
import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS, applySecurityHeaders } from "@/lib/security/headers";

describe("SECURITY_HEADERS", () => {
  it("sets the mandated headers", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(SECURITY_HEADERS["X-Permitted-Cross-Domain-Policies"]).toBe("none");
  });

  it("does not disable the Payment Request API", () => {
    expect(SECURITY_HEADERS["Permissions-Policy"]).not.toContain("payment");
  });

  it("omits CSP and HSTS preload on purpose", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBeUndefined();
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).not.toContain("preload");
  });
});

describe("applySecurityHeaders", () => {
  it("adds every header to a response", () => {
    const headers = new Headers();
    applySecurityHeaders(headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers.get(name), name).toBe(value);
    }
  });

  it("overwrites a weaker upstream value", () => {
    const headers = new Headers();
    headers.set("X-Frame-Options", "ALLOWALL");
    headers.set("X-Content-Type-Options", "sniff");
    applySecurityHeaders(headers);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
