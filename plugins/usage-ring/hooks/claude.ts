// Pure pixel logic of the pixel Claude beside the chat chip: a hammering and a
// sleeping frame as RGBA. No `$` in here, so the tests can drive it directly.
import { hexToRgb, hot } from './ring'
import type { Rgb } from './ring'

export const CLAUDE = '#d97757'

export const SPRITE = 24
/** 24 x 24 pixels on 6 x 3 cells: the body from x 4, both arms inside the picture. */
export const SPRITE_W = 24
/** Each sprite pixel becomes SCALE x SCALE image pixels, so the terminal scales crisp blocks. */
export const SCALE = 4
const BODY = hexToRgb(CLAUDE)
const EYE: Rgb = [38, 24, 20]
const Z_RGB = hexToRgb(hot(CLAUDE))

const Z = ['###', '.#.', '###']

/**
 * The sleeping Claude: eyes shut, both arms. `zPhase` 0..11 lets three z's
 * appear one by one, rising diagonally from the top right of the head, then
 * clears them.
 */
export function claudePixels(zPhase: number): Uint8Array {
  const grid: (Rgb | null)[][] = Array.from({ length: SPRITE }, () => Array<Rgb | null>(SPRITE_W).fill(null))
  const alpha: number[][] = Array.from({ length: SPRITE }, () => Array<number>(SPRITE_W).fill(0))
  const put = (x: number, y: number, rgb: Rgb, a = 1) => {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE) return
    grid[y]![x] = rgb
    alpha[y]![x] = a
  }
  const rect = (x0: number, y0: number, w: number, h: number, rgb: Rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, rgb)
  }

  // Asleep where the hammering Claude stands: same height, body from x 4.
  const top = 5
  rect(4, top, 16, 11, BODY)
  rect(1, top + 4, 3, 3, BODY)
  rect(20, top + 4, 3, 3, BODY)
  rect(7, top + 5, 4, 1, EYE)
  rect(13, top + 5, 4, 1, EYE)
  for (const x of [5, 9, 13, 17]) rect(x, top + 11, 2, 4, BODY)

  // Three z's one by one: beside the head on the right, then up and over it.
  const glyph = (x0: number, y0: number) =>
    Z.forEach((line, dy) => {
      for (let dx = 0; dx < line.length; dx++) if (line[dx] === '#') put(x0 + dx, y0 + dy, Z_RGB)
    })
  const shown = zPhase < 9 ? Math.floor(zPhase / 3) + 1 : 0
  const spots = [
    [21, top],
    [17, top - 4],
    [13, top - 5],
  ] as const
  spots.slice(0, shown).forEach(([x, y]) => glyph(x, y))

  const width = SPRITE_W * SCALE
  const height = SPRITE * SCALE
  const px = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sy = Math.floor(y / SCALE)
      const sx = Math.floor(x / SCALE)
      const rgb = grid[sy]![sx]
      if (!rgb) continue
      const i = (y * width + x) * 4
      px[i] = rgb[0]
      px[i + 1] = rgb[1]
      px[i + 2] = rgb[2]
      px[i + 3] = Math.round(alpha[sy]![sx]! * 255)
    }
  return px
}

// --- working poses -------------------------------------------------------------

const HANDLE: Rgb = [139, 90, 60]
const IRON: Rgb = [150, 150, 158]
const SPARK: Rgb = [255, 214, 120]

type Canvas = { put: (x: number, y: number, rgb: Rgb) => void; rect: (x: number, y: number, w: number, h: number, rgb: Rgb) => void; pixels: () => Uint8Array }

function canvas(): Canvas {
  const grid: (Rgb | null)[][] = Array.from({ length: SPRITE }, () => Array<Rgb | null>(SPRITE_W).fill(null))
  const put = (x: number, y: number, rgb: Rgb) => {
    if (x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE) grid[y]![x] = rgb
  }
  const rect = (x0: number, y0: number, w: number, h: number, rgb: Rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, rgb)
  }
  const pixels = () => {
    const width = SPRITE_W * SCALE
    const height = SPRITE * SCALE
    const px = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const rgb = grid[Math.floor(y / SCALE)]![Math.floor(x / SCALE)]
        if (!rgb) continue
        const i = (y * width + x) * 4
        px[i] = rgb[0]
        px[i + 1] = rgb[1]
        px[i + 2] = rgb[2]
        px[i + 3] = 255
      }
    return px
  }
  return { put, rect, pixels }
}

/** Body, legs and open eyes at `top`; `eyeDx` shifts the pupils, `x0` the whole figure. */
function figure(c: Canvas, top: number, x0: number, eyeDx: number, eyeDy: number, arms: 'both' | 'right' | 'none', legs = SPRITE - top - 11) {
  c.rect(x0 + 4, top, 16, 11, BODY)
  if (arms === 'both' || arms === 'right') c.rect(x0 + 20, top + 4, 3, 3, BODY)
  if (arms === 'both') c.rect(x0 + 1, top + 4, 3, 3, BODY)
  c.rect(x0 + 8 + eyeDx, top + 3 + eyeDy, 2, 3, EYE)
  c.rect(x0 + 14 + eyeDx, top + 3 + eyeDy, 2, 3, EYE)
  for (const x of [5, 9, 13, 17]) c.rect(x0 + x, top + 11, 2, legs, BODY)
}

/** Faces left and hammers the chip on its left: 0 raised, 1 swinging, 2 hit, 3 hit with sparks. */
export function hammerPixels(pose: number): Uint8Array {
  const c = canvas()
  // High in the picture, flush left, so the hammer reaches the chip beside it.
  const top = 5
  figure(c, top, 0, -2, 0, 'right', 4)
  // Left arm: from the body out to a hand at x 2..3, raised, halfway or level.
  const hy = [top + 1, top + 3, top + 5, top + 5][pose]!
  c.rect(2, hy, 2, 2, BODY)
  if (pose === 0) {
    // Hammer up: handle straight up from the hand, head on top.
    c.rect(2, hy - 3, 1, 3, HANDLE)
    c.rect(0, hy - 6, 4, 3, IRON)
  } else if (pose === 1) {
    // Halfway: handle up and to the left, head above it.
    c.put(1, hy - 1, HANDLE)
    c.put(1, hy - 2, HANDLE)
    c.rect(0, hy - 6, 3, 4, IRON)
  } else {
    // Hit: the head against the left edge, which is the chip's frame.
    c.rect(0, hy - 2, 2, 4, IRON)
    if (pose === 3) {
      for (const [x, y] of [
        [0, hy - 4],
        [1, hy - 5],
        [3, hy - 4],
        [0, hy + 3],
        [2, hy + 4],
      ] as const)
        c.put(x, y, SPARK)
    }
  }
  return c.pixels()
}
