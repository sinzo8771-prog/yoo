/**
 * Task 22, Step 4 — the catalog's artwork, as data.
 *
 * Every image the storefront ships is authored here and rendered to PNG by
 * `scripts/generate-catalog-media.ts`. Nothing in this file is a photograph of
 * a real item and nothing is copied from a supplier listing, which is precisely
 * what makes the licence record in `scripts/catalog/media.ts` true: there is no
 * third-party asset to license.
 *
 * Motifs are pure data in a normalised 0..1 space, so they can be asserted
 * (inside the frame, on the ground plane, using palette tones only) without
 * rendering a pixel. `docs/catalog/media-sources.md` records what each file is
 * and when it must be replaced by real photography.
 */
import { Canvas, hex, mix, type Color } from "./png";

/** Rendered edge length in px. The storefront frames product art as 1:1. */
export const ART_SIZE = 1000;
/** Render at 2x and box-filter down — the only anti-aliasing step. */
export const ART_SUPERSAMPLE = 2;

export type PaletteKey = "stoneware" | "oak" | "linen";
export type BackdropKey = "paper" | "sand" | "stone";
export type ViewKey = "front" | "detail";

/** Which motif to draw; one per product shape family. */
export type MotifKey =
  | "crock"
  | "mug"
  | "board"
  | "apron"
  | "towelStack"
  | "cellar"
  | "bowl"
  | "runner"
  | "cuttingBoard"
  | "pitcher"
  | "napkinStack"
  | "trivet";

type Palette = {
  body: string;
  bodyDark: string;
  bodyLight: string;
  accent: string;
};

/**
 * Material tones. Deliberately low-saturation: the copy promises oak, linen and
 * stoneware, so the art must not imply a colour the item is not offered in.
 */
export const PALETTES: Record<PaletteKey, Palette> = {
  stoneware: {
    body: "#C6BFB3",
    bodyDark: "#AFA79A",
    bodyLight: "#DCD6CB",
    accent: "#8B8476",
  },
  oak: {
    body: "#C9A473",
    bodyDark: "#AE8757",
    bodyLight: "#DEC49C",
    accent: "#8A6740",
  },
  linen: {
    body: "#D8D1C2",
    bodyDark: "#BEB6A5",
    bodyLight: "#ECE7DB",
    accent: "#9A9282",
  },
};

/** Backdrops are gradients, not flat fields: they keep cards from looking empty. */
export const BACKDROPS: Record<BackdropKey, { top: string; bottom: string }> = {
  paper: { top: "#F7F3EC", bottom: "#EDE6DA" },
  sand: { top: "#F2EBE0", bottom: "#E4D9C9" },
  stone: { top: "#F0EFEC", bottom: "#DFDED9" },
};

export type Tone = "body" | "bodyDark" | "bodyLight" | "accent" | "backdrop";

export type ArtOp =
  | { kind: "shadow"; cx: number; cy: number; rx: number; ry: number }
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      radius?: number;
      tone: Tone;
    }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; tone: Tone }
  | {
      kind: "poly";
      points: ReadonlyArray<readonly [number, number]>;
      tone: Tone;
    };

const SHADOW: Color = { r: 60, g: 52, b: 42, a: 0.1 };

/**
 * `detail` zooms about a focal point so the second gallery image shows the
 * material and the edge of the same object rather than a second invented view.
 */
export function viewTransform(view: ViewKey): { scale: number; fx: number; fy: number } {
  return view === "detail"
    ? { scale: 1.85, fx: 0.5, fy: 0.58 }
    : { scale: 1, fx: 0.5, fy: 0.5 };
}

/** Resolve a scene into concrete colours for one palette + backdrop pair. */
export function resolveTones(
  palette: PaletteKey,
  backdrop: BackdropKey
): Record<Tone, Color> {
  const tones = PALETTES[palette];
  const field = BACKDROPS[backdrop];
  return {
    body: hex(tones.body),
    bodyDark: hex(tones.bodyDark),
    bodyLight: hex(tones.bodyLight),
    accent: hex(tones.accent),
    // Holes (rims, hanging holes) show the backdrop, so keep them in step with
    // the gradient behind the object instead of punching a white shape.
    backdrop: mix(hex(field.top), hex(field.bottom), 0.55),
  };
}

