/** The slice of a `desktopCapturer` screen source the hub reads. */
export interface ScreenSource {
  id: string;
  name: string;
  display_id: string;
}

/**
 * The `screen:` sources, listed once and kept until the displays change. Listing them
 * (`desktopCapturer.getSources`) costs 100–500 ms, and a recording start used to pay it
 * after the overlay closed, with nothing on screen. The hub now starts the listing when the
 * overlay opens (`prefetch`) and the click finds it done.
 *
 * Kept only while it can be trusted: the owner calls `invalidate` on every display change,
 * a failed or empty listing is never kept, and `find` lists again once when the kept list
 * has no match, so a stale entry costs one listing, never a wrong source.
 */
export class ScreenSourceCache {
  private listing: Promise<ScreenSource[]> | null = null;

  constructor(private readonly list: () => Promise<ScreenSource[]>) {}

  /** Start listing in the background, unless a list is kept or on its way. */
  prefetch(): void {
    void this.sources();
  }

  /** Forget the kept list (a display was added, removed or changed). */
  invalidate(): void {
    this.listing = null;
  }

  /** The first source `match` accepts, listing again once when the kept list has none. */
  async find(
    match: (sources: ScreenSource[]) => ScreenSource | undefined,
  ): Promise<ScreenSource | undefined> {
    const kept = this.listing !== null;
    const found = match(await this.sources());
    if (found || !kept) return found;
    this.invalidate();
    return match(await this.sources());
  }

  private sources(): Promise<ScreenSource[]> {
    if (this.listing) return this.listing;
    const forget = (): void => {
      if (this.listing === listing) this.listing = null;
    };
    const listing: Promise<ScreenSource[]> = this.list().then(
      (sources) => {
        if (sources.length === 0) forget();
        return sources;
      },
      () => {
        forget();
        return [];
      },
    );
    this.listing = listing;
    return listing;
  }
}
