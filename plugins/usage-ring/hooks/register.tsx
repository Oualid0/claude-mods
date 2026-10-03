import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache, Model, Todos, Usage } from '../types'
import { FRESH_CACHE, afterRequest, cacheLeft } from './cache'
import { CLAUDE, SCALE, SPRITE, SPRITE_W, claudePixels, hammerPixels } from './claude'
import {
  RING_COLUMNS,
  RING_ROWS,
  SPRITE_COLUMNS,
  GAP,
  LABELS,
  entries,
  fit,
  fromList,
  fromTodoWrite,
  groups,
  modelLabel,
  MODEL_GAP,
  segments,
  snapshot,
  usageFrom,
  withCreated,
  withUpdated,
} from './model'
import { RING_SIZE, hexToRgb, hot, ringGlyph, ringPixels, toBase64 } from './ring'

const usage = atom({ plugin: 'usage-ring', key: 'usage' } as const, {} as Usage)
const todos = atom({ plugin: 'usage-ring', key: 'todos' } as const, {} as Todos)
const now = atom({ plugin: 'usage-ring', key: 'now' } as const, 0)

// Tokens this chat used since the session started: all four counts of every
// request, subagents included. In $.state, so a reload keeps them.
const tokens = atom({ plugin: 'usage-ring', key: 'tokens' } as const, 0)
// What the whole session cost so far, in US dollars, as /cost totals it.
const costUsd = atom({ plugin: 'usage-ring', key: 'costUsd' } as const, 0)
// Animation frame, and whether a turn of this session is running.
const frame = atom({ plugin: 'usage-ring', key: 'frame' } as const, 0)
const isBusy = atom({ plugin: 'usage-ring', key: 'isBusy' } as const, false)
const cache = atom({ plugin: 'usage-ring', key: 'cache' } as const, FRESH_CACHE as Cache)
const model = atom({ plugin: 'usage-ring', key: 'model' } as const, {} as Model)

/** The chat chip's frame on a hammer hit: a brighter orange. */
const HIT_FLASH = '#f59a6c'
const FRAME_MS = 150
/** The hammer's swing: raised, raised, swinging, hit, hit with sparks, swinging back. */
const SWING = [0, 0, 1, 2, 3, 1]
/** The pose in which the hammer hits and sparks. */
const HIT_POSE = 3
/** The z's change every second frame. */
const Z_PHASES = 12

const LIMITS_FILE = 'usage-limits.json'

