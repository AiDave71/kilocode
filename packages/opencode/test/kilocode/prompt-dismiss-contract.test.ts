/**
 * Contract test for prompt.ts Kilo-specific invariants.
 *
 * prompt.ts is a shared upstream file. PR #8988 added Suggestion.dismissAll
 * there with kilocode_change markers. An upstream merge that restructures
 * the prompt handling could silently remove this call — this test catches that.
 */

import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const PROMPT_FILE = path.resolve(import.meta.dir, "../../src/session/prompt.ts")

describe("prompt.ts Kilo-specific invariants", () => {
  test("imports Suggestion from kilocode/suggestion", () => {
    const content = fs.readFileSync(PROMPT_FILE, "utf-8")
    expect(content).toMatch(/import\s*\{[^}]*Suggestion[^}]*\}\s*from\s*["']@\/kilocode\/suggestion["']/)
  })

  test("calls Suggestion.dismissAll before restarting the session loop", () => {
    const content = fs.readFileSync(PROMPT_FILE, "utf-8")
    expect(content).toContain("Suggestion.dismissAll")
  })

  test("dismissAll and reserve run before the prompt queue enqueues the new loop", () => {
    const content = fs.readFileSync(PROMPT_FILE, "utf-8")
    // dismissAll must precede queue reservation/state cancellation so a previous
    // loop blocked on a suggestion can settle before the replacement prompt
    // restarts the loop, while still letting newer prompts supersede older
    // replacements during the cancel window.
    const block = content.match(
      /kilocode_change start[^\n]*hot-inject[\s\S]*?Suggestion\.dismissAll[\s\S]*?const hold = yield\* KiloSessionPromptQueue\.reserve\(input\.sessionID\)[\s\S]*?state\.cancel\(input\.sessionID\)[\s\S]*?kilocode_change end[\s\S]*?KiloSessionPromptQueue\.enqueue\([\s\S]*?hold/,
    )
    expect(block).not.toBeNull()
  })
})
