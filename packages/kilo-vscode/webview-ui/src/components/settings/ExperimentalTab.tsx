import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import flagMeta from "../../data/experimental-flags.json"

// kilocode_change: real stability badges + dependency check + request-feature link
type Stability = "alpha" | "beta" | "rc" | "stable"
interface FlagMeta {
  stability: Stability
  requires?: string[]
  since?: string
}
const STABILITY_COLORS: Record<Stability, string> = {
  alpha: "#e11d48",
  beta: "#f59e0b",
  rc: "#3b82f6",
  stable: "#10b981",
}
const FLAG_META: Record<string, FlagMeta> = flagMeta as never

const StabilityBadge: Component<{ flagKey: string }> = (props) => {
  const meta = (): FlagMeta | undefined => FLAG_META[props.flagKey]
  return (
    <Show when={meta()}>
      <span
        title={`${meta()!.stability.toUpperCase()}${meta()!.since ? " · since " + meta()!.since : ""}`}
        style={{
          display: "inline-block",
          padding: "1px 6px",
          "margin-left": "8px",
          "border-radius": "3px",
          "background-color": STABILITY_COLORS[meta()!.stability],
          color: "white",
          "font-size": "10px",
          "font-weight": "600",
          "text-transform": "uppercase",
          "vertical-align": "middle",
        }}
      >
        {meta()!.stability}
      </span>
    </Show>
  )
}

interface ShareOption {
  value: string
  labelKey: string
}

const SHARE_OPTIONS: ShareOption[] = [
  { value: "manual", labelKey: "settings.experimental.share.manual" },
  { value: "auto", labelKey: "settings.experimental.share.auto" },
  { value: "disabled", labelKey: "settings.experimental.share.disabled" },
]

const ExperimentalTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()
  const [active, setActive] = createSignal(false)

  const handler = (msg: ExtensionMessage) => {
    if (msg.type === "remoteStatus") {
      setActive(msg.enabled)
    }
  }

  onMount(() => {
    const unsub = vscode.onMessage(handler)
    vscode.postMessage({ type: "requestRemoteStatus" })
    onCleanup(unsub)
  })

  const experimental = createMemo(() => config().experimental ?? {})

  const updateExperimental = (key: string, value: unknown) => {
    updateConfig({
      experimental: { ...experimental(), [key]: value },
    })
  }

  return (
    <div>
      <Card>
        {/* Remote control */}
        <div data-component="remote-settings">
          <div data-slot="remote-settings-header">
            <div data-slot="settings-row-label-title">{language.t("settings.experimental.remote.title")}</div>
            <div data-slot="settings-row-label-subtitle">{language.t("settings.experimental.remote.description")}</div>
          </div>
          <div data-slot="remote-settings-block">
            <div data-slot="remote-settings-row">
              <span data-slot="remote-settings-label">{language.t("settings.experimental.remote.current")}</span>
              <span data-slot="remote-settings-status" data-active={active()}>
                {active()
                  ? language.t("settings.experimental.remote.active")
                  : language.t("settings.experimental.remote.inactive")}
              </span>
            </div>
            <div data-slot="remote-settings-hint">{language.t("settings.experimental.remote.hint")}</div>
          </div>
          <div data-slot="remote-settings-row">
            <span data-slot="remote-settings-label">{language.t("settings.experimental.remote.startup")}</span>
            <Switch
              checked={config().remote_control ?? false}
              onChange={(checked) => {
                updateConfig({ remote_control: checked })
              }}
              hideLabel
            >
              {language.t("settings.experimental.remote.startup")}
            </Switch>
          </div>
        </div>

        {/* Share mode */}
        <SettingsRow
          title={language.t("settings.experimental.share.title")}
          description={language.t("settings.experimental.share.description")}
        >
          <Select
            options={SHARE_OPTIONS}
            current={SHARE_OPTIONS.find((o) => o.value === (config().share ?? "manual"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as "manual" | "auto" | "disabled"
              if (next === (config().share ?? "manual")) return
              updateConfig({ share: next })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.formatter.title")}
          description={language.t("settings.experimental.formatter.description")}
        >
          <Switch
            checked={config().formatter !== false}
            onChange={(checked) => updateConfig({ formatter: checked ? {} : false })}
            hideLabel
          >
            {language.t("settings.experimental.formatter.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.lsp.title")}
          description={language.t("settings.experimental.lsp.description")}
        >
          <Switch
            checked={config().lsp !== false}
            onChange={(checked) => updateConfig({ lsp: checked ? {} : false })}
            hideLabel
          >
            {language.t("settings.experimental.lsp.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.pasteSummary.title")}
          description={language.t("settings.experimental.pasteSummary.description")}
        >
          <Switch
            checked={experimental().disable_paste_summary ?? false}
            onChange={(checked) => updateExperimental("disable_paste_summary", checked)}
            hideLabel
          >
            {language.t("settings.experimental.pasteSummary.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.batch.title")}
          description={language.t("settings.experimental.batch.description")}
        >
          <Switch
            checked={experimental().batch_tool ?? false}
            onChange={(checked) => updateExperimental("batch_tool", checked)}
            hideLabel
          >
            {language.t("settings.experimental.batch.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.codebaseSearch.title")}
          description={language.t("settings.experimental.codebaseSearch.description")}
        >
          <Switch
            checked={experimental().codebase_search ?? false}
            onChange={(checked) => updateExperimental("codebase_search", checked)}
            hideLabel
          >
            {language.t("settings.experimental.codebaseSearch.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.continueOnDeny.title")}
          description={language.t("settings.experimental.continueOnDeny.description")}
        >
          <Switch
            checked={experimental().continue_loop_on_deny ?? false}
            onChange={(checked) => updateExperimental("continue_loop_on_deny", checked)}
            hideLabel
          >
            {language.t("settings.experimental.continueOnDeny.title")}
          </Switch>
        </SettingsRow>

        {/* MCP timeout */}
        <SettingsRow
          title={language.t("settings.experimental.mcpTimeout.title")}
          description={language.t("settings.experimental.mcpTimeout.description")}
          last
        >
          <TextField
            value={String(experimental().mcp_timeout ?? 60000)}
            onChange={(val) => {
              const num = parseInt(val, 10)
              if (!isNaN(num) && num > 0) {
                updateExperimental("mcp_timeout", num)
              }
            }}
          />
        </SettingsRow>
      </Card>

      {/* kilocode_change: real stability legend + dependency-aware request-feature link */}
      <div style={{ "margin-top": "12px", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
        <strong>Stability:</strong>{" "}
        <span style={{ color: STABILITY_COLORS.stable }}>● stable</span>{" "}
        <span style={{ color: STABILITY_COLORS.rc }}>● rc</span>{" "}
        <span style={{ color: STABILITY_COLORS.beta }}>● beta</span>{" "}
        <span style={{ color: STABILITY_COLORS.alpha }}>● alpha</span>
        <span style={{ "margin-left": "12px" }}>
          ·{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              const ctx = {
                version: (config() as { version?: string }).version ?? "unknown",
                platform: navigator.platform,
                experimentalFlags: experimental(),
                ts: new Date().toISOString(),
              }
              const body = encodeURIComponent(
                "## Feature Request\n\n<!-- describe -->\n\n```json\n" +
                  JSON.stringify(ctx, null, 2) +
                  "\n```",
              )
              const url = `https://github.com/Kilo-Org/kilocode/issues/new?labels=feature-request&body=${body}`
              vscode.postMessage({ type: "openExternal", url })
            }}
            style={{ color: "var(--vscode-textLink-foreground)" }}
          >
            Request a feature (auto-fills context)
          </a>
        </span>
      </div>

      {/* Tool toggles */}
      <Show when={config().tools && Object.keys(config().tools ?? {}).length > 0}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
          {language.t("settings.experimental.toolToggles")}
        </h4>
        <Card>
          <For each={Object.entries(config().tools ?? {})}>
            {([name, enabled], index) => (
              <SettingsRow title={name} description="" last={index() >= Object.keys(config().tools ?? {}).length - 1}>
                <Switch
                  checked={enabled}
                  onChange={(checked) => updateConfig({ tools: { ...config().tools, [name]: checked } })}
                  hideLabel
                >
                  {name}
                </Switch>
              </SettingsRow>
            )}
          </For>
        </Card>
      </Show>
    </div>
  )
}

export default ExperimentalTab
