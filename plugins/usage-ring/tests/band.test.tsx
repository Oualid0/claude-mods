import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ALERT, WARN, ZERO } from '../hooks/model'
import { CLAUDE } from '../hooks/claude'
import { hot } from '../hooks/ring'

const BAND = {
  plugin: 'usage-ring',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** What other mods (or the engine) draw in the band, beneath this plugin. */
function below(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })
}

test('todo ring follows TaskCreate and TaskUpdate', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: String(++next), subject: 's' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, () => ({
    result: { success: true, taskId: '1', updatedFields: ['status'] },
  }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: 'a' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'b', description: 'b' })
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0/2' })).toBeDefined()

  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/2' })).toBeDefined()
})

test('session.measure fills the rings (time until reset without session.start) and writes usage-limits.json when asked', { options: { limitsFile: true } }, async ($, on) => {
  below(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: Date.parse('2026-10-03T13:00:00Z') }))
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000, tokens: 80000, percent: 40 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 48, resetsAt: '2026-10-03T15:20:00Z' },
      { kind: 'seven_day', percentUsed: 23 },
    ],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '48%' })).toBeDefined()
  expect(await ui.find({ text: '2:20' })).toBeDefined()
  expect(await ui.find({ text: '40%' })).toBeDefined()
  expect(await ui.find({ text: '23%' })).toBeDefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()
  expect(written[0]?.path).toBe('/home/test/.claude/usage-limits.json')
  expect(JSON.parse(written[0]?.text ?? '{}')).toMatchObject({
    session: { usedPercent: 48, status: null },
    week: { usedPercent: 23 },
    model: 'claude-opus-5-5',
  })
})

test('an existing task list is read at session start', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }] },
  }))
  on('tool.list', () => ({ value: [{ name: 'TaskList' }] as never }))
  on('tool.call', { tool: 'TaskList' }, () => ({
    result: {
      tasks: [
        { id: '1', subject: 'a', status: 'completed', blockedBy: [] },
        { id: '2', subject: 'b', status: 'in_progress', blockedBy: [] },
        { id: '3', subject: 'c', status: 'pending', blockedBy: [] },
      ],
    },
  }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/3' })).toBeDefined()
})

/** Sends one model request through the chain and reads its stream to the end. */
async function step($: Parameters<Parameters<typeof test>[1]>[0], input: object) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input } as never)
  for await (const _ of stream) {
    // Nothing to read: only the result's usage counts.
  }
  return stream.result
}

const answered = (usage: object) =>
  async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', ...usage } }
  }

test('usage-limits.json is not written by default', async ($, on) => {
  below(on)
  let writes = 0
  on('fs.write', () => {
    writes++
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 0 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['rateLimits'],
  } as never)
  expect(writes).toBe(0)
})

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1100 }

test('the tokens group shows the total of every request and the rate of the last minute', { options: { showTokens: true } }, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['context'],
  } as never)
  await step($, { effort: 'medium' })
  await clock.advance(30_000)
  await step($, { agentId: 'a', model: 'claude-haiku-4-5', effort: 'low' })
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'Tokens' })).toBeDefined()
  expect(await ui.find({ text: '9.2k' })).toBeDefined()
  // The rate counts all four token counts of the last minute, like the total.
  expect(await ui.find({ text: '153 tok/s' })).toBeDefined()
  expect(await ui.find({ text: 'Context' })).toBeDefined()
  // The first request leaves the window, then the second; the total stays.
  await clock.advance(40_000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '77 tok/s' })).toBeDefined()
  await clock.advance(60_000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0 tok/s' })).toBeDefined()
  expect(await ui.find({ text: '9.2k' })).toBeDefined()
  // The main thread's request started the cache's hour; the subagent's did not count.
  expect(await ui.find({ text: 'Cache' })).toBeDefined()
  expect(await ui.find({ text: '57m' })).toBeDefined()
  // Neither the titles nor the model label are shown unless asked for.
  expect(await ui.find({ text: 'tokens' })).toBeUndefined()
  expect(await ui.find({ text: 'Opus 5.5 (mid)' })).toBeUndefined()
})

