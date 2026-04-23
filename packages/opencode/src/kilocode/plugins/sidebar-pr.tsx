// kilocode_change - new file
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createResource, Show } from "solid-js"
import { Process } from "@/util"

const id = "internal:kilo-sidebar-pr"

type Pr = { number: number; title: string }

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(id)
      signal.removeEventListener("abort", stop)
    }

    const stop = () => {
      done()
      reject(signal.reason)
    }

    const id = setTimeout(() => {
      done()
      resolve()
    }, ms)

    signal.addEventListener("abort", stop, { once: true })
  })
}

async function lookup(cwd: string, branch: string): Promise<Pr | null> {
  // Try the tracking ref first (works when PR was checked out via `gh pr checkout`
  // or when the branch's upstream is a fork). Fall back to an explicit branch
  // lookup (works for same-repo branches pushed to origin).
  const build = (b?: string) => {
    const a = ["gh", "pr", "view"]
    if (b) a.push(b)
    a.push("--json", "number,title")
    return a
  }
  for (const cmd of [build(), build(branch)]) {
    const ctrl = new AbortController()
    const timer = wait(15_000, ctrl.signal).then(() => ctrl.abort())
    const res = await Process.text(cmd, {
      cwd,
      abort: ctrl.signal,
      nothrow: true,
      timeout: 1_000,
    }).finally(() => ctrl.abort())
    await timer.catch(() => undefined)
    if (res.code !== 0) continue
    const text = res.text.trim()
    if (!text) continue
    const data = JSON.parse(text) as Partial<Pr>
    if (typeof data.number === "number" && typeof data.title === "string") {
      return { number: data.number, title: data.title }
    }
  }
  return null
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const branch = createMemo(() => props.api.state.vcs?.branch)
  const cwd = createMemo(() => props.api.state.path.directory)

  // Primitive string key: createResource wraps source in createMemo and
  // compares with === for equality, so the same inputs produce a stable key
  // and the fetcher is not retriggered on every render.
  const key = createMemo(() => {
    const b = branch()
    const d = cwd()
    if (!b || !d) return false as const
    return `${d}\0${b}`
  })

  const [pr] = createResource(key, async (k) => {
    const [d, b] = k.split("\0")
    return lookup(d, b).catch(() => null)
  })

  // The wrapper <box> must be present unconditionally — the OpenTUI slot
  // registry relies on a stable root node per plugin. Gating the whole tree
  // on `<Show>` breaks the mount. Conditionally render only the inner text.
  return (
    <box>
      <Show when={pr()}>
        <text fg={theme().textMuted}>
          PR #{pr()!.number} - {pr()!.title}
        </text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
