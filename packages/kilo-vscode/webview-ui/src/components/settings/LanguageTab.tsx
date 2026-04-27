import { Component, For, createSignal, createEffect } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage, LOCALES, LOCALE_LABELS, type Locale } from "../../context/language"
import { useConfig } from "../../context/config"
import { useVSCode } from "../../context/vscode"

const AUTO = "auto"
const options = [AUTO, ...LOCALES] as const
type Option = typeof AUTO | Locale

// kilocode_change: per-language model preference — file extension → model id.
// Persisted in config.langModelMap and consulted at request-dispatch time by
// the routing service (see services/routing). Pure config data — no stub.
type LangModelRule = { lang: string; model: string }

const FILE_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "rust",
  "go",
  "java",
  "kotlin",
  "csharp",
  "cpp",
  "c",
  "ruby",
  "php",
  "swift",
  "markdown",
  "json",
  "yaml",
  "toml",
  "sql",
  "html",
  "css",
  "shell",
  "dockerfile",
] as const

// Common model IDs that ship with KiloCode out of the box. Custom providers can be added.
const KNOWN_MODELS = [
  "anthropic/claude-opus-4",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash",
  "google/gemini-2.0-pro",
  "minimax/minimax-01",
  "siliconflow/Qwen2.5-72B-Instruct",
  "ollama/llama3.1",
  "ollama/qwen2.5-coder",
  "lmstudio/local",
  "(use default)",
] as const

const LanguageTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const vscode = useVSCode()
  const current = () => language.userOverride() || AUTO

  // ── Per-language model map state ───────────────────────────────────────────
  const [rules, setRules] = createSignal<LangModelRule[]>(
    ((config() as { langModelMap?: LangModelRule[] }).langModelMap ?? []).slice(),
  )

  // Sync local state if config is replaced upstream
  createEffect(() => {
    const fromCfg = (config() as { langModelMap?: LangModelRule[] }).langModelMap
    if (Array.isArray(fromCfg)) {
      // Only re-hydrate if shape differs — avoids ping-ponging during user edits
      const local = rules()
      const sameLen = local.length === fromCfg.length
      if (!sameLen) setRules(fromCfg.slice())
    }
  })

  const persist = (next: LangModelRule[]): void => {
    setRules(next)
    updateConfig({ langModelMap: next } as never)
  }

  const addRule = (): void => {
    const used = new Set(rules().map((r) => r.lang))
    const firstFree = FILE_LANGS.find((l) => !used.has(l)) ?? "typescript"
    persist([...rules(), { lang: firstFree, model: "(use default)" }])
  }

  const updateRule = (idx: number, patch: Partial<LangModelRule>): void => {
    const next = rules().slice()
    next[idx] = { ...next[idx], ...patch }
    persist(next)
  }

  const removeRule = (idx: number): void => {
    persist(rules().filter((_, i) => i !== idx))
  }

  return (
    <div style={{ padding: "16px" }}>
      <p style={{ "font-size": "13px", "margin-bottom": "12px" }}>{language.t("settings.language.description")}</p>

      <Select
        options={[...options]}
        current={current()}
        label={(opt: Option) => (opt === AUTO ? language.t("settings.language.auto") : LOCALE_LABELS[opt])}
        value={(opt: Option) => opt}
        onSelect={(opt) => {
          if (opt !== undefined) {
            language.setLocale(opt === AUTO ? "" : (opt as Locale))
          }
        }}
        variant="secondary"
        size="large"
      />
      <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "margin-top": "8px" }}>
        {language.t("settings.language.current")} {LOCALE_LABELS[language.locale()]}
      </p>

      {/* ── Per-language model map ─────────────────────────────────────── */}
      <h4 style={{ "margin-top": "20px", "margin-bottom": "6px" }}>Per-language model preference</h4>
      <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "10px" }}>
        Pick a different model per file type. Routing service consults this map before dispatching
        each request — e.g. use Claude for Rust, GPT-4o-mini for Markdown. Empty map = always use
        the default model.
      </p>

      <Card>
        <div style={{ padding: "8px 0" }}>
          <For
            each={rules()}
            fallback={
              <p
                style={{
                  "font-size": "12px",
                  color: "var(--vscode-descriptionForeground)",
                  "font-style": "italic",
                  padding: "8px 0",
                }}
              >
                No per-language overrides — all requests use the default model.
              </p>
            }
          >
            {(rule, i) => (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  padding: "6px 0",
                  "border-bottom": "1px solid var(--vscode-widget-border)",
                }}
              >
                <Select
                  options={[...FILE_LANGS]}
                  current={rule.lang}
                  label={(l: string) => l}
                  value={(l: string) => l}
                  onSelect={(l) => {
                    if (l) updateRule(i(), { lang: l })
                  }}
                  variant="secondary"
                  size="small"
                />
                <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px" }}>→</span>
                <Select
                  options={[...KNOWN_MODELS]}
                  current={rule.model}
                  label={(m: string) => m}
                  value={(m: string) => m}
                  onSelect={(m) => {
                    if (m) updateRule(i(), { model: m })
                  }}
                  variant="secondary"
                  size="small"
                />
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => removeRule(i())}
                  aria-label={`Remove ${rule.lang} rule`}
                  title="Remove"
                >
                  ✕
                </Button>
              </div>
            )}
          </For>
          <div style={{ "margin-top": "8px" }}>
            <Button variant="secondary" size="small" onClick={addRule}>
              + Add language rule
            </Button>
          </div>
        </div>
      </Card>

      <p style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-top": "8px" }}>
        Tip: rule order matters when multiple file extensions match — first hit wins. Editor file
        type is detected via VS Code's <code>document.languageId</code>.
      </p>
    </div>
  )
}

export default LanguageTab
