# Cursor subscription adapter

Status: implemented, independently reviewed and admitted as a preview connection in [verified v0.5.0](../evidence/cursor-subscription-20261031/report.md). Clean installation, complete payload/provider custody, native windows, two installed launches and owned uninstall pass. Live account/full local-executor inference acceptance remains separate.

The user requested broad subscription coverage while keeping the local T3-style harness, resource broker, durable state and cancellation. Extend the existing official-runtime adapter with the published `@cursor/sdk` 1.0.38. Keep Service, RuntimeAdapter, operation approval and the authenticated host MCP contract unchanged. The SDK documents embedding in compiled apps and requires its corresponding native platform package; retain its license and third-party notices.

## Boundaries

- Canonical provider ID: `cursor-sdk`; native model IDs are namespaced under it.
- One fixed Cursor worker imports the SDK only after receiving the existing allowlisted private environment. No inherited Cursor/provider API keys, proxies, custom endpoints or Node injection.
- Authentication uses only the official browser login and a private SDK credential store with login provenance. The resulting first-party user key is not copied from another application or supplied through task IPC. SDK runs use the Cursor user's plan; paid tier and remaining allowance stay unavailable unless actually reported. Provider overage settings still apply.
- New and resumed agents always receive `tools: ['mcp']`, `local.settingSources: []`, a private task directory/history store and the sole authenticated host MCP server. No native filesystem, shell, task/subagent or ambient MCP configuration is enabled.
- Validate the selected model against the fresh account-specific native catalog before task input. Admit only supported model parameters. No automatic model or generic billing fallback.
- Register workers with the existing authority before awaiting startup. Revoke host/MCP authority before cancellation, then use bounded graceful close and existing owned process-tree termination.
- Preserve native agent/session identity and host input envelopes. Successful IPC writes or user echoes alone are not delivery receipts. Reconcile only matching leading envelopes in canonical native user history; unresolved input stays uncertain. Reject old-context input after settlement.
- The SDK has concurrent interaction and tool-execution lanes. Its native `user-message-appended` callback must match the active session and exact submitted envelope. A provider-local authenticated MCP forwarding gate waits for the parent's durable input acknowledgment before forwarding tools. Canonical native history remains the recovery source; a normalized stream echo is insufficient.
- Compaction stays explicitly unsupported until a native documented operation and terminal evidence are verified.
- Discovery must not create a task agent or receive its MCP credentials. Cache/coalesce through existing discovery controls; skip absent private Cursor login state. No idle workers.

## Ownership and shared exports

The Cursor implementation owns new `packages/runtime-official/cursor*.ts` files and focused Cursor tests. It exports:

```ts
openCursor(ctx: DriverContext, spawnChild: typeof spawn, modelId?: string, maintenance?: boolean): Promise<OfficialDriver>
discoverCursor(dataDir: string, spawnChild: typeof spawn): Promise<ModelInfo[]>
cursorHistory(dataDir: string, manifest: ManifestState, spawnChild: typeof spawn): Promise<HistoryReceipt[]>
cursorLogin(dataDir: string): Promise<void>
```

The shared integration owns provider IDs, explicit official-runtime branches, environment/command resolution, manifest guards, routing and fixed login dispatch. The parent owns dependency/lockfile and package custody changes. Coordinate any necessary export change before editing another owner's files.

## Acceptance

Prove poisoned ambient keys/settings/plugins cannot change authentication or tools; private official-login provenance; fresh model validation; MCP-only configuration on both create/resume; exact session/input receipt ownership; startup/active/discovery cancellation with no orphan helpers; history-only reconciliation; unsupported compaction; and error/secret redaction. Use meaningful failing regressions before implementation and the actual installed SDK with network forbidden for bootstrap/config probes.

Before enabling a release, independently review the coherent changes, run relevant existing runtime/router/login/storage/MCP tests and full checks, verify the complete Windows SDK/helper distribution in the installed application, and measure payload/startup effects. Live account sign-in/inference/resume remain a separate acceptance gate. No account credentials or model requests are needed for source development.

## Primary sources

- [Official SDK and billing/auth/config/bundling documentation](https://cursor.com/docs/sdk/typescript)
- [Pinned package metadata](https://registry.npmjs.org/@cursor%2Fsdk/1.0.38)
- [T3's pinned SDK dependency](https://github.com/pingdotgg/t3code/blob/15fe2832727893cbdd2214383f9f971474849695/packages/provider-cursor/package.json)
- [Cursor terms referenced by the published SDK license](https://cursor.com/terms-of-service)

OpenCode Go already supplies the named subscription endpoint; a duplicate OpenCode engine is not added. Native OpenCode, Antigravity and Muse retain their documented auth/bootstrap/tool admission gaps. Their pending status does not mean that Windows runtimes or tool filtering are absent.