test('the cache goes cold on a compaction or a model switch, not on an effort change, and warms with the next request', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  // Nothing beneath the plugin answers the engine's classic events.
  on('classic.PostModelSwitch', () => ({}))
  on('classic.PostCompact', () => ({}))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['context'],
  } as never)
  const switched = (fields: object) =>
    ({ from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command', ...fields }) as never
  const cold = async () => (await (await $.ui.mount(BAND)).find({ text: 'cold' })) !== undefined

  expect(await cold()).toBe(false)
  await step($, { effort: 'medium' })
  expect(await cold()).toBe(false)

  // An effort change is no event of its own; a switch to the same model or a resumed one changes nothing.
  await step($, { effort: 'high' })
  await $.classic.PostModelSwitch(switched({ to_model: 'claude-opus-5-5' }))
  await $.classic.PostModelSwitch(switched({ source: 'resume' }))
  expect(await cold()).toBe(false)

  // A subagent's switch or compaction leaves the main thread's cache alone.
  await $.classic.PostModelSwitch(switched({ agent_id: 'a' }))
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary', agent_id: 'a' } as never)
  expect(await cold()).toBe(false)

  await $.classic.PostModelSwitch(switched({}))
  expect(await cold()).toBe(true)
  await step($, { model: 'claude-sonnet-5-5' })
  expect(await cold()).toBe(false)

  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' } as never)
  expect(await cold()).toBe(true)
  await step($, {})
  expect(await cold()).toBe(false)
  expect(await (await $.ui.mount(BAND)).find({ text: '1:00' })).toBeDefined()
})

test('a new chat after /clear or a resume starts with no cache, total or rate', { options: { showTokens: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  on('session.end', () => ({ sessionId: 's' }))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['context'],
  } as never)
  await step($, { effort: 'medium' })
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '4.6k' })).toBeDefined()
  expect(await ui.find({ text: '1:00' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '4.6k' })).toBeUndefined()
  expect(await ui.find({ text: '0 tok/s' })).toBeDefined()
  expect(await ui.find({ text: '–' })).toBeDefined()
})

/** The frames the plugin has written so far: one per tick of its frame clock. */
function frames(on: On) {
  const seen: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'usage-ring' && e.key === 'frame') seen.push(e.value as number)
    return next(e)
  })
  return seen
}

/** The pixel Claude as the terminal that cannot draw pictures would show it: `⚒` hammering, `z` asleep. */
async function sprite($: Parameters<Parameters<typeof test>[1]>[0]) {
  return (await (await $.ui.mount(BAND)).find({ key: 'claude' }))?.props.alt
}

/** What the engine answers at a session start, with one rate-limit window. */
function started(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }] },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('tool.list', () => ({ value: [] as never }))
}
const completed = (fields: object) =>
  ({ answer: '', durationMs: 0, isAborted: false, reason: 'end_turn', ...fields }) as never
const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

test('the sprite hammers while a turn runs and sleeps otherwise', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }] },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await start($)

  expect(await sprite($)).toBe('z')

  await $.turn.start({ turnId: 't', text: 'go' })
  expect(await sprite($)).toBe('⚒')

  // A subagent's turn ending does not put the main thread to sleep.
  await $.turn.complete(completed({ turnId: 'u', agentId: 'a' }))
  expect(await sprite($)).toBe('⚒')

  await $.turn.complete(completed({ turnId: 't' }))
  expect(await sprite($)).toBe('z')
})

test('the frame clock ticks fast while a turn runs and once a second while the sprite sleeps', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  const ticks = frames(on)
  started(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await start($)

  await clock.advance(900)
  expect(ticks.length).toBe(0)
  await clock.advance(100)
  expect(ticks.length).toBe(1)

  await $.turn.start({ turnId: 't', text: 'go' })
  await clock.advance(1500)
  expect(ticks.length).toBe(11)

  await $.turn.complete(completed({ turnId: 't' }))
  await clock.advance(1000)
  expect(ticks.length).toBe(12)
})

