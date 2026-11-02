# Adapted T3 Code account code

Upstream: [pingdotgg/t3code](https://github.com/pingdotgg/t3code), pinned commit [`8760d063e903406c8e8f695b0852c0a15fc1e00f`](https://github.com/pingdotgg/t3code/commit/8760d063e903406c8e8f695b0852c0a15fc1e00f), retrieved 2026-11-01. Copyright (c) 2026 T3 Tools Inc. The complete MIT notice is retained in [LICENSE](LICENSE).

Copied/adapted portions:

| Upstream source | Harness adaptation | Original SHA-256 |
|---|---|---|
| [`ProviderCredentialStore.ts`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/server/src/provider/ProviderCredentialStore.ts), tuple hash and `provider-auth-` namespace | `packages/runtime/account-profile.ts`; Node crypto replaces Effect crypto | `c8e1cc5ba916703f33ba6079fabe313cc1e54dbd4c0699dcffef20ee49ed8105` |
| [`ChatGptAccountPicker.tsx`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/components/settings/ChatGptAccountPicker.tsx), account selection/fallback and radio composition | `apps/web/src/Connections.tsx`; existing harness controls and durable commands replace T3 UI/RPC | `7be76c21b514331c643864d4c32d07d84fa320265c9db2c1ba299f5ebd4f8a58` |

The integration adopts T3's separate provider-instance identity model. Harness Store metadata and its existing Pi/official runtime adapters supply account persistence, isolated native profiles, run/session pinning and cancellation. No Effect runtime, arbitrary environment settings, managed ChatGPT token broker, automatic account rotation or billing fallback was copied or enabled. Native subscription sign-in remains explicit.

License SHA-256: `935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43`. Desktop packaging retains this directory under `resources/host/third-party/t3code`.
