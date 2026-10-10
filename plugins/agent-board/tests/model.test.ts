import { expect, test } from 'claude-code/testing'

import type { Agent } from '../types'
import { ABANDON_AFTER, BAR_CELLS, COLOR, ZERO, STALL_AFTER, bar, barLabel, crewStates, displayFrom, fit, flagFrom, hideAfterFrom, isAbandoned, isStalled, limitsFrom, segments, segmentText, tierOf } from '../hooks/model'
import { hexToRgb } from '../hooks/ring'
import { CREW_H, CREW_W, FRAME_WRAP, SCALE, SLEEP_EVERY, crewKey, crewPixels, frameStep, nextFrame } from '../hooks/workers'
import type { CrewState, CrewTier } from '../hooks/workers'

const agent = (id: string, model: string, state: Agent['state']): Agent => ({ id, model, tier: tierOf(model), state })

const crew = (haiku: CrewState, sonnet: CrewState = 'sleep', opus: CrewState = 'sleep'): Record<CrewTier, CrewState> => ({ haiku, sonnet, opus })

const LIMITS = { haiku: 15, sonnet: 3, opus: 1 }

const ended1 = () => segments({ a: agent('a', 'claude-haiku-5-5', 'completed') }, LIMITS)[0]!

test('the family comes from the model name', () => {
  expect(tierOf('claude-haiku-5-5')).toBe('haiku')
  expect(tierOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(tierOf('claude-opus-5-5[1m]')).toBe('opus')
  expect(tierOf('some-other-model')).toBe('other')
})

test('limits come from the options; unset or zero means none', () => {
  expect(limitsFrom({ maxHaiku: 15, maxSonnet: '3', maxOpus: 0 })).toEqual({ haiku: 15, sonnet: 3, opus: undefined })
  expect(limitsFrom({})).toEqual({ haiku: undefined, sonnet: undefined, opus: undefined })
})

test('only whole limits from 1 up count; fractions, Infinity, zero, negatives and words mean none', () => {
  const none = { haiku: undefined, sonnet: undefined, opus: undefined }
  expect(limitsFrom({ maxHaiku: 2.5, maxSonnet: Infinity, maxOpus: -1 })).toEqual(none)
  expect(limitsFrom({ maxHaiku: '2.5', maxSonnet: 'Infinity', maxOpus: '-3' })).toEqual(none)
  expect(limitsFrom({ maxHaiku: '', maxSonnet: 'many', maxOpus: 0.5 })).toEqual(none)
  expect(limitsFrom({ maxHaiku: 1, maxSonnet: '4', maxOpus: 15 })).toEqual({ haiku: 1, sonnet: 4, opus: 15 })
})

test('the row hides after the set minutes; 0 never hides, the rest falls back to 5', () => {
  expect(hideAfterFrom({ hideAfter: 2 })).toBe(120_000)
  expect(hideAfterFrom({ hideAfter: '1.5' })).toBe(90_000)
  expect(hideAfterFrom({ hideAfter: 0 })).toBe(0)
  for (const bad of [undefined, '', 'soon', -1]) expect(hideAfterFrom({ hideAfter: bad })).toBe(300_000)
})

test('no segments before the first subagent', () => {
  expect(segments({}, LIMITS)).toEqual([])
})

test('segments count running and done per family, Ha So Op always, Ot only when used', () => {
  const agents = {
    a: agent('a', 'claude-haiku-5-5', 'running'),
    b: agent('b', 'claude-haiku-5-5', 'completed'),
    c: agent('c', 'claude-opus-5-5', 'waiting'),
  }
  const list = segments(agents, LIMITS)
  expect(list.map(s => s.short)).toEqual(['Ha', 'So', 'Op'])
  expect(list[0]).toMatchObject({ running: 1, done: 1, limit: 15 })
  expect(list[1]).toMatchObject({ running: 0, done: 0 })
  expect(list[2]).toMatchObject({ running: 1, isOver: false })
  expect(list[2]).not.toHaveProperty('percent')
  const withOther = segments({ ...agents, d: agent('d', 'mystery', 'running') }, LIMITS)
  expect(withOther.map(s => s.short)).toEqual(['Ha', 'So', 'Op', 'Ot'])
})

test('with hideUnused a family shows only once it had a subagent, Other likewise', () => {
  const agents = { a: agent('a', 'claude-haiku-5-5', 'completed') }
  expect(segments(agents, LIMITS, true).map(s => s.short)).toEqual(['Ha'])
  expect(segments(agents, LIMITS, false).map(s => s.short)).toEqual(['Ha', 'So', 'Op'])
  const more = { ...agents, b: agent('b', 'claude-opus-5-5', 'running'), c: agent('c', 'mystery', 'running') }
  expect(segments(more, LIMITS, true).map(s => s.short)).toEqual(['Ha', 'Op', 'Ot'])
  expect(segments({}, LIMITS, true)).toEqual([])
})

test('options are on for true and the text true, off for anything else', () => {
  for (const on of [true, 'true', 'TRUE', ' true ']) expect(flagFrom(on)).toBe(true)
  for (const off of [false, 'false', '', 'yes', 1, undefined, null]) expect(flagFrom(off)).toBe(false)
  expect(displayFrom({})).toEqual({ titles: false, compact: false, hideUnused: false })
  expect(displayFrom({ titles: 'true', compact: true, hideUnused: 'false' })).toEqual({ titles: true, compact: true, hideUnused: false })
})

test('more running than the limit turns the family red; the count is running/limit, plain without a limit', () => {
  const agents = { a: agent('a', 'claude-opus-5-5', 'running'), b: agent('b', 'claude-opus-5-5', 'running') }
  const opus = segments(agents, LIMITS).find(s => s.tier === 'opus')!
  expect(opus.isOver).toBe(true)
  const shown = { hasLongNames: true, hasTitles: false, hasBar: true, hasDone: true, hasCrew: true }
  expect(segmentText(opus, shown)).toMatchObject({ count: '2/1' })
  const bare = segments(agents, {}).find(s => s.tier === 'opus')!
  expect(segmentText(bare, shown)).toMatchObject({ count: '2' })
  expect(bare.isOver).toBe(false)
})

test('the token bar splits its cells by share, main loop included, and is empty before any tokens', () => {
  expect(bar({})).toEqual([])
  expect(bar({ main: 900, haiku: 100 })).toEqual([
    { key: 'main', cells: 11 },
    { key: 'haiku', cells: 1 },
  ])
  // Largest remainders: the cells always add up to the bar.
  const thirds = bar({ main: 1, haiku: 1, sonnet: 1 })
  expect(thirds.reduce((n, p) => n + p.cells, 0)).toBe(BAR_CELLS)
  expect(thirds.map(p => p.key)).toEqual(['main', 'haiku', 'sonnet'])
})

test('every share above zero keeps a cell, the cells still add up to the bar', () => {
  const tiny = bar({ main: 1_000_000, haiku: 1 })
  expect(tiny).toEqual([
    { key: 'main', cells: BAR_CELLS - 1 },
    { key: 'haiku', cells: 1 },
  ])
  const crowd = bar({ main: 1_000_000, haiku: 1, sonnet: 1, opus: 1, other: 1 })
  expect(crowd.map(p => p.key)).toEqual(['main', 'haiku', 'sonnet', 'opus', 'other'])
  expect(crowd.every(p => p.cells >= 1)).toBe(true)
  expect(crowd.reduce((n, p) => n + p.cells, 0)).toBe(BAR_CELLS)
  // A share of zero still has none.
  expect(bar({ main: 5, haiku: 0 }).map(p => p.key)).toEqual(['main'])
})

test('a count of zero has its own muted terracotta', () => {
  expect(ZERO).toBe('#9a5a44')
})

test('the family colors', () => {
  expect(COLOR).toMatchObject({ haiku: '#39ff88', sonnet: '#22d3ff', opus: '#b26bff', other: '#6a6a6a' })
})

test('every family wears its bar color as the hat', () => {
  const px = crewPixels(crew('sleep'), 0)
  // The hat's top row sits on sprite row 7, from column 7 of the worker's slot (20 pixels wide).
  const at = (slot: number) => {
    const i = (7 * SCALE * CREW_W * SCALE + (slot * 20 + 8) * SCALE) * 4
    return [px[i], px[i + 1], px[i + 2]]
  }
  expect(at(0)).toEqual([...hexToRgb(COLOR.haiku)])
  expect(at(1)).toEqual([...hexToRgb(COLOR.sonnet)])
  expect(at(2)).toEqual([...hexToRgb(COLOR.opus)])
})

test('the done count shows from one up, failed and stopped agents included, and never at zero', () => {
  const shown = { hasLongNames: true, hasTitles: false, hasBar: true, hasDone: true, hasCrew: true }
  const none = segments({ a: agent('a', 'claude-haiku-5-5', 'running') }, LIMITS)
  expect(segmentText(none[0]!, shown).done).toBeUndefined()
  expect(segmentText(ended1(), { ...shown, hasDone: false }).done).toBeUndefined()
  expect(segmentText(ended1(), shown).done).toBe('✔1')
  const ended = segments(
    { a: agent('a', 'claude-haiku-5-5', 'failed'), b: agent('b', 'claude-haiku-5-5', 'killed'), c: agent('c', 'claude-haiku-5-5', 'completed') },
    LIMITS,
  )
  expect(segmentText(ended[0]!, shown).done).toBe('✔3')
})

/** The flags `fit` turned off, in order, as the row narrows from 200 columns. */
function dropOrder(list: ReturnType<typeof segments>, display?: Parameters<typeof fit>[2]): string[] {
  const order: string[] = []
  let last = fit(list, 200, display)!
  for (let columns = 200; columns > 0; columns--) {
    const shown = fit(list, columns, display)
    if (!shown) break
    for (const key of Object.keys(last) as (keyof typeof last)[]) if (last[key] && !shown[key]) order.push(key)
    last = shown
  }
  return order
}

test('a narrow row shortens the names, then drops the titles, the token bar, done counts and crew, and never squeezes', () => {
  const agents = { a: agent('a', 'claude-haiku-5-5', 'completed'), b: agent('b', 'claude-sonnet-5-5', 'running') }
  const list = segments(agents, LIMITS)
  // By default the titles are off from the start, so the order skips them.
  expect(fit(list, 200)).toEqual({ hasLongNames: true, hasTitles: false, hasBar: true, hasDone: true, hasCrew: true })
  expect(dropOrder(list)).toEqual(['hasLongNames', 'hasBar', 'hasDone', 'hasCrew'])
  // With titles on they go right after the long names.
  const titles = { titles: true, compact: false }
  expect(fit(list, 200, titles)).toEqual({ hasLongNames: true, hasTitles: true, hasBar: true, hasDone: true, hasCrew: true })
  expect(dropOrder(list, titles)).toEqual(['hasLongNames', 'hasTitles', 'hasBar', 'hasDone', 'hasCrew'])
  // Compact starts with the short names.
  const compact = { titles: false, compact: true }
  expect(fit(list, 200, compact)).toEqual({ hasLongNames: false, hasTitles: false, hasBar: true, hasDone: true, hasCrew: true })
  expect(dropOrder(list, compact)).toEqual(['hasBar', 'hasDone', 'hasCrew'])
  expect(fit(list, 10)).toBeNull()
})

test('the titles and long names take room: 14 columns for agents and Split, 9 for Haiku, Sonnet and Opus over two letters', () => {
  const list = segments({ a: agent('a', 'claude-haiku-5-5', 'completed') }, LIMITS)
  // The fewest columns at which nothing the options ask for has been dropped yet.
  const full = (display?: Parameters<typeof fit>[2]) => {
    const all = fit(list, 200, display)!
    let columns = 200
    while (JSON.stringify(fit(list, columns - 1, display)) === JSON.stringify(all)) columns--
    return columns
  }
  const plain = full()
  expect(full({ titles: true, compact: false })).toBe(plain + 'agents '.length + 'Split '.length)
  expect(full({ titles: false, compact: true })).toBe(plain - (3 + 4 + 2))
})

test('the token bar title is Split, Sp when short', () => {
  const shown = { hasLongNames: true, hasTitles: true, hasBar: true, hasDone: true, hasCrew: true }
  expect(barLabel(shown)).toBe('Split')
  expect(barLabel({ ...shown, hasLongNames: false })).toBe('Sp')
})

test('the crew is 60 x 24 sprite pixels; work frames differ, sleepers stay still between z phases', () => {
  const all = crew('work', 'work', 'work')
  const px = crewPixels(all, 0)
  expect(px.length).toBe(CREW_W * SCALE * CREW_H * SCALE * 4)
  expect(crewPixels(all, 1)).not.toEqual(px)
  const none = crew('sleep')
  expect(crewPixels(none, 0)).toEqual(crewPixels(none, 1))
  expect(crewKey(none, 0)).not.toBe(crewKey(all, 0))
})

test('a waiting worker looks different from a working and a sleeping one, and its clock ticks each frame', () => {
  const wait = crew('wait', 'wait', 'wait')
  for (const other of [crew('work', 'work', 'work'), crew('sleep')]) {
    expect(crewPixels(wait, 0)).not.toEqual(crewPixels(other, 0))
    expect(crewKey(wait, 0)).not.toBe(crewKey(other, 0))
  }
  const frames = [0, 1, 2, 3].map(f => crewPixels(wait, f))
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) expect(frames[i]).not.toEqual(frames[j])
  expect(crewPixels(wait, 4)).toEqual(frames[0])
  expect(crewKey(wait, 0)).toBe(crewKey(wait, 4))
  expect(crewKey(wait, 0)).not.toBe(crewKey(wait, 1))
})

