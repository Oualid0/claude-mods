// The hot (whitened) tone usage-ring gives its numbers, for the board's labels.

/** How far toward white the hot tone goes. */
const HOT = 0.35

/** `hex` moved HOT of the way to white. */
export function hot(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `#${[(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
    .map(c => Math.round(c + (255 - c) * HOT).toString(16).padStart(2, '0'))
    .join('')}`
}
