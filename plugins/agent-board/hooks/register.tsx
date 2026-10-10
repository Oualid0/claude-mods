import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Agent, AgentState } from '../types'
import {
  ALERT,
  BAR_CELLS,
  COLOR,
  GAP,
  bar,
  barLabel,
  crewStates,
  displayFrom,
  LABEL_TEXT,
  limitsFrom,
  CREW_COLUMNS,
  TERRACOTTA,
  ZERO,
  fit,
  hideAfterFrom,
  isAbandoned,
  isLive,
  segmentText,
  segments,
  tierOf,
} from './model'
import { CREW_H, CREW_ROWS, CREW_W, SCALE, crewKey, crewPixels, frameStep, nextFrame } from './workers'
import { barPixels, barSize, hexToRgb, hot, toBase64 } from './ring'
import type { BarPart } from './model'

const agents = atom({ plugin: 'agent-board', key: 'agents' } as const, {} as Record<string, Agent>)
const tokens = atom({ plugin: 'agent-board', key: 'tokens' } as const, {})
const frame = atom({ plugin: 'agent-board', key: 'frame' } as const, 0)
const idleSince = atom({ plugin: 'agent-board', key: 'idleSince' } as const, null as number | null)
const hidden = atom({ plugin: 'agent-board', key: 'hidden' } as const, false)

const TICK_MS = 2000
/** A work frame every FRAME_MS; the z's move every second frame. */
const FRAME_MS = 333
/** Polls a listed live agent may be missing from the engine's list before it counts as stopped. */
const MISSES = 2
/** Rows of the row (the chip's border and the crew), and the rows it leaves the band beneath it. */
const ROW_ROWS = 3
const ROOM_BELOW = 3

/** The bar changes with the shares, so only the one drawn last is kept. */
let barCache: { key: string; base64: string } | undefined

function barPicture(parts: BarPart[]): string {
  const key = parts.map(p => `${p.key}${p.cells}`).join(',')
  if (barCache?.key !== key) {
    const runs = parts.map(p => ({ cells: p.cells, rgb: hexToRgb(COLOR[p.key]) }))
    barCache = { key, base64: toBase64(barPixels(runs, BAR_CELLS, hexToRgb(TERRACOTTA))) }
  }
  return barCache.base64
}

/** The crew's pictures are large and many, so only the one drawn last is kept. */
let crew: { key: string; base64: string } | undefined

function crewPicture(states: Parameters<typeof crewPixels>[0], f: number): string {
  const key = crewKey(states, f)
  if (crew?.key !== key) crew = { key, base64: toBase64(crewPixels(states, f)) }
  return crew.base64
}

/**
 * Keeps `idleSince` in step with the agents after a change: cleared (and the row
 * shown) while one runs, set to now when the last one ended.
 */
async function markIdle($: EngineInterface): Promise<void> {
  const live = Object.values(await read($, agents)).some(a => isLive(a.state))
  if (live) {
    if ((await read($, idleSince)) !== null) await update($, idleSince, () => null)
    if (await read($, hidden)) await update($, hidden, () => false)
  } else if ((await read($, idleSince)) === null) {
    const t = await $.clock.now()
    await update($, idleSince, () => t)
  }
}

/** The engine's status in the board's words; `pending` counts as running. */
function stateOf(status: string): AgentState {
  return status === 'pending' ? 'running' : (status as AgentState)
}

/**
 * Takes each agent's status from the engine's list. The list may end an agent or
 * change how it ended, never revive one (a request does that, in `turn.step`), so a
 * list fetched before a `turn.complete` cannot undo it. A live agent that was listed
 * and then is missing for MISSES polls ended without a word and counts as stopped;
 * one never listed (a workflow's) keeps its state until it has used no tokens for
 * ABANDON_AFTER, then counts as done (a later request revives it).
 */
