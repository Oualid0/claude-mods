import { expect, test } from 'claude-code/testing'

import { ALERT, SHORT, SPRITE_COLUMNS, compact, duration, fit, widthOf, modelLabel, modelName, groups, money, remaining, segments, snapshot, withCreated, withUpdated } from '../hooks/model'
import { SCALE, SPRITE, SPRITE_W, claudePixels, hammerPixels } from '../hooks/claude'
import { RING_SIZE, ringPixels, toBase64 } from '../hooks/ring'
import { EXPIRED, FRESH_CACHE, LONG_TTL, SHORT_TTL, afterRequest, cacheLeft, isCacheLow } from '../hooks/cache'

const NOW = Date.parse('2026-10-03T13:00:00Z')

test('session ring shows what is used and the time until reset', () => {
  const [session] = segments(
    { sessionUsed: 48, sessionResetsAt: '2026-10-03T15:14:30Z' },
    {},
    NOW,
  )
  expect(session).toMatchObject({ id: 'session', percent: 48, text: '48% 2:14h' })
})

test('a session window that ran out shows 0% and the full five hours', () => {
  const [session] = segments({ sessionUsed: 99, sessionResetsAt: '2026-10-03T12:00:00Z' }, {}, NOW)
  expect(session).toMatchObject({ id: 'session', percent: 0, text: '0% 5:00h' })
})

test('rings come in the order week, session, context, todos', () => {
  const ids = segments(
    { sessionUsed: 1, contextUsed: 7, weekUsed: 16 },
    { a: 'completed', b: 'pending' },
    NOW,
  ).map(s => s.id)
  expect(ids).toEqual(['week', 'session', 'context', 'todos'])
})

test('no todo ring without a todo list', () => {
  expect(segments({ contextUsed: 7 }, {}, NOW).map(s => s.id)).toEqual(['context'])
})

test('a narrow band drops the least important first and never squeezes', () => {
  const all = segments(
    { sessionUsed: 1, sessionResetsAt: '2026-10-03T15:00:00Z', contextUsed: 7, weekUsed: 16 },
    { a: 'pending' },
    NOW,
  )
  const extras = { tokens: 4_600_000, costUsd: 6.79, cache: '59m', model: 'Opus 5.5 (mid)' }
  const state = (s: NonNullable<ReturnType<typeof fit>>) =>
    [
      s.hasModel && 'model',
      s.hasCache && 'Ca',
      s.hasCost && 'Co',
      s.hasTokens && 'Tk',
      ...s.segments.map(x => x.short),
      s.hasLabels && 'labels',
      s.hasSprite && 'sprite',
    ].filter(Boolean)
  // Walk from wide to narrow and record each state the band goes through.
  const seen: string[] = []
  for (let columns = 200; columns > 0; columns--) {
    const shown = fit(all, extras, columns)
    const key = shown ? state(shown).join(' ') : 'hidden'
    if (seen.at(-1) !== key) seen.push(key)
    if (shown) expect(widthOf(extras, shown)).toBeLessThanOrEqual(columns)
  }
  expect(seen).toEqual([
    'model Ca Co Tk Wk Se Cx Td labels sprite',
    'Ca Co Tk Wk Se Cx Td labels sprite',
    'Ca Co Tk Wk Se Cx Td sprite',
    'Co Tk Wk Se Cx Td sprite',
    'Tk Wk Se Cx Td sprite',
    'Wk Se Cx Td sprite',
    'Wk Se Cx sprite',
    'Se Cx sprite',
    'Se Cx',
    'Se',
    'hidden',
  ])
})

test('segments carry their two-letter label', () => {
  const list = segments({ sessionUsed: 1, weekUsed: 2, contextUsed: 3 }, { a: 'pending' }, NOW)
  expect(list.map(s => s.short)).toEqual([SHORT.week, SHORT.session, SHORT.context, SHORT.todos])
  expect(list.map(s => s.short)).toEqual(['Wk', 'Se', 'Cx', 'Td'])
})

test('tokens and cost are formatted compactly', () => {
  expect([0, 812, 4600, 46_000, 4_600_000].map(compact)).toEqual(['0', '812', '4.6k', '46k', '4.6M'])
  expect(money(6.789)).toBe('$6.79')
  expect(money(0)).toBe('$0.00')
})

test('remaining time is undefined once the window has reset', () => {
  expect(remaining('2026-10-03T12:00:00Z', NOW)).toBeUndefined()
  expect(remaining('2026-10-03T13:05:00Z', NOW)).toBe('5m')
  expect(remaining('2026-10-03T16:54:59Z', NOW)).toBe('3:54h')
})

test('deleted tasks leave the count, completed ones stay', () => {
  let t = withCreated(withCreated({}, '1'), '2')
  t = withUpdated(t, '1', 'completed')
  t = withUpdated(t, '2', 'deleted')
  expect(t).toEqual({ '1': 'completed' })
})

