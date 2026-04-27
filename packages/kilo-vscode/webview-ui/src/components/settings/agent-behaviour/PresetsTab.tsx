/**
 * PresetsTab — One-click personality bundles for the Agent Behaviour panel.
 *
 * Each preset is a real config bundle that's applied via the existing
 * `updateConfig` channel. No backend stub: presets only touch keys the
 * config service already understands (`default_agent`, `instructions`,
 * `autoApprove`).
 */

import { Component, For } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useConfig } from "../../../context/config"

interface Preset {
  id: string
  name: string
  description: string
  bundle: Record<string, unknown>
}

const PRESETS: Preset[] = [
  {
    id: "aggressive-refactorer",
    name: "Aggressive Refactorer",
    description:
      "Bold structural rewrites. Auto-applies edits, prefers sweeping changes over local patches.",
    bundle: {
      default_agent: "build",
      instructions: ["./INSTRUCTIONS.md", "./REFACTOR_RULES.md"],
      autoApprove: { edit: true, write: true, bash: false, mcp: false },
    },
  },
  {
    id: "cautious-senior",
    name: "Cautious Senior",
    description: "Surgical, well-justified changes. Asks before touching anything; nothing auto-approved.",
    bundle: {
      default_agent: "build",
      instructions: ["./INSTRUCTIONS.md", "./SENIOR_REVIEW.md"],
      autoApprove: { edit: false, write: false, bash: false, mcp: false },
    },
  },
  {
    id: "research-only",
    name: "Research-Only",
    description: "Read-only investigation. No edits, no writes — just analysis and findings.",
    bundle: {
      default_agent: "ask",
      instructions: ["./RESEARCH_GUIDE.md"],
      autoApprove: { edit: false, write: false, bash: false, mcp: false },
    },
  },
  {
    id: "pair-programmer",
    name: "Pair Programmer",
    description: "Conversational driver-navigator flow. Auto-edits small things, confirms larger work.",
    bundle: {
      default_agent: "build",
      instructions: ["./INSTRUCTIONS.md", "./PAIR_NORMS.md"],
      autoApprove: { edit: true, write: false, bash: false, mcp: false },
    },
  },
]

const PresetsTab: Component = () => {
  const { updateConfig } = useConfig()

  const apply = (preset: Preset): void => {
    updateConfig(preset.bundle as never)
  }

  return (
    <div>
      <div
        style={{
          "font-size": "12px",
          color: "var(--vscode-descriptionForeground)",
          "margin-bottom": "12px",
          "line-height": "1.5",
        }}
      >
        Apply a personality preset to bundle default agent, instruction files, and auto-approve rules in one
        click. Presets overwrite the matching config keys; other settings are untouched.
      </div>

      <For each={PRESETS}>
        {(preset) => (
          <Card style={{ "margin-bottom": "12px" }}>
            <div
              style={{
                display: "flex",
                "align-items": "flex-start",
                "justify-content": "space-between",
                gap: "12px",
                padding: "8px 4px",
              }}
            >
              <div style={{ flex: "1", "min-width": "0" }}>
                <div style={{ "font-weight": "500", "font-size": "13px" }}>{preset.name}</div>
                <div
                  style={{
                    "font-size": "12px",
                    color: "var(--vscode-descriptionForeground)",
                    "margin-top": "4px",
                    "line-height": "1.4",
                  }}
                >
                  {preset.description}
                </div>
              </div>
              <Button variant="secondary" size="small" onClick={() => apply(preset)}>
                Apply
              </Button>
            </div>
          </Card>
        )}
      </For>
    </div>
  )
}

export default PresetsTab
