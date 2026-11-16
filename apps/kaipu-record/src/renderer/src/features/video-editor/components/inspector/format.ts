/** "0:10.2" — minutes, seconds, one decimal (inspector range labels, UI spec § 7.1). */
export function formatPrecise(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** "0:24": minutes and whole seconds (the camera parts' card, marks and panel). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