/** Claude Code's config directory; undefined when neither CLAUDE_CONFIG_DIR nor HOME is set. */
async function configDir($: EngineInterface): Promise<string | undefined> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude` : undefined
}

/** Seeds the session and weekly figures from the last snapshot on disk. */
async function seedFromSnapshot($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const raw = JSON.parse(await $.fs.read(`${dir}/${LIMITS_FILE}`)) as {
      session?: { usedPercent?: number; resetsAt?: string | null } | null
      week?: { usedPercent?: number } | null
    }
    await update($, usage, u => ({
      ...u,
      sessionUsed: u.sessionUsed ?? raw.session?.usedPercent,
      sessionResetsAt: u.sessionResetsAt ?? raw.session?.resetsAt ?? undefined,
      weekUsed: u.weekUsed ?? raw.week?.usedPercent,
    }))
  } catch {
    // No snapshot yet: the rings appear with the first reading.
  }
}

/** Reads the task list that already exists (a resumed session, a reload). */
async function syncTodos($: EngineInterface): Promise<void> {
  const names = (await $.tool.list()).map(t => t.name)
  if (!names.includes('TaskList')) return
  try {
    const r = await $.tool.call({ tool: 'TaskList' })
    const list = (r.result as { tasks?: { id: string; status: string }[] } | undefined)?.tasks
    if (list && !r.isError) await update($, todos, () => fromList(list))
  } catch {
    // No list to read: the ring appears with the first TaskCreate.
  }
}

const pictures = new Map<string, string>()

/** The base64 picture for `key`, drawn once. */
function cached(key: string, draw: () => Uint8Array): string {
  const hit = pictures.get(key)
  if (hit !== undefined) return hit
  const base64 = toBase64(draw())
  pictures.set(key, base64)
  return base64
}

function picture(percent: number, color: string): string {
  return cached(`r${Math.round(percent)}${color}`, () => ringPixels(Math.round(percent), hexToRgb(color)))
}

export const register: Register = (on, options) => {
  const writesLimits = options.limitsFile === true

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)
    const sessionUsage = await $.session.usage()
    const { rateLimits, context } = sessionUsage
    await update($, usage, u => usageFrom(rateLimits, context.percent, u))
    if (writesLimits && rateLimits.length === 0) await seedFromSnapshot($)
    await syncTodos($)
    try {
      const id = await $.session.model()
      await update($, model, m => ({ ...m, id }))
    } catch {
      // No model yet: the label appears with the first request.
    }
    const usd = sessionUsage.cost?.usd
    if (usd !== undefined) await update($, costUsd, () => usd)
    // Only a redraw: the frame number picks the hammer pose or the z's.
    $.clock.every(FRAME_MS, () => {
      void update($, frame, f => (f + 1) % 10_000)
    })
    $.clock.every(60_000, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) {
      const usd = e.cost.usd
      await update($, costUsd, () => usd)
    }
    await update($, usage, u => usageFrom(e.rateLimits, e.context.percent, u))
    if (writesLimits) {
      try {
        const written = snapshot(e.rateLimits, await $.clock.now(), await $.session.model())
        const dir = await configDir($)
        if (written && dir) await $.fs.write(`${dir}/${LIMITS_FILE}`, JSON.stringify(written))
      } catch {
        // No model or no file: readers keep the last snapshot; the band must not break.
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isBusy, () => true)
    return next(e)
  })

  // Each request's tokens as soon as it is answered, so the count moves while a
  // turn runs; turn.complete would bring the same sum only at the turn's end.
  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    // The model and effort this request is really sent with (a fallback, /model, /effort).
    if (e.agentId === undefined) await update($, model, () => ({ id: e.model, effort: e.effort }))
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const used = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await update($, tokens, t => t + used)
      // Subagents keep caches of their own; the band times the main thread's.
      if (e.agentId === undefined) await update($, cache, c => afterRequest(c, sentAt, u.model, u))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isBusy, () => false)
    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = (r.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id !== undefined && !r.isError) await update($, todos, t => withCreated(t, id))
    return r
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    const input = e as unknown as { taskId?: string; status?: string }
    if (input.taskId !== undefined && !r.isError) {
      const id = input.taskId
      await update($, todos, t => withUpdated(t, id, input.status))
    }
    return r
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const r = await next(e)
    const list = (r.result as { tasks?: { id: string; status: string }[] } | undefined)?.tasks
    if (list && !r.isError) await update($, todos, () => fromList(list))
    return r
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    const list = (e as unknown as { todos?: { status: string }[] }).todos
    if (list && !r.isError) await update($, todos, () => fromTodoWrite(list))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    // The minute tick only triggers the redraw; the time itself is read here, as
    // the tick holds 0 until session.start has run (and /clear fires none).
    await read($, now)
    const usedTokens = await read($, tokens)
    const usd = await read($, costUsd)
    const all = segments(await read($, usage), await read($, todos), await $.clock.now())
    if (all.length === 0) return next(e)
    const c = await read($, cache)
    const m = await read($, model)
    const extras = {
      tokens: usedTokens,
      costUsd: usd,
      cache: cacheLeft(c, await $.clock.now()),
      model: modelLabel(m.id, m.effort),
    }
    const shown = fit(all, extras, e.props.bodyColumns)
    // Not even the session ring fits: show nothing rather than squeeze it.
    if (!shown) return next(e)
    const chatEntries = entries(extras, shown)

    // Other mods' drawings go above the rings, so the rings stay next to the prompt.
    const below = await next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    const f = await read($, frame)
    const busy = await read($, isBusy)
    const pose = SWING[f % SWING.length]!
    const isHit = busy && pose === HIT_POSE

    const entry = (label: string, value: string) => (
      <Box key={label} flexDirection="row" gap={1}>
        <Text dimColor>{label}</Text>
        <Text color={hot(CLAUDE)} bold>
          {value}
        </Text>
      </Box>
    )
    // One chip per group: a rounded frame and label in terracotta.
    const chip = (label: string, list: typeof shown.segments, withEntries: boolean) => (
      <Box
        key={label}
        borderStyle="round"
        borderColor={label === LABELS.chat && isHit ? HIT_FLASH : CLAUDE}
        paddingX={1}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          {shown.hasLabels ? <Text color={CLAUDE}>{label}</Text> : null}
          <Box flexDirection="row" gap={GAP} alignItems="center">
            {list.map(s => (
              <Box key={s.id} flexDirection="row" gap={1} alignItems="center">
                <Text dimColor>{s.short}</Text>
                <Image
                  key={`ring-${s.id}`}
                  source={{ rgba: picture(s.percent, s.color), width: RING_SIZE, height: RING_SIZE }}
                  columns={RING_COLUMNS}
                  rows={RING_ROWS}
                  alt={ringGlyph(s.percent)}
                />
                <Text color={hot(s.color)} bold>
                  {s.text}
                </Text>
              </Box>
            ))}
            {withEntries && chatEntries.length > 0 ? (
              <Box flexDirection="row" gap={1}>
                {chatEntries.flatMap(([label, value], i) =>
                  i === 0 ? [entry(label, value)] : [<Text key={`gap-${label}`}> </Text>, entry(label, value)],
                )}
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    )

    // Hammering while a turn runs, asleep otherwise; 24 x 24 sprite pixels, SCALE image pixels each.
    const zPhase = Math.floor(f / 2) % Z_PHASES
    const spriteKey = busy ? `h${pose}` : `s${zPhase}`
    const sprite = (
      <Image
        key="claude"
        source={{
          rgba: cached(spriteKey, () => (busy ? hammerPixels(pose) : claudePixels(zPhase))),
          width: SPRITE_W * SCALE,
          height: SPRITE * SCALE,
        }}
        columns={SPRITE_COLUMNS}
        rows={3}
        alt={busy ? '⚒' : 'z'}
      />
    )
    const { limits, chat } = groups(shown.segments)
    const hasChat = chat.length > 0 || chatEntries.length > 0
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" alignItems="center">
          {limits.length > 0 ? (
            <Box marginRight={hasChat ? 1 : 0}>
              {chip(LABELS.limits, limits, false)}
            </Box>
          ) : null}
          {hasChat ? chip(LABELS.chat, chat, true) : null}
          {shown.hasSprite ? sprite : null}
          {shown.hasModel && extras.model !== undefined ? (
            <Box marginLeft={MODEL_GAP}>
              <Text dimColor>{extras.model}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })
}
