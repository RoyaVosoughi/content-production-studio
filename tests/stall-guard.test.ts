import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stallGuard } from "@/lib/video/tools";

// Stops a program that froze, without mistaking a slow one, or a laptop waking up, for a frozen one.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("noticing a frozen program", () => {
  it("stops it after enough quiet checks in a row", () => {
    const guard = stallGuard(3, 1000);
    vi.advanceTimersByTime(2000);
    expect(guard.stalled()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(guard.stalled()).toBe(true);
    expect(guard.signal.aborted).toBe(true);
  });

  it("starts counting again whenever the program shows progress", () => {
    const guard = stallGuard(3, 1000);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(2000);
      guard.alive();
    }
    expect(guard.stalled()).toBe(false);
    guard.stop();
  });

  it("doesn't count a long sleep as many quiet checks", () => {
    const guard = stallGuard(3, 1000);
    // After sleep, the clock jumps ahead but a missed interval fires once, not once per lost second.
    vi.setSystemTime(Date.now() + 3_600_000);
    vi.advanceTimersByTime(1000);
    expect(guard.stalled()).toBe(false);
    guard.stop();
  });

  it("can be stopped once the program is done", () => {
    const guard = stallGuard(1, 1000);
    guard.stop();
    vi.advanceTimersByTime(5000);
    expect(guard.stalled()).toBe(false);
  });
});
