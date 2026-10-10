/**
 * Small in-memory sliding-window limiter. Entries clean themselves up, so keys that are never
 * seen again do not leak memory.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns 0 if allowed, otherwise the milliseconds until the next slot. */
  consume(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return this.windowMs - (now - (recent[0] ?? now));
    }

    recent.push(now);
    this.hits.set(key, recent);
    setTimeout(() => this.prune(key), this.windowMs + 50).unref();
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length === 0) this.hits.delete(key);
    else this.hits.set(key, recent);
  }
}
