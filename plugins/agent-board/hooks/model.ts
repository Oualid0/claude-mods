import type { Agent, AgentState, Tier, Tokens } from '../types'
import type { CrewState, CrewTier } from './workers'

export const TERRACOTTA = '#d97757'
export const ALERT = '#e5484d'
/** A count of zero running: terracotta muted, not bold, so it stands apart from the grey labels. */
export const ZERO = '#9a5a44'

/** Columns between two items inside the chip. */
export const GAP = 2
/** Border and padding of a chip: `╭ ` and ` ╮`. */
const CHIP_FRAME = 4
const LABEL = 'agents'

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'other']
/** Each family's label: the full name, the two letters when the row is narrow or `compact` is set. */
export const NAME: Record<Tier, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', other: 'Other' }
export const SHORT: Record<Tier, string> = { haiku: 'Ha', sonnet: 'So', opus: 'Op', other: 'Ot' }
/**
 * Each family's neon color, for its label, its run of the token bar and its crew
 * member's hat; the main loop in Claude's own. `other` is a grey darker than the cold grey of usage-ring's cache.
 */
export const COLOR: Record<Tier | 'main', string> = {
  main: TERRACOTTA,
  haiku: '#39ff88',
  sonnet: '#22d3ff',
  opus: '#b26bff',
  other: '#6a6a6a',
}
/** Cells of the token bar. */
export const BAR_CELLS = 12
const BAR_NAME = 'Split'
const BAR_SHORT = 'Sp'

/** How many agents of a family may run at once; a family left out has no limit (only its count). */
export type Limits = Partial<Record<Tier, number>>

/** The limits from the plugin's options; only a whole number from 1 up counts, anything else means none. */
export function limitsFrom(options: Readonly<Record<string, unknown>>): Limits {
  const whole = (n: number) => (Number.isInteger(n) && n >= 1 ? n : undefined)
  const one = (v: unknown) => (typeof v === 'number' ? whole(v) : typeof v === 'string' ? whole(Number(v)) : undefined)
  return { haiku: one(options.maxHaiku), sonnet: one(options.maxSonnet), opus: one(options.maxOpus) }
}

/** Minutes the row stays after the last subagent ended. */
export const HIDE_AFTER = 5

/** The idle time in ms after which the row hides; 0 never hides, anything not a number of minutes is HIDE_AFTER. */
export function hideAfterFrom(options: Readonly<Record<string, unknown>>): number {
  const v = options.hideAfter
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return (Number.isFinite(n) && n >= 0 ? n : HIDE_AFTER) * 60_000
}

/** Whether an option is on: `true`, or the text `true` (the CLI hands options over as strings). */
export const flagFrom = (v: unknown): boolean => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')

/** What the row shows besides the counts; each is an option, off by default. */
export type Display = {
  /** The words `agents` and `Split` (the chip's title and the bar's label). */
  titles: boolean
  /** Always the two-letter labels, not only when the row is narrow. */
  compact: boolean
  /** A family appears only once it had a subagent in this chat. */
  hideUnused: boolean
}

export function displayFrom(options: Readonly<Record<string, unknown>>): Display {
  return { titles: flagFrom(options.titles), compact: flagFrom(options.compact), hideUnused: flagFrom(options.hideUnused) }
}

export function tierOf(model: string): Tier {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  return 'other'
}

export const isLive = (s: AgentState): boolean => s === 'running' || s === 'waiting'

/** Ms without new tokens after which a live subagent counts as stalled. */
export const STALL_AFTER = 5 * 60_000

/** Whether `a` is live and has used no tokens for STALL_AFTER; one with no token time yet is not. */
export const isStalled = (a: Agent, now: number): boolean =>
  isLive(a.state) && a.lastTokenAt !== undefined && now - a.lastTokenAt >= STALL_AFTER

/** Ms without tokens after which a live agent the engine's list never showed (a workflow's) counts as done. */
export const ABANDON_AFTER = 30 * 60_000

/**
 * Whether `a` is live, was never in the engine's list (which would end it) and has
 * used no tokens for ABANDON_AFTER; a later request revives it.
 */
export const isAbandoned = (a: Agent, now: number): boolean =>
  isLive(a.state) && !a.isListed && a.lastTokenAt !== undefined && now - a.lastTokenAt >= ABANDON_AFTER

/**
 * What each crew member does: works while its family has a live agent still using
 * tokens, waits when all its live agents are stalled, sleeps with none live.
 */
export function crewStates(agents: Record<string, Agent>, now: number): Record<CrewTier, CrewState> {
  const list = Object.values(agents)
  const one = (tier: CrewTier): CrewState => {
    const live = list.filter(a => a.tier === tier && isLive(a.state))
    if (live.length === 0) return 'sleep'
    return live.every(a => isStalled(a, now)) ? 'wait' : 'work'
  }
  return { haiku: one('haiku'), sonnet: one('sonnet'), opus: one('opus') }
}