test('snapshot holds both windows, their reset and the model', () => {
  const s = snapshot(
    [
      { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-03T15:20:00Z' },
      { kind: 'seven_day', percentUsed: 17, resetsAt: '2026-10-09T00:00:00Z' },
    ],
    NOW,
    'claude-opus-5-5',
  )
  expect(s).toEqual({
    session: { usedPercent: 3, resetsAt: '2026-10-03T15:20:00Z', status: null },
    week: { usedPercent: 17, resetsAt: '2026-10-09T00:00:00Z', status: null },
    updatedAt: '2026-10-03T13:00:00.000Z',
    model: 'claude-opus-5-5',
  })
  expect(snapshot([], NOW, 'x')).toBeNull()
})

test('ring pixels: empty ring is only the dim track, full ring is opaque at 12 o\'clock, the center stays clear', () => {
  const top = (p: Uint8Array) => p[(2 * RING_SIZE + RING_SIZE / 2) * 4 + 3] ?? -1
  const center = (p: Uint8Array) => p[(RING_SIZE / 2 * RING_SIZE + RING_SIZE / 2) * 4 + 3] ?? -1
  const empty = ringPixels(0, [255, 0, 0])
  const full = ringPixels(100, [255, 0, 0])
  expect(top(empty)).toBeLessThan(80)
  expect(top(full)).toBe(255)
  expect(center(full)).toBeLessThan(40)
  expect(ringPixels(50, [255, 0, 0]).length).toBe(RING_SIZE * RING_SIZE * 4)
})

test('base64 matches the standard encoding', () => {
  expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
  expect(toBase64(new Uint8Array([77, 97]))).toBe('TWE=')
  expect(toBase64(new Uint8Array([77]))).toBe('TQ==')
})

test('week and session are the limits, context and todos the chat', () => {
  const list = segments({ sessionUsed: 1, weekUsed: 2, contextUsed: 3 }, { a: 'pending' }, NOW)
  const { limits, chat } = groups(list)
  expect(limits.map(s => s.id)).toEqual(['week', 'session'])
  expect(chat.map(s => s.id)).toEqual(['context', 'todos'])
  expect(groups(segments({ contextUsed: 3 }, {}, NOW)).limits).toEqual([])
})

test('the pixel Claude is 24 x 24 sprite pixels; hammer frames differ, z\'s appear while asleep', () => {
  const size = SPRITE_W * SCALE * SPRITE * SCALE * 4
  expect(SPRITE_COLUMNS).toBe(6)
  expect(hammerPixels(0).length).toBe(size)
  expect(claudePixels(0).length).toBe(size)
  expect(toBase64(hammerPixels(0))).not.toBe(toBase64(hammerPixels(3)))
  // One z at phase 0, two at 3, three at 6, none again at 9.
  const sleeping = [0, 3, 6, 9].map(p => toBase64(claudePixels(p)))
  expect(new Set(sleeping).size).toBe(4)
  expect(toBase64(claudePixels(0))).toBe(toBase64(claudePixels(2)))
})

test('times are H:MMh from an hour up and minutes below', () => {
  expect(duration(4 * 3_600_000 + 50 * 60_000)).toBe('4:50h')
  expect(duration(60 * 60_000)).toBe('1:00h')
  expect(duration(33 * 60_000 + 59_000)).toBe('33m')
  expect(duration(30_000)).toBe('0m')
})

test('the cache counts down from the last request and learns its lifetime', () => {
  const at = 1_000_000_000
  const min = 60_000
  const hit = { input_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
  const miss = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000 }
  expect(cacheLeft(FRESH_CACHE, at)).toBeUndefined()

  let c = afterRequest(FRESH_CACHE, at, 'm', miss)
  expect(c.source).toBe('assumed')
  expect(cacheLeft(c, at + 27 * min)).toBe('33m')
  expect(cacheLeft(c, at + 60 * min)).toBe(EXPIRED)

  // A miss after a short gap says nothing; after 20 minutes it means 5 minutes.
  expect(afterRequest(c, at + 2 * min, 'm', miss).source).toBe('assumed')
  c = afterRequest(c, at + 20 * min, 'm', miss)
  expect(c).toMatchObject({ ttl: SHORT_TTL, source: 'miss' })
  expect(cacheLeft(c, at + 22 * min)).toBe('3m')

  // A hit after more than 5 minutes means the hour holds again.
  c = afterRequest(c, at + 30 * min, 'm', hit)
  expect(c).toMatchObject({ ttl: LONG_TTL, source: 'hit' })

  // Another model has a cache of its own: its miss teaches nothing.
  expect(afterRequest(c, at + 45 * min, 'other', miss).source).toBe('hit')
})

test('the model label is the short model name with its effort', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
  expect(modelLabel('claude-opus-5-5', 'medium')).toBe('Opus 5.5 (mid)')
  expect(modelLabel('claude-opus-5-5', 'xhigh')).toBe('Opus 5.5 (xhigh)')
  expect(modelLabel('claude-opus-5-5', undefined)).toBe('Opus 5.5')
  expect(modelLabel(undefined, 'high')).toBeUndefined()
})


test('rings turn red from 95%, the todo ring never does', () => {
  const list = segments({ weekUsed: 94, sessionUsed: 95, contextUsed: 99 }, { a: 'completed' }, NOW)
  expect(list.map(s => [s.id, s.color === ALERT])).toEqual([
    ['week', false],
    ['session', true],
    ['context', true],
    ['todos', false],
  ])
})

test('the cache turns red in its last 3 minutes and once lapsed', () => {
  const c = { lastAt: 0, ttl: SHORT_TTL, source: 'assumed' as const }
  expect(isCacheLow(c, SHORT_TTL - 3 * 60_000 - 1)).toBe(false)
  expect(isCacheLow(c, SHORT_TTL - 3 * 60_000)).toBe(true)
  expect(isCacheLow(c, SHORT_TTL + 1)).toBe(true)
  expect(isCacheLow({ ttl: SHORT_TTL, source: 'assumed' }, 0)).toBe(false)
})

test('the session time stays out of the red', () => {
  const [session] = segments({ sessionUsed: 96, sessionResetsAt: '2026-10-03T15:14:30Z' }, {}, NOW)
  expect(session?.color).toBe(ALERT)
  expect(session?.time).toBe('2:14h')
})