test('the crew key changes only with what changes the picture', () => {
  const none = crew('sleep')
  const all = crew('work', 'work', 'work')
  // All asleep: the work frame does not matter, only the z phase.
  expect(crewKey(none, 0)).toBe(crewKey(none, 1))
  expect(crewKey(none, 0)).not.toBe(crewKey(none, 2))
  // All working: the z phase does not matter, only the work frame.
  expect(crewKey(all, 0)).toBe(crewKey(all, 4))
  expect(crewKey(all, 0)).not.toBe(crewKey(all, 1))
})

const live = (id: string, model: string, lastTokenAt: number, state: Agent['state'] = 'running'): Agent => ({
  ...agent(id, model, state),
  lastTokenAt,
})

test('a live agent without tokens for 5 minutes is stalled; ended ones and ones without a token time are not', () => {
  expect(STALL_AFTER).toBe(300_000)
  const a = live('a', 'claude-haiku-5-5', 1000)
  expect(isStalled(a, 1000 + STALL_AFTER - 1)).toBe(false)
  expect(isStalled(a, 1000 + STALL_AFTER)).toBe(true)
  expect(isStalled(live('b', 'claude-haiku-5-5', 0, 'waiting'), STALL_AFTER)).toBe(true)
  expect(isStalled(live('c', 'claude-haiku-5-5', 0, 'completed'), STALL_AFTER)).toBe(false)
  expect(isStalled(agent('d', 'claude-haiku-5-5', 'running'), STALL_AFTER)).toBe(false)
})