test('a repeated session.start replaces the frame clock instead of stacking a second', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  const ticks = frames(on)
  started(on)
  await start($)
  await start($)
  await start($)
  await clock.advance(1000)
  expect(ticks.length).toBe(1)
  await clock.advance(3000)
  expect(ticks.length).toBe(4)
})

test('the frame clock stops when the session ends, but goes on after a /clear', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  const ticks = frames(on)
  started(on)
  on('session.end', () => ({ sessionId: 's' }))
  await start($)
  await clock.advance(2000)
  expect(ticks.length).toBe(2)

  // No session.start follows a /clear, so the clock has to keep running.
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await clock.advance(2000)
  expect(ticks.length).toBe(4)

  await $.session.end({ reason: 'other', sessionId: 's' } as never)
  await clock.advance(5000)
  expect(ticks.length).toBe(4)
})

test('the frame clock starts even when the engine fails the calls of a session start', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  const ticks = frames(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    throw new Error('no usage yet')
  })
  on('session.model', () => {
    throw new Error('no model yet')
  })
  on('tool.list', () => {
    throw new Error('no tools yet')
  })
  await start($)
  await clock.advance(2000)
  expect(ticks.length).toBe(2)
})

test('a new chat after /clear or a resume starts with no todos and no context fill, and the frame clock goes on', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  const ticks = frames(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }] },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.end', () => ({ sessionId: 's' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 's' } } }))
  // What the engine's task list holds after the end: the old chat's after a clear is never read, a resumed chat's is.
  let listed: { id: string; subject: string; status: string; blockedBy: string[] }[] = []
  on('tool.list', () => ({ value: [{ name: 'TaskList' }] as never }))
  on('tool.call', { tool: 'TaskList' }, () => ({ result: { tasks: listed } }))
  await start($)
  // A reading makes the band show up at all.
  const measure = () =>
    $.session.measure({
      context: { window: 200000, tokens: 1, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
      changed: ['context'],
    } as never)

  for (const reason of ['clear', 'resume']) {
    await measure()
    await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: 'a' })
    let ui = await $.ui.mount(BAND)
    expect(await ui.find({ text: '0/1' })).toBeDefined()
    expect(await ui.find({ text: '42%' })).toBeDefined()

    listed = reason === 'resume' ? [{ id: '7', subject: 'b', status: 'completed', blockedBy: [] }, { id: '8', subject: 'c', status: 'pending', blockedBy: [] }] : []
    const before = ticks.length
    await $.session.end({ reason, sessionId: 's' } as never)
    ui = await $.ui.mount(BAND)
    expect(await ui.find({ text: '0/1' })).toBeUndefined()
    // The old chat's fill is gone until the next reading.
    expect(await ui.find({ text: '42%' })).toBeUndefined()
    expect(await ui.find({ text: 'Context' })).toBeUndefined()
    // A resumed chat's own list is read again; a cleared one has none.
    expect(await ui.find({ text: '1/2' }) !== undefined).toBe(reason === 'resume')
    expect(await ui.find({ text: 'Todos' }) !== undefined).toBe(reason === 'resume')

    // No session.start follows either: the clock goes on.
    await clock.advance(2000)
    expect(ticks.length - before).toBe(2)
  }
})

