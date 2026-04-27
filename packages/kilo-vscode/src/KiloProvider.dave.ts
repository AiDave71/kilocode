/* eslint-disable max-lines */
/**
 * KiloProvider.dave.ts — DaveAI extensions overlay for KiloProvider.
 *
 * Per RFC 001 (docs/RFC_001_AUTOCOMPLETE_OVERLAY.md), the DaveAI-specific
 * V4 subsystem wiring (SSH / VPS / ZeroClaw / Routing / Memory / Training /
 * Governance / Workstation / Discovery / Hermes) lives here, *not* in
 * KiloProvider.ts. The upstream file is left byte-identical to the
 * Kilocode upstream baseline so PROTECTED commits 51079871, 6cc78631,
 * and 154f1043 — and any future upstream commit touching the message
 * router — apply as clean fast-forwards.
 *
 * Wiring contract:
 *   1. Upstream `KiloProvider` constructor calls `installDaveExtensions(this)`.
 *   2. `installDaveExtensions` constructs a `DaveProviderExtensions`
 *      instance and stores it on `(provider as any).__daveExtensions`.
 *   3. The single hook line at the top of upstream's message-router
 *      switch: `if (await (this as any).__daveExtensions?.handleV4Message?.(message)) return`
 *      delegates to `handleV4Message`, which dispatches to the moved
 *      cases. If the message is not a V4 case the method returns `false`
 *      and upstream's switch handles it normally.
 *
 * Importers (extension.ts, OnboardingDiscoveryService) call
 * `setHermesServices` / `setV4Services` / `broadcastDiscoveryComplete`
 * on the `DaveProviderExtensions` instance, not on the provider.
 *
 * This file imports `KiloProvider` only via `import type` — no runtime
 * import cycle.
 */

import * as vscode from "vscode"
import type { KiloProvider } from "./KiloProvider"
import { handleHermesRealWebviewMessage } from "./kilo-provider/handlers/hermes-webview"
import { handleMemoryRealWebviewMessage } from "./kilo-provider/handlers/memory-webview"
import { handleRoutingRealWebviewMessage } from "./kilo-provider/handlers/routing-webview"
import { handleZeroClawRealWebviewMessage } from "./kilo-provider/handlers/zeroclaw-webview"
import { handleGovernanceRealWebviewMessage } from "./kilo-provider/handlers/governance-webview"
import { handleTrainingWebviewMessage as handleTrainingRealWebviewMessage } from "./kilo-provider/handlers/training-webview"

export class DaveProviderExtensions {
  // V4 subsystem services — set via setV4Services() after construction.
  private sshService: import("./services/ssh").SSHService | null = null
  private vpsService: import("./services/vps").VPSService | null = null
  private zeroClawService: import("./services/zeroclaw").ZeroClawService | null = null
  private routingService: import("./services/routing").RoutingService | null = null
  private memoryService: import("./services/memory").MemoryService | null = null
  private trainingService: import("./services/training").TrainingService | null = null
  private governanceService: import("./services/governance").GovernanceService | null = null
  private workstationProfile: import("./services/workstation").WorkstationProfileService | null = null
  private discoveryService: import("./services/onboarding").OnboardingDiscoveryService | null = null
  private hermesStatusSvc: import("./services/hermes").HermesStatusService | null = null
  private hermesClientSvc: import("./services/hermes").HermesClient | null = null

  constructor(private readonly provider: KiloProvider) {}

  /** Forward to provider's postMessage — kept private here for symmetry with the original code. */
  private postMessage(message: unknown): void {
    this.provider.postMessage(message)
  }

  /** Convenience getter for the extension context, delegating to the provider. */
  private get extensionContext(): vscode.ExtensionContext | undefined {
    return (this.provider as unknown as { extensionContext?: vscode.ExtensionContext }).extensionContext
  }

  // ──────────────────────────────────────────────────────────────────
  // Region B (helpers + injectors) — moved from KiloProvider:255-295, 317-384
  // ──────────────────────────────────────────────────────────────────

  /** Build an enriched governance snapshot with release checklist/readiness data. */
  private getEnrichedGovernanceSnapshot(): Record<string, unknown> | null {
    if (!this.governanceService) return null
    const snapshot = this.governanceService.getSnapshot() as unknown as Record<string, unknown>
    snapshot.checklist = this.governanceService.getReleaseChecklist()
    snapshot.releaseReadiness = this.governanceService.computeReleaseReadiness()
    snapshot.rollbackReady = this.governanceService.isRollbackReady()
    return snapshot
  }

  /** Send the enriched governance state to the webview. */
  private sendGovernanceState(): void {
    const snapshot = this.getEnrichedGovernanceSnapshot()
    if (snapshot) {
      this.postMessage({ type: "governanceState", state: snapshot } as never)
    }
  }

  /**
   * Broadcast discovery completion to the webview so tabs can auto-refresh
   * their state (SSH profiles, providers, GPUs) once background discovery finishes.
   */
  broadcastDiscoveryComplete(result: unknown): void {
    this.postMessage({ type: "discoveryComplete", result } as never)
    // Also push fresh state for each affected subsystem
    if (this.sshService) {
      this.postMessage({ type: "sshProfilesLoaded", profiles: this.sshService.getProfiles() } as never)
    }
    if (this.routingService) {
      this.postMessage({
        type: "routingProvidersLoaded",
        providers: this.routingService.getProviders(),
      } as never)
    }
    if (this.trainingService) {
      this.postMessage({
        type: "trainingGPUDetected",
        gpus: this.trainingService.getCachedGPUs(),
      } as never)
    }
  }

