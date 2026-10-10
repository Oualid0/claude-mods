import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cache, Model, Todos, TokenLog, Usage } from '../types'
import { FRESH_CACHE, afterRequest, cacheSegment, coldCache, ttlOf, withTtl } from './cache'
import { CLAUDE, SCALE, SPRITE, SPRITE_W, claudePixels, hammerPixels } from './claude'
import {
  RING_COLUMNS,
  RING_ROWS,
  SPRITE_COLUMNS,
  GAP,
  LABELS,
  labelOf,
  fit,
  fromList,
  fromSnapshot,
  fromTodoWrite,
  groups,
  isOn,
  modelLabel,
  MODEL_GAP,
  SEPARATOR,
  rateAt,
  segments,
  tokensEntry,
  snapshot,
  usageFrom,
  withCreated,
  withUpdated,
  withTokens,
  ZERO,
} from './model'
import { RING_SIZE, hexToRgb, hot, ringGlyph, ringPixels, toBase64 } from './ring'

const usage = atom({ plugin: 'usage-ring', key: 'usage' } as const, {} as Usage)
const todos = atom({ plugin: 'usage-ring', key: 'todos' } as const, {} as Todos)

// Tokens this chat used since the session started: all four counts of every
// request, subagents included. In $.state, so a reload keeps them.
const tokens = atom({ plugin: 'usage-ring', key: 'tokens' } as const, 0)
// The requests of the last minute, for the token rate.
const recent = atom({ plugin: 'usage-ring', key: 'recent' } as const, [] as TokenLog)
// Animation frame, and whether a turn of this session is running.
const frame = atom({ plugin: 'usage-ring', key: 'frame' } as const, 0)
const isBusy = atom({ plugin: 'usage-ring', key: 'isBusy' } as const, false)
const cache = atom({ plugin: 'usage-ring', key: 'cache' } as const, FRESH_CACHE as Cache)
const model = atom({ plugin: 'usage-ring', key: 'model' } as const, {} as Model)

