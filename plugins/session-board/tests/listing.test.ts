import { expect, test } from 'claude-code/testing'

import { DONE_MS, parseListing, prune, reconcile } from '../hooks/listing'

// Captured from ListAgents on 2026-10-03 (Claude Code 2.1.288).
const LISTING = `This session is Claude Code Mods-Ideen sammeln [251829] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).

Peer sessions (3):
  diagram suggestions page [5acc20]  ·  says it was 642b6393 until 2m ago  ·  bg  ·  idle  ·  started 3m ago
  e900c72c [9910a7]  ·  bg  ·  busy  ·  started 1m ago
  claude code multi-session projects [61c313]  ·  bg  ·  busy  ·  started 19m ago`

test('parses own name and peers with their status', () => {
  const { self, peers } = parseListing(LISTING)
  expect(self).toBe('Claude Code Mods-Ideen sammeln')
  expect(peers).toEqual([
    { name: 'diagram suggestions page', ref: '5acc20', status: 'idle' },
    { name: 'e900c72c', ref: '9910a7', status: 'busy' },
    { name: 'claude code multi-session projects', ref: '61c313', status: 'busy' },
  ])
})

test('shows only running named peers; idle ones never seen running stay hidden', () => {
  const { peers } = reconcile([], parseListing(LISTING).peers, 0)
  expect(peers.map(p => p.ref)).toEqual(['61c313'])
})

test('busy to idle shows as done for DONE_MS, then disappears', () => {
  const listed = parseListing(LISTING).peers
  const first = reconcile([], listed, 0)
  const idle = listed.map(l => ({ ...l, status: 'idle' as const }))

  const second = reconcile(first.peers, idle, 1_000)
  expect(second.finished).toBe(1)
  expect(second.peers).toEqual([
    { ref: '61c313', name: 'claude code multi-session projects', status: 'done', finishedAt: 1_000 },
  ])

  expect(reconcile(second.peers, idle, 1_000 + DONE_MS - 1).peers.length).toBe(1)
  expect(reconcile(second.peers, idle, 1_000 + DONE_MS).peers).toEqual([])
  expect(prune(second.peers, 1_000 + DONE_MS)).toEqual([])
})

test('a finished peer that was renamed shows its new name', () => {
  const shown = [{ ref: 'a1', name: 'old name', status: 'done' as const, finishedAt: 0 }]
  const { peers } = reconcile(shown, [{ ref: 'a1', name: 'new name', status: 'idle' }], 1_000)
  expect(peers).toEqual([{ ref: 'a1', name: 'new name', status: 'done', finishedAt: 0 }])
})
