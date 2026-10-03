export type Usage = {
  /** five_hour window, percent used */
  sessionUsed?: number
  sessionResetsAt?: string
  /** seven_day window, percent used */
  weekUsed?: number
  /** context window fill, percent */
  contextUsed?: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** Task or todo id → its status. */
export type Todos = Record<string, TodoStatus>

/** Where the cache lifetime in use comes from: the default, a hit, or a miss. */
export type TtlSource = 'assumed' | 'hit' | 'miss'

export type Cache = {
  /** When the last main-thread request was sent: the entry's lifetime starts there. */
  lastAt?: number
  /** The model that answered it; another model has a cache of its own. */
  model?: string
  /** Lifetime in milliseconds. */
  ttl: number
  source: TtlSource
  /** Share of the last request's input that the cache served, 0..1. */
  readShare?: number
}

/** The main loop's model and the effort its last request asked for. */
export type Model = { id?: string; effort?: string | number }

declare module 'claude-code' {
  interface PluginState {
    'usage-ring': {
      usage: Usage
      todos: Todos
      now: number
      /** Animation frame counter. */
      frame: number
      /** A turn of this session is running. */
      isBusy: boolean
      /** Tokens used since the session started, all four counts of every request, subagents included. */
      tokens: number
      /** Session cost so far in US dollars. */
      costUsd: number
      /** The prompt cache's countdown. */
      cache: Cache
      model: Model
    }
  }
}