async function syncStates($: EngineInterface): Promise<void> {
  if (Object.keys(await read($, agents)).length === 0) return
  // Without a list (the call failed) nothing counts as missing, only silence is judged.
  let listed: Map<string, AgentState> | undefined
  try {
    listed = new Map((await $.agent.list()).map(one => [one.id, stateOf(one.status)]))
  } catch {
    listed = undefined
  }
  const now = await $.clock.now()
  await update($, agents, all => {
    let changed = false
    const next = { ...all }
    for (const a of Object.values(all)) {
      const state = listed?.get(a.id)
      let b = a
      if (state !== undefined) {
        const keep = !isLive(a.state) && isLive(state)
        b = { ...a, state: keep ? a.state : state, isListed: true, misses: 0 }
      } else if (listed && a.isListed && isLive(a.state)) {
        const misses = (a.misses ?? 0) + 1
        b = { ...a, misses, state: misses >= MISSES ? 'killed' : a.state }
      } else if (isAbandoned(a, now)) {
        b = { ...a, state: 'completed' }
      }
      if (b.state !== a.state || b.isListed !== a.isListed || b.misses !== a.misses) {
        next[a.id] = b
        changed = true
      }
    }
    return changed ? next : all
  })
  await markIdle($)
}

/** Hides the row once it has been idle for `hideAfter` ms; 0 never hides. */
async function hideIfIdle($: EngineInterface, hideAfter: number): Promise<void> {
  const since = await read($, idleSince)
  if (hideAfter === 0 || since === null || (await read($, hidden))) return
  if ((await $.clock.now()) - since >= hideAfter) await update($, hidden, () => true)
}

/** The sync and frame timers of the running session. */
let timers: Timer[] = []

function stopTimers(): void {
  for (const t of timers) t.cancel()
  timers = []
}

/** A timer's run: an error in it ends that run only, the timer goes on. */
const guarded = (run: () => Promise<void>) => () => {
  run().catch(() => {})
}

/** Starts the sync and frame timers, after cancelling any started before. */
function startTimers($: EngineInterface, hideAfter: number): void {
  stopTimers()
  let tick = 0
  timers = [
    $.clock.every(
      TICK_MS,
      guarded(async () => {
        await syncStates($)
        await hideIfIdle($, hideAfter)
      }),
    ),
    $.clock.every(
      FRAME_MS,
      guarded(async () => {
        tick++
        const all = await read($, agents)
        // No row, no crew to move.
        if (Object.keys(all).length === 0 || (await read($, hidden))) return
        const isAsleep = Object.values(crewStates(all, await $.clock.now())).every(s => s === 'sleep')
        const step = frameStep(isAsleep, tick)
        if (step > 0) await update($, frame, f => nextFrame(f, step))
      }),
    ),
  ]
}

