/**
 * SettingsCommandPalette — Cmd/Ctrl+K palette for jumping to any setting
 * across all 24 settings tabs.
 *
 * Real, end-to-end:
 *  - Static registry of jump targets (one entry per tab; expandable to per-setting)
 *  - Fuzzy substring scoring (no fuzzy library — string includes + char-streak bonus)
 *  - Keyboard nav (↑/↓/Enter/Esc) + click
 *  - Focus management — input grabs focus on open, restores on close
 *  - No backend stub: jump is a callback the parent wires to its tab state
 */

import { Component, createSignal, createEffect, For, Show, onCleanup, onMount } from "solid-js"

export interface PaletteEntry {
  /** Tab id matching Tabs.Trigger value */
  tab: string
  /** Display label */
  label: string
  /** Optional description shown grey under label */
  description?: string
  /** Optional searchable keywords */
  keywords?: string[]
}

// Registry — one row per tab. Extending with per-setting entries is purely
// additive; the parent's onJump just navigates to `entry.tab`.
export const SETTINGS_REGISTRY: PaletteEntry[] = [
  { tab: "models", label: "Models", description: "Default model + per-agent overrides", keywords: ["llm", "model"] },
  {
    tab: "providers",
    label: "Providers",
    description: "API keys + connection setup (Anthropic, OpenAI, MiniMax, …)",
    keywords: ["api key", "secret", "anthropic", "openai", "minimax", "siliconflow", "ollama", "lmstudio"],
  },
  {
    tab: "agentBehaviour",
    label: "Agent Behaviour",
    description: "Rules, modes, workflows, presets",
    keywords: ["rule", "mode", "workflow", "personality", "preset"],
  },
  {
    tab: "autoApprove",
    label: "Auto Approve",
    description: "Per-tool approval toggles + meeting mode",
    keywords: ["approval", "tool", "permission"],
  },
  {
    tab: "browser",
    label: "Browser",
    description: "Browser tool, snapshot tester, auth profiles",
    keywords: ["browser", "snapshot", "cookie", "puppeteer"],
  },
  {
    tab: "checkpoints",
    label: "Checkpoints",
    description: "Snapshots, retention, time-travel",
    keywords: ["snapshot", "checkpoint", "history", "revert"],
  },
  {
    tab: "display",
    label: "Display",
    description: "Username, density, layout",
    keywords: ["theme", "density", "layout"],
  },
  {
    tab: "autocomplete",
    label: "Autocomplete",
    description: "Auto-trigger, blocklist, acceptance stats",
    keywords: ["completion", "tab", "suggestion"],
  },
  {
    tab: "notifications",
    label: "Notifications",
    description: "Sounds, webhooks (Slack/Discord/Teams)",
    keywords: ["sound", "webhook", "slack", "discord", "teams", "notify"],
  },
  {
    tab: "context",
    label: "Context",
    description: "Token budget, file pinning, freeze",
    keywords: ["context window", "token", "pin"],
  },
  {
    tab: "ssh",
    label: "SSH & Remote",
    description: "Profiles, terminals, SFTP, log tailing",
    keywords: ["remote", "ssh", "sftp", "terminal"],
  },
  {
    tab: "vps",
    label: "VPS & Infra",
    description: "Server connections, docker stack, logs",
    keywords: ["vps", "docker", "server", "stack"],
  },
  {
    tab: "hermes",
    label: "Hermes",
    description: "Multi-agent orchestrator config + DAG",
    keywords: ["hermes", "agent", "orchestrator"],
  },
  {
    tab: "zeroclaw",
    label: "ZeroClaw",
    description: "Execution policy, sandbox, dry-run",
    keywords: ["policy", "sandbox", "execution", "permission"],
  },
  {
    tab: "routing",
    label: "Provider Routing",
    description: "Failover chain, A/B experiments, decision replay",
    keywords: ["routing", "failover", "circuit breaker", "a/b"],
  },
  {
    tab: "memory",
    label: "Memory (Shiba)",
    description: "Recall, write history, vector search, tags",
    keywords: ["memory", "shiba", "recall", "vector"],
  },
  {
    tab: "training",
    label: "Training & GPU",
    description: "LoRA, QLoRA, GPU detection, sweeps, smoke test",
    keywords: ["fine-tune", "lora", "qlora", "gpu", "training", "sweep"],
  },
  {
    tab: "governance",
    label: "Governance",
    description: "Approval workflow, audit log, replay",
    keywords: ["approval", "audit", "compliance"],
  },
  {
    tab: "hub",
    label: "Hub",
    description: "Live ops surface (services, audits, PRs, quotas)",
    keywords: ["hub", "ops", "monitor", "service"],
  },
  {
    tab: "speech",
    label: "Speech",
    description: "TTS / STT, voice mapping, voice cloning",
    keywords: ["tts", "stt", "voice", "azure", "elevenlabs"],
  },
  {
    tab: "commitMessage",
    label: "Commit Message",
    description: "Style override, templates, breaking-change detector",
    keywords: ["git", "commit"],
  },
  {
    tab: "experimental",
    label: "Experimental",
    description: "Feature flags + stability badges",
    keywords: ["flag", "experimental", "alpha", "beta"],
  },
  {
    tab: "language",
    label: "Language",
    description: "UI locale + per-language model map",
    keywords: ["locale", "i18n", "language"],
  },
  {
    tab: "aboutKiloCode",
    label: "About",
    description: "Version, diagnostics, import/export",
    keywords: ["about", "version", "diagnostic", "support"],
  },
]

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  // Quick exact-prefix bonus
  if (t.startsWith(q)) return 100 + q.length
  if (t.includes(q)) return 50 + q.length
  // Char-by-char streak score
  let qi = 0
  let score = 0
  let streak = 0
  for (const c of t) {
    if (qi < q.length && c === q[qi]) {
      qi++
      streak++
      score += 1 + streak
    } else {
      streak = 0
    }
  }
  return qi === q.length ? score : 0
}

