/**
 * `Array.map` over an async function with at most `limit` calls in flight, results in input
 * order. For work that touches a slow or metered drive: a synced folder's provider downloads
 * what is read, so a thousand reads started at once is a download storm, not a faster listing.
 * `limit` below 1 is treated as 1.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