test('an agent the engine never listed is abandoned after 30 minutes without tokens; listed or ended ones are not', () => {
  expect(ABANDON_AFTER).toBe(30 * 60_000)
  const a = live('a', 'claude-haiku-5-5', 1000)
  expect(isAbandoned(a, 1000 + ABANDON_AFTER - 1)).toBe(false)
  expect(isAbandoned(a, 1000 + ABANDON_AFTER)).toBe(true)
  expect(isAbandoned({ ...a, state: 'waiting' }, 1000 + ABANDON_AFTER)).toBe(true)
  expect(isAbandoned({ ...a, isListed: true }, 1000 + ABANDON_AFTER)).toBe(false)
  expect(isAbandoned({ ...a, state: 'completed' }, 1000 + ABANDON_AFTER)).toBe(false)
  expect(isAbandoned(agent('b', 'claude-haiku-5-5', 'running'), ABANDON_AFTER)).toBe(false)
})

test('the frame moves every tick while a worker works or waits, every third tick by three frames while all sleep', () => {
  for (let tick = 1; tick <= 6; tick++) expect(frameStep(false, tick)).toBe(1)
  expect([1, 2, 3, 4, 5, 6].map(tick => frameStep(true, tick))).toEqual([0, 0, SLEEP_EVERY, 0, 0, SLEEP_EVERY])
})

