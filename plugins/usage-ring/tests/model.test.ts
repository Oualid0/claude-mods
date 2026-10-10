import { expect, test } from 'claude-code/testing'

import { ALERT, COLORS, FRAME, GAP, GREY, MODEL_GAP, SEPARATOR, SHORT, SPRITE_COLUMNS, WARN, ZERO, compact, duration, fit, fromSnapshot, isOn, perSecond, rateAt, tokensEntry, widthOf, modelLabel, modelName, groups, remaining, segments, snapshot, type Layout, withCreated, withTokens, withUpdated } from '../hooks/model'
import { SCALE, SPRITE, SPRITE_W, claudePixels, hammerPixels } from '../hooks/claude'
import { RING_SIZE, ringPixels, toBase64 } from '../hooks/ring'
import { COLD, FRESH_CACHE, LONG_TTL, SHORT_TTL, afterRequest, cacheSegment, coldCache, ttlOf, withTtl } from '../hooks/cache'

const NOW = Date.parse('2026-10-03T13:00:00Z')

test('session ring shows what is used and the time until reset', () => {
  const [session] = segments(
    { sessionUsed: 48, sessionResetsAt: '2026-10-03T15:14:30Z' },
    {},
    NOW,
  )
  expect(session).toMatchObject({ id: 'session', percent: 48, text: '48% 2:14' })
})

