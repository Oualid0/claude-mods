// Pure logic of the band: what each ring shows, the todo bookkeeping and the
// optional usage-limits.json snapshot. No `$` in here, so the tests
// can drive it directly.

import type { TodoStatus, Todos, Usage } from '../types'

/** Claude's terracotta: every ring, frame and label. */
export const TERRACOTTA = '#d97757'

export const COLORS = {
  session: TERRACOTTA,
  context: TERRACOTTA,
  week: TERRACOTTA,
  todos: TERRACOTTA,
} as const

/** Two-letter label dimmed in front of each ring. */
export const SHORT = { week: 'Wk', session: 'Se', context: 'Cx', todos: 'Td' } as const

export type SegmentId = keyof typeof COLORS

export type Segment = {
  id: SegmentId
  short: string
  /** How full the ring is drawn, 0..100. */
  percent: number
  text: string
  color: string
}

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** Folds the engine's rate-limit windows into the band's usage. */
export function usageFrom(
  rateLimits: readonly RateLimit[],
  contextPercent: number | undefined,
  previous: Usage,
): Usage {
  const session = rateLimits.find(w => w.kind === 'five_hour')
  const week = rateLimits.find(w => w.kind === 'seven_day')
  return {
    sessionUsed: session?.percentUsed ?? previous.sessionUsed,
    sessionResetsAt: session ? session.resetsAt : previous.sessionResetsAt,
    weekUsed: week?.percentUsed ?? previous.weekUsed,
    contextUsed: contextPercent ?? previous.contextUsed,
  }
}

/** A span as the band shows it: `4:50h` from an hour up, `33m` below. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}h`
}

/** Time left until `resetsAt` (`4:50h`, `33m`); undefined when unknown or past. */
export function remaining(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return duration(ms)
}

const round = (n: number) => Math.round(n)

/** The session window's length, shown once a window has run out and the next has not begun. */
export const FRESH_WINDOW = '5:00h'

/** Whether the session window ending at `resetsAt` is over. */
export function hasReset(resetsAt: string | undefined, now: number): boolean {
  if (!resetsAt) return false
  const at = Date.parse(resetsAt)
  return Number.isFinite(at) && at <= now
}

export function todoCounts(todos: Todos): { done: number; total: number } {
  const statuses = Object.values(todos)
  return {
    done: statuses.filter(s => s === 'completed').length,
    total: statuses.length,
  }
}

/** The rings in band order (week, session, then context, todos); a ring without a figure is left out. */
export function segments(usage: Usage, todos: Todos, now: number): Segment[] {
  const out: Segment[] = []

  if (usage.weekUsed !== undefined) {
    const used = round(usage.weekUsed)
    out.push({ id: 'week', short: SHORT.week, percent: used, text: `${used}%`, color: COLORS.week })
  }
  if (usage.sessionUsed !== undefined) {
    // A window that ran out is empty and whole again until the next reading
    // brings the new one: 0% and its full five hours.
    const isOver = hasReset(usage.sessionResetsAt, now)
    const used = isOver ? 0 : round(usage.sessionUsed)
    const time = isOver ? FRESH_WINDOW : remaining(usage.sessionResetsAt, now)
    out.push({
      id: 'session',
      short: SHORT.session,
      percent: used,
      text: time ? `${used}% ${time}` : `${used}%`,
      color: COLORS.session,
    })
  }
  if (usage.contextUsed !== undefined) {
    const used = round(usage.contextUsed)
    out.push({ id: 'context', short: SHORT.context, percent: used, text: `${used}%`, color: COLORS.context })
  }
  const { done, total } = todoCounts(todos)
  if (total > 0) {
    out.push({
      id: 'todos',
      short: SHORT.todos,
      percent: (done / total) * 100,
      text: `${done}/${total}`,
      color: COLORS.todos,
    })
  }
  return out
}

