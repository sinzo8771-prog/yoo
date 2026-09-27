/**
 * Task 18 — SSRF guard for operator-configurable provider URLs.
 *
 * Pins the allow/deny contract: https-only by default, no embedded credentials,
 * every loopback/private/link-local/CGNAT/reserved form refused (including the
 * IPv4 special notations the URL parser normalizes), single-label and
 * `.local`/`.internal` hosts refused, real provider hosts accepted, and the
 * local-development opt-in ignored under NODE_ENV=production.
 */
import { describe, expect, it } from "vitest";

import {
  ProviderUrlError,
  assertOutboundUrl,
  checkOutboundUrl,
  isPrivateHostname,
  normalizeHostname,
  providerUrlAllowPrivate,
  type UrlRejectionReason,
} from "@/lib/security/ssrf";

/** Reason for a refused URL, or "ok" when it was accepted. */
function reasonOf(value: unknown, options?: Parameters<typeof checkOutboundUrl>[1]): string {
  const result = checkOutboundUrl(value, options);
  return result.ok ? "ok" : result.reason;
}

describe("checkOutboundUrl", () => {
  it("accepts https provider hosts", () => {
    const result = checkOutboundUrl("https://developers.cjdropshipping.com/api2.0/v1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe("developers.cjdropshipping.com");
  });

  it("refuses anything that is not a usable string", () => {
    for (const value of [undefined, null, 42, {}, "", "   "]) {
      expect(reasonOf(value)).toBe("not_a_string");
    }
  });

  it("refuses non-https schemes", () => {
    expect(reasonOf("http://developers.cjdropshipping.com/x")).toBe("protocol_not_allowed");
    expect(reasonOf("ftp://example.com/x")).toBe("protocol_not_allowed");
    expect(reasonOf("file:///etc/passwd")).toBe("protocol_not_allowed");
  });

  it("refuses embedded credentials", () => {
    expect(reasonOf("https://user:pass@example.com/x")).toBe("embedded_credentials");
  });

  it("refuses loopback, private, link-local, CGNAT and reserved hosts", () => {
    const refused = [
      "https://localhost/x",
      "https://localhost./x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://172.16.0.1/x",
      "https://192.168.1.10/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://100.64.0.1/x",
      "https://198.18.0.1/x",
      "https://224.0.0.1/x",
      "https://[::1]/x",
      "https://[fd00::1]/x",
      "https://[fe80::1]/x",
      "https://[::ffff:127.0.0.1]/x",
    ];
    for (const url of refused) {
      expect(reasonOf(url), url).toBe("private_host");
    }
  });

  it("normalizes IPv4 special notations before the host check", () => {
    // These all denote 127.0.0.1 / 0.0.0.0 and are normalized by `new URL`.
    expect(reasonOf("https://2130706433/x")).toBe("private_host");
    expect(reasonOf("https://0177.0.0.1/x")).toBe("private_host");
    expect(reasonOf("https://0x7f.0.0.1/x")).toBe("private_host");
    expect(reasonOf("https://127.1/x")).toBe("private_host");
    expect(reasonOf("https://0/x")).toBe("private_host");
  });

  it("refuses internal suffixes and single-label hosts", () => {
    expect(reasonOf("https://api.internal/x")).toBe("private_host");
    expect(reasonOf("https://metadata.local/x")).toBe("private_host");
    expect(reasonOf("https://cjdropshipping")).toBe("single_label_host");
  });

  it("refuses oversized and unparseable URLs", () => {
    expect(reasonOf(`https://example.com/${"a".repeat(3000)}`)).toBe("too_long");
    expect(reasonOf("not a url")).toBe("invalid_url");
    expect(reasonOf("https://")).toBe("invalid_url");
  });

  it("allows private hosts only with the explicit development opt-in", () => {
    expect(reasonOf("http://localhost:3000/api", { allowPrivate: true })).toBe("ok");
    expect(reasonOf("http://stub.internal/api", { allowPrivate: true })).toBe("ok");
    expect(reasonOf("http://localhost:3000/api")).toBe("protocol_not_allowed");
  });

  it("throws ProviderUrlError with the reason from assertOutboundUrl", () => {
    expect(() => assertOutboundUrl("https://10.0.0.1/x")).toThrow(ProviderUrlError);
    try {
      assertOutboundUrl("https://10.0.0.1/x");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderUrlError);
      expect((error as ProviderUrlError).reason).toBe<UrlRejectionReason>("private_host");
    }
    expect(assertOutboundUrl("https://example.com/x").hostname).toBe("example.com");
  });
});

describe("hostname helpers", () => {
  it("normalizes brackets, case, and trailing dots", () => {
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname(" Example.COM. ")).toBe("example.com");
  });

  it("flags private hosts and clears public ones", () => {
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("example.com")).toBe(false);
  });
});

describe("providerUrlAllowPrivate", () => {
  it("requires the explicit opt-in", () => {
    expect(providerUrlAllowPrivate({})).toBe(false);
    expect(providerUrlAllowPrivate({ ALLOW_PRIVATE_PROVIDER_URLS: "true" })).toBe(true);
  });

  it("never allows private hosts in production", () => {
    expect(
      providerUrlAllowPrivate({
        ALLOW_PRIVATE_PROVIDER_URLS: "true",
        NODE_ENV: "production",
      })
    ).toBe(false);
  });
});
