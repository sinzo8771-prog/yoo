/**
 * Task 18 — sanitizing operator-supplied logo markup and CSS.
 *
 * Pins that a plain inline logo survives untouched, that internal paint
 * references are kept, and that scripts, event handlers, SMIL animation,
 * embedding elements, external/script-scheme URLs, remote paint references and
 * fetching style payloads are removed. Also pins the angle clamp that protects
 * the `hue-rotate(<value>deg)` interpolation.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LOGO_HUE, MAX_SVG_LENGTH, safeCssAngle, sanitizeSvg } from "@/lib/security/markup";

const LOGO = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="currentColor"/></svg>';

describe("sanitizeSvg", () => {
  it("keeps a plain inline logo byte-for-byte", () => {
    expect(sanitizeSvg(LOGO)).toBe(LOGO);
  });

  it("keeps internal paint references", () => {
    const markup = '<svg><path fill="url(#grad)" stroke="#000" d="M0 0"/></svg>';
    expect(sanitizeSvg(markup)).toBe(markup);
  });

  it("refuses anything that is not one svg document", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "   ",
      "hello",
      "<div>hi</div>",
      "<svg><path d=\"M0 0\"/>",
      '<svg></svg><script>alert(1)</script>',
      "<!-- leading comment -->" + LOGO,
      LOGO + "trailing",
    ]) {
      expect(sanitizeSvg(value), String(value).slice(0, 40)).toBeNull();
    }
  });

  it("refuses markup past the length budget", () => {
    const oversized = `<svg><path d="${"0".repeat(MAX_SVG_LENGTH)}"/></svg>`;
    expect(oversized.length).toBeGreaterThan(MAX_SVG_LENGTH);
    expect(sanitizeSvg(oversized)).toBeNull();
  });

  it("drops script elements together with their content", () => {
    const result = sanitizeSvg(
      '<svg><script>alert(1)</script><path d="M0 0"/></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
    expect(result).toContain("<path");
  });

  it("drops comments that try to hide markup", () => {
    const result = sanitizeSvg(
      '<svg><!-- <script>alert(1)</script> --><path d="M0 0"/></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("script");
    expect(result).toContain("<path");
  });

  it("drops event handler attributes", () => {
    const result = sanitizeSvg(
      '<svg onload="alert(1)"><path onclick="alert(2)" onmouseover=\'alert(3)\' d="M0 0"/></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/\son[a-z]+/i);
    expect(result).toContain("<path");
  });

  it("drops script-scheme, data, protocol-relative and off-origin URLs", () => {
    const result = sanitizeSvg(
      '<svg><a href="javascript:alert(1)"><path d="M0 0"/></a>' +
        '<a xlink:href="data:text/html;base64,PHNjcmlwdD4="><path d="M0 0"/></a>' +
        '<a href="//evil.example/x"><path d="M0 0"/></a>' +
        '<a href="https://evil.example/x"><path d="M0 0"/></a></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("javascript");
    expect(result).not.toContain("data:text/html");
    expect(result).not.toContain("evil.example");
    expect(result).not.toContain("href");
  });

  it("drops external paint references but keeps internal ones", () => {
    const result = sanitizeSvg(
      '<svg><path fill="url(http://evil.example/x.svg#a)" d="M0 0"/>' +
        '<path stroke="url(#keep)" d="M1 1"/></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("evil.example");
    expect(result).toContain('url(#keep)');
  });

  it("drops style payloads that can fetch or execute", () => {
    const result = sanitizeSvg(
      '<svg><path style="fill:url(http://evil.example/x)" d="M0 0"/>' +
        '<path style="fill:red" d="M1 1"/></svg>'
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("url(");
    expect(result).not.toContain("evil.example");
    expect(result).toContain("fill:red");
  });

  it("drops embedding and animation elements", () => {
    const result = sanitizeSvg(
      '<svg><foreignObject><div>hi</div></foreignObject><iframe src="https://evil.example"/>' +
        '<use href="#x"/><image href="https://evil.example/x.png"/>' +
        '<animate attributeName="href" values="javascript:alert(1)"/>' +
        '<path d="M0 0"/></svg>'
    );
    expect(result).not.toBeNull();
    for (const forbidden of ["foreignObject", "iframe", "use", "image", "animate", "evil.example", "javascript"]) {
      expect(result, forbidden).not.toContain(forbidden);
    }
    expect(result).toContain("<path");
  });

  it("is case-insensitive about tags", () => {
    const result = sanitizeSvg('<SVG><SCRIPT>alert(1)</SCRIPT><path d="M0 0"/></SVG>');
    expect(result).not.toBeNull();
    expect(result?.toLowerCase()).not.toContain("script");
    expect(result).toContain("<path");
  });
});

describe("safeCssAngle", () => {
  it("accepts numbers and numeric strings", () => {
    expect(safeCssAngle(180)).toBe(180);
    expect(safeCssAngle("180")).toBe(180);
    expect(safeCssAngle(" 90 ")).toBe(90);
  });

  it("clamps out-of-range values", () => {
    expect(safeCssAngle(9999)).toBe(360);
    expect(safeCssAngle(-45)).toBe(0);
  });

  it("falls back for junk that could break out of the declaration", () => {
    for (const value of [
      "0); background-image:url(http://evil.example)",
      "url(#a)",
      "",
      "   ",
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
    ]) {
      expect(safeCssAngle(value), String(value)).toBe(DEFAULT_LOGO_HUE);
    }
  });

  it("honours custom bounds and fallback", () => {
    expect(safeCssAngle(500, { max: 100, fallback: 50 })).toBe(100);
    expect(safeCssAngle("nope", { fallback: 12 })).toBe(12);
  });
});
