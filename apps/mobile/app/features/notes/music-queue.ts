// Reused from heal-earth-club/lib/music-queue.ts.
export function nextQueueIndex(
  length: number,
  current: number,
  direction: 1 | -1 = 1
): number | null {
  if (!Number.isInteger(length) || length < 1) return null;
  return Number.isInteger(current) && current >= 0 && current < length
    ? (current + direction + length) % length
    : 0;
}
