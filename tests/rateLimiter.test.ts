import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/utils/rateLimiter';

describe('SlidingWindowLimiter', () => {
  it('allows up to `max` hits per window and reports the wait time afterwards', () => {
    const limiter = new SlidingWindowLimiter(2, 1_000);
    expect(limiter.consume('a', 0)).toBe(0);
    expect(limiter.consume('a', 100)).toBe(0);
    expect(limiter.consume('a', 200)).toBe(800);
  });

  it('frees a slot once the window has passed', () => {
    const limiter = new SlidingWindowLimiter(1, 1_000);
    expect(limiter.consume('a', 0)).toBe(0);
    expect(limiter.consume('a', 999)).toBe(1);
    expect(limiter.consume('a', 1_000)).toBe(0);
  });

  it('tracks keys independently and supports reset', () => {
    const limiter = new SlidingWindowLimiter(1, 1_000);
    expect(limiter.consume('a', 0)).toBe(0);
    expect(limiter.consume('b', 0)).toBe(0);
    limiter.reset('a');
    expect(limiter.consume('a', 1)).toBe(0);
  });
});
