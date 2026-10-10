import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Tokens } from '../types'
import { ALERT, BAR_CELLS, COLOR, TERRACOTTA, ZERO, bar } from '../hooks/model'
import { barPixels, hexToRgb, hot, toBase64 } from '../hooks/ring'

const BAND = {
  plugin: 'agent-board',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const LIMITS = { options: { maxHaiku: 15, maxSonnet: 3, maxOpus: 1 } }

/** The token bar's picture for `tokens`, as the row should draw it. */
const barFor = (tokens: Tokens) =>
  toBase64(barPixels(bar(tokens).map(p => ({ cells: p.cells, rgb: hexToRgb(COLOR[p.key]) })), BAR_CELLS, hexToRgb(TERRACOTTA)))

/** The token bar's picture as the row drew it. */
async function drawnBar(ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  const found = await ui.find({ key: 'agent-board-bar' })
  return (found?.props.source as { rgba?: string } | undefined)?.rgba
}

/** What other mods (or the engine) draw in the band, beneath this plugin. */
function below(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })
}

/** The engine's side of a spawn: each call starts an agent on `model` with the next id. */
function spawns(on: On, model: string) {
  let n = 0
  on('agent.spawn', () => ({ model, agentId: `a${++n}` }))
}

/** Sends one model request through the chain and reads its stream to the end. */
async function step($: Parameters<TestBody>[0], input: object) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input } as never)
  for await (const _ of stream) {
    // Nothing to read: only the result's usage counts.
  }
  return stream.result
}

const answered = (tokens: number) => ({
  turnId: 't',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: 'end_turn',
  usage: { model: 'm', input_tokens: tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})

test('no row before the first subagent', async ($, on) => {
  below(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'below' })).toBeDefined()
  expect(await ui.find({ key: 'agent-board-bar' })).toBeUndefined()
})

test('a running subagent counts against its family limit, then shows as done', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'agent-board-bar' })).toBeDefined()
  expect(await ui.find({ text: '1/15' })).toBeDefined()
  expect(await ui.find({ text: '0/3' })).toBeDefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()
  // Nothing has ended yet: no done count, not even a zero.
  expect(await ui.find({ text: '✔' })).toBeUndefined()
  // The band yields to the feedback survey.
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ text: '1/15' })).toBeUndefined()
  expect(await survey.find({ text: 'below' })).toBeDefined()

  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, agentId: 'a1' } as never)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0/15' })).toBeDefined()
  expect(await ui.find({ text: '✔1' })).toBeDefined()
  // The families that never had one show no done count at all.
  expect(await ui.find({ text: '✔0' })).toBeUndefined()
})

test('tokens split into the main loop and the subagent families', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  on('turn.step', async function* ($, e) {
    return answered(e.agentId === undefined ? 300 : 100) as never
  })
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await step($, {})
  await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  const ui = await $.ui.mount(BAND)
  expect(await drawnBar(ui)).toBe(barFor({ main: 300, haiku: 100 }))
})

test('without limit options the row shows plain counts', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-sonnet-5-5')
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'reviewer' } as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'Sonnet' })).toBeDefined()
  expect(await ui.find({ text: '0/3' })).toBeUndefined()
})

test('an ended agent that is woken by a message runs again', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-opus-5-5')
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    return answered(10) as never
  })
  await $.agent.spawn({ prompt: 'review', description: 'review', subagentType: 'planner' } as never)
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'a1' } as never)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0/1' })).toBeDefined()

  await step($, { agentId: 'a1', model: 'claude-opus-5-5' })
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/1' })).toBeDefined()
})

test('tokens of loops the board never saw spawn count as the main loop', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  on('turn.step', async function* ($, e) {
    return answered(e.agentId === 'a1' ? 100 : 300) as never
  })
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await step($, { agentId: 'compact-fork', model: 'claude-opus-5-5' })
  await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  const ui = await $.ui.mount(BAND)
  // Haiku 100 of 400; no Opus run although the fork ran on Opus.
  expect(await drawnBar(ui)).toBe(barFor({ main: 300, haiku: 100 }))
})