test('CLAUDE_CONFIG_DIR decides where the limits file goes, HOME only when it is unset', { options: { limitsFile: true } }, async ($, on) => {
  below(on)
  const written: string[] = []
  let variables: Record<string, string> = { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/test' }
  on('fs.write', ($, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('env.get', ($, e) => ({ value: variables[e.name] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 0 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const measure = () =>
    $.session.measure({
      context: { window: 200000, tokens: 1, percent: 1 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
      changed: ['rateLimits'],
    } as never)

  await measure()
  variables = { HOME: '/home/test' }
  await measure()
  variables = {}
  await measure()
  // Without either variable there is nowhere to write, and nothing breaks.
  expect(written).toEqual(['/cfg/usage-limits.json', '/home/test/.claude/usage-limits.json'])
})

test('a session start seeds the rings from the limits file, leaving out a window that already reset', { options: { limitsFile: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: Date.parse('2026-10-03T13:00:00Z') })
  const reads: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return {
      value: JSON.stringify({
        session: { usedPercent: 48, resetsAt: '2026-10-03T12:00:00Z', status: null },
        week: { usedPercent: 23, resetsAt: '2026-10-08T00:00:00Z', status: null },
      }),
    }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('tool.list', () => ({ value: [] as never }))
  await start($)
  const ui = await $.ui.mount(BAND)
  expect(reads).toEqual(['/cfg/usage-limits.json'])
  expect(await ui.find({ text: '23%' })).toBeDefined()
  expect(await ui.find({ text: '48%' })).toBeUndefined()
})

test('a ring figure outside 0..100 is held to it and one that is not a number leaves the ring out', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: Number.NaN },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 130 },
      { kind: 'seven_day', percentUsed: Number.NaN },
    ],
    changed: ['rateLimits'],
  } as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '100%' })).toBeDefined()
  expect(await ui.find({ text: 'NaN%' })).toBeUndefined()
  expect(await ui.find({ text: 'Week' })).toBeUndefined()
  expect(await ui.find({ text: 'Context' })).toBeUndefined()
})

test('the band yields to a survey, other surfaces and a terminal too narrow for a single ring', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['rateLimits'],
  } as never)
  expect(await (await $.ui.mount(BAND)).find({ text: 'Session' })).toBeDefined()
  expect(await (await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })).find({ text: 'Session' })).toBeUndefined()
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 4 } })
  expect(await narrow.find({ text: 'below' })).toBeDefined()
  expect(await narrow.find({ text: 'Se' })).toBeUndefined()
  expect(await narrow.find({ text: '1%' })).toBeUndefined()
})

/** A warm band: limits, a context fill, a todo list, a request that warmed the cache and the model known. */
async function warm($: Parameters<Parameters<typeof test>[1]>[0], on: On) {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 's' } } }))
  await $.session.measure({
    context: { window: 200000, tokens: 80000, percent: 40 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 48, resetsAt: '1970-01-01T02:20:00Z' },
      { kind: 'seven_day', percentUsed: 23 },
    ],
    changed: ['context', 'rateLimits'],
  } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: 'a' })
  await step($, { effort: 'medium' })
  return clock
}

test('the tokens group is one entry: Tokens, the total, a gap, the rate with its unit', { options: { showTokens: true } }, async ($, on) => {
  await warm($, on)
  const ui = await $.ui.mount(BAND)
  const entry = await ui.find({ type: 'Box', key: 'tokens-entry' })
  expect(entry?.text).toBe('Tokens4.6k77 tok/s')
  // The label, then a box holding the total and the rate a gap apart.
  const [label, values] = entry?.children as [{ children: string[] }, { props: { gap: number }; children: { children: string[] }[] }]
  expect(label.children).toEqual(['Tokens'])
  expect(values.props.gap).toBe(2)
  expect(values.children.map(c => c.children[0])).toEqual(['4.6k', '77 tok/s'])
})

test('the default band is one frame: rings for week, session and context, text for cache and todos, no titles, no model', async ($, on) => {
  await warm($, on)
  const ui = await $.ui.mount(BAND)
  for (const id of ['week', 'session', 'context']) expect(await ui.find({ key: `ring-${id}` })).toBeDefined()
  for (const id of ['todos', 'cache']) expect(await ui.find({ key: `ring-${id}` })).toBeUndefined()
  expect(await ui.find({ text: 'Todos' })).toBeDefined()
  expect(await ui.find({ text: '0/1' })).toBeDefined()
  expect(await ui.find({ text: 'Cache' })).toBeDefined()
  // Hours without the h; the 5-hour window at 2:20 left.
  expect(await ui.find({ text: '2:20' })).toBeDefined()
  expect(await ui.find({ text: '1:00' })).toBeDefined()
  // The groups are divided by a bar inside the one frame, and carry no titles.
  expect(await ui.find({ type: 'Text', text: ' │ ' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: ' │ ' }))?.props.dimColor).toBe(true)
  // The tokens group is off by default.
  expect(await ui.find({ text: 'Tokens' })).toBeUndefined()
  expect(await ui.find({ text: 'tok/s' })).toBeUndefined()
  for (const title of ['limits', 'chat', 'tokens']) expect(await ui.find({ text: title })).toBeUndefined()
  expect(await ui.find({ text: 'Opus 5.5 (mid)' })).toBeUndefined()
  expect((await ui.find({ key: 'claude' }))?.props.alt).toBe('z')
})