export function renderArtwork(options: {
  motif: MotifKey;
  palette: PaletteKey;
  backdrop: BackdropKey;
  view: ViewKey;
  size?: number;
  supersample?: number;
}): Buffer {
  const size = options.size ?? ART_SIZE;
  const supersample = options.supersample ?? ART_SUPERSAMPLE;
  const side = size * supersample;

  const field = BACKDROPS[options.backdrop];
  const canvas = new Canvas(side, side);
  canvas.fillVerticalGradient(hex(field.top), hex(field.bottom));

  const tones = resolveTones(options.palette, options.backdrop);
  const { scale, fx, fy } = viewTransform(options.view);
  const at = (value: number, focal: number): number =>
    ((value - focal) * scale + focal) * side;
  const span = (value: number): number => value * scale * side;

  for (const op of MOTIFS[options.motif]) {
    switch (op.kind) {
      case "shadow":
        canvas.fillEllipse(
          at(op.cx, fx),
          at(op.cy, fy),
          span(op.rx),
          span(op.ry),
          SHADOW
        );
        break;
      case "rect":
        canvas.fillRoundedRect(
          at(op.x, fx),
          at(op.y, fy),
          span(op.w),
          span(op.h),
          span(op.radius ?? 0),
          tones[op.tone]
        );
        break;
      case "ellipse":
        canvas.fillEllipse(
          at(op.cx, fx),
          at(op.cy, fy),
          span(op.rx),
          span(op.ry),
          tones[op.tone]
        );
        break;
      case "poly":
        canvas.fillPolygon(
          op.points.map(([x, y]) => [at(x, fx), at(y, fy)] as const),
          tones[op.tone]
        );
        break;
    }
  }

  return canvas.downscale(supersample).toPng();
}

/**
 * Scene definitions. Conventions every motif follows, asserted by tests:
 *  - the object sits on the ground plane around y ≈ 0.80-0.87 (its shadow);
 *  - nothing is drawn outside 0.02..0.98 in either axis, so a crop never clips
 *    the subject;
 *  - tones are palette references only, so the same motif can be drawn in
 *    stoneware, oak or linen without a second definition.
 */
