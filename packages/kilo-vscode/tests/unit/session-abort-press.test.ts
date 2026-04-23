import { describe, expect, it } from "bun:test"
import { createAbortPressForTest } from "../../webview-ui/src/context/session-abort-press"

// Minimal fake timer harness: `set` returns an incrementing id and stores the
// callback; `advance` runs the callback if called. Matches the subset of timer
// behavior the helper depends on (set, clear, expiry).
function fakeTimers() {
  const queue = new Map<number, () => void>()
  let nextId = 0
  return {
    set: (fn: () => void) => {
      nextId += 1
      queue.set(nextId, fn)
      return nextId as unknown as ReturnType<typeof setTimeout>
    },
    clear: (t: ReturnType<typeof setTimeout>) => {
      queue.delete(t as unknown as number)
    },
    expire: (t: ReturnType<typeof setTimeout>) => {
      const fn = queue.get(t as unknown as number)
      if (!fn) return false
      queue.delete(t as unknown as number)
      fn()
      return true
    },
    pending: () => queue.size,
  }
}

describe("session-abort-press", () => {
  it("requires two presses to trigger", () => {
    const timers = fakeTimers()
    const gate = createAbortPressForTest({ set: timers.set, clear: timers.clear })

    expect(gate.press()).toBe(false)
    expect(gate.count).toBe(1)
    expect(gate.hasTimer).toBe(true)

    expect(gate.press()).toBe(true)
    expect(gate.count).toBe(0)
    expect(gate.hasTimer).toBe(false)
  })

  it("resets after the window elapses", () => {
    const timers = fakeTimers()
    const gate = createAbortPressForTest({ set: timers.set, clear: timers.clear })

    expect(gate.press()).toBe(false)
    expect(timers.pending()).toBe(1)

    // Expire the timer — simulates the 5s window elapsing with no second press.
    timers.expire(1 as unknown as ReturnType<typeof setTimeout>)
    expect(gate.count).toBe(0)
    expect(gate.hasTimer).toBe(false)

    // Next press restarts the counter from 1.
    expect(gate.press()).toBe(false)
    expect(gate.count).toBe(1)
  })

  it("re-arms the timer on every press", () => {
    const timers = fakeTimers()
    const gate = createAbortPressForTest({ set: timers.set, clear: timers.clear })

    gate.press()
    // Press again before the window closes — prior timer is cleared, new one started.
    // Since this is the second press, it triggers and clears (no pending timer).
    gate.press()
    expect(timers.pending()).toBe(0)
  })

  it("reset() clears count and timer", () => {
    const timers = fakeTimers()
    const gate = createAbortPressForTest({ set: timers.set, clear: timers.clear })

    gate.press()
    expect(gate.hasTimer).toBe(true)

    gate.reset()
    expect(gate.count).toBe(0)
    expect(gate.hasTimer).toBe(false)
    expect(timers.pending()).toBe(0)
  })
})
