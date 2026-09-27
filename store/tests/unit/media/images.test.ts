import { describe, expect, it } from "vitest";
import {
  ANY_PATHNAME,
  collectImageHosts,
  isOptimizableImageUrl,
  matchesImagePattern,
  parseImageHost,
  parseImageHostList,
  toRemotePatterns,
  type ImageRemotePattern,
} from "@/lib/media/images";

describe("parseImageHost (Task 20, Step 2)", () => {
  it("parses bare hostnames and defaults to https + all paths", () => {
    expect(parseImageHost("cdn.example.com")).toEqual({
      protocol: "https",
      hostname: "cdn.example.com",
      port: "",
      pathname: "/**",
    });
  });

  it("preserves explicit http scheme for local development", () => {
    expect(parseImageHost("http://localhost:3001")).toEqual({
      protocol: "http",
      hostname: "localhost",
      port: "3001",
      pathname: "/**",
    });
  });

  it("handles explicit ports with https", () => {
    expect(parseImageHost("https://cdn.example.com:8443")).toEqual({
      protocol: "https",
      hostname: "cdn.example.com",
      port: "8443",
      pathname: "/**",
    });
  });

  it("transforms pathname prefixes into glob patterns", () => {
    expect(parseImageHost("https://cdn.example.com/products/")).toEqual({
      protocol: "https",
      hostname: "cdn.example.com",
      port: "",
      pathname: "/products/**",
    });

    expect(parseImageHost("https://cdn.example.com/uploads")).toEqual({
      protocol: "https",
      hostname: "cdn.example.com",
      port: "",
      pathname: "/uploads/**",
    });
  });

  it("lowercases hostnames for case-insensitive matching", () => {
    expect(parseImageHost("https://CDN.Example.COM")).toEqual({
      protocol: "https",
      hostname: "cdn.example.com",
      port: "",
      pathname: "/**",
    });
  });

  it("rejects non-string or empty input", () => {
    expect(parseImageHost("")).toBeNull();
    expect(parseImageHost("   ")).toBeNull();
    expect(parseImageHost(null)).toBeNull();
    expect(parseImageHost(undefined)).toBeNull();
    expect(parseImageHost(123)).toBeNull();
  });

  it("rejects strings containing whitespace or wildcard globs", () => {
    expect(parseImageHost("cdn.example.com foo.com")).toBeNull();
    expect(parseImageHost("*.example.com")).toBeNull();
    expect(parseImageHost("https://*.cdn.com")).toBeNull();
    expect(parseImageHost("cdn.example.{com,net}")).toBeNull();
  });

  it("rejects URLs with embedded credentials", () => {
    expect(parseImageHost("https://user:pass@cdn.example.com")).toBeNull();
    expect(parseImageHost("https://user@cdn.example.com")).toBeNull();
  });

  it("rejects unsupported protocols (ftp, file, javascript, etc.)", () => {
    expect(parseImageHost("ftp://cdn.example.com")).toBeNull();
    expect(parseImageHost("file:///path/to/img")).toBeNull();
    expect(parseImageHost("javascript:alert(1)")).toBeNull();
  });
});

describe("parseImageHostList (Task 20, Step 2)", () => {
  it("splits comma-separated strings and drops invalid elements", () => {
    const raw = "cdn1.example.com, invalid host, https://cdn2.example.com:8080/images, ";
    const parsed = parseImageHostList(raw);

    expect(parsed).toEqual([
      {
        protocol: "https",
        hostname: "cdn1.example.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn2.example.com",
        port: "8080",
        pathname: "/images/**",
      },
    ]);
  });

  it("returns empty array for non-string input", () => {
    expect(parseImageHostList(null)).toEqual([]);
    expect(parseImageHostList(undefined)).toEqual([]);
  });
});



