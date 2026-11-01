import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadSdk, safeError } from "./sdk.ts";
import { requireSubscriptionProvider, subscriptionInteraction, subscriptionProviderLabel, validateSubscriptionAuthUrl } from './connections.ts';
import { taskPaths } from "./session.ts";
import { isPlanProvider, registerPlanKeyProvider } from './plan-keys.ts';
import { createLiteralCredentialStore } from './credentials.ts';

type Interaction = Parameters<ModelRuntime["login"]>[2];
export async function getOrCreateDeviceId(dataDir: string): Promise<string> {
  const { agentDir } = taskPaths(dataDir, "login");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const path = join(agentDir, "device-id");
  try { return validateDeviceId(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const id = randomUUID(), temporary = join(agentDir, `.device-id-${id}.tmp`);
  await writeFile(temporary, id, { flag: "wx", mode: 0o600 });
  try {
    try { await link(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return validateDeviceId(await readFile(path, "utf8"));
  } finally { await unlink(temporary); }
}
function validateDeviceId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("The Pi installation device ID is invalid. Restore dataDir/pi/device-id before signing in.");
  return id;
}

export async function loginSubscription({ dataDir, interaction, provider = "openai" }: { dataDir: string; interaction: Interaction; provider?: string }): Promise<void> {
  const selected = requireSubscriptionProvider(provider);
  const sdk = await loadSdk();
  const { agentDir, authPath } = taskPaths(dataDir, "login");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const credentials = await createLiteralCredentialStore(authPath);
  const runtime = await sdk.ModelRuntime.create({ authPath, credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  if (isPlanProvider(selected)) {
    await registerPlanKeyProvider(runtime, selected, { authPath, readStoredCredential: sdk.readStoredCredential, login: true });
    await runtime.login(selected, 'api_key', interaction);
    await chmod(authPath, 0o600);
    return;
  }
  const deviceId = await getOrCreateDeviceId(dataDir);
  if (!runtime.getProvider(selected)?.auth.oauth?.isSubscription) throw new Error("The installed Pi SDK does not support subscription login for this provider.");
  await runtime.login(selected, "oauth", subscriptionInteraction(selected, interaction), { agentName: "Generative Harness", getDeviceId: () => deviceId });
  await chmod(authPath, 0o600);
}

/** Raw terminal input prevents pasted redirect codes and credentials from echoing. */
function hiddenPrompt(message: string, signal?: AbortSignal): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || !stdin.setRawMode) return Promise.reject(new Error("Run pnpm agent:login in an interactive terminal. Authorization codes are never accepted through app/browser logs or echoed input."));
  process.stderr.write(message + " ");
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    let value = "";
    const cleanup = () => { stdin.removeListener("data", onData); signal?.removeEventListener("abort", abort); stdin.setRawMode(wasRaw); stdin.pause(); process.stderr.write("\n"); };
    const abort = () => { cleanup(); reject(new Error("Login prompt cancelled.")); };
    const onData = (data: Buffer) => {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003" || char === "\u001b") { abort(); return; }
        if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
        if (char === "\b" || char === "\u007f") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    if (signal?.aborted) { abort(); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.on("data", onData); signal?.addEventListener("abort", abort, { once: true });
  });
}
function openSignIn(url: string, provider: string, kind: 'auth_url' | 'device_code') {
  const validated = validateSubscriptionAuthUrl(provider, url, kind);
  const binary = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", validated] : [validated];
  execFile(binary, args, { windowsHide: true }, error => { if (error) process.stderr.write("Open the sign-in URL above in your system browser.\n"); });
}

export async function loginMain(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' || args[i] === '--data-dir') { if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing login option value.'); }
    else if (!['--help', '--no-open'].includes(args[i])) throw new Error('Unsupported login argument. Keys are accepted only through hidden interactive terminal input.');
  }
  if (args.includes("--help")) { process.stderr.write("pnpm agent:login [--data-dir PATH] [--provider openai|openai-codex|github-copilot|xai|kimi-coding|opencode-go] [--no-open]\nStores subscription OAuth or a dedicated plan key in dataDir/pi/auth.json. Default: openai. GitHub.com only. Kimi Code membership is for personal interactive coding only. Go key storage does not prove entitlement. No app-side API billing fallback; provider Extra Usage still applies.\n"); return; }
  const option = (name: string) => { const position = args.indexOf(name); if (position < 0) return undefined; const value = args[position + 1]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`); return value; };
  const dataDir = resolve(option("--data-dir") ?? process.env.HARNESS_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? homedir(), "GenerativeHarness"));
  const provider = requireSubscriptionProvider(option("--provider") ?? "openai");
  const label = subscriptionProviderLabel(provider);
  const control = new AbortController();
  const stop = () => control.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  process.stderr.write(`Sign in with ${label}. Credentials stay in ${taskPaths(dataDir, "login").authPath}.\nNo app-side API billing fallback; provider Extra Usage still applies.\n`);
  try {
    await loginSubscription({ dataDir, provider, interaction: {
      signal: control.signal,
      async prompt(prompt) {
        const signal = prompt.signal ? AbortSignal.any([prompt.signal, control.signal]) : control.signal;
        if (prompt.type === "select") {
          process.stderr.write(prompt.options.map((item, i) => `${i + 1}. ${item.label}`).join("\n") + "\n");
          const value = await hiddenPrompt(prompt.message + " [1]", signal);
          const selected = value === "" ? 0 : Number(value) - 1;
          if (!Number.isInteger(selected) || !prompt.options[selected]) throw new Error("Invalid login option.");
          return prompt.options[selected].id;
        }
        return hiddenPrompt(prompt.message + " (input hidden)", signal);
      },
      notify(event) {
        if (event.type === "auth_url") { process.stderr.write(`${label} sign-in: ${event.url}\n`); if (!args.includes("--no-open")) openSignIn(event.url, provider, event.type); }
        else if (event.type === "device_code") { process.stderr.write(`Open ${event.verificationUri} and enter the temporary device code ${event.userCode}.\n`); if (!args.includes('--no-open')) openSignIn(event.verificationUri, provider, event.type); }
        else process.stderr.write(safeError(new Error(event.message)) + "\n");
      },
    } });
    process.stderr.write(`${label} connection saved. Refresh the harness model list.\n`);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void loginMain().catch(error => { process.stderr.write(safeError(error) + "\n"); process.exitCode = 1; });
}
