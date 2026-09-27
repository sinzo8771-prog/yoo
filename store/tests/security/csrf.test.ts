/**
 * Task 18 — explicit CSRF gate for server-action POSTs.
 *
 * Pins the middleware contract: non-actions and non-POSTs pass untouched,
 * same-origin actions pass (including behind a proxy via `x-forwarded-host`),
 * and cross-site, mismatched, origin-less, or opaque-origin action POSTs fail
 * closed.
 */
import { describe, expect, it } from "vitest";

import { TRUSTED_FETCH_SITES, isTrustedActionRequest } from "@/lib/security/csrf";

const action = {
  method: "POST",
  nextAction: "1",
  origin: "https://shop.example.com",
  host: "shop.example.com",
  secFetchSite: "same-origin",
};

describe("isTrustedActionRequest", () => {
  it("lets GETs and non-action POSTs through", () => {
    expect(isTrustedActionRequest({ method: "GET", origin: "https://evil.example" })).toBe(true);
    expect(isTrustedActionRequest({ method: "POST", origin: "https://evil.example" })).toBe(true);
    expect(isTrustedActionRequest({ method: "HEAD", secFetchSite: "cross-site" })).toBe(true);
  });

  it("accepts a same-origin action POST", () => {
    expect(isTrustedActionRequest(action)).toBe(true);
    expect(TRUSTED_FETCH_SITES).toContain("same-origin");
  });

  it("accepts a matching x-forwarded-host behind a proxy", () => {
    expect(
      isTrustedActionRequest({
        method: "POST",
        nextAction: "1",
        origin: "https://shop.example.com",
        host: "10.0.0.7:3000",
        forwardedHost: "shop.example.com",
        secFetchSite: "same-origin",
      })
    ).toBe(true);
  });

  it("refuses cross-site and same-site fetch metadata", () => {
    expect(isTrustedActionRequest({ ...action, secFetchSite: "cross-site" })).toBe(false);
    expect(isTrustedActionRequest({ ...action, secFetchSite: "same-site" })).toBe(false);
  });

  it("refuses mismatched, opaque, and non-http(s) origins", () => {
    expect(isTrustedActionRequest({ ...action, origin: "https://evil.example" })).toBe(false);
    expect(isTrustedActionRequest({ ...action, origin: "null" })).toBe(false);
    expect(isTrustedActionRequest({ ...action, origin: "chrome-extension://abcdef" })).toBe(false);
    expect(isTrustedActionRequest({ ...action, origin: "not a url" })).toBe(false);
  });

  it("fails closed when no trustworthy signal is present", () => {
    expect(
      isTrustedActionRequest({ method: "POST", nextAction: "1", host: "shop.example.com" })
    ).toBe(false);
  });

  it("fails closed when the request host is unknown", () => {
    expect(
      isTrustedActionRequest({
        method: "POST",
        nextAction: "1",
        origin: "https://shop.example.com",
      })
    ).toBe(false);
  });

  it("compares hosts case-insensitively and trims forwarded lists", () => {
    expect(isTrustedActionRequest({ ...action, host: "SHOP.example.com " })).toBe(true);
    expect(
      isTrustedActionRequest({
        method: "POST",
        nextAction: "1",
        origin: "https://shop.example.com",
        host: "internal",
        forwardedHost: "shop.example.com, internal",
      })
    ).toBe(true);
  });
});
