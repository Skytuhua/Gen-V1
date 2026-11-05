import { HarnessError, type ModelInfo } from "../contracts/index.ts";
import { loadSdk, type PiSdk } from "./sdk.ts";
import type {CreateAgentSessionOptions} from '@earendil-works/pi-coding-agent';
import { SUBSCRIPTION_PROVIDER_IDS, SUBSCRIPTION_OAUTH_PROVIDER_IDS, SUBSCRIPTION_PLAN_PROVIDER_IDS, isSubscriptionProviderId, type SubscriptionProviderId } from '../contracts/connections.ts';
import { isPlanCredential, isPlanProvider, registerPlanKeyProvider } from './plan-keys.ts';
import { createLiteralCredentialStore } from './credentials.ts';
export function thinkingForModel(model:{thinkingLevelMap?:Record<string,unknown>},level?:string|null):CreateAgentSessionOptions['thinkingLevel']{
  if(level===undefined)return undefined;
  if(level===null)return 'medium'; // Explicit Default resets a resumed session; SDK clamps to model capabilities.
  if(!model.thinkingLevelMap||!Object.hasOwn(model.thinkingLevelMap,level)||model.thinkingLevelMap[level]==null)throw new HarnessError('PI_MODEL_UNAVAILABLE','The selected reasoning level is not supported by this model.');
  return level as CreateAgentSessionOptions['thinkingLevel'];
}

export const SUBSCRIPTION_PROVIDERS = SUBSCRIPTION_PROVIDER_IDS;
export const AUTH_HELP = "Subscription authentication is unavailable. Run pnpm agent:login using the same data directory and choose an available OAuth or dedicated plan-key connection, then refresh models. No app-side API billing fallback; provider Extra Usage still applies.";

export async function createSubscriptionRuntime(authPath: string, options: { provider?: SubscriptionProviderId; tolerateUnavailable?: boolean } = {}) {
  const sdk = await loadSdk();
  const credentials = await createLiteralCredentialStore(authPath);
  const stored = new Map(await Promise.all(SUBSCRIPTION_PROVIDERS.filter(id => !options.provider || options.provider === id).map(async id => [id, await credentials.read(id)] as const)));
  const oauth = SUBSCRIPTION_OAUTH_PROVIDER_IDS.filter(id => stored.get(id)?.type === 'oauth');
  const plans = SUBSCRIPTION_PLAN_PROVIDER_IDS.filter(id => isPlanCredential(id, stored.get(id)));
  const candidates = [...oauth, ...plans], eligible: SubscriptionProviderId[] = [];
  if (!candidates.length) throw new HarnessError("PI_AUTH_REQUIRED", AUTH_HELP);
  const runtime = await sdk.ModelRuntime.create({ authPath, credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  let unavailable: unknown;
  for (const id of candidates) {
    try {
      if (isPlanProvider(id)) await registerPlanKeyProvider(runtime, id, { authPath, readStoredCredential: sdk.readStoredCredential });
      else {
        const provider = runtime.getProvider(id);
        if (!provider?.auth.oauth?.isSubscription) throw new HarnessError("PI_AUTH_REQUIRED", AUTH_HELP);
        // Remove API-key resolution itself, so lost/expired OAuth cannot switch billing modes.
        runtime.registerNativeProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
      }
      eligible.push(id);
    } catch (error) { if (!options.tolerateUnavailable) throw error; unavailable ??= error; }
  }
  if (!eligible.length) throw unavailable ?? new HarnessError("PI_AUTH_REQUIRED", AUTH_HELP);
  return { sdk, runtime, eligible };
}

export async function subscriptionModels(authPath: string): Promise<ModelInfo[]> {
  const { runtime, eligible } = await createSubscriptionRuntime(authPath, { tolerateUnavailable: true });
  const result: ModelInfo[] = [];
  let unavailable: unknown;
  for (const provider of eligible) {
    try {
      const models = await runtime.getAvailable(provider);
      for (const model of models) result.push({ id: `${model.provider}/${model.id}`, provider: model.provider, name: model.name,
        thinkingLevels: model.thinkingLevelMap ? Object.entries(model.thinkingLevelMap).filter(([, value]) => value !== null).map(([key]) => key) : undefined });
    } catch (error) { unavailable ??= error; }
  }
  if (!result.length) throw unavailable ?? new HarnessError("PI_AUTH_REQUIRED", AUTH_HELP);
  return result;
}

export async function selectSubscriptionModel(authPath: string, modelId: string) {
  const slash = modelId.indexOf("/");
  const provider = modelId.slice(0, slash), id = modelId.slice(slash + 1);
  if (slash < 1 || !isSubscriptionProviderId(provider)) throw new HarnessError("PI_MODEL_UNAVAILABLE", `The selected subscription model is unavailable. ${AUTH_HELP}`);
  const { sdk, runtime, eligible } = await createSubscriptionRuntime(authPath, { provider });
  if (!eligible.includes(provider)) throw new HarnessError("PI_MODEL_UNAVAILABLE", `The selected subscription model is unavailable. ${AUTH_HELP}`);
  const model = runtime.getModel(provider, id);
  if (!model) throw new HarnessError("PI_MODEL_UNAVAILABLE", "The selected model is not in the installed Pi SDK catalog. Refresh the model list and select an available subscription model.");
  const auth = await runtime.checkAuth(provider);
  if (auth?.type !== (isPlanProvider(provider) ? 'api_key' : 'oauth')) throw new HarnessError("PI_AUTH_REQUIRED", AUTH_HELP);
  const available = await runtime.getAvailable(provider);
  if (!available.some(candidate => candidate.provider === provider && candidate.id === id)) throw new HarnessError("PI_MODEL_UNAVAILABLE", "The selected model is unavailable for this subscription account. Refresh models and choose an available model.");
  return { sdk, runtime, model };
}

export type SubscriptionRuntime = Awaited<ReturnType<PiSdk["ModelRuntime"]["create"]>>;