test('the cache text takes the colors its ring had: normal, yellow, red, and red once cold', async ($, on) => {
  const clock = await warm($, on)
  const color = async (text: string) => (await (await $.ui.mount(BAND)).find({ type: 'Text', text }))?.props.color
  expect(await color('1:00')).toBe(hot(CLAUDE))
  await clock.advance(51 * 60_000)
  // Under 10 minutes of the hour left.
  expect(await color('9m')).toBe(hot(WARN))
  await clock.advance(7 * 60_000)
  // Under 3 minutes.
  expect(await color('2m')).toBe(hot(ALERT))
  await clock.advance(5 * 60_000)
  expect(await color('cold')).toBe(hot(ALERT))
})

// The settings validation only lets a boolean through, so the string "true" is covered by isOn in model.test.ts.
for (const value of [true]) {
  test(`showModel (${JSON.stringify(value)}) shows the grey model label next to the sprite`, { options: { showModel: value } }, async ($, on) => {
    await warm($, on)
    const label = await (await $.ui.mount(BAND)).find({ type: 'Text', text: 'Opus 5.5 (mid)' })
    expect(label).toBeDefined()
    expect(label?.props.dimColor).toBe(true)
  })

  test(`titles (${JSON.stringify(value)}) starts every group with its title in terracotta`, { options: { titles: value, showTokens: true } }, async ($, on) => {
    await warm($, on)
    const ui = await $.ui.mount(BAND)
    for (const title of ['limits', 'chat', 'tokens']) expect((await ui.find({ type: 'Text', text: title }))?.props.color).toBe(CLAUDE)
  })

  test(`compact (${JSON.stringify(value)}) always uses the short labels`, { options: { compact: value, showTokens: true } }, async ($, on) => {
    await warm($, on)
    const ui = await $.ui.mount(BAND)
    for (const short of ['Wk', 'Se', 'Cx', 'Ca', 'Td', 'Tk']) expect(await ui.find({ text: short })).toBeDefined()
    for (const long of ['Week', 'Session', 'Context', 'Cache', 'Todos', 'Tokens']) expect(await ui.find({ text: long })).toBeUndefined()
  })
}

test('the options are off by default and false keeps them off', { options: { showModel: false, titles: false, compact: false, showTokens: false } }, async ($, on) => {
  await warm($, on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'Opus 5.5 (mid)' })).toBeUndefined()
  expect(await ui.find({ text: 'limits' })).toBeUndefined()
  expect(await ui.find({ text: 'Week' })).toBeDefined()
})

