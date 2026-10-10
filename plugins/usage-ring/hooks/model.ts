// Pure logic of the band: what each entry shows, the todo bookkeeping and the
// optional usage-limits.json snapshot. No `$` in here, so the tests
// can drive it directly.

import type { TodoStatus, Todos, TokenLog, Usage } from '../types'

/** Claude's terracotta: every ring, the frame and the titles. */
export const TERRACOTTA = '#d97757'

/** A red that sits next to the terracotta: rings from 95% on and a cache about to lapse. */
export const ALERT = '#e5484d'
/** A yellow that sits next to the terracotta and the red: a context filling up, a cache running low. */
export const WARN = '#e5b83c'
/** The grey of a cache that holds nothing (cold). */
export const GREY = '#8a8a8a'
/** A muted terracotta for a value of 0: apart from the grey labels, quieter than the bright values. */
export const ZERO = '#9a5a44'
/** From this fill on a limit ring turns red. */
export const ALERT_PERCENT = 95
/** From this fill on the context ring turns yellow, then red. */
export const CONTEXT_WARN_PERCENT = 50
export const CONTEXT_ALERT_PERCENT = 80

/** The color of a limit ring: red from 95%, otherwise `base`. */
export const ringColor = (percent: number, base: string): string => (percent >= ALERT_PERCENT ? ALERT : base)

/** The color of the context ring: yellow from 50%, red from 80%, otherwise `base`. */
export const contextColor = (percent: number, base: string): string =>
  percent >= CONTEXT_ALERT_PERCENT ? ALERT : percent >= CONTEXT_WARN_PERCENT ? WARN : base

export const COLORS = {
  session: TERRACOTTA,
  context: TERRACOTTA,
  week: TERRACOTTA,
  todos: TERRACOTTA,
  cache: TERRACOTTA,
} as const

/** The label dimmed in front of each entry: the full word, the two letters when the band is narrow or `compact` is on. */
export const NAME = { week: 'Week', session: 'Session', context: 'Context', todos: 'Todos', cache: 'Cache' } as const
export const SHORT = { week: 'Wk', session: 'Se', context: 'Cx', todos: 'Td', cache: 'Ca' } as const

export type SegmentId = keyof typeof COLORS

export type Segment = {
  id: SegmentId
  name: string
  short: string
  /** Whether a ring is drawn in front of `text` (week, session, context); todos and the cache are text only. */
  hasRing: boolean
  /** How full the ring is drawn, 0..100. */
  percent: number
  text: string
  /** The color of `text` when it differs from `color` (a cold cache: red word). */
  textColor?: string
  /** The value is 0: it is drawn in the ZERO color (never a warning or alert color, which start well above 0). */
  isDim?: boolean
  /** The time part of `text` (`4:54`); it keeps the base color when the ring turns red. */
  time?: string
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
    contextUsed: contextPercent,
  }
}

/** A span as the band shows it: `4:50` (hours:minutes) from an hour up, `33m` below. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Time left until `resetsAt` (`4:50`, `33m`); undefined when unknown or past. */
export function remaining(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return duration(ms)
}

/** A displayed percentage: rounded and held to 0..100; undefined for a missing or non-finite figure. */
function clamp(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined
}

/** The session window's length, shown once a window has run out and the next has not begun. */
export const FRESH_WINDOW = '5:00'

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

/** The entries in band order (week, session, then context, todos); one without a finite figure is left out, a percentage is held to 0..100. The cache entry comes from cache.ts. */
export function segments(usage: Usage, todos: Todos, now: number): Segment[] {
  const out: Segment[] = []

  const weekUsed = clamp(usage.weekUsed)
  if (weekUsed !== undefined) {
    out.push({ id: 'week', name: NAME.week, short: SHORT.week, hasRing: true, isDim: weekUsed === 0, percent: weekUsed, text: `${weekUsed}%`, color: ringColor(weekUsed, COLORS.week) })
  }
  const sessionUsed = clamp(usage.sessionUsed)
  if (sessionUsed !== undefined) {
    // A window that ran out is empty and whole again until the next reading
    // brings the new one: 0% and its full five hours.
    const isOver = hasReset(usage.sessionResetsAt, now)
    const used = isOver ? 0 : sessionUsed
    const time = isOver ? FRESH_WINDOW : remaining(usage.sessionResetsAt, now)
    out.push({
      id: 'session',
      name: NAME.session, short: SHORT.session,
      hasRing: true,
      isDim: used === 0,
      percent: used,
      text: time ? `${used}% ${time}` : `${used}%`,
      time,
      color: ringColor(used, COLORS.session),
    })
  }
  const contextUsed = clamp(usage.contextUsed)
  if (contextUsed !== undefined) {
    out.push({ id: 'context', name: NAME.context, short: SHORT.context, hasRing: true, isDim: contextUsed === 0, percent: contextUsed, text: `${contextUsed}%`, color: contextColor(contextUsed, COLORS.context) })
  }
  const { done, total } = todoCounts(todos)
  if (total > 0) {
    out.push({
      id: 'todos',
      name: NAME.todos, short: SHORT.todos,
      hasRing: false,
      isDim: done === 0,
      percent: (done / total) * 100,
      text: `${done}/${total}`,
      color: COLORS.todos,
    })
  }
  return out
}