export const RING_COLUMNS = 2
export const RING_ROWS = 1
/** Columns between two rings inside a chip. */
export const GAP = 2
/** Columns between the two chips. */
export const CHIP_GAP = 1
/** Columns a chip adds around its content: the frame and one column of padding, both sides. */
export const CHIP_FRAME = 4

/** Label in front of each chip's rings: the account's limits, then this chat's own. */
export const LABELS = { limits: 'limits', chat: 'chat' } as const

export type Groups = { limits: Segment[]; chat: Segment[] }

/** Splits the band into the limit rings (week, session) and the chat's own (context, todos). */
export function groups(list: readonly Segment[]): Groups {
  const isLimit = (s: Segment) => s.id === 'week' || s.id === 'session'
  return { limits: list.filter(isLimit), chat: list.filter(s => !isLimit(s)) }
}

/** The pixel Claude beside the chat chip, in terminal columns. */
export const SPRITE_COLUMNS = 6

/** Tokens as `812`, `4.6k`, `46k`, `4.6M`. */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Dollars as `$6.79`. */
export const money = (usd: number): string => `$${usd.toFixed(2)}`

/** Effort levels as the band shows them. */
export const EFFORT_SHORT: Record<string, string> = {
  low: 'low',
  medium: 'mid',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`; any other name as given. */
export function modelName(id: string): string {
  const bare = id.replace(/\[.*\]$/, '').trim()
  const parts = bare.replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p))
  const [family, ...version] = parts
  if (!family || !/^[a-z]+$/.test(family) || !version.every(v => /^\d+$/.test(v))) return bare
  const title = family[0]!.toUpperCase() + family.slice(1)
  return version.length > 0 ? `${title} ${version.join('.')}` : title
}

/** The label beside the pixel Claude: `Opus 5.5 (mid)`, or the name alone while the effort is unknown. */
export function modelLabel(id: string | undefined, effort: string | number | undefined): string | undefined {
  if (!id) return undefined
  const name = modelName(id)
  if (effort === undefined) return name
  return `${name} (${typeof effort === 'number' ? effort : (EFFORT_SHORT[effort] ?? effort)})`
}

/** What the chat chip shows besides its rings: tokens, cost and the cache's time left. */
export type Extras = { tokens: number; costUsd: number; cache?: string; model?: string }

/** What of the band fits: the rings kept and which of the chat's entries stay. */
export type Shown = {
  segments: Segment[]
  hasTokens: boolean
  hasCost: boolean
  hasCache: boolean
  hasModel: boolean
  /** The chips' words `limits` and `chat`. */
  hasLabels: boolean
  /** The pixel Claude. */
  hasSprite: boolean
}

/** Columns of a `Tk 4.6M` or `Co $6.79` entry: label, space, value. */
const entryWidth = (value: string) => 2 + 1 + value.length

/** Columns between two entries: their own gap around one blank. */
const EXTRAS_GAP = 3

/** The chat's entries that are shown, as `[label, value]`, in order. */
export function entries(extras: Extras, shown: Shown): [string, string][] {
  const out: [string, string][] = []
  if (shown.hasTokens) out.push(['Tk', compact(extras.tokens)])
  if (shown.hasCost) out.push(['Co', money(extras.costUsd)])
  if (shown.hasCache && extras.cache !== undefined) out.push(['Ca', extras.cache])
  return out
}

function extrasWidth(extras: Extras, shown: Shown): number {
  const list = entries(extras, shown)
  if (list.length === 0) return 0
  return list.reduce((sum, [, value]) => sum + entryWidth(value), 0) + (list.length - 1) * EXTRAS_GAP
}

/** A chip: frame, label, then the items, each `GAP` apart; 0 without items. `extra` is the width of a trailing non-ring item. */
function chipWidth(label: string | undefined, list: readonly Segment[], extra = 0): number {
  const items = list.map(s => s.short.length + 1 + RING_COLUMNS + 1 + s.text.length)
  if (extra > 0) items.push(extra)
  if (items.length === 0) return 0
  const labelWidth = label === undefined ? 0 : label.length + 1
  return CHIP_FRAME + labelWidth + items.reduce((a, b) => a + b, 0) + (items.length - 1) * GAP
}

export function widthOf(extras: Extras, shown: Shown): number {
  const { limits, chat } = groups(shown.segments)
  const limitsChip = chipWidth(shown.hasLabels ? LABELS.limits : undefined, limits)
  const chatChip = chipWidth(shown.hasLabels ? LABELS.chat : undefined, chat, extrasWidth(extras, shown))
  const chips = limitsChip + chatChip + (limitsChip > 0 && chatChip > 0 ? CHIP_GAP : 0)
  const sprite = shown.hasSprite ? SPRITE_COLUMNS : 0
  const model = shown.hasModel && extras.model !== undefined ? MODEL_GAP + extras.model.length : 0
  return chips + sprite + model
}

/** Columns between the pixel Claude and the model label. */
export const MODEL_GAP = 1

/**
 * What of the band fits `columns`, dropping the least important first: the
 * model label, the chips' words, the cache, the cost, the tokens, todos, the
 * weekly ring, the pixel Claude, the context ring. The session ring goes
 * last: null when not even it fits, and the band shows nothing.
 */
export function fit(list: readonly Segment[], extras: Extras, columns: number): Shown | null {
  const shown: Shown = {
    segments: [...list],
    hasTokens: true,
    hasCost: true,
    hasCache: true,
    hasModel: true,
    hasLabels: true,
    hasSprite: true,
  }
  const without = (id: SegmentId) => () => (shown.segments = shown.segments.filter(s => s.id !== id))
  const drops: (() => void)[] = [
    () => (shown.hasModel = false),
    () => (shown.hasLabels = false),
    () => (shown.hasCache = false),
    () => (shown.hasCost = false),
    () => (shown.hasTokens = false),
    without('todos'),
    without('week'),
    () => (shown.hasSprite = false),
    without('context'),
  ]
  for (const drop of drops) {
    if (widthOf(extras, shown) <= columns) return shown
    drop()
  }
  return widthOf(extras, shown) <= columns ? shown : null
}

// --- todos -------------------------------------------------------------------

export function withCreated(todos: Todos, id: string): Todos {
  return { ...todos, [id]: 'pending' }
}

export function withUpdated(todos: Todos, id: string, status: string | undefined): Todos {
  if (status === 'deleted') {
    const { [id]: _gone, ...rest } = todos
    return rest
  }
  if (status === 'pending' || status === 'in_progress' || status === 'completed') {
    return { ...todos, [id]: status }
  }
  return todos
}

export function fromList(list: readonly { id: string; status: string }[]): Todos {
  const out: Todos = {}
  for (const t of list) out[t.id] = t.status as TodoStatus
  return out
}

/** TodoWrite replaces the whole list; its entries have no ids, so index them. */
export function fromTodoWrite(list: readonly { status: string }[]): Todos {
  const out: Todos = {}
  list.forEach((t, i) => {
    out[`todo-${i}`] = t.status as TodoStatus
  })
  return out
}

// --- usage-limits.json -------------------------------------------------------

type Window = { usedPercent: number; resetsAt: string | null; status: null }

export type Snapshot = {
  session: Window | null
  week: Window | null
  updatedAt: string
  model: string
}

/**
 * The limits as `usage-limits.json` holds them for other tools; null when the
 * engine has no limit reading, so a good snapshot is never overwritten by an
 * empty one.
 */
export function snapshot(
  rateLimits: readonly RateLimit[],
  now: number,
  model: string,
): Snapshot | null {
  const window = (kind: string): Window | null => {
    const w = rateLimits.find(r => r.kind === kind)
    return w ? { usedPercent: w.percentUsed, resetsAt: w.resetsAt ?? null, status: null } : null
  }
  const session = window('five_hour')
  const week = window('seven_day')
  if (!session && !week) return null
  return { session, week, updatedAt: new Date(now).toISOString(), model }
}
