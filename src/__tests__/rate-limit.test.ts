import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const window = { windowMs: 60_000, max: 3 };
    const key = `t1:${Math.random()}`;
    expect(checkRateLimit(key, window)).toBeNull();
    expect(checkRateLimit(key, window)).toBeNull();
    expect(checkRateLimit(key, window)).toBeNull();
  });

  it("blocks requests over the limit", () => {
    const window = { windowMs: 60_000, max: 2 };
    const key = `t2:${Math.random()}`;
    expect(checkRateLimit(key, window)).toBeNull();
    expect(checkRateLimit(key, window)).toBeNull();
    const result = checkRateLimit(key, window);
    expect(result).not.toBeNull();
    expect(result!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("releases bucket once the window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const window = { windowMs: 60_000, max: 1 };
    const key = `t3:${Math.random()}`;
    expect(checkRateLimit(key, window)).toBeNull();
    expect(checkRateLimit(key, window)).not.toBeNull();
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, window)).toBeNull();
  });

  it("scopes limits per key", () => {
    const window = { windowMs: 60_000, max: 1 };
    const a = `t4a:${Math.random()}`;
    const b = `t4b:${Math.random()}`;
    expect(checkRateLimit(a, window)).toBeNull();
    expect(checkRateLimit(b, window)).toBeNull();
    expect(checkRateLimit(a, window)).not.toBeNull();
    expect(checkRateLimit(b, window)).not.toBeNull();
  });
});
