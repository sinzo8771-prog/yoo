import { describe, expect, it } from "vitest";

/**
 * Task 22 unit tests — artwork invariants (`scripts/catalog/art.ts`) and the
 * PNG round-trip (`scripts/catalog/png.ts`). These are the checks that let the
 * media record be trusted without eyeballing every file: motifs stay inside the
 * frame on the ground plane, tones come only from the declared palettes, and
 * the encoder is deterministic so a recorded sha256 identifies the bytes.
 */
import {
  BACKDROPS,
  MOTIFS,
  PALETTES,
  renderArtwork,
  viewTransform,
  type ArtOp,
} from "@/scripts/catalog/art";
import { MEDIA } from "@/scripts/catalog/media";
import { Canvas, hex, readPngSize } from "@/scripts/catalog/png";

/** Nothing may be drawn into the outer 2% — a crop must never clip the subject. */
const FRAME_MARGIN = 0.02;
const TONES = new Set(["body", "bodyDark", "bodyLight", "accent", "backdrop"]);

function opBounds(op: ArtOp): Array<[number, number]> {
  switch (op.kind) {
    case "shadow":
      return [
        [op.cx - op.rx, op.cx + op.rx],
        [op.cy - op.ry, op.cy + op.ry],
      ];
    case "rect":
      return [
        [op.x, op.x + op.w],
        [op.y, op.y + op.h],
      ];
    case "ellipse":
      return [
        [op.cx - op.rx, op.cx + op.rx],
        [op.cy - op.ry, op.cy + op.ry],
      ];
    case "poly":
      return [
        [Math.min(...op.points.map((p) => p[0])), Math.max(...op.points.map((p) => p[0]))],
        [Math.min(...op.points.map((p) => p[1])), Math.max(...op.points.map((p) => p[1]))],
      ];
  }
}

describe("motif invariants", () => {
  it("defines a scene for every motif and draws it inside the frame", () => {
    const motifs = Object.keys(MOTIFS);
    expect(motifs.length).toBeGreaterThanOrEqual(12);
    for (const [key, ops] of Object.entries(MOTIFS)) {
      expect(ops.length, key).toBeGreaterThan(0);
      for (const op of ops) {
        for (const [lo, hi] of opBounds(op)) {
          expect(lo, `${key}: op starts inside the frame`).toBeGreaterThanOrEqual(FRAME_MARGIN);
          expect(hi, `${key}: op ends inside the frame`).toBeLessThanOrEqual(1 - FRAME_MARGIN);
        }
      }
    }
  });

  it("starts every scene with a shadow resting on the ground plane", () => {
    for (const [key, ops] of Object.entries(MOTIFS)) {
      const first = ops[0];
      expect(first.kind, key).toBe("shadow");
      if (first.kind === "shadow") {
        expect(first.cy, key).toBeGreaterThanOrEqual(0.8);
        expect(first.cy, key).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it("uses palette tones only, so one motif renders in every material", () => {
    for (const [key, ops] of Object.entries(MOTIFS)) {
      for (const op of ops) {
        if (op.kind === "shadow") continue;
        expect(TONES.has(op.tone), `${key}: tone ${op.tone}`).toBe(true);
      }
    }
  });

  it("renders every motif the media plan actually references", () => {
    const used = new Set(MEDIA.map((entry) => entry.motif));
    for (const motif of used) {
      expect(MOTIFS[motif], `planned motif ${motif}`).toBeDefined();
    }
    expect(used.size).toBeGreaterThanOrEqual(12);
  });

  it("keeps palettes and backdrops parseable as hex colours", () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const [tone, value] of Object.entries(palette)) {
        expect(() => hex(value), `${name}/${tone}`).not.toThrow();
      }
    }
    for (const [name, field] of Object.entries(BACKDROPS)) {
      expect(() => hex(field.top), `${name}/top`).not.toThrow();
      expect(() => hex(field.bottom), `${name}/bottom`).not.toThrow();
    }
  });

  it("zooms for the detail view and leaves the front view untouched", () => {
    expect(viewTransform("front").scale).toBe(1);
    expect(viewTransform("detail").scale).toBeGreaterThan(1);
  });
});

describe("PNG round-trip", () => {
  it("encodes a canvas into a PNG whose header reports the same size", () => {
    const canvas = new Canvas(32, 48);
    canvas.fillVerticalGradient(hex("#ffffff"), hex("#000000"));
    const png = canvas.toPng();
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(readPngSize(png)).toEqual({ width: 32, height: 48 });
  });

  it("rejects non-PNG bytes rather than guessing dimensions", () => {
    expect(() => readPngSize(Buffer.from("not a png at all, but long enough"))).toThrow();
  });

  it("expands shorthand hex and rejects anything that is not a colour", () => {
    expect(hex("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hex("ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(() => hex("#xyz123")).toThrow();
    expect(() => hex("")).toThrow();
  });

  it("renders deterministically, so a recorded sha256 identifies the bytes", () => {
    const options = {
      motif: "mug" as const,
      palette: "stoneware" as const,
      backdrop: "paper" as const,
      view: "front" as const,
      size: 64,
      supersample: 1,
    };
    const first = renderArtwork(options);
    const second = renderArtwork(options);
    expect(first.equals(second)).toBe(true);
    expect(readPngSize(first)).toEqual({ width: 64, height: 64 });
  });

  it("draws a visibly different image for the detail view of the same object", () => {
    const base = { motif: "crock" as const, palette: "oak" as const, backdrop: "sand" as const, size: 64, supersample: 1 };
    const front = renderArtwork({ ...base, view: "front" });
    const detail = renderArtwork({ ...base, view: "detail" });
    expect(front.equals(detail)).toBe(false);
  });

  it("refuses impossible canvas sizes instead of rendering undefined pixels", () => {
    expect(() => new Canvas(0, 10)).toThrow();
    expect(() => new Canvas(10, -1)).toThrow();
  });
});

