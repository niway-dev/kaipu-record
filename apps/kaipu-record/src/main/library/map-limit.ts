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
  // Once one call fails, `Promise.all` has already rejected: no worker starts another item (in a
  // synced folder that would be a download nobody is waiting for).
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < items.length && !failed) {
      const index = next++;
      try {
        out[index] = await fn(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