test('a session window that ran out shows 0% and the full five hours', () => {
  const [session] = segments({ sessionUsed: 99, sessionResetsAt: '2026-10-03T12:00:00Z' }, {}, NOW)
  expect(session).toMatchObject({ id: 'session', percent: 0, text: '0% 5:00' })
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

/** Walks from wide to narrow and records each state the band goes through. */
function walk(layout: Layout) {
  const all = [
    ...segments(
      { sessionUsed: 1, sessionResetsAt: '2026-10-03T15:00:00Z', contextUsed: 7, weekUsed: 16 },
      { a: 'pending' },
      NOW,
    ),
    cacheSegment({ lastAt: NOW, ttl: LONG_TTL }, NOW),
  ]
  const extras = { total: 12_700_000, rate: 48_000, model: 'Opus 5.5 (mid)' }
  const state = (s: NonNullable<ReturnType<typeof fit>>) =>
    [
      s.hasModel && 'model',
      s.hasTotal && 'Tk',
      s.hasRate && 'tok/s',
      ...s.segments.map(x => x.short),
      s.hasTitles && 'titles',
      s.hasSprite && 'sprite',
      s.hasLongNames && 'long',
    ].filter(Boolean)
  const seen: string[] = []
  for (let columns = 200; columns > 0; columns--) {
    const shown = fit(all, extras, columns, { tokens: true, ...layout })
    const key = shown ? state(shown).join(' ') : 'hidden'
    if (seen.at(-1) !== key) seen.push(key)
    if (shown) expect(widthOf(extras, shown)).toBeLessThanOrEqual(columns)
  }
  return seen
}

test('a narrow band shortens the labels first, then drops the least important, and never squeezes', () => {
  expect(walk({})).toEqual([
    'model Tk tok/s Wk Se Cx Td Ca sprite long',
    'model Tk tok/s Wk Se Cx Td Ca sprite',
    'Tk tok/s Wk Se Cx Td Ca sprite',
    'Tk Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td sprite',
    'Wk Se Cx sprite',
    'Se Cx sprite',
    'Se Cx',
    'Se',
    'hidden',
  ])
})

test('without showTokens the tokens group is not there at all and costs no width, however wide the terminal', () => {
  const all = [...segments({ sessionUsed: 1, contextUsed: 7 }, {}, NOW), cacheSegment(FRESH_CACHE, NOW)]
  const extras = { total: 12_700_000, rate: 48_000 }
  const off = fit(all, extras, 200, { titles: true })!
  expect(tokensEntry(extras, off)).toBeUndefined()
  const on = fit(all, extras, 200, { titles: true, tokens: true })!
  expect(tokensEntry(extras, on)).toBeDefined()
  expect(widthOf(extras, on) - widthOf(extras, off)).toBe(SEPARATOR.length + 'tokens '.length + 'Tokens 12.7M'.length + GAP + '800 tok/s'.length)
  // The walk without the group: titles, then the labels, then the entries.
  expect(walk({ tokens: false })).toEqual([
    'model Wk Se Cx Td Ca sprite long',
    'model Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td sprite',
    'Wk Se Cx sprite',
    'Se Cx sprite',
    'Se Cx',
    'Se',
    'hidden',
  ])
})

test('with titles the titles go right after the model label; compact starts with the short labels', () => {
  expect(walk({ titles: true })).toEqual([
    'model Tk tok/s Wk Se Cx Td Ca titles sprite long',
    'model Tk tok/s Wk Se Cx Td Ca titles sprite',
    'Tk tok/s Wk Se Cx Td Ca titles sprite',
    'Tk tok/s Wk Se Cx Td Ca sprite',
    'Tk Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td Ca sprite',
    'Wk Se Cx Td sprite',
    'Wk Se Cx sprite',
    'Se Cx sprite',
    'Se Cx',
    'Se',
    'hidden',
  ])
  expect(walk({ compact: true })[0]).toBe('model Tk tok/s Wk Se Cx Td Ca sprite')
  expect(walk({ compact: true, titles: true })[0]).toBe('model Tk tok/s Wk Se Cx Td Ca titles sprite')
})

test('the band is one frame with its groups divided by a bar: its width counts the frame once', () => {
  const list = [
    ...segments({ sessionUsed: 48, sessionResetsAt: '2026-10-03T15:20:00Z', contextUsed: 40, weekUsed: 23 }, { a: 'completed', b: 'pending' }, NOW),
    cacheSegment({ lastAt: NOW, ttl: LONG_TTL }, NOW + 60_000),
  ]
  const extras = { total: 9200, rate: 9200 }
  const shown = fit(list, extras, 200, { tokens: true })!
  // limits: "Week ◔ 23%" + "Session ◔ 48% 2:20"; chat: "Context ◔ 40%" + "Cache 59m" + "Todos 1/2"; tokens: "Tokens 9.2k  153 tok/s"
  const limits = 'Week'.length + 1 + 2 + 1 + '23%'.length + GAP + 'Session'.length + 1 + 2 + 1 + '48% 2:20'.length
  const chat = 'Context'.length + 1 + 2 + 1 + '40%'.length + GAP + 'Cache 59m'.length + GAP + 'Todos 1/2'.length
  const tokens = 'Tokens 9.2k'.length + GAP + '153 tok/s'.length
  expect(SEPARATOR).toBe(' │ ')
  expect(widthOf(extras, { ...shown, hasSprite: false, hasModel: false })).toBe(FRAME + limits + chat + tokens + 2 * SEPARATOR.length)
  // The titles add the word and a space in front of each group.
  expect(widthOf(extras, { ...shown, hasTitles: true, hasSprite: false, hasModel: false })).toBe(
    FRAME + limits + chat + tokens + 2 * SEPARATOR.length + ('limits'.length + 1) + ('chat'.length + 1) + ('tokens'.length + 1),
  )
  // Short labels, the pixel Claude and the model label are added on top.
  const short = {
    limits: 'Wk'.length + 1 + 2 + 1 + '23%'.length + GAP + 'Se'.length + 1 + 2 + 1 + '48% 2:20'.length,
    chat: 'Cx'.length + 1 + 2 + 1 + '40%'.length + GAP + 'Ca 59m'.length + GAP + 'Td 1/2'.length,
    tokens: 'Tk 9.2k'.length + GAP + '153 tok/s'.length,
  }
  expect(widthOf({ ...extras, model: 'Opus 5.5' }, { ...shown, hasLongNames: false })).toBe(
    FRAME + short.limits + short.chat + short.tokens + 2 * SEPARATOR.length + SPRITE_COLUMNS + MODEL_GAP + 'Opus 5.5'.length,
  )
})

test('only week, session and context have a ring; todos and the cache are text', () => {
  const list = [...segments({ sessionUsed: 1, weekUsed: 2, contextUsed: 3 }, { a: 'completed', b: 'pending' }, NOW), cacheSegment(FRESH_CACHE, NOW)]
  expect(list.map(s => [s.id, s.hasRing])).toEqual([
    ['week', true],
    ['session', true],
    ['context', true],
    ['todos', false],
    ['cache', false],
  ])
  expect(list.find(s => s.id === 'todos')?.text).toBe('1/2')
})

test('only the options that are on, as true or as the string "true", switch a feature on', () => {
  expect([true, 'true'].map(isOn)).toEqual([true, true])
  expect([false, 'false', undefined, null, 0, 1, 'yes', ''].map(isOn)).toEqual([false, false, false, false, false, false, false, false])
})

test('segments carry their full and their two-letter label', () => {
  const list = segments({ sessionUsed: 1, weekUsed: 2, contextUsed: 3 }, { a: 'pending' }, NOW)
  expect(list.map(s => s.name)).toEqual(['Week', 'Session', 'Context', 'Todos'])
  expect(list.map(s => s.short)).toEqual([SHORT.week, SHORT.session, SHORT.context, SHORT.todos])
  expect(list.map(s => s.short)).toEqual(['Wk', 'Se', 'Cx', 'Td'])
})

test('tokens are formatted compactly, the rate with its unit', () => {
  expect([0, 812, 4600, 46_000, 4_600_000, 12_700_000].map(compact)).toEqual(['0', '812', '4.6k', '46k', '4.6M', '12.7M'])
  expect([0, 48_000, 335_000, 1_200_000].map(perSecond)).toEqual(['0 tok/s', '800 tok/s', '6k tok/s', '20k tok/s'])
})

test('the tokens group is one entry: label, total, a gap, then the rate; two-letter label when narrow', () => {
  const extras = { total: 39_500_000, rate: 360_000 }
  const shown = { segments: [], hasTotal: true, hasRate: true, hasModel: false, hasTitles: true, hasSprite: false, hasLongNames: true }
  expect(tokensEntry(extras, shown)).toMatchObject({ label: 'Tokens', total: '39.5M', rate: '6k tok/s' })
  expect(tokensEntry(extras, { ...shown, hasLongNames: false })).toMatchObject({ label: 'Tk', total: '39.5M', rate: '6k tok/s' })
  // The rate part goes first, then the whole entry.
  expect(tokensEntry(extras, { ...shown, hasRate: false })).toMatchObject({ label: 'Tokens', total: '39.5M', rate: undefined })
  expect(tokensEntry(extras, { ...shown, hasTotal: false })).toBeUndefined()
  expect(tokensEntry({ total: 0, rate: 0 }, shown)).toMatchObject({ label: 'Tokens', total: '0', rate: '0 tok/s' })
  // At least GAP spaces between total and rate: "Tokens 39.5M  6k tok/s".
  expect(widthOf(extras, { ...shown, segments: [{ id: 'context', name: 'Context', short: 'Cx', hasRing: true, percent: 1, text: '1%', color: '#000' }], hasTitles: false })).toBe(
    FRAME + ('Context'.length + 1 + 2 + 1 + 2) + SEPARATOR.length + 'Tokens 39.5M'.length + GAP + '6k tok/s'.length,
  )
})

test('the rate counts the last 60 seconds and falls to 0 in a pause', () => {
  const s = 1000
  let log = withTokens([], 0, 30_000)
  log = withTokens(log, 20 * s, 18_000)
  expect(rateAt(log, 30 * s)).toBe(48_000)
  // The first request leaves the window after a minute.
  expect(rateAt(log, 61 * s)).toBe(18_000)
  expect(rateAt(log, 81 * s)).toBe(0)
  // Old requests are dropped when a new one is logged.
  expect(withTokens(log, 100 * s, 5)).toEqual([[100 * s, 5]])
})

test('remaining time is undefined once the window has reset', () => {
  expect(remaining('2026-10-03T12:00:00Z', NOW)).toBeUndefined()
  expect(remaining('2026-10-03T13:05:00Z', NOW)).toBe('5m')
  expect(remaining('2026-10-03T16:54:59Z', NOW)).toBe('3:54')
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
  // The cache ring sits between context and todos.
  expect(groups([...list, cacheSegment(FRESH_CACHE, NOW)]).chat.map(s => s.id)).toEqual(['context', 'cache', 'todos'])
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

test('times are H:MM from an hour up and minutes below', () => {
  expect(duration(4 * 3_600_000 + 50 * 60_000)).toBe('4:50')
  expect(duration(60 * 60_000)).toBe('1:00')
  expect(duration(33 * 60_000 + 59_000)).toBe('33m')
  expect(duration(30_000)).toBe('0m')
})

test('the cache counts down from the last request and learns its lifetime', () => {
  const at = 1_000_000_000
  const min = 60_000
  const hit = { input_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
  const miss = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000 }
  expect(cacheSegment(FRESH_CACHE, at).text).toBe('–')

  let c = afterRequest(FRESH_CACHE, at, 'm', miss)
  expect(c.ttl).toBe(LONG_TTL)
  expect(cacheSegment(c, at + 27 * min).text).toBe('33m')
  expect(cacheSegment(c, at + 60 * min).text).toBe(COLD)

  // A miss after a short gap says nothing; after 20 minutes it could be a changed prompt, so one is not enough.
  expect(afterRequest(c, at + 2 * min, 'm', miss).ttl).toBe(LONG_TTL)
  c = afterRequest(c, at + 20 * min, 'm', miss)
  expect(c).toMatchObject({ ttl: LONG_TTL, misses: 1 })
  // Two misses in a row mean 5 minutes.
  c = afterRequest(c, at + 40 * min, 'm', miss)
  expect(c.ttl).toBe(SHORT_TTL)
  expect(c.misses).toBeUndefined()
  expect(cacheSegment(c, at + 42 * min).text).toBe('3m')

  // A hit after more than 5 minutes means the hour holds again.
  c = afterRequest(c, at + 50 * min, 'm', hit)
  expect(c.ttl).toBe(LONG_TTL)

  // Another model has a cache of its own: its miss teaches nothing, not even toward the two.
  expect(afterRequest(c, at + 65 * min, 'other', miss)).toMatchObject({ ttl: LONG_TTL })
  expect(afterRequest(c, at + 65 * min, 'other', miss).misses).toBeUndefined()
})

test('the zero color is the fixed muted terracotta, apart from the grey of the labels', () => {
  expect(ZERO).toBe('#9a5a44')
  expect(ZERO).not.toBe(GREY)
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


test('limit rings turn red from 95%, the context ring yellow from 50% and red from 80%, the todo ring never', () => {
  const list = segments({ weekUsed: 94, sessionUsed: 95, contextUsed: 99 }, { a: 'completed' }, NOW)
  expect(list.map(s => [s.id, s.color === ALERT])).toEqual([
    ['week', false],
    ['session', true],
    ['context', true],
    ['todos', false],
  ])
  const context = (used: number) => segments({ contextUsed: used }, {}, NOW)[0]!.color
  expect(context(49)).not.toBe(WARN)
  expect(context(49)).not.toBe(ALERT)
  expect(context(50)).toBe(WARN)
  expect(context(79)).toBe(WARN)
  expect(context(80)).toBe(ALERT)
  // The limits stay as they were.
  expect(segments({ weekUsed: 80, sessionUsed: 60 }, {}, NOW).map(s => s.color)).not.toContain(WARN)
})

test('the cache ring drains from the lifetime, its yellow and red scaled to it', () => {
  const min = 60_000
  const c = { lastAt: 0, ttl: LONG_TTL }
  expect(cacheSegment(c, 0)).toMatchObject({ percent: 100, text: '1:00' })
  expect(cacheSegment(c, 30 * min)).toMatchObject({ percent: 50, text: '30m' })
  const colorAt = (left: number) => cacheSegment(c, LONG_TTL - left * min).color
  expect(colorAt(10.5)).not.toBe(WARN)
  expect(colorAt(9.5)).toBe(WARN)
  expect(colorAt(3)).toBe(WARN)
  expect(colorAt(2.5)).toBe(ALERT)
  // A five-minute lifetime drains from five, yellow under 2 minutes, red under 1, in seconds at the end.
  const short = { ...c, ttl: SHORT_TTL }
  expect(cacheSegment(short, 0)).toMatchObject({ percent: 100, text: '5m', color: COLORS.cache })
  const shortAt = (left: number) => cacheSegment(short, SHORT_TTL - left * min)
  expect(shortAt(2.5).color).toBe(COLORS.cache)
  expect(shortAt(1.5).color).toBe(WARN)
  expect(shortAt(0.75)).toMatchObject({ color: ALERT, text: '45s' })
  // From 1m straight to 59s, never 60s.
  expect(shortAt(59.5 / 60).text).toBe('59s')
})

test('a cold cache is an empty grey ring and a red cold: expired, switched model, compaction', () => {
  const c = { lastAt: 0, ttl: SHORT_TTL }
  const cold = { percent: 0, text: COLD, color: GREY, textColor: ALERT }
  expect(cacheSegment(c, SHORT_TTL)).toMatchObject(cold)
  expect(cacheSegment(c, 1000)).not.toMatchObject({ text: COLD })
  expect(cacheSegment(coldCache(c), 1000)).toMatchObject(cold)
  expect(cacheSegment(coldCache(FRESH_CACHE), 1000)).toMatchObject(cold)
  // The next request makes it warm again.
  const u = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000 }
  const warm = afterRequest(coldCache(c), 2000, 'm', u)
  expect(warm.isCold).toBeUndefined()
  expect(cacheSegment(warm, 2000).text).toBe('5m')
  // The first request after a compaction teaches nothing about the lifetime.
  const learned = { lastAt: 0, ttl: LONG_TTL, model: 'm' }
  expect(afterRequest(coldCache(learned), 20 * 60_000, 'm', u)).toMatchObject({ ttl: LONG_TTL })
})

test('the session time stays out of the red', () => {
  const [session] = segments({ sessionUsed: 96, sessionResetsAt: '2026-10-03T15:14:30Z' }, {}, NOW)
  expect(session?.color).toBe(ALERT)
  expect(session?.time).toBe('2:14')
})

test('a displayed percentage is held to 0..100, and a figure that is not finite leaves its ring out', () => {
  const list = segments({ weekUsed: 140, sessionUsed: -3, contextUsed: 100.4 }, {}, NOW)
  expect(list.map(s => [s.id, s.percent, s.text])).toEqual([
    ['week', 100, '100%'],
    ['session', 0, '0%'],
    ['context', 100, '100%'],
  ])
  const broken = segments({ weekUsed: Number.NaN, sessionUsed: Number.POSITIVE_INFINITY, contextUsed: Number.NaN }, {}, NOW)
  expect(broken).toEqual([])
})

test('a band with no ring left is hidden, not drawn empty: no limit reading, a narrow terminal', () => {
  const all = [...segments({ contextUsed: 7 }, {}, NOW), cacheSegment(FRESH_CACHE, NOW)]
  const extras = { total: 1200, rate: 600 }
  for (let columns = 120; columns >= 0; columns--) {
    const shown = fit(all, extras, columns)
    if (shown) {
      expect(shown.segments.length).toBeGreaterThan(0)
      expect(widthOf(extras, shown)).toBeLessThanOrEqual(columns)
    }
  }
  expect(fit(all, extras, 3)).toBeNull()
  expect(fit(all, extras, 0)).toBeNull()
  // Nothing to show is nothing that fits, however wide the terminal.
  expect(fit([], extras, 200)).toBeNull()
})

test('the limits file seeds the rings: types are checked and a window that already reset is stale', () => {
  const file = {
    session: { usedPercent: 48, resetsAt: '2026-10-03T15:00:00Z', status: null },
    week: { usedPercent: 23, resetsAt: '2026-10-08T00:00:00Z', status: null },
  }
  expect(fromSnapshot(file, NOW)).toEqual({ sessionUsed: 48, sessionResetsAt: '2026-10-03T15:00:00Z', weekUsed: 23 })
  // The session window is over; the week is still running.
  expect(fromSnapshot(file, Date.parse('2026-10-04T00:00:00Z'))).toEqual({ sessionUsed: undefined, sessionResetsAt: undefined, weekUsed: 23 })
  // A window without a reset time is taken as it is.
  expect(fromSnapshot({ week: { usedPercent: 5, resetsAt: null } }, NOW).weekUsed).toBe(5)
  // Wrong types and shapes seed nothing.
  const none = { sessionUsed: undefined, sessionResetsAt: undefined, weekUsed: undefined }
  expect(fromSnapshot({ session: { usedPercent: '48' }, week: { usedPercent: Number.NaN } }, NOW)).toEqual(none)
  expect(fromSnapshot({ session: { usedPercent: 48, resetsAt: 12 }, week: { usedPercent: 3, resetsAt: 'soon' } }, NOW)).toEqual(none)
  for (const raw of [null, 'x', 7, [], undefined]) expect(fromSnapshot(raw, NOW)).toEqual(none)
})

test('a value of 0 is flagged for the zero color, from 1 on it is not: week, session, context and todos', () => {
  const dim = (usage: Parameters<typeof segments>[0], todos: Parameters<typeof segments>[1] = {}) =>
    Object.fromEntries(segments(usage, todos, NOW).map(s => [s.id, s.isDim]))
  expect(dim({ weekUsed: 0, sessionUsed: 0, contextUsed: 0 }, { a: 'pending', b: 'pending' })).toEqual({ week: true, session: true, context: true, todos: true })
  expect(dim({ weekUsed: 1, sessionUsed: 1, contextUsed: 1 }, { a: 'completed', b: 'pending' })).toEqual({ week: false, session: false, context: false, todos: false })
  // 0.4% is shown as 0%, and so it is flagged; a window that ran out shows 0% too.
  expect(dim({ weekUsed: 0.4 }).week).toBe(true)
  expect(segments({ sessionUsed: 99, sessionResetsAt: '2026-10-03T12:00:00Z' }, {}, NOW)[0]?.isDim).toBe(true)
  // The warning and alert colors start well above 0, so a red value is never a zero one.
  for (const s of segments({ weekUsed: 99, sessionUsed: 97, contextUsed: 85 }, {}, NOW)) expect(s.isDim).toBe(false)
  // The cache is no zero case.
  expect(cacheSegment(FRESH_CACHE, NOW).isDim).toBeUndefined()
  expect(cacheSegment({ lastAt: NOW, ttl: LONG_TTL }, NOW + LONG_TTL).isDim).toBeUndefined()
})

test('the tokens entry marks a 0 total and a rate that shows as 0', () => {
  const shown = { segments: [], hasTotal: true, hasRate: true, hasModel: false, hasTitles: false, hasSprite: false, hasLongNames: true }
  expect(tokensEntry({ total: 0, rate: 0 }, shown)).toMatchObject({ isTotalZero: true, isRateZero: true })
  expect(tokensEntry({ total: 1, rate: 29 }, shown)).toMatchObject({ isTotalZero: false, isRateZero: true, rate: '0 tok/s' })
  expect(tokensEntry({ total: 900, rate: 30 }, shown)).toMatchObject({ isTotalZero: false, isRateZero: false, rate: '1 tok/s' })
})

// Reproduces a live report: after /reload-plugins the system prompt and tools change, so the
// next request reads little from the cache although the hour still holds. It must not shorten the lifetime.
test('a request that read little after a prompt change does not turn a 1-hour cache into a 5-minute one', () => {
  const at = 1_000_000_000
  const min = 60_000
  const hit = { input_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
  const afterReload = { input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 9000 }
  let c = afterRequest(FRESH_CACHE, at, 'm', hit)
  c = afterRequest(c, at + 1 * min, 'm', hit)
  expect(c.ttl).toBe(LONG_TTL)
  // 10 idle minutes, then the first request after a reload: a miss, but no sign of a 5-minute lifetime.
  c = afterRequest(c, at + 11 * min, 'm', afterReload)
  expect(c.ttl).toBe(LONG_TTL)
  expect(cacheSegment(c, at + 17 * min).text).not.toBe(COLD)
})

test('one miss then a hit keeps the hour; the count only goes on with telling requests', () => {
  const at = 1_000_000_000
  const min = 60_000
  const hit = { input_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
  const miss = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000 }
  const some = { input_tokens: 5000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 3000 }
  let c = afterRequest(afterRequest(FRESH_CACHE, at, 'm', hit), at + 1 * min, 'm', hit)
  // One miss, then a hit after a long gap: the hour holds and the count starts over.
  c = afterRequest(c, at + 11 * min, 'm', miss)
  expect(c.misses).toBe(1)
  c = afterRequest(c, at + 21 * min, 'm', hit)
  expect(c).toMatchObject({ ttl: LONG_TTL })
  expect(c.misses).toBeUndefined()
  c = afterRequest(c, at + 31 * min, 'm', miss)
  expect(c).toMatchObject({ ttl: LONG_TTL, misses: 1 })
  // A telling request that read some of the cache starts the count over too.
  c = afterRequest(c, at + 41 * min, 'm', some)
  expect(c).toMatchObject({ ttl: LONG_TTL })
  expect(c.misses).toBeUndefined()
  // A request after a short gap is no telling one: it leaves the count where it was, hit or miss.
  c = afterRequest(c, at + 51 * min, 'm', miss)
  c = afterRequest(c, at + 52 * min, 'm', hit)
  c = afterRequest(c, at + 53 * min, 'm', miss)
  expect(c).toMatchObject({ ttl: LONG_TTL, misses: 1 })
  c = afterRequest(c, at + 63 * min, 'm', miss)
  expect(c.ttl).toBe(SHORT_TTL)
})

test('the engine names the lifetime: 5m and 1h are taken, anything else is ignored', () => {
  expect(ttlOf('5m')).toBe(SHORT_TTL)
  expect(ttlOf('1h')).toBe(LONG_TTL)
  for (const unknown of [undefined, null, '', '30m', 3600, {}]) expect(ttlOf(unknown)).toBeUndefined()
  // It is authoritative: the count of misses starts over and the rest stays.
  expect(withTtl({ lastAt: 5, model: 'm', ttl: LONG_TTL, misses: 1, isCold: true }, SHORT_TTL)).toEqual({ lastAt: 5, model: 'm', ttl: SHORT_TTL, isCold: true })
})
