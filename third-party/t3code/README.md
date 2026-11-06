# Adapted T3 Code presentation and account code

Upstream: [pingdotgg/t3code](https://github.com/pingdotgg/t3code), pinned commit [`8760d063e903406c8e8f695b0852c0a15fc1e00f`](https://github.com/pingdotgg/t3code/commit/8760d063e903406c8e8f695b0852c0a15fc1e00f), retrieved 2026-11-01. Copyright (c) 2026 T3 Tools Inc. The complete MIT notice is retained in [LICENSE](LICENSE).

Copied/adapted portions:

| Upstream source | Harness adaptation | Original SHA-256 |
|---|---|---|
| [`ProviderCredentialStore.ts`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/server/src/provider/ProviderCredentialStore.ts), tuple hash and `provider-auth-` namespace | `packages/runtime/account-profile.ts`; Node crypto replaces Effect crypto | `c8e1cc5ba916703f33ba6079fabe313cc1e54dbd4c0699dcffef20ee49ed8105` |
| [`ChatGptAccountPicker.tsx`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/components/settings/ChatGptAccountPicker.tsx), account selection/fallback and radio composition | `apps/web/src/Connections.tsx`; existing harness controls and durable commands replace T3 UI/RPC | `7be76c21b514331c643864d4c32d07d84fa320265c9db2c1ba299f5ebd4f8a58` |
| [`settingsLayout.tsx`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/components/settings/settingsLayout.tsx), lines 209–265, 445–502, 548–587 | `Settings.tsx` and `settings.css`: section headings, responsive label/control rows and independently scrolling content. Harness commands replace scoped T3 RPC. | `2129709e4e6bc6017bc24282326bc23ae5834c6ee204ee254860f927fa7045b0` |
| [`SettingsSidebarNav.tsx`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/components/settings/SettingsSidebarNav.tsx), lines 113–146, 211–338 | `Settings.tsx`: local search, current-section state and focus visibility. Twelve supported sections replace the upstream inventory; no T3 authentication, services or router copied. | `b89043690e92fb7d5c3545a0bb7a3c1896aa84762ef41291e940f54181e7cc9f` |
| [`_chat.settings.tsx`](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/apps/web/src/routes/_chat.settings.tsx), lines 109–149 | Parent-modal child layout, sidebar/content split and fixed header contract; Harness shared Modal owns focus and modality. | `bd646519cd3ad8ef6546a44046befca8cb8db86eba2b0b5633b4b96132440d3f` |

The integration adopts T3's separate provider-instance identity model. Harness Store metadata and its existing Pi/official runtime adapters supply account persistence, isolated native profiles, run/session pinning and cancellation. No Effect runtime, arbitrary environment settings, managed ChatGPT token broker, automatic account rotation or billing fallback was copied or enabled. Native subscription sign-in remains explicit.

License SHA-256: `935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43`. Desktop packaging retains this directory under `resources/host/third-party/t3code`.

The settings source files and license were rechecked at this exact pin on 2026-11-06 UTC. These are selective presentation adaptations, not a complete source port or latest-upstream parity claim. About & Licenses exposes the T3 attribution; the full unchanged MIT notice remains in LICENSE.
