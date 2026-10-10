/** A model family; `other` for a model whose name says none of the three. */
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'other'

/** Where a subagent stands, as the board tracks it. */
export type AgentState = 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

export type Agent = {
  id: string
  /** The model it runs on, as the spawn resolved it. */
  model: string
  tier: Tier
  state: AgentState
  /** Whether the engine's list has shown it (a workflow's agents never are). */
  isListed?: boolean
  /** Polls in a row it was missing from the engine's list while live. */
  misses?: number
  /** When it last used tokens (its spawn counts); a live agent silent for too long is stalled. */
  lastTokenAt?: number
}

/** Tokens per loop owner: the main loop, or the subagents by model family. */
export type Tokens = Partial<Record<'main' | Tier, number>>

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      /** This chat's subagents by id. */
      agents: Record<string, Agent>
      tokens: Tokens
      /** When the last live subagent ended; null while one runs or before the first. */
      idleSince: number | null
      /** Whether the row is hidden after being idle for the set time. */
      hidden: boolean
      /** Animation frame counter for the workers. */
      frame: number
    }
  }
}