/** Ends agent `a1` with `input`, then returns the band. */
async function ended($: Parameters<TestBody>[0], on: On, input: object) {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, agentId: 'a1', ...input } as never)
  return $.ui.mount(BAND)
}

for (const [how, input] of [
  ['an error', { reason: 'error' }],
  ['a refusal', { reason: 'refusal' }],
  ['an abort', { isAborted: true, reason: 'aborted' }],
] as const) {
  test(`a subagent that ends on ${how} no longer runs`, LIMITS, async ($, on) => {
    const ui = await ended($, on, input)
    expect(await ui.find({ text: '0/15' })).toBeDefined()
    expect(await ui.find({ text: '✔1' })).toBeDefined()
  })
}

test('/clear empties the row', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  on('session.end', () => ({ sessionId: 's' }))
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'agent-board-bar' })).toBeUndefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()
})

test('a band too narrow or too short for the row shows only what lies beneath', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  for (const props of [{ bodyColumns: 10 }, { maxRows: 5 }]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, ...props } })
    expect(await ui.find({ text: 'Ha' })).toBeUndefined()
    expect(await ui.find({ text: 'below' })).toBeDefined()
  }
})

test('the engine list ends agents but never revives one a turn ended', LIMITS, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  on('turn.complete', () => ({ text: '' }))
  let rows = [
    { id: 'a1', status: 'running' },
    { id: 'a2', status: 'running' },
  ]
  on('agent.list', () => ({ value: rows }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, agentId: 'a1' } as never)
  await clock.advance(2000)
  let ui = await $.ui.mount(BAND)
  // a1 stays done although the list still says running.
  expect(await ui.find({ text: '1/15' })).toBeDefined()

  rows = [{ id: 'a2', status: 'killed' }]
  await clock.advance(2000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0/15' })).toBeDefined()
  expect(await ui.find({ text: '✔2' })).toBeDefined()
})

test('a listed agent missing from the engine list for two polls counts as stopped', LIMITS, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  let rows = [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }]
  on('agent.list', () => ({ value: rows }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  // a3 never shows in the list, as a workflow's agents.
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)
  await clock.advance(2000)
  rows = [{ id: 'a2', status: 'running' }]
  await clock.advance(2000)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '3/15' })).toBeDefined()
  await clock.advance(2000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '2/15' })).toBeDefined()
  expect(await ui.find({ text: '✔1' })).toBeDefined()
})

/** A started session with the engine's side of spawns, turn ends and an empty agent list. */
async function started($: Parameters<TestBody>[0], on: On) {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  return clock
}

const spawn = ($: Parameters<TestBody>[0]) =>
  $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'general-purpose' } as never)

const end = ($: Parameters<TestBody>[0], agentId: string) =>
  $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, agentId } as never)

test('the row hides 5 minutes after the last subagent ended and returns with the next', LIMITS, async ($, on) => {
  const clock = await started($, on)
  await spawn($)
  await end($, 'a1')
  await clock.advance(298_000)
  expect(await (await $.ui.mount(BAND)).find({ key: 'agent-board-bar' })).toBeDefined()
  await clock.advance(4_000)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'agent-board-bar' })).toBeUndefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()

  await spawn($)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/15' })).toBeDefined()
  expect(await ui.find({ text: '✔1' })).toBeDefined()
})

test('a running subagent keeps the row however long it runs', LIMITS, async ($, on) => {
  const clock = await started($, on)
  await spawn($)
  await clock.advance(600_000)
  expect(await (await $.ui.mount(BAND)).find({ key: 'agent-board-bar' })).toBeDefined()
})

