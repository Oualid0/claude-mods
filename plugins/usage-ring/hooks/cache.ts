// The prompt cache's countdown. The engine shows neither the cache's lifetime
// (5 minutes or 1 hour) nor when an entry lapses; both are inferred from what
// each request read from the cache and how long after the one before it came.

import type { Cache } from '../types'
import { duration } from './model'

export const SHORT_TTL = 5 * 60_000
export const LONG_TTL = 60 * 60_000

/** Shown once the entry's lifetime is over. */
export const EXPIRED = 'expired'

/** At least this share of the input read from the cache counts as a hit. */
export const HIT_SHARE = 0.5
/** Below this share it counts as a miss. */
export const MISS_SHARE = 0.1

export const FRESH_CACHE: Cache = { ttl: LONG_TTL, source: 'assumed' }

type Counts = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function readShare(u: Counts): number | undefined {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? u.cache_read_input_tokens / total : undefined
}

/**
 * The cache after a main-thread request sent at `sentAt` answered with `u`.
 *
 * Only a gap between both lifetimes says which one holds: a hit after more
 * than 5 minutes means 1 hour, a miss means 5 minutes (or an invalidation the
 * band cannot see, such as a changed system prompt). The latest such request
 * wins, so a drop to 5 minutes (usage overage) shows too.
 */
export function afterRequest(cache: Cache, sentAt: number, model: string, u: Counts): Cache {
  const share = readShare(u)
  let { ttl, source } = cache
  const gap = cache.lastAt === undefined ? undefined : sentAt - cache.lastAt
  const isTelling = gap !== undefined && gap > SHORT_TTL && gap < LONG_TTL && cache.model === model
  if (isTelling && share !== undefined) {
    if (share >= HIT_SHARE) {
      ttl = LONG_TTL
      source = 'hit'
    } else if (share < MISS_SHARE) {
      ttl = SHORT_TTL
      source = 'miss'
    }
  }
  return { lastAt: sentAt, model, ttl, source, readShare: share }
}

/** Time left on the entry (`33m`), `expired` once over; undefined before the first request. */
export function cacheLeft(cache: Cache, now: number): string | undefined {
  if (cache.lastAt === undefined) return undefined
  const ms = cache.lastAt + cache.ttl - now
  return ms > 0 ? duration(ms) : EXPIRED
}