test('the frame counter wraps without a hitch in the z phase or the work loop', () => {
  const states = [crew('sleep'), crew('work', 'wait', 'sleep'), crew('wait', 'work', 'work')]
  expect(nextFrame(0)).toBe(1)
  expect(nextFrame(10, 3)).toBe(13)
  for (const step of [1, SLEEP_EVERY]) {
    // Whatever tick the wrap falls on, the picture goes on as if the counter had not wrapped.
    for (let from = FRAME_WRAP - step; from < FRAME_WRAP; from++) {
      const wrapped = nextFrame(from, step)
      expect(wrapped).toBeLessThan(step)
      for (const s of states) expect(crewKey(s, wrapped)).toBe(crewKey(s, from + step))
    }
  }
})

test('a worker waits only when all running agents of its family are stalled', () => {
  const now = STALL_AFTER
  const stalled = (id: string, model: string) => live(id, model, 0)
  const fresh = (id: string, model: string) => live(id, model, now - 1000)
  const states = crewStates(
    {
      h1: stalled('h1', 'claude-haiku-5-5'),
      h2: fresh('h2', 'claude-haiku-5-5'),
      s1: stalled('s1', 'claude-sonnet-5-5'),
      s2: stalled('s2', 'claude-sonnet-5-5'),
      o1: live('o1', 'claude-opus-5-5', 0, 'completed'),
    },
    now,
  )
  // Haiku: one still produces tokens, so it works. Sonnet: all stalled. Opus: none running.
  expect(states).toEqual({ haiku: 'work', sonnet: 'wait', opus: 'sleep' })
  // The fresh agent stalls too, 5 minutes on.
  expect(crewStates({ h2: fresh('h2', 'claude-haiku-5-5') }, now + 1000 + STALL_AFTER).haiku).toBe('wait')
  expect(crewStates({}, now)).toEqual({ haiku: 'sleep', sonnet: 'sleep', opus: 'sleep' })
})
