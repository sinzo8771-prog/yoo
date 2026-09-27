/**
 * Task 22, Step 4 — a dependency-free RGBA rasteriser and PNG encoder.
 *
 * Why hand-rolled: the catalog needs real image files to check (dimensions, alt
 * text, file size, licence record), and this repository holds no licensed
 * product photography, so the media is *authored* art generated here. That must
 * not add a native image dependency (`sharp` is only present transitively, via
 * Next), and it must be deterministic: the same plan has to produce
 * byte-identical files, or the media record's `sha256` could never be trusted.
 *
 * Scope is deliberately tiny — flat shapes, no image parsing, so it is not
 * attack surface. `deflateSync` comes from node:zlib; the PNG chunk layout and
 * CRC32 are implemented below.
 */
import { deflateSync } from "node:zlib";

/** Straight sRGB colour with 0..1 alpha (alpha is composited, never stored). */
export type Color = { r: number; g: number; b: number; a?: number };

/** `#rgb` / `#rrggbb` → Color. Throws on anything else rather than guessing. */
export function hex(value: string): Color {
  const raw = value.trim().replace(/^#/, "");
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${JSON.stringify(value)}`);
  }
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/** Linear interpolation in sRGB space — good enough for flat-art gradients. */
export function mix(from: Color, to: Color, t: number): Color {
  const k = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(from.r + (to.r - from.r) * k),
    g: Math.round(from.g + (to.g - from.g) * k),
    b: Math.round(from.b + (to.b - from.b) * k),
    a: (from.a ?? 1) + ((to.a ?? 1) - (from.a ?? 1)) * k,
  };
}

/** A point in canvas pixel space. */
export type Point = readonly [number, number];

export class Canvas {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits per channel, row-major; alpha stays 255 after compositing. */
  private readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(`Invalid canvas size ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }

  /** Composite one pixel; out-of-bounds coordinates are ignored (clipping). */
  private blend(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const alpha = color.a ?? 1;
    if (alpha <= 0) return;
    const at = (y * this.width + x) * 4;
    const d = this.data;
    if (alpha >= 1) {
      d[at] = color.r;
      d[at + 1] = color.g;
      d[at + 2] = color.b;
      return;
    }
    d[at] = color.r * alpha + d[at] * (1 - alpha);
    d[at + 1] = color.g * alpha + d[at + 1] * (1 - alpha);
    d[at + 2] = color.b * alpha + d[at + 2] * (1 - alpha);
  }

  /** Vertical linear gradient over the full canvas (the backdrop). */
  fillVerticalGradient(top: Color, bottom: Color): void {
    for (let y = 0; y < this.height; y++) {
      const color = mix(top, bottom, y / Math.max(1, this.height - 1));
      for (let x = 0; x < this.width; x++) this.blend(x, y, color);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color): void {
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let py = Math.round(y); py < y1; py++) {
      for (let px = Math.round(x); px < x1; px++) this.blend(px, py, color);
    }
  }

  /** Axis-aligned rounded rectangle; `radius` is clamped to half the box. */
  fillRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    color: Color
  ): void {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    const x1 = x + w;
    const y1 = y + h;
    for (let py = Math.floor(y); py < Math.ceil(y1); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x1); px++) {
        if (!insideRoundedRect(px + 0.5, py + 0.5, x, y, x1, y1, r)) continue;
        this.blend(px, py, color);
      }
    }
  }

  /** Axis-aligned ellipse with the given radii. */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    if (rx <= 0 || ry <= 0) return;
    for (let py = Math.floor(cy - ry); py < Math.ceil(cy + ry); py++) {
      for (let px = Math.floor(cx - rx); px < Math.ceil(cx + rx); px++) {
        const dx = (px + 0.5 - cx) / rx;
        const dy = (py + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        this.blend(px, py, color);
      }
    }
  }

  /** Even-odd scanline fill; the outline is closed implicitly. */
  fillPolygon(points: readonly Point[], color: Color): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let py = Math.floor(minY); py < Math.ceil(maxY); py++) {
      const y = py + 0.5;
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if (ay === by) continue;
        if (y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
        crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        this.fillRect(
          crossings[i],
          py,
          crossings[i + 1] - crossings[i],
          1,
          color
        );
      }
    }
  }

  /** Box-filter downscale by an integer factor: the supersampling step. */
  downscale(factor: number): Canvas {
    if (!Number.isInteger(factor) || factor < 1) {
      throw new Error(`Invalid downscale factor ${factor}`);
    }
    if (factor === 1) return this.copy();
    const out = new Canvas(this.width / factor, this.height / factor);
    const samples = factor * factor;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < factor; sy++) {
          for (let sx = 0; sx < factor; sx++) {
            const at = ((y * factor + sy) * this.width + (x * factor + sx)) * 4;
            r += this.data[at];
            g += this.data[at + 1];
            b += this.data[at + 2];
          }
        }
        const at = (y * out.width + x) * 4;
        out.data[at] = Math.round(r / samples);
        out.data[at + 1] = Math.round(g / samples);
        out.data[at + 2] = Math.round(b / samples);
      }
    }
    return out;
  }

  private copy(): Canvas {
    const out = new Canvas(this.width, this.height);
    out.data.set(this.data);
    return out;
  }

  /** 8-bit RGBA PNG (colour type 6, no interlace), filter 0 on every row. */
  toPng(): Buffer {
    const bytesPerRow = this.width * 4;
    const raw = Buffer.alloc((bytesPerRow + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const rowStart = y * (bytesPerRow + 1);
      raw[rowStart] = 0; // filter type 0 (None)
      for (let i = 0; i < bytesPerRow; i++) {
        raw[rowStart + 1 + i] = this.data[y * bytesPerRow + i];
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr.writeUInt8(8, 8); // bit depth
    ihdr.writeUInt8(6, 9); // colour type: RGBA
    ihdr.writeUInt8(0, 10); // compression: deflate
    ihdr.writeUInt8(0, 11); // filter method: adaptive
    ihdr.writeUInt8(0, 12); // interlace: none

    return Buffer.concat([
      PNG_SIGNATURE,
      chunk("IHDR", ihdr),
      // Level 9, one fresh stream per file: reproducible output.
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function insideRoundedRect(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number
): boolean {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  if (r === 0) return true;
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
  if (cx === px && cy === py) return true;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Dimensions read straight out of a PNG's IHDR. Used by the media verifier, so
 * a declared size can never be taken on trust from the manifest alone.
 */
export function readPngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file");
  }
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("PNG is missing its IHDR chunk");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
