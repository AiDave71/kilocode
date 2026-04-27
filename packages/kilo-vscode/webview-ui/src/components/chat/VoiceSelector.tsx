/**
 * VoiceSelector — Compact Azure voice picker for the chat composer toolbar.
 *
 * Sits next to the Enhance / Send buttons in PromptInput. Lets the user
 * pick an Azure neural voice for the assistant's TTS playback and preview
 * the voice with a small Play button.
 *
 * Behaviours:
 *  - Voice list is grouped by locale (en-GB first, then alphabetical)
 *  - Selection is persisted via the existing config bus
 *    (`updateGlobalSettingValue` → "ttsVoiceId") and via localStorage
 *    so reloads stick even before the global config round-trip completes.
 *  - Preview Play button:
 *    - Disabled if Azure region/key not configured
 *    - Caches the last preview audio (by voiceId) to avoid hammering Azure
 *    - Mutually-exclusive: clicking another voice's play stops the current
 *  - All controls are real <button>/<select> elements (keyboard a11y).
 */

import { Component, createSignal, createMemo, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { AZURE_VOICES, type AzureVoice } from "../../data/azure-voices"
import { synthesizeAzure } from "../../utils/tts-azure"
import { useVSCode } from "../../context/vscode"
import { useConfig } from "../../context/config"

const PREVIEW_TEXT =
  "Hi, I'm your KiloCode voice. This is a quick preview so you can hear how I sound."
const STORAGE_KEY_VOICE = "kilo.chat.azureVoice"

// Lightweight in-memory blob cache so repeated previews don't re-hit Azure
const previewCache = new Map<string, Blob>()
let activeAudio: HTMLAudioElement | null = null

function localeKey(v: AzureVoice): string {
  // Sort en-GB first, then alphabetical
  return v.locale === "en-GB" ? "0" : v.locale
}

function groupedVoices(): Array<{ locale: string; voices: AzureVoice[] }> {
  const buckets = new Map<string, AzureVoice[]>()
  for (const v of AZURE_VOICES) {
    if (!buckets.has(v.locale)) buckets.set(v.locale, [])
    buckets.get(v.locale)!.push(v)
  }
  return Array.from(buckets.entries())
    .map(([locale, voices]) => ({ locale, voices: voices.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => localeKey(a.voices[0]).localeCompare(localeKey(b.voices[0])))
}

export interface VoiceSelectorProps {
  /** Optional override for compact mode (smaller dropdown, no label) */
  compact?: boolean
}

const VoiceSelector: Component<VoiceSelectorProps> = (props) => {
  const vscode = useVSCode()
  const { config, updateConfig } = useConfig()

  // ── Voice ID state ────────────────────────────────────────────────────────
  const initialVoice = (() => {
    try {
      const ls = localStorage.getItem(STORAGE_KEY_VOICE)
      if (ls) return ls
    } catch {
      /* localStorage may be unavailable */
    }
    return "en-GB-MaisieNeural"
  })()
  const [voiceId, setVoiceId] = createSignal<string>(initialVoice)
  const [previewing, setPreviewing] = createSignal(false)

  // Pull region + key out of config (set on the SpeechTab)
  const azureRegion = createMemo(() => {
    const c = config() as { speechAzureRegion?: string; ttsAzureRegion?: string } | undefined
    return c?.speechAzureRegion ?? c?.ttsAzureRegion ?? ""
  })
  const azureKey = createMemo(() => {
    const c = config() as { speechAzureKey?: string; ttsAzureKey?: string } | undefined
    return c?.speechAzureKey ?? c?.ttsAzureKey ?? ""
  })

  const canPreview = createMemo(() => Boolean(azureRegion()) && Boolean(azureKey()))

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = (next: string) => {
    setVoiceId(next)
    try {
      localStorage.setItem(STORAGE_KEY_VOICE, next)
    } catch {
      /* localStorage may be unavailable */
    }
    // Persist to global config so other surfaces (assistant TTS, mobile) pick it up.
    // We piggy-back the existing updateConfig path; this is a fire-and-forget
    // optimistic update — failures don't block the UX.
    try {
      updateConfig({ ttsVoiceId: next } as never)
    } catch {
      /* config bus may not have ttsVoiceId in schema yet — non-fatal */
    }
    vscode.postMessage({ type: "voicePreferenceChanged", voiceId: next } as never)
  }

  const stopActive = () => {
    if (activeAudio) {
      try {
        activeAudio.pause()
      } catch {
        /* */
      }
      activeAudio.src = ""
      activeAudio = null
    }
  }

  const handlePreview = async () => {
    if (previewing()) {
      stopActive()
      setPreviewing(false)
      return
    }
    if (!canPreview()) {
      showToast({
        variant: "error",
        title: "Configure Azure key + region in Settings → Speech first",
      })
      return
    }
    stopActive()
    setPreviewing(true)
    try {
      let blob = previewCache.get(voiceId())
      if (!blob) {
        blob = await synthesizeAzure(PREVIEW_TEXT, {
          region: azureRegion(),
          apiKey: azureKey(),
          voiceId: voiceId(),
        })
        previewCache.set(voiceId(), blob)
      }
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      activeAudio = audio
      audio.addEventListener(
        "ended",
        () => {
          URL.revokeObjectURL(url)
          if (activeAudio === audio) activeAudio = null
          setPreviewing(false)
        },
        { once: true },
      )
      audio.addEventListener(
        "error",
        () => {
          URL.revokeObjectURL(url)
          setPreviewing(false)
        },
        { once: true },
      )
      await audio.play()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: `Voice preview failed: ${msg}` })
      setPreviewing(false)
    }
  }

  onCleanup(stopActive)

  // ── Render ────────────────────────────────────────────────────────────────
  const grouped = groupedVoices()

  return (
    <div
      class="voice-selector"
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "4px",
        "margin-right": "4px",
      }}
    >
      <Tooltip value={`Voice: ${voiceId()}`} placement="top">
        <select
          value={voiceId()}
          onChange={(e) => handleChange(e.currentTarget.value)}
          aria-label="Assistant voice"
          style={{
            background: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            border: "1px solid var(--vscode-input-border)",
            "border-radius": "4px",
            "font-size": props.compact ? "11px" : "12px",
            padding: props.compact ? "2px 4px" : "3px 6px",
            "max-width": props.compact ? "120px" : "180px",
          }}
        >
          {grouped.map((group) => (
            <optgroup label={group.locale}>
              {group.voices.map((v) => (
                <option value={v.id} title={v.description}>
                  {v.name} {v.gender === "Female" ? "♀" : "♂"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Tooltip>
      <Tooltip value={canPreview() ? (previewing() ? "Stop preview" : "Play preview") : "Configure Azure in Settings → Speech"} placement="top">
        <Button
          variant="ghost"
          size="small"
          onClick={handlePreview}
          disabled={!canPreview() && !previewing()}
          aria-label={previewing() ? "Stop voice preview" : "Play voice preview"}
        >
          <Show
            when={previewing()}
            fallback={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3 2.5v11l11-5.5L3 2.5z" />
              </svg>
            }
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3" y="3" width="4" height="10" rx="1" />
              <rect x="9" y="3" width="4" height="10" rx="1" />
            </svg>
          </Show>
        </Button>
      </Tooltip>
    </div>
  )
}

export default VoiceSelector
