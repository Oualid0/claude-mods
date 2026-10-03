// Parses the text ListAgents answers and decides which peers the board shows.
// The listing is written for the model, not a fixed format: anything the
// parser does not recognise is skipped. ListAgents tells only busy from idle;
// a closed session stays listed as idle, so idle counts as finished.

import type { Peer } from '../types'

/** How long a finished peer stays on the board. */
export const DONE_MS = 60_000

export type Listed = { ref: string; name: string; status: 'busy' | 'idle' | 'unknown' }

const SELF = /^This session is (.+?) \[[0-9a-f]+\]/m
const PEER = /^\s+(.+?) \[([0-9a-f]+)\]((?:\s+·\s+.*)?)$/
/** A session nobody named yet is listed under a bare hex id (`e900c72c`). */
const UNNAMED = /^[0-9a-f]{6,}$/

export function parseListing(listing: string): { self?: string; peers: Listed[] } {
  const self = SELF.exec(listing)?.[1]
  const peers: Listed[] = []
  let inPeers = false
  for (const line of listing.split('\n')) {
    if (/^Peer sessions \(\d+\):/.test(line)) {
      inPeers = true
      continue
    }
    if (!inPeers) continue
    if (!/^\s/.test(line)) {
      inPeers = false
      continue
    }
    const m = PEER.exec(line)
    if (!m) continue
    const parts = (m[3] ?? '').split('·').map(p => p.trim())
    peers.push({
      name: m[1] ?? '',
      ref: m[2] ?? '',
      status: parts.includes('busy') ? 'busy' : parts.includes('idle') ? 'idle' : 'unknown',
    })
  }
  return { self, peers }
}

/**
 * The peers to show after a new listing: running ones, plus the ones that went
 * from busy to idle within `DONE_MS`. Unnamed sessions never show.
 */
export function reconcile(
  shown: readonly Peer[],
  listed: readonly Listed[],
  now: number,
): { peers: Peer[]; finished: number } {
  const before = new Map(shown.map(p => [p.ref, p]))
  const peers: Peer[] = []
  let finished = 0
  for (const l of listed) {
    if (UNNAMED.test(l.name)) continue
    const was = before.get(l.ref)
    if (l.status === 'busy') {
      peers.push({ ref: l.ref, name: l.name, status: 'busy' })
    } else if (was?.status === 'busy') {
      peers.push({ ref: l.ref, name: l.name, status: 'done', finishedAt: now })
      finished += 1
    } else if (was?.status === 'done' && now - (was.finishedAt ?? 0) < DONE_MS) {
      // Keep when it finished, but take the name as listed now: a /rename shows at once.
      peers.push({ ...was, name: l.name })
    }
  }
  return { peers, finished }
}

/** Drops finished peers whose `DONE_MS` ran out. */
export function prune(peers: readonly Peer[], now: number): Peer[] {
  return peers.filter(p => p.status === 'busy' || now - (p.finishedAt ?? 0) < DONE_MS)
}
