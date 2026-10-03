export type Status = 'busy' | 'done'

export type Peer = {
  /** The short ref ListAgents prints in brackets. */
  ref: string
  name: string
  status: Status
  /** When it went from busy to idle, on `$.clock.now()`'s scale. */
  finishedAt?: number
}

export type Board = {
  /** This session's name as ListAgents reports it. */
  self?: string
  /** Only running peers and those that finished in the last few seconds. */
  peers: Peer[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-board': { board: Board; selfStatus: 'busy' | 'idle' }
  }
}
