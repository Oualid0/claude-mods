// Draws a donut as RGBA pixels: the filled arc starts at 12 o'clock and runs
// clockwise in a whitened "hot" tone, the rest of the ring is the same color, dimmed.

export const RING_SIZE = 32

const OUTER = 15.5
const INNER = 10
const SAMPLES = 4
const TRACK_ALPHA = 0.22
/** How far the arc and the ring's text move toward white. */
const CORE = 0.35

export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function toWhite(rgb: Rgb, t: number): Rgb {
  return [0, 1, 2].map(i => Math.round(rgb[i]! + (255 - rgb[i]!) * t)) as unknown as Rgb
}

/** The hot tone of `hex`, as the arc draws it; the ring's text uses it too. */
export function hot(hex: string): string {
  return `#${toWhite(hexToRgb(hex), CORE)
    .map(c => c.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Fraction of the circle (0..1) at which the point lies, clockwise from 12. */
function turnOf(x: number, y: number): number {
  const angle = Math.atan2(x, -y)
  return (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI)
}

/**
 * The ring for `percent` (clamped to 0..100) as `RING_SIZE * RING_SIZE` RGBA
 * pixels, edges antialiased by supersampling. A `scale` below 1 draws a smaller
 * ring with empty room around it.
 */
export function ringPixels(percent: number, rgb: Rgb, scale = 1): Uint8Array {
  const fill = Math.min(100, Math.max(0, percent)) / 100
  const n = RING_SIZE
  const lit = new Float32Array(n * n)
  const track = new Float32Array(n * n)
  const center = n / 2
  const step = 1 / SAMPLES

  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      let arc = 0
      let rest = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step - center
          const y = py + (sy + 0.5) * step - center
          const r = Math.hypot(x, y)
          if (r > OUTER * scale || r < INNER * scale) continue
          if (turnOf(x, y) < fill) arc++
          else rest++
        }
      }
      lit[py * n + px] = arc / (SAMPLES * SAMPLES)
      track[py * n + px] = rest / (SAMPLES * SAMPLES)
    }
  }

  const core = toWhite(rgb, CORE)
  const pixels = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const ring = lit[i]! + track[i]! * TRACK_ALPHA
    const alpha = Math.min(1, ring)
    // The arc in its hot tone, the track in the plain color.
    const w = alpha === 0 ? 0 : lit[i]! / alpha
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = Math.round(core[c]! * w + rgb[c]! * (1 - w))
    pixels[i * 4 + 3] = Math.round(alpha * 255)
  }
  return pixels
}

/** The same ring as a glyph, for terminals that cannot draw the picture. */
export function ringGlyph(percent: number): string {
  const glyphs = ['○', '◔', '◑', '◕', '●']
  const p = Math.min(100, Math.max(0, percent))
  return glyphs[Math.round(p / 25)] ?? '○'
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
