import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
  expect(await ui.find({ text: '2:20h' })).toBeDefined()
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

test('the chat chip counts tokens of every request and shows the session cost', async ($, on) => {
  below(on)
  mock.clock(on, { now: 0 })
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1100 }
  on('turn.step', answered(usage) as never)
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 1 }],
    cost: { usd: 6.789 },
    changed: ['cost'],
  } as never)
  await step($, { effort: 'medium' })
  await step($, { agentId: 'a', model: 'claude-haiku-4-5', effort: 'low' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: '9.2k' })).toBeDefined()
  expect(await ui.find({ text: '$6.79' })).toBeDefined()
  expect(await ui.find({ text: 'Cx' })).toBeDefined()
  // The main thread's request started the cache's hour; the subagent's did not count.
  expect(await ui.find({ text: '1:00h' })).toBeDefined()
  // The main thread's model and effort, beside the pixel Claude.
  expect(await ui.find({ text: 'Opus 5.5 (mid)' })).toBeDefined()
})
