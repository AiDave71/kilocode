/**
 * AutoUpdateService — KiloCode VSIX OTA client (HUB_OTA_UPDATE_SPEC §4).
 * Polls Hub `/api/updates/manifest?channel=<channel>` on activate and every
 * pollIntervalMs (default 1 h), fires `onUpdateAvailable` when a newer
 * version is published, silently installs when mode is "silent".
 * Storage: globalState for prefs, SecretStorage for clientId.
 * No external runtime deps — global fetch with stdlib https fallback.
 */
import * as vscode from "vscode"
import * as https from "https"
import * as http from "http"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { URL } from "url"

export type UpdateChannel = "stable" | "canary" | "dev"
export type UpdateMode = "off" | "prompt" | "silent"

export interface ManifestFileComponent { version: string; sha256: string; size: number }
export interface ManifestImageComponent { version: string; imageRef: string; digest: string }
export interface Manifest {
  ok?: boolean; ts?: string; channel: UpdateChannel; version: string
  minimumVersion?: string; publishedAt: string; publishedBy?: string
  forceDowngrade?: boolean
  components: {
    "kilocode-vsix": ManifestFileComponent
    "webui-bundle": ManifestFileComponent
    "hub-image": ManifestImageComponent
    pipelines: ManifestFileComponent
  }
  releaseNotes?: string; signature: string
}
export interface UpdateInfo {
  manifest: Manifest; currentVersion: string; newVersion: string
  isForced: boolean; releaseNotes?: string
}
export interface SignedDownload {
  ok: boolean; url: string; sha256: string; size: number; expiresAt: string
}

const POLL_INTERVAL_MS_DEFAULT = 60 * 60 * 1000
const HTTP_TIMEOUT_MS = 15_000
const STATE_KEY = {
  channel: "daveai.autoUpdate.channel",
  mode: "daveai.autoUpdate.mode",
  skippedVersions: "daveai.autoUpdate.skippedVersions",
  lastCheckedAt: "daveai.autoUpdate.lastCheckedAt",
  pinnedVersion: "daveai.autoUpdate.pinnedVersion",
} as const
const SECRET_KEY = {
  clientId: "daveai.autoUpdate.clientId",
  authToken: "daveai.autoUpdate.authToken",
} as const

export class AutoUpdateService implements vscode.Disposable {
  private readonly _onUpdateAvailable = new vscode.EventEmitter<UpdateInfo>()
  readonly onUpdateAvailable = this._onUpdateAvailable.event