test('hideAfter 0 keeps the row shown', { options: { ...LIMITS.options, hideAfter: 0 } }, async ($, on) => {
  const clock = await started($, on)
  await spawn($)
  await end($, 'a1')
  await clock.advance(600_000)
  expect(await (await $.ui.mount(BAND)).find({ key: 'agent-board-bar' })).toBeDefined()
})

/** What the crew image says it shows: `⚒` at work, `⌛` waiting, `z` asleep. */
async function crewAlt(ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return (await ui.find({ key: 'agent-board-crew' }))?.props.alt
}

/** Every model request of any loop answers with 10 tokens. */
function answers(on: On) {
  on('turn.step', async function* () {
    return answered(10) as never
  })
}

test('the crew keeps working while any running subagent of the family still makes tokens', LIMITS, async ($, on) => {
  answers(on)
  const clock = await started($, on)
  await spawn($)
  await spawn($)
  await clock.advance(150_000)
  await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  // a2 is silent for 5 minutes now, a1 only for 2.5.
  await clock.advance(155_000)
  expect(await crewAlt(await $.ui.mount(BAND))).toBe('⚒')
})

test('the crew waits once all running subagents of a family made no tokens for 5 minutes, new tokens end it', LIMITS, async ($, on) => {
  answers(on)
  const clock = await started($, on)
  await spawn($)
  await clock.advance(295_000)
  expect(await crewAlt(await $.ui.mount(BAND))).toBe('⚒')
  await clock.advance(10_000)
  expect(await crewAlt(await $.ui.mount(BAND))).toBe('⌛')

  await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  expect(await crewAlt(await $.ui.mount(BAND))).toBe('⚒')

  await end($, 'a1')
  expect(await crewAlt(await $.ui.mount(BAND))).toBe('z')
})

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The first Text of the drawing that holds exactly `text` (`find` answers the outermost element that contains it). */
function textIn(node: unknown, text: string): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const drawn = node as Drawn
  if (drawn.type === 'Text' && drawn.children?.includes(text)) return drawn
  for (const child of drawn.children ?? []) {
    const hit = textIn(child, text)
    if (hit) return hit
  }
  return undefined
}

/** The props of the Text that says `text`. */
async function propsOf(ui: { find: (q: { text: string }) => Promise<unknown> }, text: string) {
  return textIn(await ui.find({ text }), text)?.props
}

/** A label or count dimmed in the terminal's grey, with no color of its own. */
const dimmed = { dimColor: true }

test('the model label is dimmed like usage-ring\'s labels, not in its family color', { options: { maxHaiku: 1 } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  for (const name of ['Haiku', 'Sonnet', 'Opus']) {
    const props = await propsOf(ui, name)
    expect(props).toMatchObject(dimmed)
    expect(props).not.toHaveProperty('color')
  }
})

test('a count of zero is muted terracotta, from one running it has the chip color, over the limit it is red', { options: { maxHaiku: 1, maxOpus: 1 } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  let ui = await $.ui.mount(BAND)
  // Sonnet has no limit (plain 0), Opus has one (0/1): both in the fixed muted terracotta, neither bold nor dim.
  for (const zero of ['0', '0/1']) {
    const props = await propsOf(ui, zero)
    expect(props).toMatchObject({ color: ZERO })
    expect(props).not.toHaveProperty('bold')
    expect(props).not.toHaveProperty('dimColor')
  }
  expect(await propsOf(ui, '1/1')).toMatchObject({ color: hot(TERRACOTTA), bold: true })
  expect(await propsOf(ui, '1/1')).not.toHaveProperty('dimColor')
  await spawn($)
  ui = await $.ui.mount(BAND)
  expect(await propsOf(ui, '2/1')).toMatchObject({ color: hot(ALERT), bold: true })
})

test('a count without a limit has the chip color from one running', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await propsOf(ui, '1')).toMatchObject({ color: hot(TERRACOTTA), bold: true })
})