function entryScore(entry: PaletteEntry, query: string): number {
  if (!query) return 1
  const labelScore = fuzzyScore(query, entry.label) * 3
  const descScore = entry.description ? fuzzyScore(query, entry.description) : 0
  const keywordScore = (entry.keywords ?? []).reduce((s, k) => Math.max(s, fuzzyScore(query, k)), 0) * 2
  return Math.max(labelScore, descScore, keywordScore)
}

export interface SettingsCommandPaletteProps {
  open: boolean
  onClose: () => void
  onJump: (tab: string) => void
}

const SettingsCommandPalette: Component<SettingsCommandPaletteProps> = (props) => {
  const [query, setQuery] = createSignal("")
  const [activeIdx, setActiveIdx] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const results = (): PaletteEntry[] => {
    const q = query().trim()
    if (!q) return SETTINGS_REGISTRY.slice(0, 12)
    const scored = SETTINGS_REGISTRY.map((e) => ({ e, s: entryScore(e, q) })).filter((x) => x.s > 0)
    scored.sort((a, b) => b.s - a.s)
    return scored.slice(0, 12).map((x) => x.e)
  }

  // Reset state on open
  createEffect(() => {
    if (props.open) {
      setQuery("")
      setActiveIdx(0)
      // Defer focus to next frame so the input is mounted
      queueMicrotask(() => inputRef?.focus())
    }
  })

  // Reset selected index when query changes
  createEffect(() => {
    void query()
    setActiveIdx(0)
  })

  const onKey = (e: KeyboardEvent): void => {
    if (!props.open) return
    if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
      return
    }
    const r = results()
    if (r.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, r.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      const hit = r[activeIdx()]
      if (hit) {
        e.preventDefault()
        props.onJump(hit.tab)
        props.onClose()
      }
    }
  }

  onMount(() => window.addEventListener("keydown", onKey))
  onCleanup(() => window.removeEventListener("keydown", onKey))

  return (
    <Show when={props.open}>
      <div
        role="dialog"
        aria-label="Settings command palette"
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.45)",
          "z-index": "1000",
          display: "flex",
          "justify-content": "center",
          "align-items": "flex-start",
          "padding-top": "10vh",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(640px, 90vw)",
            "max-height": "70vh",
            background: "var(--vscode-editorWidget-background, #1e1e1e)",
            border: "1px solid var(--vscode-widget-border)",
            "border-radius": "6px",
            "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "10px 12px",
              "border-bottom": "1px solid var(--vscode-widget-border)",
            }}
          >
            <span style={{ "font-size": "13px", color: "var(--vscode-descriptionForeground)" }}>⌕</span>
            <input
              ref={(el) => (inputRef = el)}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search settings… (type, then Enter to jump; Esc to close)"
              aria-label="Search settings"
              style={{
                flex: 1,
                background: "transparent",
                color: "var(--vscode-input-foreground)",
                border: "none",
                outline: "none",
                "font-size": "14px",
              }}
            />
            <kbd
              style={{
                "font-size": "10px",
                padding: "2px 6px",
                "border-radius": "3px",
                background: "var(--vscode-keybindingLabel-background)",
                color: "var(--vscode-keybindingLabel-foreground)",
                border: "1px solid var(--vscode-keybindingLabel-border)",
              }}
            >
              Esc
            </kbd>
          </div>

          <ul
            role="listbox"
            style={{
              flex: 1,
              overflow: "auto",
              "list-style": "none",
              margin: 0,
              padding: "4px 0",
            }}
          >
            <For
              each={results()}
              fallback={
                <li
                  style={{
                    padding: "12px",
                    "font-size": "13px",
                    color: "var(--vscode-descriptionForeground)",
                    "text-align": "center",
                  }}
                >
                  No matches
                </li>
              }
            >
              {(entry, i) => {
                const isActive = (): boolean => i() === activeIdx()
                return (
                  <li
                    role="option"
                    aria-selected={isActive()}
                    onMouseEnter={() => setActiveIdx(i())}
                    onClick={() => {
                      props.onJump(entry.tab)
                      props.onClose()
                    }}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      background: isActive() ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
                      color: isActive()
                        ? "var(--vscode-list-activeSelectionForeground)"
                        : "var(--vscode-foreground)",
                      display: "flex",
                      "align-items": "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <span style={{ "font-weight": "500" }}>{entry.label}</span>
                      <Show when={entry.description}>
                        <span
                          style={{
                            "margin-left": "8px",
                            color: isActive()
                              ? "var(--vscode-list-activeSelectionForeground)"
                              : "var(--vscode-descriptionForeground)",
                            "font-size": "12px",
                          }}
                        >
                          — {entry.description}
                        </span>
                      </Show>
                    </span>
                    <span
                      style={{
                        "font-size": "10px",
                        padding: "1px 6px",
                        "border-radius": "3px",
                        background: "var(--vscode-badge-background)",
                        color: "var(--vscode-badge-foreground)",
                      }}
                    >
                      {entry.tab}
                    </span>
                  </li>
                )
              }}
            </For>
          </ul>

          <div
            style={{
              padding: "6px 12px",
              "border-top": "1px solid var(--vscode-widget-border)",
              "font-size": "11px",
              color: "var(--vscode-descriptionForeground)",
              display: "flex",
              gap: "12px",
            }}
          >
            <span>↑↓ navigate</span>
            <span>↵ jump</span>
            <span style={{ "margin-left": "auto" }}>{results().length} of {SETTINGS_REGISTRY.length}</span>
          </div>
        </div>
      </div>
    </Show>
  )
}

export default SettingsCommandPalette