export type Segment = {
  tier: Tier
  name: string
  short: string
  running: number
  done: number
  limit?: number
  isOver: boolean
}

/**
 * One segment per family once any agent exists: Haiku, Sonnet and Opus always, Other
 * only when used. With `isUnusedHidden` a family also needs an agent of its own.
 */
export function segments(agents: Record<string, Agent>, limits: Limits, isUnusedHidden = false): Segment[] {
  const list = Object.values(agents)
  if (list.length === 0) return []
  return TIERS.flatMap(tier => {
    const mine = list.filter(a => a.tier === tier)
    if ((tier === 'other' || isUnusedHidden) && mine.length === 0) return []
    const running = mine.filter(a => isLive(a.state)).length
    const done = mine.length - running
    const limit = limits[tier]
    return [{ tier, name: NAME[tier], short: SHORT[tier], running, done, limit, isOver: limit !== undefined && running > limit }]
  })
}

/** One run of the token bar: whose tokens, and how many cells they take. */
export type BarPart = { key: Tier | 'main'; cells: number }

/**
 * The token bar: the main loop and each family by its share of all this chat's
 * tokens, in BAR_CELLS cells (largest remainders, every share above 0 keeps at
 * least one cell, taken from the largest); empty before any tokens.
 */
export function bar(tokens: Tokens): BarPart[] {
  const keys = ['main', ...TIERS] as const
  const total = keys.reduce((sum, k) => sum + (tokens[k] ?? 0), 0)
  if (total === 0) return []
  const exact = keys.map(k => ((tokens[k] ?? 0) / total) * BAR_CELLS)
  const cells = exact.map(Math.floor)
  let left = BAR_CELLS - cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left-- <= 0) break
    cells[i]!++
  }
  // Five keys at most in twelve cells: a missing one always finds a run of three or more to take from.
  keys.forEach((k, i) => {
    if ((tokens[k] ?? 0) <= 0 || cells[i]! > 0) return
    cells[cells.indexOf(Math.max(...cells))]!--
    cells[i] = 1
  })
  return keys.map((key, i) => ({ key, cells: cells[i]! })).filter(p => p.cells > 0)
}

/** What the row draws; `fit` turns parts off, starting from what the options ask for. */
export type Shown = { hasLongNames: boolean; hasTitles: boolean; hasBar: boolean; hasDone: boolean; hasCrew: boolean }

/** Columns of the crew right of the chip (60 x 24 sprite pixels at the size of usage-ring's Claude), and the gap before it. */
export const CREW_COLUMNS = 15
const CREW_GAP = 1

const countText = (s: Segment): string => (s.limit !== undefined ? `${s.running}/${s.limit}` : `${s.running}`)

/** The texts of one entry; the done count (`✔3`) only from one up, and only while `hasDone`. */
export function segmentText(s: Segment, shown: Shown): { label: string; count: string; done?: string } {
  return {
    label: shown.hasLongNames ? s.name : s.short,
    count: countText(s),
    done: shown.hasDone && s.done >= 1 ? `✔${s.done}` : undefined,
  }
}

function width(list: Segment[], shown: Shown): number {
  const items = list.map(s => {
    const t = segmentText(s, shown)
    return t.label.length + 1 + t.count.length + (t.done ? 1 + t.done.length : 0)
  })
  const body = items.reduce((w, n) => w + n, 0) + GAP * Math.max(0, items.length - 1)
  // The gap, the title `Split ` if shown, and the cells.
  const tk = shown.hasBar ? 1 + (shown.hasTitles ? barLabel(shown).length + 1 : 0) + BAR_CELLS : 0
  const chip = CHIP_FRAME + (shown.hasTitles ? LABEL.length + 1 : 0) + body + tk
  return chip + (shown.hasCrew ? CREW_GAP + CREW_COLUMNS : 0)
}

/**
 * What fits in `columns`, starting from what the options ask for (`titles` on, `compact` off
 * by default). Drops in this order, the least useful first: the long names (two letters
 * instead), the titles `agents` and `Split`, the token bar, the done counts, the crew. What the
 * options already left out is skipped. Null when not even the counts fit.
 */
export function fit(list: Segment[], columns: number, display: Pick<Display, 'titles' | 'compact'> = { titles: false, compact: false }): Shown | null {
  let shown: Shown = { hasLongNames: !display.compact, hasTitles: display.titles, hasBar: true, hasDone: true, hasCrew: true }
  const drops: (keyof Shown)[] = ['hasLongNames', 'hasTitles', 'hasBar', 'hasDone', 'hasCrew']
  for (const drop of drops) {
    if (width(list, shown) <= columns) return shown
    shown = { ...shown, [drop]: false }
  }
  return width(list, shown) <= columns ? shown : null
}

export const LABEL_TEXT = LABEL
/** The token bar's title. */
export const barLabel = (shown: Shown): string => (shown.hasLongNames ? BAR_NAME : BAR_SHORT)
