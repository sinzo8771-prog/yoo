/**
 * Task 18 — sanitizing operator-supplied markup/CSS before it is rendered raw.
 *
 * Two fields on the Openfront `Store` record reach the storefront unescaped:
 * `logoIcon` is injected with `dangerouslySetInnerHTML`, and `logoColor` is
 * interpolated into a CSS `hue-rotate()` value. Both are operator-configurable,
 * so without validation a compromised (or merely careless) admin account gets
 * stored XSS on every page — the highest-value target in the app, because the
 * session cookie and cart proof are readable there.
 *
 * `sanitizeSvg` is a deny-list sanitizer, not a full parser:
 *  - HTML comments are removed before scanning, so `<!-- <script> -->` cannot be
 *    reassembled by the browser,
 *  - elements that execute or fetch are dropped (script/style/foreignObject/
 *    iframe/object/embed/canvas/media, SMIL animation, `use`/`image`/`feImage`,
 *    filters),
 *  - every `on*` event attribute is dropped,
 *  - URL-bearing attributes (`href`/`xlink:href`/`src`) that point off-origin or
 *    use `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` are dropped,
 *  - paint attributes (`fill`/`stroke`/`clip-path`/`mask`/markers) may only use
 *    internal `#id` references,
 *  - `style` attributes containing `url()`, `expression`, `@import`,
 *    `behavior:` or a script scheme are dropped,
 *  - the result must still be one `<svg>…</svg>` document or nothing is returned.
 *
 * Residual risk: a deny-list is weaker than an allow-list parser, so a
 * nonce-based CSP stays the recommended follow-up (see
 * `docs/security/threat-model.md` §HTML/script injection).
 */

/** Longest logo markup we will even inspect. */
export const MAX_SVG_LENGTH = 20_000;

/** Elements that can execute code, fetch subresources, or animate attributes. */
const DENIED_TAGS = [
  "script",
  "style",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "canvas",
  "audio",
  "video",
  "source",
  "track",
  "link",
  "meta",
  "base",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "handler",
  "use",
  "image",
  "feimage",
  "filter",
  "cursor",
] as const;

/** Denied tags whose *content* must be removed along with the tag itself. */
const DENIED_WITH_CONTENT = [
  "script",
  "style",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "canvas",
  "audio",
  "video",
  "filter",
] as const;

const EVENT_ATTRIBUTE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTRIBUTE = /\s(?:xlink:href|href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const PAINT_ATTRIBUTE =
  /\s(?:fill|stroke|clip-path|mask|marker-start|marker-mid|marker-end)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Schemes that must never appear in a URL-bearing attribute. */
const UNSAFE_URL = /^(?:https?:|\/\/|data:|javascript:|vbscript:|file:|ftp:|blob:)/i;
/** Style payloads that can fetch or execute. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:/i;

/** Read the value out of a matched `name="value"` attribute. */
function attributeValue(raw: string): string {
  const equals = raw.indexOf("=");
  if (equals === -1) return "";
  let value = raw.slice(equals + 1).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value;
}

/** A usable logo is exactly one `<svg>…</svg>` document. */
function isSvgDocument(markup: string): boolean {
  return /^<svg[\s>]/i.test(markup) && /<\/svg>\s*$/i.test(markup);
}

/**
 * Remove executable or fetching markup from an operator-supplied SVG. Returns
 * the cleaned markup, or null when the input is unusable — callers fall back to
 * the built-in brand mark rather than rendering nothing.
 */
export function sanitizeSvg(markup: unknown): string | null {
  if (typeof markup !== "string") return null;
  if (markup.length > MAX_SVG_LENGTH) return null;
  if (markup.includes("\u0000")) return null;

  let svg = markup.trim();
  if (!isSvgDocument(svg)) return null;

  // Comments first: `<!-- <script> -->` must never be re-assembled downstream.
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  if (!isSvgDocument(svg.trim())) return null;

  for (const tag of DENIED_WITH_CONTENT) {
    svg = svg
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  for (const tag of DENIED_TAGS) {
    svg = svg.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  svg = svg.replace(EVENT_ATTRIBUTE, "");
  svg = svg.replace(URL_ATTRIBUTE, (attribute) =>
    UNSAFE_URL.test(attributeValue(attribute)) ? "" : attribute
  );
  // Paint references may only point at ids inside the same document.
  svg = svg.replace(PAINT_ATTRIBUTE, (attribute) => {
    const value = attributeValue(attribute);
    if (!/url\s*\(/i.test(value)) return attribute;
    return /url\s*\(\s*["']?#/i.test(value) ? attribute : "";
  });
  svg = svg.replace(STYLE_ATTRIBUTE, (attribute) =>
    UNSAFE_STYLE.test(attributeValue(attribute)) ? "" : attribute
  );

  const cleaned = svg.trim();
  return isSvgDocument(cleaned) ? cleaned : null;
}

/** Neutral hue used when no (or no valid) logo color is configured. */
export const DEFAULT_LOGO_HUE = 0;

/**
 * Clamp an operator-supplied CSS angle. Only a finite number survives, so the
 * value can never break out of `hue-rotate(<value>deg)` into another
 * declaration.
 */
export function safeCssAngle(
  value: unknown,
  options: { min?: number; max?: number; fallback?: number } = {}
): number {
  const min = options.min ?? 0;
  const max = options.max ?? 360;
  const fallback = options.fallback ?? DEFAULT_LOGO_HUE;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
