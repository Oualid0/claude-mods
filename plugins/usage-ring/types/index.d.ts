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

export type Cache = {
  /** When the last main-thread request was sent: the entry's lifetime starts there. */
  lastAt?: number
  /** The model that answered it; another model has a cache of its own. */
  model?: string
  /** Lifetime in milliseconds. */
  ttl: number
  /** Telling misses in a row that could mean a 5-minute lifetime; absent at 0. */
  misses?: number
  /** Dropped by a model switch or a compaction: cold until the next request. */
  isCold?: boolean
}

/** When a model request used how many tokens, as `[at, tokens]`; only the last minute is kept. */
export type TokenLog = [at: number, tokens: number][]

/** The main loop's model and the effort its last request asked for. */
export type Model = { id?: string; effort?: string | number }

declare module 'claude-code' {
  interface PluginState {
    'usage-ring': {
      usage: Usage
      todos: Todos
      /** Animation frame counter. */
      frame: number
      /** A turn of this session is running. */
      isBusy: boolean
      /** Tokens used since the session started, all four counts of every request, subagents included. */
      tokens: number
      /** The requests of the last minute, for the token rate. */
      recent: TokenLog
      /** The prompt cache's countdown. */
      cache: Cache
      model: Model
    }
  }
}