test('a narrow row dims the two-letter labels the same way', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 42 } })
  for (const short of ['Ha', 'So']) expect(await propsOf(ui, short)).toMatchObject(dimmed)
})

test('a model of no known family shows as Other, dimmed too', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'mystery-model')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await propsOf(ui, 'Other')).toMatchObject(dimmed)
})

test('a limit that is no whole number from 1 up is ignored', { options: { maxHaiku: 2.5, maxSonnet: 0, maxOpus: -1 } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/2.5' })).toBeUndefined()
  expect(await ui.find({ text: '1' })).toBeDefined()
  expect(await ui.find({ text: '0/0' })).toBeUndefined()
})

test('a subagent the engine never listed counts as done after 30 minutes without tokens, a request revives it', LIMITS, async ($, on) => {
  answers(on)
  const clock = mock.clock(on, { now: 0 })
  below(on)
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  on('agent.list', () => ({ value: [] }) as never)
  // Spawned before the timers run, so the test can jump the half hour.
  await spawn($)
  await clock.set(1_790_000)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(2000)
  expect(await (await $.ui.mount(BAND)).find({ text: '1/15' })).toBeDefined()
  await clock.advance(10_000)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '0/15' })).toBeDefined()
  expect(await ui.find({ text: '✔1' })).toBeDefined()

  await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '1/15' })).toBeDefined()
})

test('a listed subagent follows the engine list however long it is silent', LIMITS, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  below(on)
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  on('agent.list', () => ({ value: [{ id: 'a1', status: 'running' }] }) as never)
  await spawn($)
  await clock.set(3_600_000)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(4000)
  expect(await (await $.ui.mount(BAND)).find({ text: '1/15' })).toBeDefined()
})

/** The crew picture as the row drew it. */
async function crewPicture(ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  const found = await ui.find({ key: 'agent-board-crew' })
  return (found?.props.source as { rgba?: string } | undefined)?.rgba
}

test('a repeated session.start does not stack timers; session.end stops them and /clear starts them anew', LIMITS, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  on('session.end', () => ({ sessionId: 's' }))
  spawns(on, 'claude-haiku-5-5')
  let polls = 0
  on('agent.list', () => {
    polls++
    return { value: [] } as never
  })
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await start()
  await start()
  await spawn($)
  polls = 0
  await clock.advance(2000)
  expect(polls).toBe(1)
  const before = await crewPicture(await $.ui.mount(BAND))
  await clock.advance(333)
  expect(await crewPicture(await $.ui.mount(BAND))).not.toBe(before)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's' } as never)
  polls = 0
  const stopped = await crewPicture(await $.ui.mount(BAND))
  await clock.advance(4000)
  expect(polls).toBe(0)
  expect(await crewPicture(await $.ui.mount(BAND))).toBe(stopped)

  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await spawn($)
  polls = 0
  await clock.advance(2000)
  expect(polls).toBe(1)
})

test('a failing engine list does not end the timers', LIMITS, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  spawns(on, 'claude-haiku-5-5')
  let isBroken = true
  let polls = 0
  on('agent.list', () => {
    polls++
    if (isBroken) throw new Error('list failed')
    return { value: [] } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await spawn($)
  await clock.advance(2000)
  isBroken = false
  polls = 0
  await clock.advance(2000)
  expect(polls).toBe(1)
  expect(await (await $.ui.mount(BAND)).find({ text: '1/15' })).toBeDefined()
})

test('a resume ends the timers and starts them anew once, even if session.start follows', LIMITS, async ($, on) => {
  below(on)
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: '/' }))
  on('session.end', () => ({ sessionId: 's' }))
  spawns(on, 'claude-haiku-5-5')
  let polls = 0
  on('agent.list', () => {
    polls++
    return { value: [] } as never
  })
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await start()
  await spawn($)
  await $.session.end({ reason: 'resume', sessionId: 's' } as never)
  expect(await (await $.ui.mount(BAND)).find({ key: 'agent-board-bar' })).toBeUndefined()
  await start()
  await spawn($)
  polls = 0
  await clock.advance(2000)
  expect(polls).toBe(1)
})

