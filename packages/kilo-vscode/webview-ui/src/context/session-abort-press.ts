// Shared counter for the double-Esc-to-abort gesture.
// Mirrors the CLI's `store.interrupt` in packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:
// press increments a counter and (re)starts a 5s reset timer; the second press within the window
// triggers abort and resets.

const WINDOW_MS = 5000

interface Timers {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (t: ReturnType<typeof setTimeout>) => void
}

function press(state: { count: number; timer: ReturnType<typeof setTimeout> | undefined }, timers: Timers): boolean {
  state.count += 1
  if (state.timer) timers.clear(state.timer)
  if (state.count >= 2) {
    state.count = 0
    state.timer = undefined
    return true
  }
  state.timer = timers.set(() => {
    state.count = 0
    state.timer = undefined
  }, WINDOW_MS)
  return false
}

const defaults: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t),
}

const shared: { count: number; timer: ReturnType<typeof setTimeout> | undefined } = { count: 0, timer: undefined }

// Registers an Esc press; returns true when this press is the second within the
// 5s window (and the caller should trigger abort).
export function registerAbortPress(): boolean {
  return press(shared, defaults)
}

// Resets the counter. Safe to call from anywhere (idle transitions, tests, etc.).
export function resetAbortPress(): void {
  shared.count = 0
  if (shared.timer) defaults.clear(shared.timer)
  shared.timer = undefined
}

// Test-only factory: creates an isolated press-state with caller-supplied timers.
export function createAbortPressForTest(timers: Timers) {
  const state = { count: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  return {
    press: () => press(state, timers),
    reset: () => {
      state.count = 0
      if (state.timer) timers.clear(state.timer)
      state.timer = undefined
    },
    get count() {
      return state.count
    },
    get hasTimer() {
      return state.timer !== undefined
    },
  }
}
