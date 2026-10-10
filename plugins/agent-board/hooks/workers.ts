// Pure pixel logic of the crew right of the agents chip: one small pixel Claude
// in a hard hat per model family, at work while the family has a subagent
// running, waiting when all its subagents stalled, asleep otherwise. No `$` in here, so tests can drive it directly.
import { COLOR } from './model'
import { hexToRgb, hot } from './ring'
import type { Rgb } from './ring'

export type CrewTier = 'haiku' | 'sonnet' | 'opus'
export const CREW: readonly CrewTier[] = ['haiku', 'sonnet', 'opus']
/** What a worker does: works, waits (its subagents stalled), or sleeps (none running). */
export type CrewState = 'work' | 'wait' | 'sleep'

/** Each worker gets a slot SLOT pixels wide; the crew is as tall as the pixel Claude below. */
const SLOT = 20
export const CREW_W = SLOT * CREW.length
export const CREW_H = 24
/** Each sprite pixel becomes SCALE x SCALE image pixels, so the terminal scales crisp blocks. */
export const SCALE = 4
/** The crew is 60 x 24 pixels on 3 rows (its columns are CREW_COLUMNS in `model`). */
export const CREW_ROWS = 3
/** Frames of a working loop, and of the waiting one. */
export const WORK_FRAMES = 4
/** Phases of the sleeping z's. */
export const Z_PHASES = 12
/** The frame counter wraps here: a multiple of the z cycle (2 frames a phase) and of the work loop, so no animation jumps. */
export const FRAME_WRAP = Z_PHASES * 2 * 400
/** While the whole crew sleeps, a frame step comes every SLEEP_EVERY ticks and moves that many frames, so the z's keep their pace. */
export const SLEEP_EVERY = 3

/** How far the frame counter moves on tick number `tick`; 0 skips the tick (no redraw while all sleep). */
export function frameStep(isAsleep: boolean, tick: number): number {
  if (!isAsleep) return 1
  return tick % SLEEP_EVERY === 0 ? SLEEP_EVERY : 0
}

/** The frame `step` frames on, wrapping at FRAME_WRAP. */
export const nextFrame = (frame: number, step = 1): number => (frame + step) % FRAME_WRAP

const BODY = hexToRgb('#d97757')
const EYE: Rgb = [38, 24, 20]
const WOOD: Rgb = [139, 90, 60]
const IRON: Rgb = [150, 150, 158]
const PAPER: Rgb = [245, 245, 240]
const BOX: Rgb = [176, 124, 72]
const BOX_EDGE: Rgb = [120, 80, 45]
const DIRT: Rgb = [120, 84, 52]
const TICK: Rgb = [90, 170, 90]
const Z_RGB = hexToRgb(hot('#d97757'))

/** The hard hat per family, in its color from the split bar. */
const HELMET: Record<CrewTier, Rgb> = {
  haiku: hexToRgb(COLOR.haiku),
  sonnet: hexToRgb(COLOR.sonnet),
  opus: hexToRgb(COLOR.opus),
}

const Z = ['###', '.#.', '###']

type Grid = (Rgb | null)[][]
type Paint = { put: (x: number, y: number, rgb: Rgb) => void; rect: (x: number, y: number, w: number, h: number, rgb: Rgb) => void }

function canvas(): Paint & { grid: Grid } {
  const grid: Grid = Array.from({ length: CREW_H }, () => Array<Rgb | null>(CREW_W).fill(null))
  const put = (x: number, y: number, rgb: Rgb) => {
    if (x < 0 || y < 0 || x >= CREW_W || y >= CREW_H) return
    grid[y]![x] = rgb
  }
  const rect = (x0: number, y0: number, w: number, h: number, rgb: Rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, rgb)
  }
  return { grid, put, rect }
}

function toPixels(grid: Grid): Uint8Array {
  const w = CREW_W * SCALE
  const h = CREW_H * SCALE
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const rgb = grid[Math.floor(y / SCALE)]![Math.floor(x / SCALE)]
      if (!rgb) continue
      const i = (y * w + x) * 4
      px[i] = rgb[0]
      px[i + 1] = rgb[1]
      px[i + 2] = rgb[2]
      px[i + 3] = 255
    }
  return px
}

/** Body top row: the hat sits on rows 7..10, the legs end on row 21. */
const TOP = 11

type Legs = 'still' | 'left' | 'right' | 'tap'

/** One worker, its body 16 pixels wide from `x + 2`; `dy` bobs it, `isArmsUp` lifts both arms, `gaze` moves the eyes. */
function worker(p: Paint, slot: number, tier: CrewTier, isAwake: boolean, dy = 0, legs: Legs = 'still', isArmsUp = false, gaze = 0) {
  const { rect } = p
  const x = slot + 2
  const top = TOP + dy
  const hat = HELMET[tier]
  rect(x + 5, top - 4, 6, 1, hat)
  rect(x + 4, top - 3, 8, 2, hat)
  rect(x + 2, top - 1, 12, 1, hat)
  rect(x + 3, top, 10, 8, BODY)
  if (isArmsUp) {
    rect(x + 1, top - 2, 2, 4, BODY)
    rect(x + 13, top - 2, 2, 4, BODY)
  } else {
    rect(x + 1, top + 3, 2, 2, BODY)
    rect(x + 13, top + 3, 2, 2, BODY)
  }
  if (isAwake) {
    rect(x + 5 + gaze, top + 2, 1, 2, EYE)
    rect(x + 10 + gaze, top + 2, 1, 2, EYE)
  } else {
    rect(x + 4, top + 3, 3, 1, EYE)
    rect(x + 9, top + 3, 3, 1, EYE)
  }
  // Walking: every other leg one pixel shorter, alternating; tapping: only the right foot lifts.
  const short = legs === 'left' ? [6, 11] : legs === 'right' ? [4, 9] : legs === 'tap' ? [11] : []
  for (const dx of [4, 6, 9, 11]) rect(x + dx, top + 8, 1, short.includes(dx) ? 2 : 3, BODY)
}

