/** "0:10.2" — minutes, seconds, one decimal (inspector range labels, UI spec § 7.1). */
export function formatPrecise(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
