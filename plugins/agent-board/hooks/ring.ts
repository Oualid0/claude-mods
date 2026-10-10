// Pixel helpers of the row: colors, the whitened "hot" tone, base64 for images and
// the token bar as RGBA pixels.

const SAMPLES = 4
const TRACK_ALPHA = 0.22
/** How far the hot tone moves toward white. */
const CORE = 0.35

export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function toWhite(rgb: Rgb, t: number): Rgb {
  return [0, 1, 2].map(i => Math.round(rgb[i]! + (255 - rgb[i]!) * t)) as unknown as Rgb
}

/** The hot tone of `hex`: the color moved toward white, for counts and the crew's z's. */
export function hot(hex: string): string {
  return `#${toWhite(hexToRgb(hex), CORE)
    .map(c => c.toString(16).padStart(2, '0'))
    .join('')}`
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, as `Image` sources take it. */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}

/** Pixels per terminal column and row, as the rings use them. */
const CELL_W = 16
const CELL_H = 32
/** The bar's height and the gap between two of its runs, in pixels. */
const BAR_H = 12
const BAR_GAP = 2

/** The bar's picture size in pixels for `cells` columns and one row. */
export function barSize(cells: number): { width: number; height: number } {
  return { width: cells * CELL_W, height: CELL_H }
}

/**
 * A rounded bar `cells` columns wide, one run per part in its color, a small gap
 * between runs; with no parts, an empty track in `track`, dimmed.
 */
export function barPixels(parts: readonly { cells: number; rgb: Rgb }[], cells: number, track: Rgb): Uint8Array {
  const { width: w, height: h } = barSize(cells)
  const top = (h - BAR_H) / 2
  const r = BAR_H / 2
  const total = parts.reduce((n, p) => n + p.cells, 0)
  // Where each run ends, in pixels.
  let at = 0
  const ends = parts.map(p => (at += (p.cells / (total || 1)) * w))
  const pixels = new Uint8Array(w * h * 4)
  const step = 1 / SAMPLES
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let hit = 0
      let rgb: Rgb | undefined
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step
          const y = py + (sy + 0.5) * step
          // Inside the pill: the middle band, or one of the two round ends.
          const cx = Math.min(Math.max(x, r), w - r)
          if (Math.hypot(x - cx, y - (top + r)) > r) continue
          const i = ends.findIndex(e => x < e)
          if (i > 0 && x < ends[i - 1]! + BAR_GAP) continue
          hit++
          rgb = parts[i === -1 ? parts.length - 1 : i]?.rgb
        }
      }
      const o = (py * w + px) * 4
      const alpha = hit / (SAMPLES * SAMPLES)
      const c = rgb ?? track
      pixels[o] = c[0]
      pixels[o + 1] = c[1]
      pixels[o + 2] = c[2]
      pixels[o + 3] = Math.round(alpha * (rgb ? 255 : TRACK_ALPHA * 255))
    }
  }
  return pixels
}