  /** Inject Hermes services so the HermesTab can communicate with the pipeline. */
  setHermesServices(
    status: import("./services/hermes").HermesStatusService,
    client: import("./services/hermes").HermesClient,
  ): void {
    this.hermesStatusSvc = status
    this.hermesClientSvc = client
  }

  /** Inject V4 subsystem services so message routing can reach them. */
  setV4Services(services: {
    ssh: import("./services/ssh").SSHService
    vps: import("./services/vps").VPSService
    zeroClaw: import("./services/zeroclaw").ZeroClawService
    routing: import("./services/routing").RoutingService
    memory: import("./services/memory").MemoryService
    training: import("./services/training").TrainingService
    governance: import("./services/governance").GovernanceService
    workstation: import("./services/workstation").WorkstationProfileService
    discovery?: import("./services/onboarding").OnboardingDiscoveryService
  }): void {
    this.sshService = services.ssh
    this.vpsService = services.vps
    this.zeroClawService = services.zeroClaw
    this.routingService = services.routing
    this.memoryService = services.memory
    this.trainingService = services.training
    this.governanceService = services.governance
    this.workstationProfile = services.workstation
    if (services.discovery) this.discoveryService = services.discovery

    // Bridge SSH service events to the webview
    if (services.ssh && typeof services.ssh.onChange === "function") {
      services.ssh.onChange((event: Record<string, unknown>) => {
        switch (event.type) {
          case "connectionStatus":
            this.postMessage({ type: "sshConnectionStatus", profileName: event.profileName, status: event.status, error: event.error } as never)
            break
          case "filesListed":
            this.postMessage({ type: "sshFilesListed", path: event.path, entries: event.entries } as never)
            break
          case "logOutput":
            this.postMessage({ type: "sshLogOutput", lines: event.lines } as never)
            break
          case "logTailingStopped":
            this.postMessage({ type: "sshLogTailingStopped" } as never)
            break
          case "sshError":
            this.postMessage({ type: "sshError", error: event.error } as never)
            break
        }
      })
    }

    // Bridge ZeroClaw status events to webview
    if (services.zeroClaw) {
      services.zeroClaw.onStatusChange((event) => {
        this.postMessage({ type: "zeroClawTaskUpdated", task: event.task } as never)
      })
    }

    // Bridge routing state changes
    if (services.routing) {
      services.routing.onChange(() => {
        this.postMessage({ type: "routingProvidersLoaded", providers: services.routing.getProviders() } as never)
      })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Region C/D (full V4 message router) — moved from KiloProvider:1188-1866
  //
  // Returns true when the message was consumed (so upstream's switch
  // does not also handle it). Returns false when the message type is
  // not a V4 type — upstream's switch then handles it.
  //
  // The original try/catch wrapping the upstream switch (which posted
  // a `v4Error` envelope on uncaught failures) is preserved here; it
  // only wraps V4 cases now, leaving upstream's switch unwrapped.
  // ──────────────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity
  async handleV4Message(message: Record<string, unknown>): Promise<boolean> {
    const type = message?.type
    if (typeof type !== "string") return false
    if (!isV4MessageType(type)) return false

    // Real-backend handlers (Hub-routed) take priority over the legacy
    // in-process service switch. Each returns true if it consumed the
    // message; we return immediately to avoid double-processing.
    const realCtx = {
      extensionContext: (this.provider as unknown as { extensionContext?: vscode.ExtensionContext }).extensionContext,
      postMessage: (m: unknown) => this.postMessage(m as never),
    }
    // Cast to permissive shape for the legacy switch below (pre-existing
    // pattern; the original KiloProvider.ts inline version did the same
    // implicitly via the switch context).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = message as any
    try {
      if (await handleHermesRealWebviewMessage(message, realCtx as never)) return true
      if (await handleMemoryRealWebviewMessage(message, realCtx as never)) return true
      if (await handleRoutingRealWebviewMessage(message, realCtx as never)) return true
      if (await handleZeroClawRealWebviewMessage(message, realCtx as never)) return true
      if (await handleGovernanceRealWebviewMessage(message, realCtx as never)) return true
      if (await handleTrainingRealWebviewMessage(message, realCtx as never)) return true
    } catch (err) {
      console.warn("[KiloProvider.dave] real-backend handler error (non-fatal):", err)
      // Fall through to the legacy switch below.
    }

    try {
      switch (type) {
        // ─── V4 Subsystem Message Routing ───────────────────────────────
        // Message tracing: log every V4 message when enabled
        // SSH
        case "requestSSHProfiles":
          if (this.sshService) {
            let profiles = this.sshService.getProfiles()
            // Auto-import from ~/.ssh/config if list is empty (first-run UX)
            if (profiles.length === 0) {
              try {
                const imported = await this.sshService.importFromSSHConfig()
                if (imported.length > 0) {
                  console.log(`[KiloProvider] Lazy-imported ${imported.length} SSH profiles on tab request`)
                  profiles = this.sshService.getProfiles()
                }
              } catch (err) {
                console.warn("[KiloProvider] SSH lazy-import failed:", err)
              }
            }
            this.postMessage({ type: "sshProfilesLoaded", profiles } as never)
          }
          break
        case "requestSSHSessions":
          if (this.sshService) this.postMessage({ type: "sshSessionsUpdated", sessions: this.sshService.getSessionSnapshots() } as never)
          break
        case "sshProfileSave":
          await this.sshService?.saveProfile(m.profile)
          if (this.sshService) this.postMessage({ type: "sshProfilesLoaded", profiles: this.sshService.getProfiles() } as never)
          break
        case "sshProfileDelete":
          await this.sshService?.deleteProfile(m.profileName)
          if (this.sshService) this.postMessage({ type: "sshProfilesLoaded", profiles: this.sshService.getProfiles() } as never)
          break
        case "sshConnect":
          await this.sshService?.connect(m.profileName)
          if (this.sshService) this.postMessage({ type: "sshSessionsUpdated", sessions: this.sshService.getSessionSnapshots() } as never)
          break
        case "sshDisconnect":
          this.sshService?.disconnect(m.profileName)
          if (this.sshService) this.postMessage({ type: "sshSessionsUpdated", sessions: this.sshService.getSessionSnapshots() } as never)
          break
        case "sshOpenTerminal":
          await this.sshService?.openTerminal(m.profileName)
          break
        case "sshBrowseFiles":
          // listFiles() returns void and emits a "filesListed" event, which is
          // forwarded to the webview by the SSH event relay in setV4Services().
          // No manual postMessage needed here — the event bridge handles it.
          await this.sshService?.listFiles(m.profileName, m.path ?? "/")
          break
        case "sshFileOpen":
          await this.sshService?.openRemoteFile(m.profileName, m.remotePath)
          break
        case "sshFileDownload":
          await this.sshService?.downloadFile(m.profileName, m.remotePath)
          break
        case "sshFileUpload":
          await this.sshService?.uploadFile(m.profileName, m.remotePath)
          break
        case "sshFilePreview":
          if (this.sshService) {
            const preview = await this.sshService.getFilePreview(m.profileName, m.remotePath)
            this.postMessage({ type: "sshFilePreviewResult", profileName: m.profileName, remotePath: m.remotePath, content: preview } as never)
          }
          break
        case "sshFileDiff":
          await this.sshService?.diffRemoteFile(m.profileName, m.localPath, m.remotePath)
          break
        case "sshFileSaveRemote":
          await this.sshService?.saveRemoteFile(m.profileName, m.localPath, m.remotePath, m.confirmAndUpload ?? false)
          break
        case "sshGetErrors":
          if (this.sshService) {
            const errors = this.sshService.getLastErrors(m.profileName)
            this.postMessage({ type: "sshErrors", errors: errors.map((e: { message: string; code: string; profileName: string; timestamp: number }) => ({ message: e.message, code: e.code, profileName: e.profileName, timestamp: e.timestamp })) } as never)
          }
          break
        case "sshTailLogs":
          if (m.action === "stop") this.sshService?.stopLogTail(m.profileName)
          else this.sshService?.startLogTail(m.profileName, m.service)
          break
        case "sshImportConfig":
          if (this.sshService) {
            await this.sshService.importFromSSHConfig()
            this.postMessage({ type: "sshProfilesLoaded", profiles: this.sshService.getProfiles() } as never)
          }
          break

        // VPS
        case "requestVPSServers":
        case "requestVpsServers":
        case "vpsServerAdd":
        case "vpsServerRemove":
        case "vpsRefreshMetrics":
        case "vpsServiceAction":
        case "vpsDockerAction":
        case "vpsDeploy":
        case "vpsRollback":
        case "vpsBackup":
        case "vpsGetReverseProxyConfigs":
        case "vpsAddReverseProxyConfig":
        case "vpsRemoveReverseProxyConfig":
        case "vpsTestReverseProxyConfig":
          if (this.vpsService) {
            await this.vpsService.handleMessage(message, (msg) => this.postMessage(msg as never))
          }
          break

        // ZeroClaw
        case "requestZeroClawTasks":
          if (this.zeroClawService) this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
          break
        case "zeroClawSubmitTask":
          if (this.zeroClawService) {
            try {
              // Tab sends fields at top level (description, projectPath, riskLevel, etc.)
              const submission = m.task ?? {
                description: m.description,
                projectPath: m.projectPath,
                riskLevel: m.riskLevel,
                workspaceScope: m.workspaceScope,
                networkPolicy: m.networkPolicy,
                writePolicy: m.writePolicy,
                limits: m.limits,
              }
              const submitted = this.zeroClawService.submit(submission)
              this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
              this.postMessage({ type: "zeroClawTaskUpdated", task: submitted } as never)
            } catch (err) {
              this.postMessage({ type: "zeroClawError", error: err instanceof Error ? err.message : "Task submission failed" } as never)
            }
          }
          break
        case "zeroClawCancelTask":
          this.zeroClawService?.cancel(m.taskId)
          if (this.zeroClawService) this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
          break
        case "zeroClawRetryTask":
          if (this.zeroClawService) {
            try {
              const retried = this.zeroClawService.retry(m.taskId)
              this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
              if (retried) {
                this.postMessage({ type: "zeroClawTaskRetried", newTask: retried } as never)
              } else {
                vscode.window.showWarningMessage("Retry budget exhausted — task has reached the maximum retry limit.")
              }
            } catch (err) {
              this.postMessage({ type: "zeroClawError", error: err instanceof Error ? err.message : "Retry failed" } as never)
            }
          }
          break
        case "zeroClawApproveTask":
          this.zeroClawService?.approve(m.taskId, m.approver ?? "operator")
          if (this.zeroClawService) this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
          break
        case "zeroClawRejectTask":
          this.zeroClawService?.reject(m.taskId, m.reason ?? "rejected")
          if (this.zeroClawService) this.postMessage({ type: "zeroClawTasksLoaded", tasks: this.zeroClawService.getAllTasks() } as never)
          break
        case "zeroClawGetHistory":
          if (this.zeroClawService) {
            try {
              this.postMessage({ type: "zeroClawHistoryLoaded", tasks: this.zeroClawService.getHistory() } as never)
              // Also bootstrap the tab with a default task context so the form can pre-populate on mount.
              const defaultContext = this.zeroClawService.getDefaultTaskContext()
              this.postMessage({ type: "zeroClawContext", context: defaultContext } as never)
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err)
              this.postMessage({ type: "zeroClawError", error: `zeroClawGetHistory failed: ${errMsg}` } as never)
            }
          }
          break
        case "zeroClawGetTaskResult":
          if (this.zeroClawService) {
            const result = this.zeroClawService.getTaskResult(m.taskId)
            this.postMessage({ type: "zeroClawTaskResult", result } as never)
          }
          break
        case "zeroClawCollectArtifacts":
          if (this.zeroClawService) {
            const artifacts = await this.zeroClawService.collectArtifacts(m.taskId)
            this.postMessage({ type: "zeroClawArtifacts", artifacts } as never)
          }
          break

        // Routing
        case "requestRoutingState":
          if (this.routingService) {
            // Send current state immediately
            this.postMessage({ type: "routingProvidersLoaded", providers: this.routingService.getProviders() } as never)
            this.postMessage({ type: "routingConfigLoaded", config: this.routingService.getConfig() } as never)
            this.postMessage({ type: "routingHealthLoaded", health: this.routingService.getHealthSummary(), providers: this.routingService.getProviders() } as never)
            this.postMessage({ type: "routingTracesLoaded", traces: this.routingService.getTraces() } as never)
            // Kick off a background health re-check for local providers so Ollama/LM Studio
            // show "healthy" within seconds of tab open (non-blocking — results stream in)
            const routing = this.routingService
            void Promise.all([
              routing.testProvider("ollama").catch(() => false),
              routing.testProvider("lmstudio").catch(() => false),
            ]).then(() => {
              this.postMessage({ type: "routingProvidersLoaded", providers: routing.getProviders() } as never)
              this.postMessage({ type: "routingHealthLoaded", health: routing.getHealthSummary(), providers: routing.getProviders() } as never)
            })
          }
          break
        case "routingTestProvider":
          if (this.routingService) {
            const testSuccess = await this.routingService.testProvider(m.providerId)
            this.postMessage({ type: "routingTestResult", providerId: m.providerId, success: !!testSuccess } as never)
            this.postMessage({ type: "routingProvidersLoaded", providers: this.routingService.getProviders() } as never)
            this.postMessage({ type: "routingHealthLoaded", health: this.routingService.getHealthSummary(), providers: this.routingService.getProviders() } as never)
          }
          break
        case "routingConfigureKey":
          if (this.routingService) {
            // Pass the actual API key string to SecretStorage — not just a boolean
            await this.routingService.configureApiKey(m.providerId, m.apiKey ?? undefined)
            this.postMessage({ type: "routingKeyConfigured", providerId: m.providerId, configured: !!m.apiKey } as never)
            this.postMessage({ type: "routingProvidersLoaded", providers: this.routingService.getProviders() } as never)
          }
          break
        case "routingSetRole":
          this.routingService?.setRole(m.providerId, m.role, m.enabled)
          if (this.routingService) this.postMessage({ type: "routingProvidersLoaded", providers: this.routingService.getProviders() } as never)
          break
        case "routingSetMode":
          // This message type is overloaded: it can carry mode, privacyMode, or costThreshold
          if (this.routingService) {
            if (m.mode) this.routingService.setMode(m.mode)
            if (m.privacyMode) this.routingService.setPrivacyMode(m.privacyMode)
            if (m.costThreshold !== undefined) this.routingService.setCostThreshold(m.costThreshold)
            this.postMessage({ type: "routingConfigLoaded", config: this.routingService.getConfig() } as never)
          }
          break
        case "routingSetFallbackOrder":
          this.routingService?.setFallbackOrder(m.order)
          if (this.routingService) this.postMessage({ type: "routingConfigLoaded", config: this.routingService.getConfig() } as never)
          break
        case "routingGetTraces":
          if (this.routingService) this.postMessage({ type: "routingTracesLoaded", traces: this.routingService.getTraces() } as never)
          break
        case "routingGetHealth":
          if (this.routingService) this.postMessage({ type: "routingHealthLoaded", health: this.routingService.getHealthSummary(), providers: this.routingService.getProviders() } as never)
          break

        // Memory
        case "memoryGetStatus":
          if (this.memoryService) this.postMessage({ type: "memoryStatusLoaded", ...this.memoryService.getStatus() } as never)
          break
        case "memoryRecall":
          if (this.memoryService) {
            try {
              const recallResult = this.memoryService.recall(m.query, { project: m.project })
              // Tab expects flat properties: results (array), status, query — not nested RecallResult
              this.postMessage({ type: "memoryRecallResult", results: recallResult.results, status: recallResult.status, query: recallResult.query, project: recallResult.project, timestamp: recallResult.timestamp } as never)
            } catch (err) {
              this.postMessage({ type: "memoryRecallResult", results: [], status: "failed", query: m.query ?? "", project: m.project, timestamp: Date.now() } as never)
            }
          }
          break
        case "memoryWrite":
          if (this.memoryService) {
            try {
              // Tab sends individual fields (summary, content, factType, scope, project)
              const writeEntry = m.entry ?? {
                summary: m.summary,
                content: m.content,
                factType: m.factType,
                scope: m.scope,
                project: m.project,
              }
              this.memoryService.writeMemory(writeEntry)
              this.postMessage({ type: "memoryWriteResult", success: true } as never)
              // Refresh history after successful write
              this.postMessage({ type: "memoryHistoryLoaded", records: this.memoryService.getWriteHistory() } as never)
            } catch (err) {
              this.postMessage({ type: "memoryWriteResult", success: false, error: err instanceof Error ? err.message : "Write failed" } as never)
            }
          }
          break
        case "memoryReconnect":
          await this.memoryService?.reconnect()
          if (this.memoryService) {
            const status = this.memoryService.getStatus()
            this.postMessage({ type: "memoryStatusLoaded", ...status } as never)
            this.postMessage({ type: "memoryConnectionChanged", connection: status.connection } as never)
          }
          break
        case "memoryGetHistory":
          if (this.memoryService) this.postMessage({ type: "memoryHistoryLoaded", records: this.memoryService.getWriteHistory() } as never)
          break
        case "memorySetPermission":
          if (this.memoryService) {
            const updatedPerm = this.memoryService.setPermission(m.agentId, m.scope, m.allowed)
            // Tab expects full AgentPermission with { agentId, scopes: { global, project, task } }
            this.postMessage({ type: "memoryPermissionChanged", permission: updatedPerm ?? { agentId: m.agentId, scopes: { global: m.scope === "global" ? m.allowed : false, project: m.scope === "project" ? m.allowed : false, task: m.scope === "task" ? m.allowed : false } } } as never)
          }
          break
        case "memoryRunDiagnostics":
          if (this.memoryService) {
            try {
              const diagResult = await this.memoryService.runDiagnostics()
              this.postMessage({ type: "memoryDiagnosticResult", result: diagResult } as never)
            } catch (err) {
              this.postMessage({ type: "memoryDiagnosticResult", result: { passed: false, tests: [], error: err instanceof Error ? err.message : "Diagnostics failed" } } as never)
            }
          }
          break
        case "memoryGetRecallTraces":
          if (this.memoryService) {
            this.postMessage({ type: "memoryRecallTracesLoaded", traces: this.memoryService.getAgentRecallTraces() } as never)
          }
          break

        // Training
        case "requestTrainingState":
        case "trainingGetJobs":
          if (this.trainingService) {
            const cached = this.trainingService.getCachedGPUs()
            this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: cached } as never)
            // If no GPUs cached yet, kick off auto-detect in background so the tab auto-populates
            if (cached.length === 0) {
              const training = this.trainingService
              void training.detectGPUs().then((gpus) => {
                this.postMessage({ type: "trainingGPUDetected", gpus } as never)
                this.postMessage({ type: "trainingState", datasets: training.getDatasets(), jobs: training.getJobs(), gpus } as never)
              }).catch((err) => {
                console.warn("[KiloProvider] Auto GPU detect failed:", err)
              })
            }
          }
          break
        case "trainingRegisterDataset":
          if (this.trainingService) {
            this.trainingService.registerDataset(m.name, m.sourcePath, m.format)
            const allDs = this.trainingService.getDatasets()
            const newDs = allDs[allDs.length - 1]
            // Tab expects trainingDatasetRegistered to clear the form
            this.postMessage({ type: "trainingDatasetRegistered", dataset: newDs } as never)
            this.postMessage({ type: "trainingState", datasets: allDs, jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
          }
          break
        case "trainingValidateDataset":
          if (this.trainingService) {
            await this.trainingService.validateDataset(m.datasetId)
            const validated = this.trainingService.getDatasets().find(d => d.id === m.datasetId)
            // Tab expects trainingDatasetValidated to clear the validating spinner
            if (validated) this.postMessage({ type: "trainingDatasetValidated", dataset: validated } as never)
            this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
          }
          break
        case "trainingLaunchJob":
          if (this.trainingService) {
            try {
              // Tab sends individual fields (name, preset, datasetId, etc.), not m.config
              const jobConfig = m.config ?? {
                name: m.name,
                preset: m.preset,
                datasetId: m.datasetId,
                target: m.target,
                hyperparams: m.hyperparams,
                resourceLimits: m.resourceLimits,
              }
              this.trainingService.launchJob(jobConfig)
              const launched = this.trainingService.getJobs().at(-1)
              this.postMessage({ type: "trainingJobLaunched", job: launched } as never)
              this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Launch failed" } as never)
            }
          }
          break
        case "trainingPauseJob":
          this.trainingService?.pauseJob(m.jobId)
          if (this.trainingService) this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
          break
        case "trainingResumeJob":
          if (this.trainingService) {
            try {
              this.trainingService.resumeJob(m.jobId)
              this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Resume failed" } as never)
            }
          }
          break
        case "trainingCancelJob":
          if (this.trainingService) {
            try {
              this.trainingService.cancelJob(m.jobId)
              this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Cancel failed" } as never)
            }
          }
          break
        case "trainingRemoveDataset":
          if (this.trainingService) {
            this.trainingService.removeDataset(m.datasetId)
            this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
          }
          break
        case "trainingBrowsePath":
          if (this.trainingService) {
            const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: true, canSelectMany: false, openLabel: "Select training data" })
            if (chosen?.[0]) this.postMessage({ type: "trainingBrowsePathResult", path: chosen[0].fsPath } as never)
          }
          break
        case "trainingResumeCheckpoint":
          if (this.trainingService) {
            try {
              this.trainingService.resumeFromCheckpoint(m.jobId, m.checkpointId)
              this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: this.trainingService.getCachedGPUs() } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Checkpoint resume failed" } as never)
            }
          }
          break
        case "trainingCompareRuns":
          if (this.trainingService) {
            try {
              // Tab sends { jobIdA, jobIdB } as individual fields
              const idA = m.jobIdA ?? m.jobIds?.[0]
              const idB = m.jobIdB ?? m.jobIds?.[1]
              const comparison = this.trainingService.compareRuns(idA, idB)
              this.postMessage({ type: "trainingCompareResult", comparison } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Comparison failed" } as never)
            }
          }
          break
        case "trainingExportModel":
          if (this.trainingService) {
            try {
              // Tab sends { jobId, format } as individual fields
              const exportOpts = m.exportOptions ?? {
                jobId: m.jobId,
                format: m.format,
                quantization: m.quantization,
                outputPath: m.outputPath,
                includeTokenizer: m.includeTokenizer ?? true,
                includeConfig: m.includeConfig ?? true,
                includeReadme: m.includeReadme ?? true,
                mergeAdapter: m.mergeAdapter ?? false,
              }
              const exportResult = await this.trainingService.exportModel(exportOpts)
              this.postMessage({ type: "trainingExportComplete", exportResult } as never)
            } catch (err) {
              this.postMessage({ type: "trainingError", error: err instanceof Error ? err.message : "Export failed" } as never)
            }
          }
          break
        case "trainingDetectGPU":
          if (this.trainingService) {
            try {
              await this.trainingService.detectGPUs()
              const detectedGpus = this.trainingService.getCachedGPUs()
              // Always post trainingGPUDetected (even if empty array) so the tab clears its "Detecting..." state
              this.postMessage({ type: "trainingGPUDetected", gpus: detectedGpus ?? [] } as never)
              this.postMessage({ type: "trainingState", datasets: this.trainingService.getDatasets(), jobs: this.trainingService.getJobs(), gpus: detectedGpus ?? [] } as never)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.error("[KiloProvider] trainingDetectGPU failed:", msg)
              // Send both trainingError and trainingGPUDetected (empty) so the tab clears detecting state
              this.postMessage({ type: "trainingError", error: `GPU detection failed: ${msg}` } as never)
              this.postMessage({ type: "trainingGPUDetected", gpus: [] } as never)
            }
          } else {
            // No training service — still clear the detecting state
            this.postMessage({ type: "trainingGPUDetected", gpus: [] } as never)
          }
          break

        // Governance
        // Helper to send governance state to the webview (wrap in state property for tab)
        case "requestGovernanceState":
        case "governanceGetAuditLog":
          this.sendGovernanceState()
          break
        case "governanceSetTier": {
          const validTiers = ["observer", "operator", "admin", "superadmin"]
          if (!validTiers.includes(m.tier)) {
            this.postMessage({ type: "governanceError", error: `Invalid tier: "${m.tier}". Must be one of: ${validTiers.join(", ")}` } as never)
            break
          }
          // Tab sends { user }, not { userId }
          const userId = m.userId ?? m.user
          this.governanceService?.setUserTier(userId, m.tier, m.assignedBy ?? "operator")
          this.sendGovernanceState()
          break
        }
        case "governanceApproveAction":
          // Tab sends { approvalId, approvedBy }, not { actionId, approver }
          this.governanceService?.approveAction(
            m.actionId ?? m.approvalId,
            m.approver ?? m.approvedBy ?? "operator",
            m.reason,
          )
          this.sendGovernanceState()
          break
        case "governanceRejectAction":
          // Tab sends { approvalId, rejectedBy }, not { actionId, approver }
          this.governanceService?.rejectAction(
            m.actionId ?? m.approvalId,
            m.approver ?? m.rejectedBy ?? "operator",
            m.reason,
          )
          this.sendGovernanceState()
          break
        case "governanceAddDangerousAction":
          // Tab sends individual fields (name, description, minimumTier, requiresApproval), not m.action
          this.governanceService?.addDangerousAction(m.action ?? {
            name: m.name,
            description: m.description,
            severity: m.severity ?? "warning",
            minimumTier: m.minimumTier,
            requiresApproval: m.requiresApproval ?? true,
            blocked: m.blocked ?? false,
          })
          this.sendGovernanceState()
          break
        case "governanceToggleBlock":
          this.governanceService?.toggleActionBlock(m.actionId, m.blocked)
          this.sendGovernanceState()
          break
        case "governanceCreateVerdict":
          if (this.governanceService) {
            this.governanceService.createReleaseVerdict(m.scope, m.criticalDefects ?? 0, m.highDefects ?? 0, m.riskSummary ?? "", m.rollbackPlan ?? "", m.decision ?? "pass")
            this.sendGovernanceState()
          }
          break
        case "governanceExportAudit":
          if (this.governanceService) {
            const auditData = this.governanceService.getAuditLog()
            this.postMessage({ type: "governanceAuditExport", data: auditData } as never)
            this.sendGovernanceState()
          }
          break

        // ── Workstation Profile ──────────────────────────
        case "workstationGetProfile":
          if (this.workstationProfile) this.postMessage({ type: "workstationProfile", profile: this.workstationProfile.getProfile() } as never)
          break
        case "workstationGetHardware":
          if (this.workstationProfile) this.postMessage({ type: "workstationHardware", hardware: this.workstationProfile.getHardware() } as never)
          break
        case "workstationGetLimits":
          if (this.workstationProfile) this.postMessage({ type: "workstationLimits", limits: this.workstationProfile.getLimits() } as never)
          break
        case "workstationGetLocalAI":
          if (this.workstationProfile) this.postMessage({ type: "workstationLocalAI", localAI: this.workstationProfile.getLocalAI() } as never)
          break
        case "workstationGetRoutingPrefs":
          if (this.workstationProfile) this.postMessage({ type: "workstationRoutingPrefs", prefs: this.workstationProfile.getRoutingPreferences() } as never)
          break
        case "workstationShouldPreferLocal":
          if (this.workstationProfile) this.postMessage({ type: "workstationLocalPref", prefer: this.workstationProfile.shouldPreferLocal(m.taskType as string) } as never)
          break
        case "workstationGetModelLibrary":
          if (this.workstationProfile) this.postMessage({ type: "workstationModelLibrary", library: this.workstationProfile.getModelLibrary() } as never)
          break
        case "workstationGetModelsByCategory":
          if (this.workstationProfile) this.postMessage({ type: "workstationModelsForCategory", models: this.workstationProfile.getModelsByCategory(m.category as never) } as never)
          break
        case "workstationHasLoRAs":
          if (this.workstationProfile) this.postMessage({ type: "workstationLoRAStatus", available: this.workstationProfile.hasLoRAs() } as never)
          break
        case "workstationHasLocalTTS":
          if (this.workstationProfile) this.postMessage({ type: "workstationLocalTTSStatus", available: this.workstationProfile.hasLocalTTS() } as never)
          break
        case "workstationHasLocalSTT":
          if (this.workstationProfile) this.postMessage({ type: "workstationLocalSTTStatus", available: this.workstationProfile.hasLocalSTT() } as never)
          break
        case "workstationReload":
          if (this.workstationProfile) {
            this.workstationProfile.reload()
            this.postMessage({ type: "workstationProfile", profile: this.workstationProfile.getProfile() } as never)
          }
          break

        // ── Onboarding Discovery ──────────────────────────
        case "requestDiscoveryResult":
          if (this.discoveryService) {
            const result = await this.discoveryService.getCachedResult()
            this.postMessage({ type: "discoveryResult", result } as never)
          }
          break
        case "triggerDiscovery":
          if (this.discoveryService) {
            const result = await this.discoveryService.runFullDiscovery()
            this.postMessage({ type: "discoveryResult", result } as never)
            this.postMessage({ type: "discoveryComplete", result } as never)
          } else {
            // Discovery service not available — send empty result so wizard doesn't hang
            this.postMessage({ type: "discoveryError", error: "Discovery service not initialized" } as never)
          }
          break

        // ── Hermes Pipeline ───────────────────────────────
        case "requestHermesStatus":
          await this.handleHermesStatusRequest()
          break
        case "hermesToggle":
          await this.hermesStatusSvc?.toggle()
          await this.handleHermesStatusRequest()
          break
        case "hermesTestConnection":
          await this.hermesStatusSvc?.refresh()
          await this.handleHermesStatusRequest()
          break
        case "hermesSetApiKey": {
          const { saveKey } = await import("./services/hermes")
          if (this.extensionContext && typeof m.key === "string") {
            await saveKey(this.extensionContext, m.key)
            await this.handleHermesStatusRequest()
          }
          break
        }
        case "hermesClearApiKey": {
          const { clearKey } = await import("./services/hermes")
          if (this.extensionContext) {
            await clearKey(this.extensionContext)
            await this.handleHermesStatusRequest()
          }
          break
        }
        case "hermesUpdateConfig": {
          if (this.hermesStatusSvc && typeof m.key === "string") {
            const section = "kilo-code.new.hermes"
            const cfg = vscode.workspace.getConfiguration(section)
            await cfg.update(m.key as string, m.value, vscode.ConfigurationTarget.Global)
            await this.handleHermesStatusRequest()
          }
          break
        }
        case "requestHermesTasks":
          await this.handleHermesTasksRequest()
          break
        case "hermesSubmitTask":
          await this.handleHermesSubmitTask(message)
          break
        case "hermesApproveTask":
          if (this.hermesClientSvc && typeof m.taskId === "string") {
            try {
              const result = await this.hermesClientSvc.approve(m.taskId)
              this.postMessage({ type: "hermesTaskApproved", task: result } as never)
              await this.handleHermesTasksRequest()
            } catch (err) {
              this.postMessage({ type: "hermesError", message: err instanceof Error ? err.message : "Approve failed" } as never)
            }
          }
          break
        case "hermesCancelTask":
          if (this.hermesClientSvc && typeof m.taskId === "string") {
            try {
              const result = await this.hermesClientSvc.cancel(m.taskId)
              this.postMessage({ type: "hermesTaskCancelled", task: result } as never)
              await this.handleHermesTasksRequest()
            } catch (err) {
              this.postMessage({ type: "hermesError", message: err instanceof Error ? err.message : "Cancel failed" } as never)
            }
          }
          break
        case "hermesAgentAssist":
          await this.handleHermesAgentAssist()
          break
        default:
          // Defensive: isV4MessageType allowed it through but no case matches.
          return false
      }
      return true
    } catch (err) {
      console.error(`[Kilo New] KiloProvider: unhandled error in message handler for "${type}":`, err)
      // Safety net: send a generic error to the webview so it never hangs waiting for a response
      this.postMessage({ type: "v4Error", subsystem: type, error: err instanceof Error ? err.message : "Unknown error" } as never)
      return true
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Region E (Hermes private helpers) — moved from KiloProvider:3151-3239
  // ──────────────────────────────────────────────────────────────────

  private async handleHermesStatusRequest(): Promise<void> {
    if (!this.hermesStatusSvc || !this.hermesClientSvc || !this.extensionContext) {
      this.postMessage({ type: "hermesStatusUpdate", status: {
        enabled: false, baseUrl: "http://187.77.30.206:18789",
        approvalMode: "auto-low", workspaceScopeOnly: true,
        reachable: false, latency_ms: 0, keySource: "none",
      } } as never)
      return
    }
    const cfg = this.hermesStatusSvc.getConfig()
    const health = await this.hermesClientSvc.health(3000)
    const { keySource } = await import("./services/hermes")
    const src = await keySource(this.extensionContext)
    this.postMessage({ type: "hermesStatusUpdate", status: {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      approvalMode: cfg.approvalMode,
      workspaceScopeOnly: cfg.workspaceScopeOnly,
      reachable: health.bridge_reachable,
      latency_ms: health.latency_ms,
      version: health.version,
      keySource: src,
      error: health.error,
    } } as never)
  }

  private async handleHermesTasksRequest(): Promise<void> {
    this.postMessage({ type: "hermesTasksUpdate", tasks: [] } as never)
  }

  private async handleHermesSubmitTask(message: Record<string, unknown>): Promise<void> {
    if (!this.hermesClientSvc || !this.hermesStatusSvc) {
      this.postMessage({ type: "hermesError", message: "Hermes not initialized" } as never)
      return
    }
    const cfg = this.hermesStatusSvc.getConfig()
    if (!cfg.enabled) {
      this.postMessage({ type: "hermesError", message: "Hermes pipeline is disabled — enable it in Settings → Hermes" } as never)
      return
    }
    try {
      const { type: _t, ...rest } = message
      const envelope = {
        task_type: (rest.task_type as string) ?? "research",
        description: (rest.description as string) ?? "",
        evidence: (rest.evidence as unknown[]) ?? [],
        auto_approve: (rest.auto_approve as boolean) ?? (cfg.approvalMode === "auto-all"),
        workspace_scope_only: cfg.workspaceScopeOnly,
      }
      const created = await this.hermesClientSvc.postTask(envelope as never)
      this.postMessage({ type: "hermesTaskSubmitted", task: created } as never)
    } catch (err) {
      this.postMessage({ type: "hermesError", message: err instanceof Error ? err.message : "Task submission failed" } as never)
    }
  }

  private async handleHermesAgentAssist(): Promise<void> {
    if (!this.hermesStatusSvc?.getConfig().enabled) {
      this.postMessage({ type: "hermesError", message: "Enable Hermes pipeline before running Agent Assist" } as never)
      return
    }
    try {
      const { getSettingsAgentAPI } = await import("./services/SettingsAgentAPI")
      const api = getSettingsAgentAPI(this.extensionContext ?? undefined)
      const [fillResult, suggestions] = await Promise.all([
        api.autoFillAll(),
        api.getSuggestions(),
      ])
      const auditFindings: string[] = []
      const status = await api.getSettingsStatus()
      const providerValues = Object.values(status.providers ?? {})
      if (!providerValues.some((v) => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true))) {
        auditFindings.push("No providers are fully configured — add at least one API key")
      }
      if (!status.speech?.azureConfigured) {
        auditFindings.push("Azure Speech not configured — Speech tab needs region + key")
      }
      this.postMessage({ type: "hermesAgentAssistResult", result: {
        filled: fillResult.filled,
        failed: fillResult.failed,
        suggestions: suggestions.slice(0, 10).map((s) => s.reason ?? s.category ?? String(s)),
        auditFindings,
      } } as never)
    } catch (err) {
      this.postMessage({ type: "hermesError", message: err instanceof Error ? err.message : "Agent Assist failed" } as never)
    }
  }
}