test('while all workers sleep the crew moves slowly: nothing for a while, then three frames at once', LIMITS, async ($, on) => {
  answers(on)
  const clock = await started($, on)
  await spawn($)
  await end($, 'a1')
  const asleep = await crewPicture(await $.ui.mount(BAND))
  // Eight ticks of 333 ms: a frame a tick would have reached the second z (frame 8) by now, the slow pace is at frame 6.
  await clock.advance(2664)
  expect(await crewPicture(await $.ui.mount(BAND))).toBe(asleep)
  // The third tick of the next three moves three frames at once, to frame 9.
  await clock.advance(666)
  expect(await crewPicture(await $.ui.mount(BAND))).not.toBe(asleep)
})

/** The Text that says `text`, anywhere in what the band drew. */
async function textOf(ui: { find: (q: { text: string }) => Promise<unknown> }, text: string) {
  return textIn(await ui.find({ text }), text)
}

test('no ring per family, with or without a limit; the count says running/limit', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  for (const tier of ['haiku', 'sonnet', 'opus']) expect(await ui.find({ key: `agent-board-ring-${tier}` })).toBeUndefined()
  expect(await ui.find({ text: '1/15' })).toBeDefined()
})

test('the done count is dimmed, without a color of its own, and shows from one up', LIMITS, async ($, on) => {
  const ui = await ended($, on, {})
  const done = await textOf(ui, '✔1')
  expect(done?.props).toMatchObject({ dimColor: true })
  expect(done?.props).not.toHaveProperty('color')
  expect(await textOf(ui, '✔0')).toBeUndefined()
})

test('the titles agents and Split are hidden by default', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'agent-board-bar' })).toBeDefined()
  expect(await textOf(ui, 'agents')).toBeUndefined()
  expect(await textOf(ui, 'Split')).toBeUndefined()
})

test('the titles option shows agents and Split again', { options: { ...LIMITS.options, titles: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await textOf(ui, 'agents')).toBeDefined()
  expect(await textOf(ui, 'Split')).toBeDefined()
  // Too narrow for the titles, they go first.
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 42 } })
  expect(await textOf(narrow, 'agents')).toBeUndefined()
  expect(await textOf(narrow, 'Sp')).toBeUndefined()
})

test('the compact option always writes the short labels', { options: { ...LIMITS.options, compact: true, titles: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await propsOf(ui, 'Ha')).toMatchObject(dimmed)
  expect(await textOf(ui, 'Haiku')).toBeUndefined()
  expect(await textOf(ui, 'Sp')).toBeDefined()
  expect(await textOf(ui, 'Split')).toBeUndefined()
})

test('without the compact option the full names show', LIMITS, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await textOf(ui, 'Haiku')).toBeDefined()
  expect(await textOf(ui, 'Ha')).toBeUndefined()
})

test('the hideUnused option shows a family only once it had a subagent', { options: { hideUnused: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await textOf(ui, 'Haiku')).toBeDefined()
  expect(await textOf(ui, 'Sonnet')).toBeUndefined()
  expect(await textOf(ui, 'Opus')).toBeUndefined()
})

test('without hideUnused all three families show from the first subagent on', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'claude-haiku-5-5')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  for (const name of ['Haiku', 'Sonnet', 'Opus']) expect(await textOf(ui, name)).toBeDefined()
  expect(await textOf(ui, 'Other')).toBeUndefined()
})

test('hideUnused shows Other once a model of no known family ran', { options: { hideUnused: true } }, async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  spawns(on, 'mystery-model')
  await spawn($)
  const ui = await $.ui.mount(BAND)
  expect(await textOf(ui, 'Other')).toBeDefined()
  expect(await textOf(ui, 'Haiku')).toBeUndefined()
})