test('a narrow terminal drops the model, titles and long labels before any entry, in the one frame', { options: { showModel: true, titles: true, showTokens: true } }, async ($, on) => {
  await warm($, on)
  // Walk from wide to narrow and note which parts are still there.
  const seen: string[] = []
  for (let bodyColumns = 200; bodyColumns >= 0; bodyColumns--) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })
    const has = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text.replace(/[()]/g, '\\$&')}$`) })) !== undefined
    const parts = [
      (await has('Opus 5.5 (mid)')) && 'model',
      (await has('limits')) && 'titles',
      (await has('Week')) && 'long',
      (await has('Wk')) && 'short',
      (await has('\\d+k? tok/s')) && 'rate',
      (await has('Tk')) && 'Tk',
      (await has('Ca')) && 'Ca',
      (await has('Td')) && 'Td',
      (await has('Cx')) && 'Cx',
      (await has('Se')) && 'Se',
      (await has('below')) && 'below',
    ].filter(Boolean)
    const key = parts.join(' ')
    if (seen.at(-1) !== key) seen.push(key)
  }
  // `long` stands for all the long labels, `short` for Wk: the other short ones are listed as they leave. The rate (`6k tok/s`) leaves before `Tk`.
  expect(seen).toEqual([
    'model titles long rate below',
    'model titles short rate Tk Ca Td Cx Se below',
    'titles short rate Tk Ca Td Cx Se below',
    'short rate Tk Ca Td Cx Se below',
    'short Tk Ca Td Cx Se below',
    'short Ca Td Cx Se below',
    'short Td Cx Se below',
    'short Cx Se below',
    'Cx Se below',
    'Se below',
    'below',
  ])
})

test('showTokens off keeps the tokens group out, its title too, even with titles on; the groups are divided by a bar', { options: { titles: true } }, async ($, on) => {
  await warm($, on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'Tokens' })).toBeUndefined()
  expect(await ui.find({ text: 'tokens' })).toBeUndefined()
  expect(await ui.find({ text: 'tok/s' })).toBeUndefined()
  for (const title of ['limits', 'chat']) expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
  // Two groups, one bar between them, and none after the last.
  expect(await ui.find({ type: 'Box', key: 'part-1' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'part-2' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' │ ' })).toBeDefined()
})

test('showTokens on shows the tokens group with its title, after the chat group and a bar', { options: { titles: true, showTokens: true } }, async ($, on) => {
  await warm($, on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 } })
  expect(await ui.find({ type: 'Text', text: 'tokens' })).toBeDefined()
  expect((await ui.find({ type: 'Box', key: 'tokens-entry' }))?.text).toBe('Tokens4.6k77 tok/s')
  expect(await ui.find({ type: 'Box', key: 'part-2' })).toBeDefined()
})

type Node = { type: string; props?: Record<string, unknown>; children: Node[] }
/** The value Text of an entry: the second Text of its Box (the first is the label). */
async function valueOf($: Parameters<Parameters<typeof test>[1]>[0], key: string) {
  const entry = (await (await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 } })).find({ type: 'Box', key })) as unknown as Node
  return entry.children.filter(c => c.type === 'Text')[1]!.props!
}
async function tokenValues($: Parameters<Parameters<typeof test>[1]>[0]) {
  const entry = (await (await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 } })).find({ type: 'Box', key: 'tokens-entry' })) as unknown as Node
  const values = entry.children.find(c => c.type === 'Box')!.children
  return values.map(c => c.props!)
}

test('every entry whose value is 0 is terracotta, and from 1 on it is not', { options: { showTokens: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: String(++next), subject: 's' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, () => ({ result: { success: true, taskId: '1', updatedFields: ['status'] } }))
  const measure = (percent: number) =>
    $.session.measure({
      context: { window: 200000, tokens: 1, percent },
      rateLimits: [
        { kind: 'five_hour', percentUsed: percent, resetsAt: '1970-01-01T02:20:00Z' },
        { kind: 'seven_day', percentUsed: percent },
      ],
      changed: ['context', 'rateLimits'],
    } as never)

  // Nothing used yet: 0%, 0 of 2 todos, no tokens.
  await measure(0)
  await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: 'a' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'b', description: 'b' })
  for (const key of ['week', 'session', 'context', 'todos']) {
    const props = await valueOf($, key)
    // The muted terracotta: neither bold nor dimmed, so it differs from the grey labels.
    expect([key, props.color, props.bold, props.dimColor]).toEqual([key, ZERO, undefined, undefined])
  }
  const [total, rate] = await tokenValues($)
  expect([total!.color, rate!.color]).toEqual([ZERO, ZERO])
  expect([total!.bold, rate!.bold, total!.dimColor, rate!.dimColor]).toEqual([undefined, undefined, undefined, undefined])

  // Used: 5%, one of 2 todos done, a request with a rate.
  await measure(5)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await step($, {})
  for (const key of ['week', 'session', 'context', 'todos']) {
    const props = await valueOf($, key)
    expect([key, props.dimColor, props.bold]).toEqual([key, undefined, true])
    expect(props.color).toBe(hot(CLAUDE))
  }
  const [total2, rate2] = await tokenValues($)
  expect([total2!.dimColor, rate2!.dimColor, total2!.bold, rate2!.bold]).toEqual([undefined, undefined, true, true])
  expect([total2!.color, rate2!.color]).toEqual([hot(CLAUDE), hot(CLAUDE)])
})

test('the rate and the total turn terracotta on their own: a total from a request, a rate of the last minute gone', { options: { showTokens: true } }, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(USAGE) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  await $.session.measure({ context: { window: 200000, tokens: 1, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }], changed: ['context'] } as never)
  await step($, {})
  let [total, rate] = await tokenValues($)
  expect([total!.color, rate!.color]).toEqual([hot(CLAUDE), hot(CLAUDE)])
  // A pause of a minute: 0 tok/s turns terracotta, the total stays bright.
  await clock.advance(61_000)
  ;[total, rate] = await tokenValues($)
  expect([total!.color, rate!.color]).toEqual([hot(CLAUDE), ZERO])
})

test('a warning or alert color wins over the zero color, and the cache is no zero case', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 85 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 97 }, { kind: 'seven_day', percentUsed: 0 }],
    changed: ['context', 'rateLimits'],
  } as never)
  const session = await valueOf($, 'session')
  expect(session.dimColor).toBeUndefined()
  expect(session.color).toBe(hot(ALERT))
  const context = await valueOf($, 'context')
  expect(context.dimColor).toBeUndefined()
  expect(context.color).toBe(hot(ALERT))
  expect((await valueOf($, 'week')).color).toBe(ZERO)
  // Before the first request the cache shows its dash in the normal color.
  const cache = await valueOf($, 'cache')
  expect(cache.dimColor).toBeUndefined()
  expect(cache.color).toBe(hot(CLAUDE))
})

const HIT = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
const AFTER_RELOAD = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 9000 }

// Reproduces a live report: /reload-plugins changes the system prompt and tools, so the next
// request reads little from the cache although the hour still holds. 6 idle minutes later the
// cache must not show `cold`.
test('the first request after a prompt change does not make the cache go cold after 5 idle minutes', async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  let usage: object = HIT
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', ...usage } }
  } as never)
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['context'],
  } as never)
  const cold = async () => (await (await $.ui.mount(BAND)).find({ text: 'cold' })) !== undefined
  await step($, {})
  await clock.advance(60_000)
  await step($, {})
  expect(await cold()).toBe(false)
  // 10 idle minutes (waiting on subagents), then the request after a reload: it re-caches the prompt.
  await clock.advance(10 * 60_000)
  usage = AFTER_RELOAD
  await step($, {})
  await clock.advance(6 * 60_000)
  expect(await cold()).toBe(false)
})

test('a model switch names the cache lifetime: 5m and 1h are taken, an unknown one keeps the learned lifetime', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', answered(HIT) as never)
  on('classic.PostModelSwitch', () => ({}))
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    changed: ['context'],
  } as never)
  const switched = (fields: object) =>
    ({ from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command', ...fields }) as never
  const text = async (t: string | RegExp) => (await (await $.ui.mount(BAND)).find({ type: 'Text', text: t })) !== undefined

  await step($, {})
  expect(await text('1:00')).toBe(true)
  // The engine says 5m on a switch: the cache is cold, and the next request counts down from 5 minutes.
  await $.classic.PostModelSwitch(switched({ cache_ttl: '5m' }))
  expect(await text('cold')).toBe(true)
  await step($, { model: 'claude-sonnet-5-5' })
  expect(await text('5m')).toBe(true)
  // An unknown value keeps the learned lifetime (5 minutes here), also for an agent's switch.
  await $.classic.PostModelSwitch(switched({ cache_ttl: 'weird' }))
  await $.classic.PostModelSwitch(switched({ cache_ttl: '1h', agent_id: 'a' }))
  await step($, { model: 'claude-sonnet-5-5' })
  expect(await text('5m')).toBe(true)
  // 1h on a switch back is taken, on a resume or a switch to the same model too (no cold marking there).
  await $.classic.PostModelSwitch(switched({ cache_ttl: '1h', to_model: 'claude-sonnet-5-5', from_model: 'claude-sonnet-5-5' }))
  expect(await text('cold')).toBe(false)
  expect(await text('5m')).toBe(false)
  expect(await text('1:00')).toBe(true)
})