export const RING_COLUMNS = 2
export const RING_ROWS = 1
/** Columns between two entries inside a group. */
export const GAP = 2
/** Between two groups, spaces included; drawn dimmed. */
export const SEPARATOR = ' │ '
/** Columns the frame adds around its content: the border and one column of padding, both sides. */
export const FRAME = 4

/** Title of each group: the account's limits, this chat's own, then its tokens. */
export const LABELS = { limits: 'limits', chat: 'chat', tokens: 'tokens' } as const

export type Groups = { limits: Segment[]; chat: Segment[] }

/** The chat group's entries in the order they are drawn. */
const CHAT_ORDER: SegmentId[] = ['context', 'cache', 'todos']

/** Splits the band into the limits (week, session) and the chat's own (context, cache, todos). */
export function groups(list: readonly Segment[]): Groups {
  const isLimit = (s: Segment) => s.id === 'week' || s.id === 'session'
  const chat = list.filter(s => !isLimit(s))
  return { limits: list.filter(isLimit), chat: chat.sort((a, b) => CHAT_ORDER.indexOf(a.id) - CHAT_ORDER.indexOf(b.id)) }
}

/** The pixel Claude beside the frame, in terminal columns. */
export const SPRITE_COLUMNS = 6

/** Tokens as `812`, `4.6k`, `46k`, `4.6M`. */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

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

/** The tokens group: all tokens of this chat, and what the last minute used. */
export type Extras = { total: number; rate: number; model?: string }

/** What of the band fits: the entries kept and which of the other parts stay. */
export type Shown = {
  segments: Segment[]
  /** The tokens entry's total; without it the whole entry (and group) goes. */
  hasTotal: boolean
  /** The tokens entry's rate, after the total. */
  hasRate: boolean
  hasModel: boolean
  /** The groups' titles `limits`, `chat` and `tokens`. */
  hasTitles: boolean
  /** The pixel Claude. */
  hasSprite: boolean
  /** Full words (`Week`, `Tokens`) as labels; two letters (`Wk`, `Tk`) without. */
  hasLongNames: boolean
}

/** The label shown in front of an entry. */
export const labelOf = (s: Segment, shown: Shown): string => (shown.hasLongNames ? s.name : s.short)

/** The window the token rate counts: the last minute. */
export const RATE_WINDOW_MS = 60_000

/** Tokens of the last minute per second, rounded to whole units, with the unit: `800 tok/s`, `6k tok/s`. */
export function perSecond(n: number): string {
  const r = Math.round(n / (RATE_WINDOW_MS / 1000))
  if (r < 1000) return `${r} tok/s`
  if (r < 999_500) return `${Math.round(r / 1000)}k tok/s`
  return `${Math.round(r / 1_000_000)}M tok/s`
}

/** The log with a request of `used` tokens at `at` added and everything older than the window dropped. */
export function withTokens(log: TokenLog, at: number, used: number): TokenLog {
  return [...log.filter(([t]) => t > at - RATE_WINDOW_MS), [at, used]]
}

/** Tokens used in the last minute before `now`; 0 in a pause. */
export function rateAt(log: TokenLog, now: number): number {
  return log.reduce((sum, [t, n]) => (t > now - RATE_WINDOW_MS && t <= now ? sum + n : sum), 0)
}

/** The label of the tokens entry. */
const TOKENS_NAME = 'Tokens'
const TOKENS_SHORT = 'Tk'

/** The tokens group's one entry: the label, the chat's total, then the rate; undefined once the total is dropped. */
export type TokensEntry = {
  label: string
  total: string
  rate?: string
  /** A 0 total, or a rate that shows as 0, is drawn in the ZERO color. */
  isTotalZero: boolean
  isRateZero: boolean
}

export function tokensEntry(extras: Extras, shown: Shown): TokensEntry | undefined {
  if (!shown.hasTotal) return undefined
  return {
    label: shown.hasLongNames ? TOKENS_NAME : TOKENS_SHORT,
    total: compact(extras.total),
    rate: shown.hasRate ? perSecond(extras.rate) : undefined,
    isTotalZero: extras.total === 0,
    isRateZero: Math.round(extras.rate / (RATE_WINDOW_MS / 1000)) === 0,
  }
}

/** Columns of the tokens entry: label, space, total, then `GAP` and the rate (if shown). */
const tokensWidth = (t: TokensEntry) => t.label.length + 1 + t.total.length + (t.rate === undefined ? 0 : GAP + t.rate.length)