/** Milliseconds per frame while a turn runs (the hammer swings) and while the sprite sleeps (the z's rise). */
const FRAME_MS = 150
const SLEEP_FRAME_MS = 1000
/** Both frame counts divide it, so the poses stay in step when the counter wraps. */
const FRAME_WRAP = 12_000
/** The hammer's swing: raised, raised, swinging, hit, hit with sparks, swinging back. */
const SWING = [0, 0, 1, 2, 3, 1]
/** The z's change with every frame of the sleeping sprite. */
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
    const seed = fromSnapshot(JSON.parse(await $.fs.read(`${dir}/${LIMITS_FILE}`)), await $.clock.now())
    await update($, usage, u => ({
      ...u,
      sessionUsed: u.sessionUsed ?? seed.sessionUsed,
      sessionResetsAt: u.sessionResetsAt ?? seed.sessionResetsAt,
      weekUsed: u.weekUsed ?? seed.weekUsed,
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

/**
 * The context fill: the last response's figure, or before the first response
 * (a new chat, after /clear) the local estimate of what is already loaded
 * (system prompt, tools, memory files). Undefined when neither is known.
 */
async function contextPercent(
  $: EngineInterface,
  context: { percent?: number },
): Promise<number | undefined> {
  if (context.percent !== undefined) return context.percent
  try {
    const { context: c } = await $.session.usage({ breakdown: 'summary' })
    return c.breakdown?.percentage
  } catch {
    return undefined
  }
}

// The frame clock: one timer, 150 ms while a turn runs, one second while the sprite sleeps.
let tick: Timer | undefined
let tickMs = 0

function stopTick(): void {
  tick?.cancel()
  tick = undefined
}

function startTick($: EngineInterface, ms: number): void {
  stopTick()
  tickMs = ms
  // Only a redraw: the frame number picks the hammer pose or the z's.
  tick = $.clock.every(ms, () => {
    void update($, frame, f => (f + 1) % FRAME_WRAP).catch(() => undefined)
  })
}

/** Switches a running clock to `ms`; before session.start (or after the session ended) there is none. */
function retick($: EngineInterface, ms: number): void {
  if (tick && tickMs !== ms) startTick($, ms)
}

/** Runs `step`, ignoring a failure: the steps of a start do not depend on each other. */
async function attempt(step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch {
    // The band fills in with the first reading instead.
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
  const writesLimits = isOn(options.limitsFile)
  const showsModel = isOn(options.showModel)
  const layout = { titles: isOn(options.titles), compact: isOn(options.compact), tokens: isOn(options.showTokens) }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A repeated session.start replaces the timer instead of adding a second.
    stopTick()
    let hasLimits = false
    await attempt(async () => {
      const { rateLimits, context } = await $.session.usage()
      hasLimits = rateLimits.length > 0
      const percent = await contextPercent($, context)
      await update($, usage, u => usageFrom(rateLimits, percent, u))
    })
    if (writesLimits && !hasLimits) await attempt(() => seedFromSnapshot($))
    await attempt(() => syncTodos($))
    await attempt(async () => {
      const id = await $.session.model()
      await update($, model, m => ({ ...m, id }))
    })
    let isRunning = false
    await attempt(async () => {
      isRunning = await read($, isBusy)
    })
    startTick($, isRunning ? FRAME_MS : SLEEP_FRAME_MS)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const percent = await contextPercent($, e.context)
    await update($, usage, u => usageFrom(e.rateLimits, percent, u))
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
    retick($, FRAME_MS)
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
      const at = await $.clock.now()
      await update($, recent, log => withTokens(log, at, used))
      // Subagents keep caches of their own; the band times the main thread's.
      if (e.agentId === undefined) await update($, cache, c => afterRequest(c, sentAt, u.model, u))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isBusy, () => false)
      retick($, SLEEP_FRAME_MS)
    }
    return next(e)
  })

  // A model switch drops the cache (every model has one of its own), and so does
  // a compaction (the history it served is gone). Both are cold until the next request.
  // A subagent's switch or compaction leaves the main thread's cache alone.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const isMain = e.agent_id === undefined
    const isSwitch = e.from_model !== e.to_model && e.source !== 'resume'
    // The engine names the lifetime on a switch (5m or 1h): it settles what the requests could only hint at.
    const ttl = ttlOf(e.cache_ttl)
    if (isMain && (isSwitch || ttl !== undefined)) {
      await update($, cache, c => {
        const named = ttl === undefined ? c : withTtl(c, ttl)
        return isSwitch ? coldCache(named) : named
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) await update($, cache, c => coldCache(c))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new chat (after /clear, or another one resumed in its place) starts with no
  // cache, no tokens, no rate, no todos and no context fill of its own, and the frame
  // clock goes on: no session.start follows a /clear. Any other end stops the clock.
  // A resumed chat brings its task list along, so it is read again once the end has
  // passed; a cleared one is empty.
  on('session.end', async ($, e, next) => {
    const isNewChat = e.reason === 'clear' || e.reason === 'resume'
    if (isNewChat) {
      await update($, cache, () => FRESH_CACHE)
      await update($, tokens, () => 0)
      await update($, recent, () => [])
      await update($, todos, () => ({}))
      await update($, usage, u => ({ ...u, contextUsed: undefined }))
    } else {
      stopTick()
    }
    const result = await next(e)
    if (e.reason === 'resume') await attempt(() => syncTodos($))
    return result
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = (r.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id !== undefined && !r.isError) await update($, todos, t => withCreated(t, id))
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    const input = e as unknown as { taskId?: string; status?: string }
    if (input.taskId !== undefined && !r.isError) {
      const id = input.taskId
      await update($, todos, t => withUpdated(t, id, input.status))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const r = await next(e)
    const list = (r.result as { tasks?: { id: string; status: string }[] } | undefined)?.tasks
    if (list && !r.isError) await update($, todos, () => fromList(list))
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    const list = (e as unknown as { todos?: { status: string }[] }).todos
    if (list && !r.isError) await update($, todos, () => fromTodoWrite(list))
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const usedTokens = await read($, tokens)
    const at = await $.clock.now()
    const rings = segments(await read($, usage), await read($, todos), at)
    if (rings.length === 0) return next(e)
    const all = [...rings, cacheSegment(await read($, cache), at)]
    const m = await read($, model)
    const extras = {
      total: usedTokens,
      rate: rateAt(await read($, recent), at),
      model: showsModel ? modelLabel(m.id, m.effort) : undefined,
    }
    const shown = fit(all, extras, e.props.bodyColumns, layout)
    // Not even one entry fits: show nothing rather than squeeze it.
    if (!shown) return next(e)
    const tokenCount = tokensEntry(extras, shown)

    // Other mods' drawings go above the band, so it stays next to the prompt.
    const below = await next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    const f = await read($, frame)
    const busy = await read($, isBusy)
    const pose = SWING[f % SWING.length]!

    // A value in the bright color of its entry, or in the muted ZERO color (not bold) when it is 0.
    const value = (text: string, isDim: boolean, color: string) =>
      isDim ? (
        <Text color={ZERO}>{text}</Text>
      ) : (
        <Text color={hot(color)} bold>
          {text}
        </Text>
      )
    // An entry: its dimmed label, a ring for the limits and the context, then the value.
    const entry = (s: typeof shown.segments[number]) => (
      <Box key={s.id} flexDirection="row" gap={1} alignItems="center">
        <Text dimColor>{labelOf(s, shown)}</Text>
        {s.hasRing ? (
          <Image
            key={`ring-${s.id}`}
            source={{ rgba: picture(s.percent, s.color), width: RING_SIZE, height: RING_SIZE }}
            columns={RING_COLUMNS}
            rows={RING_ROWS}
            alt={ringGlyph(s.percent)}
          />
        ) : null}
        {value(s.time ? s.text.slice(0, -(s.time.length + 1)) : s.text, s.isDim === true, s.textColor ?? s.color)}
        {s.time ? (
          <Text color={hot(CLAUDE)} bold>
            {s.time}
          </Text>
        ) : null}
      </Box>
    )
    // A group: its title in terracotta (with the `titles` option), then its entries.
    const group = (title: string, items: ReturnType<typeof entry>[]) => (
      <Box key={title} flexDirection="row" gap={1} alignItems="center">
        {shown.hasTitles ? <Text color={CLAUDE}>{title}</Text> : null}
        <Box flexDirection="row" gap={GAP} alignItems="center">
          {items}
        </Box>
      </Box>
    )
    // The tokens group is one entry without a ring: the dimmed label, the total, then the rate a gap apart.
    const tokenItems = tokenCount
      ? [
          <Box key="tokens-entry" flexDirection="row" gap={1}>
            <Text dimColor>{tokenCount.label}</Text>
            <Box flexDirection="row" gap={GAP}>
              {value(tokenCount.total, tokenCount.isTotalZero, CLAUDE)}
              {tokenCount.rate !== undefined ? value(tokenCount.rate, tokenCount.isRateZero, CLAUDE) : null}
            </Box>
          </Box>,
        ]
      : []

    // Hammering while a turn runs, asleep otherwise; 24 x 24 sprite pixels, SCALE image pixels each.
    const zPhase = f % Z_PHASES
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
    // The groups that have something to show, one frame around them, a dimmed bar between.
    const parts = [
      limits.length > 0 ? group(LABELS.limits, limits.map(entry)) : null,
      chat.length > 0 ? group(LABELS.chat, chat.map(entry)) : null,
      tokenItems.length > 0 ? group(LABELS.tokens, tokenItems) : null,
    ].filter(part => part !== null)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" alignItems="center">
          <Box borderStyle="round" borderColor={CLAUDE} paddingX={1} flexDirection="row">
            {parts.map((part, i) => (
              <Box key={`part-${i}`} flexDirection="row">
                {i > 0 ? <Text dimColor>{SEPARATOR}</Text> : null}
                {part}
              </Box>
            ))}
          </Box>
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