/**
 * Cheap pre-filter so we don't pay the dispatch cost on every upstream
 * message — only V4 message types ever enter the dispatcher's switch.
 *
 * This is the SOURCE OF TRUTH for which message types are owned by the
 * DaveAI overlay vs. upstream. If you add a case in `handleV4Message`,
 * add its prefix here too.
 */
function isV4MessageType(type: string): boolean {
  return (
    type.startsWith("ssh") ||
    type.startsWith("requestSSH") ||
    type.startsWith("vps") ||
    type.startsWith("requestVPS") ||
    type.startsWith("requestVps") ||
    type.startsWith("zeroClaw") ||
    type.startsWith("zeroclaw") ||
    type.startsWith("requestZeroClaw") ||
    type.startsWith("routing") ||
    type.startsWith("requestRouting") ||
    type.startsWith("memory") ||
    type.startsWith("training") ||
    type.startsWith("requestTraining") ||
    type.startsWith("governance") ||
    type.startsWith("requestGovernance") ||
    type.startsWith("workstation") ||
    type.startsWith("requestDiscovery") ||
    type === "triggerDiscovery" ||
    type.startsWith("hermes") ||
    type.startsWith("requestHermes")
  )
}

/**
 * Bootstrap the DaveAI overlay onto an upstream `KiloProvider`.
 *
 * Call this exactly once, immediately after `new KiloProvider(...)`.
 * After installation, callers wire services via:
 *   ext.setHermesServices(status, client)
 *   ext.setV4Services({ ... })
 *   ext.broadcastDiscoveryComplete(result)
 *
 * The returned `DaveProviderExtensions` is also stored on
 * `(provider as any).__daveExtensions` so the upstream message-router
 * hook line can find it without any explicit reference to this module.
 */
export function installDaveExtensions(provider: KiloProvider): DaveProviderExtensions {
  const ext = new DaveProviderExtensions(provider)
  ;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions = ext
  return ext
}