/** Haiku: walks in place with a crate held over the head. */
function crate(p: Paint, slot: number, frame: number) {
  const { rect } = p
  const dy = frame % 2
  worker(p, slot, 'haiku', true, dy, dy ? 'left' : 'right', true)
  const x = slot + 5
  const y = TOP - 8 + dy
  rect(x, y, 10, 5, BOX)
  rect(x, y, 10, 1, BOX_EDGE)
  rect(x + 4, y, 2, 5, BOX_EDGE)
}

/** Sonnet: the shovel goes into the ground, then throws the dirt up. */
function shovel(p: Paint, slot: number, frame: number) {
  const { rect } = p
  worker(p, slot, 'sonnet', true)
  rect(slot + 15, TOP + 10, 5, 1, DIRT)
  if (frame % 2 === 0) {
    rect(slot + 16, TOP - 1, 1, 9, WOOD)
    rect(slot + 15, TOP + 8, 3, 2, IRON)
  } else {
    rect(slot + 15, TOP + 2, 1, 4, WOOD)
    rect(slot + 16, TOP + 1, 1, 1, WOOD)
    rect(slot + 17, TOP - 1, 3, 2, IRON)
    rect(slot + 18, TOP - 3, 1, 1, DIRT)
    rect(slot + 19, TOP - 5, 1, 1, DIRT)
    if (frame === 3) rect(slot + 17, TOP - 6, 1, 1, DIRT)
  }
}

/** Opus: a big clipboard, one line ticked green per frame, the pencil beside it. */
function clipboard(p: Paint, slot: number, frame: number) {
  const { rect } = p
  worker(p, slot, 'opus', true)
  const ticks = frame % WORK_FRAMES
  rect(slot + 13, TOP - 1, 7, 9, WOOD)
  rect(slot + 14, TOP, 5, 7, PAPER)
  for (let i = 0; i < ticks; i++) rect(slot + 15, TOP + 1 + i * 2, 3, 1, TICK)
  rect(slot + 19, TOP - 1 + ticks * 2, 1, 3, EYE)
}

/** Waiting: stands, looks at a small clock on its wrist, whose hand ticks round, and taps its foot. */
function waiting(p: Paint, slot: number, tier: CrewTier, frame: number) {
  const { rect, put } = p
  worker(p, slot, tier, true, 0, frame % 2 ? 'tap' : 'still', false, 1)
  const x = slot + 14
  // The right arm reaches out below the clock, which sits in front of the body.
  rect(slot + 15, TOP + 5, 2, 2, BODY)
  rect(x, TOP, 5, 5, IRON)
  rect(x + 1, TOP + 1, 3, 3, PAPER)
  put(x + 2, TOP + 2, EYE)
  // The hand points up, right, down, left.
  const [hx, hy] = [
    [2, 1],
    [3, 2],
    [2, 3],
    [1, 2],
  ][frame % WORK_FRAMES]!
  put(x + hx!, TOP + hy!, EYE)
}

function zs(p: Paint, x: number, zPhase: number) {
  // Two z's one by one, then a pause: the slot is too small for a third.
  const shown = zPhase < 8 ? Math.floor(zPhase / 4) + 1 : 0
  const spots = [
    [x + 12, 3],
    [x + 8, 0],
  ] as const
  spots.slice(0, shown).forEach(([x0, y0]) =>
    Z.forEach((line, dy) => {
      for (let dx = 0; dx < line.length; dx++) if (line[dx] === '#') p.put(x0 + dx, y0 + dy, Z_RGB)
    }),
  )
}

/**
 * The crew: Haiku, Sonnet, Opus left to right, each at work (`frame`) or waiting
 * with its clock as `states` says for its family, asleep with rising z's otherwise.
 */
export function crewPixels(states: Record<CrewTier, CrewState>, frame: number): Uint8Array {
  const c = canvas()
  const f = frame % WORK_FRAMES
  const zPhase = Math.floor(frame / 2) % Z_PHASES
  CREW.forEach((tier, i) => {
    const slot = i * SLOT
    if (states[tier] === 'sleep') {
      worker(c, slot, tier, false)
      zs(c, slot + 2, zPhase)
    } else if (states[tier] === 'wait') waiting(c, slot, tier, f)
    else if (tier === 'haiku') crate(c, slot, f)
    else if (tier === 'sonnet') shovel(c, slot, f)
    else clipboard(c, slot, f)
  })
  return toPixels(c.grid)
}

/** The image key for a crew state: one picture per family state, work frame and z phase. */
export function crewKey(crew: Record<CrewTier, CrewState>, frame: number): string {
  const letter = { work: 'w', wait: 'c', sleep: 's' } as const
  const states = CREW.map(t => letter[crew[t]]).join('')
  // Only what changes the picture: the frame while one works or waits, the z phase while one sleeps.
  const work = /[wc]/.test(states) ? frame % WORK_FRAMES : '-'
  const zs = states.includes('s') ? Math.floor(frame / 2) % Z_PHASES : '-'
  return `c${states}${work}.${zs}`
}