describe("collectImageHosts (Task 20, Step 2)", () => {
  it("collects hosts from env keys and deduplicates them", () => {
    const env = {
      S3_ENDPOINT: "https://s3.us-east-1.amazonaws.com/my-bucket",
      NEXT_PUBLIC_BACKEND_URL: "http://localhost:3001",
      NEXT_PUBLIC_IMAGE_HOSTS: "cdn.cj.com, https://s3.us-east-1.amazonaws.com/my-bucket",
    };

    const hosts = collectImageHosts(env);

    expect(hosts).toEqual([
      {
        protocol: "https",
        hostname: "s3.us-east-1.amazonaws.com",
        port: "",
        pathname: "/my-bucket/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3001",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn.cj.com",
        port: "",
        pathname: "/**",
      },
    ]);
  });

  it("ignores unset or whitespace-only env variables", () => {
    const env = {
      S3_ENDPOINT: "   ",
      NEXT_PUBLIC_BACKEND_URL: undefined,
    };
    expect(collectImageHosts(env)).toEqual([]);
  });
});

describe("toRemotePatterns (Task 20, Step 2)", () => {
  it("produces copies of the patterns to prevent caller mutation", () => {
    const hosts: ImageRemotePattern[] = [
      { protocol: "https", hostname: "cdn.example.com", port: "", pathname: "/**" },
    ];
    const copy = toRemotePatterns(hosts);

    expect(copy).toEqual(hosts);
    expect(copy[0]).not.toBe(hosts[0]);
  });
});

describe("matchesImagePattern and isOptimizableImageUrl (Task 20, Step 2)", () => {
  const allowedPatterns: ImageRemotePattern[] = [
    {
      protocol: "https",
      hostname: "cdn.example.com",
      port: "",
      pathname: "/**",
    },
    {
      protocol: "https",
      hostname: "cdn.restricted.com",
      port: "",
      pathname: "/catalog/**",
    },
    {
      protocol: "http",
      hostname: "localhost",
      port: "3001",
      pathname: "/**",
    },
  ];

  it("matches valid absolute URLs against allowlisted hosts", () => {
    expect(matchesImagePattern("https://cdn.example.com/item.png", allowedPatterns)).toBe(true);
    expect(matchesImagePattern("https://CDN.EXAMPLE.COM/ITEM.PNG", allowedPatterns)).toBe(true);
    expect(matchesImagePattern("http://localhost:3001/uploads/img.jpg", allowedPatterns)).toBe(true);
  });

  it("respects pathname prefix restrictions", () => {
    expect(matchesImagePattern("https://cdn.restricted.com/catalog/tee.jpg", allowedPatterns)).toBe(true);
    expect(matchesImagePattern("https://cdn.restricted.com/other/tee.jpg", allowedPatterns)).toBe(false);
  });

  it("rejects non-matching protocols or ports", () => {
    expect(matchesImagePattern("http://cdn.example.com/item.png", allowedPatterns)).toBe(false);
    expect(matchesImagePattern("https://localhost:3001/uploads/img.jpg", allowedPatterns)).toBe(false);
    expect(matchesImagePattern("http://localhost:3000/uploads/img.jpg", allowedPatterns)).toBe(false);
  });

  it("rejects URLs with credentials even on allowed hosts", () => {
    expect(matchesImagePattern("https://user:pass@cdn.example.com/item.png", allowedPatterns)).toBe(false);
  });

  it("rejects un-allowlisted supplier domains gracefully", () => {
    expect(matchesImagePattern("https://untrusted-cdn.supplier.com/item.jpg", allowedPatterns)).toBe(false);
  });

  it("isOptimizableImageUrl permits same-origin root-relative paths", () => {
    expect(isOptimizableImageUrl("/product-placeholder.png", allowedPatterns)).toBe(true);
    expect(isOptimizableImageUrl("/media/shoes.jpg", allowedPatterns)).toBe(true);
  });

  it("isOptimizableImageUrl rejects protocol-relative URLs", () => {
    expect(isOptimizableImageUrl("//cdn.example.com/item.png", allowedPatterns)).toBe(false);
  });

  it("isOptimizableImageUrl rejects empty, non-string, or invalid inputs", () => {
    expect(isOptimizableImageUrl("", allowedPatterns)).toBe(false);
    expect(isOptimizableImageUrl("   ", allowedPatterns)).toBe(false);
    expect(isOptimizableImageUrl(null, allowedPatterns)).toBe(false);
    expect(isOptimizableImageUrl(12345, allowedPatterns)).toBe(false);
    expect(isOptimizableImageUrl("not-a-valid-url", allowedPatterns)).toBe(false);
  });
});
