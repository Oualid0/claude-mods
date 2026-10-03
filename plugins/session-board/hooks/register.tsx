import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board } from '../types'
import { DONE_MS, parseListing, prune, reconcile } from './listing'
import { hot } from './color'

const board = atom({ plugin: 'session-board', key: 'board' } as const, { peers: [] } as Board)
const selfStatus = atom(
  { plugin: 'session-board', key: 'selfStatus' } as const,
  'idle' as 'busy' | 'idle',
)

const POLL_MS = 5_000

// The "hot" (whitened) tones of an ochre and a sage, as usage-ring lightens its numbers.
const LABEL = {
  busy: { glyph: '●', word: 'running', color: hot('#e0a458') },
  done: { glyph: '✓', word: 'done', color: hot('#9cae86') },
  idle: { glyph: '○', word: 'ready', color: hot('#9cae86') },
} as const

/** The status words share one column. */
const WORD_WIDTH = Math.max(...Object.values(LABEL).map(l => l.word.length))

/** Frame and label of the board's chip: Claude's terracotta. */
const CHIP_COLOR = '#d97757'

// When the poll still waiting on ListAgents started; the next tick skips it
// instead of piling up, unless that call has hung for longer than POLL_STUCK_MS.
let pollingSince: number | undefined
const POLL_STUCK_MS = 30_000

async function poll($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (pollingSince !== undefined && now - pollingSince < POLL_STUCK_MS) return
  pollingSince = now
  try {
    await pollOnce($)
  } finally {
    pollingSince = undefined
  }
}

async function pollOnce($: EngineInterface): Promise<void> {
  let listing: string | undefined
  try {
    const r = await $.tool.call({ tool: 'ListAgents' })
    listing = (r.result as { listing?: string } | undefined)?.listing ?? r.text
  } catch {
    return
  }
  if (listing === undefined) return
  const { self, peers } = parseListing(listing)
  const now = await $.clock.now()
  const shown = (await read($, board)).peers
  const next = reconcile(shown, peers, now)
  await update($, board, () => ({ self, peers: next.peers }))
  if (next.finished > 0) {
    // Hide the finished rows on time rather than at the next poll.
    $.clock.after(DONE_MS, () => {
      void $.clock.now().then(t => update($, board, b => ({ ...b, peers: prune(b.peers, t) })))
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await poll($)
    $.clock.every(POLL_MS, () => {
      void poll($)
    })
    return result
  })

  on('turn.start', async ($, e, next) => {
    await update($, selfStatus, () => 'busy')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, selfStatus, () => 'idle')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { self, peers } = await read($, board)
    if (peers.length === 0) return next(e)

    const rows = [
      { key: 'self', name: self ?? 'this session', label: LABEL[await read($, selfStatus)], isSelf: true },
      ...peers.map(p => ({ key: p.ref, name: p.name, label: LABEL[p.status], isSelf: false })),
    ]
    const nameWidth = Math.min(40, Math.max(...rows.map(r => r.name.length)))

    // The board sits on top; other mods' drawings (the rings) go below it.
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // One chip as wide as its content, the sessions a row each beside the label.
    return (
      <Box flexDirection="column">
        <Box alignSelf="flex-start" borderStyle="round" borderColor={CHIP_COLOR} paddingX={1} flexDirection="row" gap={1}>
          <Text color={CHIP_COLOR}>sessions</Text>
          <Box flexDirection="column">
            {rows.map(r => (
              <Box key={r.key} flexDirection="row" gap={2} alignItems="center">
                <Text color={r.label.color} bold>
                  {r.label.glyph} {r.label.word.padEnd(WORD_WIDTH)}
                </Text>
                <Box width={nameWidth}>
                  <Text bold={r.isSelf} wrap="truncate-end">
                    {r.name}
                  </Text>
                </Box>
                <Text color={CHIP_COLOR}>{r.isSelf ? '←' : ' '}</Text>
              </Box>
            ))}
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
