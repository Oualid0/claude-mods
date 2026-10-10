// The prompt cache's countdown. The engine shows neither the cache's lifetime
// (5 minutes or 1 hour) nor when an entry lapses; both are inferred from what
// each request read from the cache and how long after the one before it came.

import type { Cache } from '../types'
import { ALERT, COLORS, GREY, NAME, SHORT, WARN, duration, type Segment } from './model'

export const SHORT_TTL = 5 * 60_000
export const LONG_TTL = 60 * 60_000

/** Time left under which the ring turns yellow, then red: 10 and 3 minutes for a 1-hour entry, 2 and 1 for a 5-minute one. */
export function thresholds(ttl: number): { warn: number; alert: number } {
  return ttl <= SHORT_TTL ? { warn: 2 * 60_000, alert: 60_000 } : { warn: 10 * 60_000, alert: 3 * 60_000 }
}

/** Time left as `33m`, or `45s` in the last minute. */
export const timeLeft = (ms: number): string => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : duration(ms))

/** Shown once the entry is gone: its lifetime is over, the model switched or the chat compacted. */
export const COLD = 'cold'

/** Shown before the first request: nothing is cached yet. */
export const CACHE_NONE = '–'

/** At least this share of the input read from the cache counts as a hit. */
export const HIT_SHARE = 0.5
/** Below this share it counts as a miss. */
export const MISS_SHARE = 0.1

export const FRESH_CACHE: Cache = { ttl: LONG_TTL }

type Counts = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function readShare(u: Counts): number | undefined {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? u.cache_read_input_tokens / total : undefined
}

/** This many telling misses in a row mean the entry lives 5 minutes; one can be a changed prompt. */
export const MISSES_FOR_SHORT = 2

/**
 * The cache after a main-thread request sent at `sentAt` answered with `u`.
 *
 * Only a gap between both lifetimes says which one holds: a hit after more
 * than 5 minutes means 1 hour at once. A miss there is also what a changed
 * system prompt or tool list looks like (a plugin reload, an MCP change), so
 * only `MISSES_FOR_SHORT` of them in a row mean 5 minutes; a hit, or a request in
 * between that read some of the cache, starts the count over. Requests that are
 * no telling ones (short gap, another model, a cold entry) leave the count as it is.
 * The latest verdict wins, so a drop to 5 minutes (usage overage) shows too.
 */
export function afterRequest(cache: Cache, sentAt: number, model: string, u: Counts): Cache {
  const share = readShare(u)
  let { ttl } = cache
  let misses = cache.misses ?? 0
  const gap = cache.lastAt === undefined ? undefined : sentAt - cache.lastAt
  // A cold entry was dropped or rewritten (a compaction), so what this request read says nothing about the lifetime.
  const isTelling = !cache.isCold && gap !== undefined && gap > SHORT_TTL && gap < LONG_TTL && cache.model === model
  if (isTelling && share !== undefined) {
    if (share >= HIT_SHARE) {
      ttl = LONG_TTL
      misses = 0
    } else if (share < MISS_SHARE) {
      misses++
      if (misses >= MISSES_FOR_SHORT) {
        ttl = SHORT_TTL
        misses = 0
      }
    } else {
      misses = 0
    }
  }
  return { lastAt: sentAt, model, ttl, ...(misses > 0 ? { misses } : {}) }
}

/** The lifetime the engine names on a model switch (`cache_ttl`), or undefined for anything else. */
export function ttlOf(value: unknown): number | undefined {
  return value === '1h' ? LONG_TTL : value === '5m' ? SHORT_TTL : undefined
}

/** The cache with the lifetime the engine named: it is authoritative, so the count of misses starts over. */
export function withTtl(cache: Cache, ttl: number): Cache {
  const { misses: _, ...rest } = cache
  return { ...rest, ttl }
}

/** The cache after a model switch or a compaction: gone until the next request. */
export const coldCache = (cache: Cache): Cache => ({ ...cache, isCold: true })

/** Whether the entry is gone: dropped by a switch or a compaction, or its lifetime is over. False before the first request. */
export function isCold(cache: Cache, now: number): boolean {
  if (cache.isCold) return true
  return cache.lastAt !== undefined && cache.lastAt + cache.ttl - now <= 0
}

/**
 * The cache's entry, text only: the time left in the normal color, yellow and red as
 * `thresholds` says. Cold is a red `cold`; before the first request `–`.
 */
export function cacheSegment(cache: Cache, now: number): Segment {
  const base = { id: 'cache', name: NAME.cache, short: SHORT.cache, hasRing: false } as const
  if (isCold(cache, now)) return { ...base, percent: 0, text: COLD, color: GREY, textColor: ALERT }
  if (cache.lastAt === undefined) return { ...base, percent: 0, text: CACHE_NONE, color: GREY, textColor: COLORS.cache }
  const left = cache.lastAt + cache.ttl - now
  const { warn, alert } = thresholds(cache.ttl)
  const color = left < alert ? ALERT : left < warn ? WARN : COLORS.cache
  return { ...base, percent: (left / cache.ttl) * 100, text: timeLeft(left), color }
}