  private timer: NodeJS.Timeout | null = null
  private channel: vscode.OutputChannel
  private clientIdCached: string | null = null
  private disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hubBaseUrl: string,
    private readonly authToken: string | undefined = undefined,
    private readonly pollIntervalMs: number = POLL_INTERVAL_MS_DEFAULT,
  ) {
    this.channel = vscode.window.createOutputChannel("DaveAI Auto-Update")
    this.disposables.push(this._onUpdateAvailable, this.channel)
  }

  start(): void {
    if (this.timer) return
    void this.checkNow().catch((e) => this.log(`initial check failed: ${e}`))
    this.timer = setInterval(() => {
      void this.checkNow().catch((e) => this.log(`scheduled check failed: ${e}`))
    }, this.pollIntervalMs)
  }

  dispose(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.disposables.forEach((d) => d.dispose())
  }

  /** Manually trigger a manifest poll. Network errors are swallowed. */
  async checkNow(): Promise<UpdateInfo | null> {
    try {
      const channel = this.getChannel()
      const manifest = await this.fetchManifest(channel)
      await this.context.globalState.update(STATE_KEY.lastCheckedAt, new Date().toISOString())
      if (!manifest) return null

      const currentVersion = this.getCurrentVersion()
      if (this.getPinnedVersion()) {
        this.log(`pinned; ignoring manifest ${manifest.version}`)
        return null
      }

      const cmp = compareSemver(manifest.version, currentVersion)
      if (cmp <= 0 && !manifest.forceDowngrade) return null

      const minVersion = manifest.minimumVersion ?? "0.0.0"
      const isForced = compareSemver(currentVersion, minVersion) < 0

      if (!isForced && this.isVersionSkipped(manifest.version)) {
        this.log(`version ${manifest.version} previously skipped`)
        return null
      }

      const info: UpdateInfo = {
        manifest, currentVersion, newVersion: manifest.version, isForced,
        releaseNotes: manifest.releaseNotes,
      }
      this._onUpdateAvailable.fire(info)

      if (this.getMode() === "silent" && !isForced) {
        void this.installUpdate(info).catch((e) => this.log(`silent install failed: ${e}`))
      }
      return info
    } catch (err) {
      this.log(`checkNow error (suppressed): ${stringifyError(err)}`)
      return null
    }
  }

  /** Download VSIX, run installVSIX command, prompt reload. */
  async installUpdate(info: UpdateInfo): Promise<void> {
    const vsix = info.manifest.components["kilocode-vsix"]
    const signed = await this.fetchSignedDownload("kilocode-vsix", vsix.version)
    const stagingDir = path.join(os.homedir(), ".kilocode", "staging")
    fs.mkdirSync(stagingDir, { recursive: true })
    const target = path.join(stagingDir, `kilocode-${vsix.version}.vsix`)

    this.log(`downloading ${signed.url} → ${target}`)
    await this.download(signed.url, target)

    // kilocode_change: SHA256 + size verification before installVSIX. Without this,
    // a compromised CDN, tampered storage, or MITM could swap the VSIX payload
    // and the user would get a malicious extension installed unchallenged.
    const crypto = await import("crypto")
    const fileBuf = fs.readFileSync(target)
    const gotSha = crypto.createHash("sha256").update(fileBuf).digest("hex").toLowerCase()
    const wantSha = ((signed as { sha256?: string }).sha256 || vsix.sha256 || "").toLowerCase()
    if (!wantSha || gotSha !== wantSha) {
      try {
        fs.unlinkSync(target)
      } catch {
        /* best-effort cleanup */
      }
      throw new Error(`VSIX integrity check failed (sha256 ${gotSha} != ${wantSha})`)
    }
    const wantSize = (signed as { size?: number }).size
    if (typeof wantSize === "number" && fileBuf.byteLength !== wantSize) {
      try {
        fs.unlinkSync(target)
      } catch {
        /* */
      }
      throw new Error(`VSIX size mismatch (${fileBuf.byteLength} != ${wantSize})`)
    }

    try {
      await vscode.commands.executeCommand(
        "workbench.extensions.action.installVSIX",
        vscode.Uri.file(target),
      )
    } catch (err) {
      this.log(`installVSIX command failed: ${stringifyError(err)}`)
      try {
        fs.unlinkSync(target)
      } catch {
        /* */
      }
      throw err
    } finally {
      // Clean up staged VSIX after install attempt regardless of outcome
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target)
      } catch {
        /* */
      }
    }

    const choice = await vscode.window.showInformationMessage(
      `KiloCode v${vsix.version} installed. Reload window to activate?`,
      "Reload Now", "Later",
    )
    if (choice === "Reload Now") {
      void vscode.commands.executeCommand("workbench.action.reloadWindow")
    }
  }

  // Settings accessors
  getChannel(): UpdateChannel { return this.context.globalState.get<UpdateChannel>(STATE_KEY.channel) ?? "stable" }
  setChannel(c: UpdateChannel): Thenable<void> { return this.context.globalState.update(STATE_KEY.channel, c) }
  getMode(): UpdateMode { return this.context.globalState.get<UpdateMode>(STATE_KEY.mode) ?? "prompt" }
  setMode(m: UpdateMode): Thenable<void> { return this.context.globalState.update(STATE_KEY.mode, m) }
  getSkippedVersions(): string[] { return this.context.globalState.get<string[]>(STATE_KEY.skippedVersions) ?? [] }
  async addSkippedVersion(version: string): Promise<void> {
    const current = this.getSkippedVersions()
    if (!current.includes(version)) {
      await this.context.globalState.update(STATE_KEY.skippedVersions, [...current, version])
    }
  }
  isVersionSkipped(v: string): boolean { return this.getSkippedVersions().includes(v) }
  getPinnedVersion(): string | null { return this.context.globalState.get<string | null>(STATE_KEY.pinnedVersion) ?? null }
  getLastCheckedAt(): string | null { return this.context.globalState.get<string>(STATE_KEY.lastCheckedAt) ?? null }
  getCurrentVersion(): string { return this.context.extension?.packageJSON?.version ?? "0.0.0" }
  async getClientId(): Promise<string> {
    if (this.clientIdCached) return this.clientIdCached
    const fromSecret = await this.context.secrets.get(SECRET_KEY.clientId)
    if (fromSecret) { this.clientIdCached = fromSecret; return fromSecret }
    const fresh = uuidV4()
    await this.context.secrets.store(SECRET_KEY.clientId, fresh)
    this.clientIdCached = fresh
    return fresh
  }

  // Networking

  private async fetchManifest(channel: UpdateChannel): Promise<Manifest | null> {
    const clientId = await this.getClientId()
    const url = `${this.hubBaseUrl.replace(/\/$/, "")}/api/updates/manifest?channel=${channel}&clientId=${encodeURIComponent(clientId)}`
    const body = await this.httpGet(url)
    if (!body) return null
    try { return JSON.parse(body) as Manifest }
    catch (err) { this.log(`manifest parse error: ${stringifyError(err)}`); return null }
  }

  private async fetchSignedDownload(name: string, version: string): Promise<SignedDownload> {
    const url = `${this.hubBaseUrl.replace(/\/$/, "")}/api/updates/components/${encodeURIComponent(name)}/${encodeURIComponent(version)}/url`
    const body = await this.httpGet(url)
    if (!body) throw new Error(`empty response from ${url}`)
    return JSON.parse(body) as SignedDownload
  }

  private async httpGet(url: string): Promise<string | null> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "kilocode-auto-update/1.0",
    }
    if (this.authToken) headers.authorization = `Bearer ${this.authToken}`

    const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch
    if (typeof fetchFn === "function") {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS)
      try {
        const res = await fetchFn(url, { headers, signal: ctl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
        return await res.text()
      } finally { clearTimeout(t) }
    }

    // kilocode_change: was missing 3xx redirect handling (so manifest URLs behind
     // CloudFront/S3 redirects returned redirect HTML and JSON.parse failed downstream).
     // Also `req.on("timeout")` could fire AFTER response started, so error+end could
     // double-fire resolve/reject. `done` flag now prevents that.
    const MAX_HOPS = 5
    const doGet = (target: string, hops: number): Promise<string | null> =>
      new Promise<string | null>((resolve, reject) => {
        let done = false
        const settle = (fn: () => void): void => {
          if (!done) {
            done = true
            fn()
          }
        }
        const u = new URL(target)
        const lib = u.protocol === "https:" ? https : http
        const req = lib.get(target, { headers, timeout: HTTP_TIMEOUT_MS }, (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            if (hops >= MAX_HOPS) {
              settle(() => reject(new Error(`Too many redirects (${MAX_HOPS}) on ${target}`)))
              return
            }
            const next = new URL(res.headers.location as string, target).toString()
            doGet(next, hops + 1).then(
              (v) => settle(() => resolve(v)),
              (e) => settle(() => reject(e)),
            )
            return
          }
          if (status < 200 || status >= 300) {
            res.resume()
            settle(() => reject(new Error(`HTTP ${status} on ${target}`)))
            return
          }
          let buf = ""
          res.setEncoding("utf8")
          res.on("data", (c) => (buf += c))
          res.on("end", () => settle(() => resolve(buf)))
          res.on("error", (e) => settle(() => reject(e)))
        })
        req.on("timeout", () => {
          req.destroy(new Error("timeout"))
        })
        req.on("error", (e) => settle(() => reject(e)))
      })
    return doGet(url, 0)
  }

  private async download(url: string, target: string, hops = 0): Promise<void> {
    // kilocode_change: previously did not follow 3xx redirects — signed S3 / CloudFront
    // URLs always redirect, so the redirect HTML body was being written as the VSIX,
    // and VS Code's installVSIX then rejected the file. Cap at 5 hops to avoid loops.
    const MAX_HOPS = 5
    return new Promise<void>((resolve, reject) => {
      const u = new URL(url)
      const lib = u.protocol === "https:" ? https : http
      const file = fs.createWriteStream(target)
      lib
        .get(url, { timeout: HTTP_TIMEOUT_MS }, (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            // Don't write the redirect body — close the stream and recurse
            file.close(() => {
              if (hops >= MAX_HOPS) {
                reject(new Error(`Too many redirects (${MAX_HOPS}) downloading ${url}`))
                return
              }
              const next = new URL(res.headers.location as string, url).toString()
              this.download(next, target, hops + 1).then(resolve, reject)
            })
            res.resume()
            return
          }
          if (status >= 400) {
            file.close()
            reject(new Error(`HTTP ${status} on ${url}`))
            res.resume()
            return
          }
          res.pipe(file)
          file.on("finish", () => file.close((err) => (err ? reject(err) : resolve())))
          file.on("error", reject)
        })
        .on("error", reject)
    })
  }

  private log(msg: string): void {
    this.channel.appendLine(`[${new Date().toISOString()}] ${msg}`)
  }
}

/** Compare two `x.y.z` semver strings. Returns -1, 0, or 1. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0
    const bi = pb[i] ?? 0
    if (ai > bi) return 1
    if (ai < bi) return -1
  }
  return 0
}

function uuidV4(): string {
  const cryptoMod = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoMod?.randomUUID) return cryptoMod.randomUUID()
  const b = require("crypto").randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = b.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}