/** A group: its title, then the items, each `GAP` apart; 0 without items. `widths` are the items' columns. */
function groupWidth(title: string | undefined, widths: readonly number[]): number {
  if (widths.length === 0) return 0
  const titleWidth = title === undefined ? 0 : title.length + 1
  return titleWidth + widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * GAP
}

/** Columns of an entry: label, space, then the ring and a space (if it has one), then the value. */
const entryWidth = (s: Segment, shown: Shown) =>
  labelOf(s, shown).length + 1 + (s.hasRing ? RING_COLUMNS + 1 : 0) + s.text.length

/** Columns of the whole band: the one frame around the groups, the pixel Claude and the model label. */
export function widthOf(extras: Extras, shown: Shown): number {
  const { limits, chat } = groups(shown.segments)
  const title = (word: string) => (shown.hasTitles ? word : undefined)
  const entry = tokensEntry(extras, shown)
  const tokens = entry ? [tokensWidth(entry)] : []
  const widths = [
    groupWidth(title(LABELS.limits), limits.map(s => entryWidth(s, shown))),
    groupWidth(title(LABELS.chat), chat.map(s => entryWidth(s, shown))),
    groupWidth(title(LABELS.tokens), tokens),
  ].filter(w => w > 0)
  const frame = widths.length === 0 ? 0 : FRAME + widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * SEPARATOR.length
  const sprite = shown.hasSprite ? SPRITE_COLUMNS : 0
  const model = shown.hasModel && extras.model !== undefined ? MODEL_GAP + extras.model.length : 0
  return frame + sprite + model
}

/** Columns between the pixel Claude and the model label. */
export const MODEL_GAP = 1

/** The options that set how the band starts out before `fit` drops anything. */
export type Layout = {
  /** Start with the groups' titles. */
  titles?: boolean
  /** Start with the two-letter labels. */
  compact?: boolean
  /** Show the tokens group at all. */
  tokens?: boolean
}

/** Whether a `userConfig` boolean is on: the CLI may hand it over as `true` or as the string `"true"`. */
export const isOn = (value: unknown): boolean => value === true || value === 'true'

/**
 * What of the band fits `columns`, shortening the labels to two letters first
 * (unless `layout.compact` did), then dropping the least important: the model
 * label, the groups' titles, the rate, the total (and with it the tokens group),
 * the cache, todos, the weekly ring, the pixel Claude, the context ring. The
 * session ring goes last (without a limit reading, whichever entry is left):
 * null when not even one fits, and the band shows nothing. A step that has
 * nothing to take away (no titles, no model label, no tokens group) costs no width.
 */
export function fit(list: readonly Segment[], extras: Extras, columns: number, layout: Layout = {}): Shown | null {
  const shown: Shown = {
    segments: [...list],
    hasTotal: layout.tokens === true,
    hasRate: layout.tokens === true,
    hasModel: true,
    hasTitles: layout.titles === true,
    hasSprite: true,
    hasLongNames: layout.compact !== true,
  }
  const without = (id: SegmentId) => () => (shown.segments = shown.segments.filter(s => s.id !== id))
  const drops: (() => void)[] = [
    () => (shown.hasLongNames = false),
    () => (shown.hasModel = false),
    () => (shown.hasTitles = false),
    () => (shown.hasRate = false),
    () => (shown.hasTotal = false),
    without('cache'),
    without('todos'),
    without('week'),
    () => (shown.hasSprite = false),
    without('context'),
  ]
  // A band without an entry is no band: it is never what fits.
  const fits = () => shown.segments.length > 0 && widthOf(extras, shown) <= columns
  for (const drop of drops) {
    if (fits()) return shown
    drop()
  }
  return fits() ? shown : null
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

/**
 * The figures to seed the rings from a `usage-limits.json` read off the disk.
 * Only a window with a finite `usedPercent` counts, and one whose reset time
 * has already passed is stale; anything of another type is ignored.
 */
export function fromSnapshot(raw: unknown, now: number): Pick<Usage, 'sessionUsed' | 'sessionResetsAt' | 'weekUsed'> {
  const object = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
  const window = (v: unknown): { used: number; resetsAt?: string } | undefined => {
    const w = object(v)
    if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return undefined
    if (w.resetsAt === undefined || w.resetsAt === null) return { used: w.usedPercent }
    if (typeof w.resetsAt !== 'string' || hasReset(w.resetsAt, now) || !Number.isFinite(Date.parse(w.resetsAt))) return undefined
    return { used: w.usedPercent, resetsAt: w.resetsAt }
  }
  const file = object(raw)
  const session = window(file?.session)
  const week = window(file?.week)
  return { sessionUsed: session?.used, sessionResetsAt: session?.resetsAt, weekUsed: week?.used }
}

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