export const register: Register = (on, options) => {
  const limits = limitsFrom(options)
  const hideAfter = hideAfterFrom(options)
  const display = displayFrom(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    startTimers($, hideAfter)
    return result
  })

  // A new chat (after /clear, or another one resumed in its place) starts an empty row.
  // The timers stop with a session; a chat that goes on in its place gets new ones.
  on('session.end', async ($, e, next) => {
    stopTimers()
    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        await update($, agents, () => ({}))
        await update($, tokens, () => ({}))
        await update($, idleSince, () => null)
        await update($, hidden, () => false)
      } finally {
        // The chat goes on: its timers start even if a reset failed.
        startTimers($, hideAfter)
      }
    }
    return next(e)
  })

  // Only watches the spawn: if the bookkeeping fails, the spawn goes on as the engine answered it.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.agentId === undefined) return r
    const id = r.agentId
    const now = await $.clock.now()
    await update($, agents, all => ({
      ...all,
      [id]: { id, model: r.model, tier: tierOf(r.model), state: 'running' as AgentState, lastTokenAt: now },
    }))
    await markIdle($)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const used = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const id = e.agentId
      const all = await read($, agents)
      // Loops the row never saw spawn (the engine's compaction and memory
      // forks, forked skills) count as the main loop's work.
      const known = id === undefined ? undefined : all[id]
      const key = known?.tier ?? 'main'
      await update($, tokens, t => ({ ...t, [key]: (t[key] ?? 0) + used }))
      if (id !== undefined && known) {
        // New tokens end a stall. A request also means it runs: a message may have woken an agent that had ended.
        const now = await $.clock.now()
        const wake = !isLive(known.state)
        await update($, agents, a =>
          a[id] ? { ...a, [id]: { ...a[id], lastTokenAt: now, ...(wake ? { state: 'running' as AgentState, misses: 0 } : {}) } } : a,
        )
        if (wake) await markIdle($)
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const state: AgentState =
        e.reason === 'error' || e.reason === 'refusal' ? 'failed' : e.isAborted || e.reason === 'aborted' ? 'killed' : 'completed'
      await update($, agents, all => (all[id] ? { ...all, [id]: { ...all[id], state } } : all))
      await markIdle($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    // A short band keeps its rows for what lies beneath, next to the prompt.
    if (e.props.maxRows < ROW_ROWS + ROOM_BELOW) return next(e)
    if (await read($, hidden)) return next(e)
    const used = await read($, tokens)
    const list = segments(await read($, agents), limits, display.hideUnused)
    if (list.length === 0) return next(e)
    const shown = fit(list, e.props.bodyColumns, display)
    if (!shown) return next(e)

    const parts = bar(used)
    const now = await $.clock.now()
    const below = await next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    // Image keys carry the plugin's name: two equal keys in one band refuse the whole band.
    const chip = (
      <Box borderStyle="round" borderColor={TERRACOTTA} paddingX={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {shown.hasTitles ? <Text color={TERRACOTTA}>{LABEL_TEXT}</Text> : null}
          <Box flexDirection="row" gap={GAP} alignItems="center">
            {list.map(s => {
              const t = segmentText(s, shown)
              const color = s.isOver ? ALERT : TERRACOTTA
              return (
                <Box key={s.tier} flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor>{t.label}</Text>
                  {s.running === 0 ? (
                    <Text color={ZERO}>{t.count}</Text>
                  ) : (
                    <Text color={hot(color)} bold>
                      {t.count}
                    </Text>
                  )}
                  {t.done ? (
                    <Text dimColor>{t.done}</Text>
                  ) : null}
                </Box>
              )
            })}
          </Box>
          {shown.hasBar ? (
            <Box flexDirection="row" gap={1}>
              {shown.hasTitles ? <Text dimColor>{barLabel(shown)}</Text> : null}
              <Image
                key="agent-board-bar"
                source={{ rgba: barPicture(parts), ...barSize(BAR_CELLS) }}
                columns={BAR_CELLS}
                rows={1}
                alt={parts.map(p => '█'.repeat(p.cells)).join('') || '░'.repeat(BAR_CELLS)}
              />
            </Box>
          ) : null}
        </Box>
      </Box>
    )
    let workers = null
    if (shown.hasCrew) {
      const f = await read($, frame)
      const states = crewStates(await read($, agents), now)
      const awake = Object.values(states)
      workers = (
        <Image
          key="agent-board-crew"
          source={{ rgba: crewPicture(states, f), width: CREW_W * SCALE, height: CREW_H * SCALE }}
          columns={CREW_COLUMNS}
          rows={CREW_ROWS}
          alt={awake.includes('work') ? '⚒' : awake.includes('wait') ? '⌛' : 'z'}
        />
      )
    }
    // Above whatever lies beneath, so the row sits right over the usage rings;
    // the crew stands right of the chip, as the pixel Claude does below.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center">
          {chip}
          {workers ? <Box marginLeft={1}>{workers}</Box> : null}
        </Box>
        {below}
      </Box>
    )
  })
}
