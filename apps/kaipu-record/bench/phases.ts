export interface PhaseMark {
  label: string;
  /** Milliseconds since the tracker started, on a monotonic clock. */
  tMs: number;
}

/** Phase labels the owner types ("export start", "scrub"). `now` must be monotonic. */
export class PhaseTracker {
  private readonly t0: number;
  private readonly list: PhaseMark[] = [{ label: "start", tMs: 0 }];

  constructor(private readonly now: () => number) {
    this.t0 = now();
  }

  mark(label: string): void {
    const clean = label.trim();
    if (clean === "") return;
    this.list.push({ label: clean, tMs: Math.round(this.now() - this.t0) });
  }

  current(): string {
    return this.list[this.list.length - 1]!.label;
  }

  phaseAt(tMs: number): string {
    let label = this.list[0]!.label;
    for (const m of this.list) if (m.tMs <= tMs) label = m.label;
    return label;
  }

  marks(): PhaseMark[] {
    return this.list.map((m) => ({ ...m }));
  }
}
