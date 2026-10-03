import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'session-board',
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

const listing = (status: string | null) =>
  `This session is mine [111111] — the name other sessions use.\n\n` +
  (status === null
    ? ''
    : `Peer sessions (1):\n  other work [222222]  ·  ${status}  ·  started 1m ago`)

/** The engine beneath the plugin: ListAgents, the clock, the band. */
function world(on: On, answer: () => string) {
  const clock = mock.clock(on, { now: 0 })
  on('tool.call', { tool: 'ListAgents' }, () => ({ result: { listing: answer() } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })
  return { clock }
}

test('board lists running peers above what is below, hides finished ones after 60 s', async ($, on) => {
  let current = listing('busy')
  const { clock } = world(on, () => current)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'other work' })).toBeDefined()
  expect(await ui.find({ text: 'mine' })).toBeDefined()
  expect(await ui.find({ text: /running/ })).toBeDefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()

  current = listing('idle')
  await clock.advance(5_000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /done/ })).toBeDefined()

  // Still there after 30 s, gone after 60 s.
  await clock.advance(30_000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /done/ })).toBeDefined()
  await clock.advance(30_000)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'other work' })).toBeUndefined()
  expect(await ui.find({ text: 'below' })).toBeDefined()
})

test('the own row ends in an arrow and shows no todos', async ($, on) => {
  world(on, () => listing('busy'))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '←' })).toBeDefined()
  expect(await ui.find({ text: /\d\/\d/ })).toBeUndefined()
  expect(await ui.find({ text: 'this session' })).toBeUndefined()
})