export const MOTIFS: Record<MotifKey, readonly ArtOp[]> = {
  crock: [
    { kind: "shadow", cx: 0.5, cy: 0.862, rx: 0.25, ry: 0.032 },
    // Two utensils first, so the jar's mouth closes over them.
    { kind: "rect", x: 0.42, y: 0.13, w: 0.035, h: 0.2, radius: 0.017, tone: "bodyLight" },
    { kind: "rect", x: 0.525, y: 0.1, w: 0.035, h: 0.23, radius: 0.017, tone: "bodyDark" },
    { kind: "poly", points: [[0.33, 0.32], [0.67, 0.32], [0.71, 0.8], [0.29, 0.8]], tone: "body" },
    { kind: "rect", x: 0.305, y: 0.66, w: 0.39, h: 0.045, radius: 0.01, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.5, cy: 0.32, rx: 0.17, ry: 0.048, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.5, cy: 0.32, rx: 0.135, ry: 0.03, tone: "backdrop" },
  ],
  mug: [
    { kind: "shadow", cx: 0.46, cy: 0.858, rx: 0.21, ry: 0.03 },
    { kind: "ellipse", cx: 0.71, cy: 0.58, rx: 0.105, ry: 0.125, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.71, cy: 0.58, rx: 0.06, ry: 0.08, tone: "backdrop" },
    { kind: "poly", points: [[0.31, 0.38], [0.62, 0.38], [0.6, 0.78], [0.33, 0.78]], tone: "body" },
    { kind: "ellipse", cx: 0.465, cy: 0.38, rx: 0.155, ry: 0.045, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.465, cy: 0.38, rx: 0.12, ry: 0.026, tone: "backdrop" },
  ],
  board: [
    { kind: "shadow", cx: 0.5, cy: 0.86, rx: 0.19, ry: 0.028 },
    { kind: "rect", x: 0.365, y: 0.16, w: 0.27, h: 0.66, radius: 0.085, tone: "body" },
    { kind: "rect", x: 0.42, y: 0.34, w: 0.16, h: 0.012, radius: 0, tone: "bodyDark" },
    { kind: "rect", x: 0.42, y: 0.42, w: 0.16, h: 0.012, radius: 0, tone: "bodyDark" },
    { kind: "rect", x: 0.42, y: 0.5, w: 0.16, h: 0.012, radius: 0, tone: "bodyLight" },
    { kind: "ellipse", cx: 0.5, cy: 0.245, rx: 0.03, ry: 0.03, tone: "backdrop" },
  ],
  apron: [
    { kind: "shadow", cx: 0.5, cy: 0.868, rx: 0.24, ry: 0.03 },
    { kind: "rect", x: 0.4, y: 0.1, w: 0.028, h: 0.14, radius: 0.014, tone: "bodyLight" },
    { kind: "rect", x: 0.575, y: 0.1, w: 0.028, h: 0.14, radius: 0.014, tone: "bodyLight" },
    {
      kind: "poly",
      points: [
        [0.38, 0.22],
        [0.62, 0.22],
        [0.68, 0.5],
        [0.8, 0.82],
        [0.2, 0.82],
        [0.32, 0.5],
      ],
      tone: "body",
    },
    { kind: "rect", x: 0.44, y: 0.56, w: 0.24, h: 0.13, radius: 0.02, tone: "bodyDark" },
    { kind: "rect", x: 0.44, y: 0.56, w: 0.24, h: 0.02, radius: 0.01, tone: "bodyLight" },
  ],
  towelStack: [
    { kind: "shadow", cx: 0.5, cy: 0.855, rx: 0.26, ry: 0.03 },
    { kind: "rect", x: 0.26, y: 0.66, w: 0.5, h: 0.13, radius: 0.025, tone: "bodyDark" },
    { kind: "rect", x: 0.28, y: 0.54, w: 0.46, h: 0.13, radius: 0.025, tone: "body" },
    { kind: "rect", x: 0.3, y: 0.42, w: 0.42, h: 0.13, radius: 0.025, tone: "bodyLight" },
    { kind: "rect", x: 0.3, y: 0.42, w: 0.42, h: 0.016, radius: 0.008, tone: "bodyDark" },
    { kind: "rect", x: 0.33, y: 0.5, w: 0.36, h: 0.014, radius: 0.007, tone: "accent" },
  ],
  cellar: [
    { kind: "shadow", cx: 0.5, cy: 0.828, rx: 0.17, ry: 0.026 },
    { kind: "rect", x: 0.31, y: 0.58, w: 0.38, h: 0.18, radius: 0.06, tone: "body" },
    { kind: "ellipse", cx: 0.5, cy: 0.58, rx: 0.19, ry: 0.055, tone: "bodyLight" },
    { kind: "rect", x: 0.335, y: 0.42, w: 0.33, h: 0.15, radius: 0.07, tone: "body" },
    { kind: "ellipse", cx: 0.5, cy: 0.42, rx: 0.165, ry: 0.05, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.5, cy: 0.365, rx: 0.05, ry: 0.05, tone: "accent" },
  ],
  bowl: [
    { kind: "shadow", cx: 0.5, cy: 0.845, rx: 0.26, ry: 0.03 },
    {
      kind: "poly",
      points: [
        [0.2, 0.5],
        [0.8, 0.5],
        [0.72, 0.79],
        [0.28, 0.79],
      ],
      tone: "body",
    },
    { kind: "ellipse", cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.075, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.055, tone: "bodyLight" },
    { kind: "ellipse", cx: 0.5, cy: 0.795, rx: 0.11, ry: 0.03, tone: "bodyDark" },
  ],
  runner: [
    { kind: "shadow", cx: 0.5, cy: 0.83, rx: 0.3, ry: 0.03 },
    { kind: "rect", x: 0.14, y: 0.44, w: 0.72, h: 0.11, radius: 0.025, tone: "body" },
    { kind: "rect", x: 0.14, y: 0.55, w: 0.72, h: 0.16, radius: 0.025, tone: "bodyDark" },
    { kind: "rect", x: 0.14, y: 0.71, w: 0.72, h: 0.05, radius: 0.02, tone: "bodyLight" },
    { kind: "rect", x: 0.14, y: 0.545, w: 0.72, h: 0.012, radius: 0.006, tone: "bodyLight" },
    { kind: "rect", x: 0.18, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
    { kind: "rect", x: 0.3, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
    { kind: "rect", x: 0.42, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
    { kind: "rect", x: 0.54, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
    { kind: "rect", x: 0.66, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
    { kind: "rect", x: 0.78, y: 0.76, w: 0.02, h: 0.055, radius: 0.01, tone: "bodyLight" },
  ],
  cuttingBoard: [
    { kind: "shadow", cx: 0.5, cy: 0.83, rx: 0.29, ry: 0.03 },
    { kind: "rect", x: 0.14, y: 0.36, w: 0.72, h: 0.44, radius: 0.075, tone: "body" },
    { kind: "rect", x: 0.2, y: 0.46, w: 0.6, h: 0.012, radius: 0, tone: "bodyDark" },
    { kind: "rect", x: 0.2, y: 0.56, w: 0.6, h: 0.012, radius: 0, tone: "bodyDark" },
    { kind: "rect", x: 0.2, y: 0.66, w: 0.6, h: 0.012, radius: 0, tone: "bodyLight" },
    { kind: "ellipse", cx: 0.795, cy: 0.435, rx: 0.027, ry: 0.027, tone: "backdrop" },
  ],
  pitcher: [
    { kind: "shadow", cx: 0.48, cy: 0.845, rx: 0.2, ry: 0.03 },
    { kind: "ellipse", cx: 0.72, cy: 0.53, rx: 0.1, ry: 0.115, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.72, cy: 0.53, rx: 0.058, ry: 0.072, tone: "backdrop" },
    {
      kind: "poly",
      points: [
        [0.37, 0.3],
        [0.6, 0.3],
        [0.68, 0.72],
        [0.3, 0.72],
      ],
      tone: "body",
    },
    { kind: "poly", points: [[0.37, 0.3], [0.29, 0.235], [0.34, 0.305]], tone: "body" },
    { kind: "ellipse", cx: 0.49, cy: 0.72, rx: 0.19, ry: 0.045, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.485, cy: 0.3, rx: 0.115, ry: 0.038, tone: "bodyDark" },
    { kind: "ellipse", cx: 0.485, cy: 0.3, rx: 0.085, ry: 0.022, tone: "backdrop" },
  ],
  napkinStack: [
    { kind: "shadow", cx: 0.5, cy: 0.845, rx: 0.24, ry: 0.028 },
    { kind: "rect", x: 0.24, y: 0.62, w: 0.52, h: 0.14, radius: 0.02, tone: "bodyDark" },
    { kind: "rect", x: 0.27, y: 0.5, w: 0.46, h: 0.13, radius: 0.02, tone: "body" },
    { kind: "rect", x: 0.31, y: 0.38, w: 0.38, h: 0.13, radius: 0.02, tone: "bodyLight" },
    { kind: "rect", x: 0.31, y: 0.44, w: 0.38, h: 0.012, radius: 0.006, tone: "accent" },
    { kind: "rect", x: 0.27, y: 0.55, w: 0.46, h: 0.012, radius: 0.006, tone: "bodyLight" },
  ],
  trivet: [
    { kind: "shadow", cx: 0.5, cy: 0.825, rx: 0.24, ry: 0.028 },
    { kind: "ellipse", cx: 0.5, cy: 0.56, rx: 0.31, ry: 0.245, tone: "body" },
    { kind: "ellipse", cx: 0.5, cy: 0.56, rx: 0.265, ry: 0.2, tone: "bodyDark" },
    { kind: "rect", x: 0.29, y: 0.4, w: 0.05, h: 0.32, radius: 0.02, tone: "body" },
    { kind: "rect", x: 0.385, y: 0.375, w: 0.05, h: 0.37, radius: 0.02, tone: "body" },
    { kind: "rect", x: 0.475, y: 0.36, w: 0.05, h: 0.4, radius: 0.02, tone: "body" },
    { kind: "rect", x: 0.565, y: 0.375, w: 0.05, h: 0.37, radius: 0.02, tone: "body" },
    { kind: "rect", x: 0.66, y: 0.4, w: 0.05, h: 0.32, radius: 0.02, tone: "body" },
  ],
};

