# Issue #1392 — Windows real-device acceptance evidence (A4/A6)

Worker: `devin-t3win-95159c` · Role: verification · Host: Windows desktop, Electron app
Branch verified: `devin/1392-read-aloud` @ `2b30830830e7268ec16b71d33bbb29db21efeaa9` (PR #1450 head)
Session date: 2026-07 (UTC). No product code was modified by this verification.

## Method

- Launched the real desktop shell (`electron.exe dist/desktop-app/main.mjs`) with
  `HARNESS_DESKTOP_NODE_PATH=C:\Program Files\nodejs\node.exe` (Node v24.14.0) and a
  local stub `RuntimeAdapter` injected via `HARNESS_STUB_RUNTIME` so a settled assistant
  reply (~1093 chars, incl. fenced code, links, table) could be seeded through the real
  HTTP command API. The stub emits no network/model traffic.
- Drove the real renderer over CDP (Playwright `connectOverCDP` on port 9222). Real
  `speechSynthesis` was instrumented to record every `speak()` call (text, voice, rate)
  and every utterance event (`start`/`boundary`/`end`/`error`), plus `cancel()`/`pause()`/
  `resume()` calls with timestamps. This is live-engine evidence, not a mock.

## Real Windows voice inventory (speechSynthesis.getVoices)

Six voices, all `localService: true`:
- Microsoft David — English (United States) — default
- Microsoft Mark — English (United States)
- Microsoft Zira — English (United States)
- Microsoft Hanhan — Chinese (Traditional, Taiwan)
- Microsoft Yating — Chinese (Traditional, Taiwan)
- Microsoft Zhiwei — Chinese (Traditional, Taiwan)

## Results — playback lifecycle (A6)

| Check | Result | Evidence |
|---|---|---|
| Play on settled reply | PASS | Button `Read aloud` → `Pause reading`+`Stop reading`; engine events `start>boundary…>end` per chunk; prose chunked into bounded utterances (11 chunks for ~1093 chars), fenced code/link URLs not spoken |
| Pause | PASS | `Pause reading` → `Resume reading`; no new `speak()` calls while held paused |
| Resume | PASS | New utterance enqueued at pause position; speaking resumed |
| Stop | PASS | `cancel()` issued; utterance ended with `error:"interrupted"`; `speaking` settled to `false`; UI returned to `Read aloud` |
| Replay | PASS | Re-play started at first chunk ("Here is a long synthetic reply…") |
| Natural completion | PASS | All chunks ended `end`; UI returned to idle |
| Thread switch while speaking | PASS | Real switch to a second thread: `cancel()` recorded at switch, zero `speak()` calls after cancel, engine drained to `speaking:false` |
| Reduced-motion | PASS | `prefers-reduced-motion: reduce` emulated; playback active with static indicator (see `reduced-motion.png`) |

## Results — voice/rate preferences (A4)

| Check | Result | Evidence |
|---|---|---|
| Searchable Settings rows | PASS | Settings search surfaces `Read-aloud voice` and `Read-aloud speed` under Chat (see `settings-section.png`) |
| Persist voice+rate via real UI | PASS | Selected `Microsoft Zira - English (United States)` + `1.5×`; `localStorage["harness:read-aloud:v1"] = {"voiceURI":"Microsoft Zira - English (United States)","rate":1.5}` |
| Next Play uses selection | PASS | Subsequent utterances recorded `voice=Microsoft Zira - English (United States)`, `rate=1.5` (see `utterance-dump.json`) |
| Preference survives reload | PASS | Stored JSON re-read after `page.reload()` |
| Missing voice fallback | PASS | Planted `voiceURI:"Nonexistent Voice XYZ"`; playback fell back to default `Microsoft David` at stored `rate:1.25`; stored URI was NOT erased |

## Results — local-only / network independence (A4/A6)

- `Network.emulateNetworkConditions offline=true` via CDP; page `fetch('/api/snapshot')`
  confirmed `OFFLINE` (request throws).
- With the reply already loaded, `Read aloud` was clicked offline: real engine produced
  3+ utterances (`start>boundary>boundary…>end`) using `Microsoft Zira` at `rate:1.5`
  (see `offline.png`). No network access is needed for local playback.
- First attempt used an invalid `emulateNetworkConditions` parameter set
  (`throughput` without `downloadThroughput`/`uploadThroughput`) and was rejected by the
  Electron 45.2.0 target; corrected parameters accepted. Failed attempt preserved here
  per evidence policy.

## Limits / not performed

- No human listened to audio output; evidence is engine-level (utterance text/voice/rate
  submitted to Windows SAPI plus real `start`/`boundary`/`end`/`interrupted` events and
  `speechSynthesis.speaking` transitions) — live-engine proof, not a mock.
- Verified on the dev-built Electron shell (Chrome 156 / Electron 45.2.0), not an
  NSIS-installed package; the code path is identical renderer `speechSynthesis`.
- OS-level audio sink routing/mute behavior not tested.

## Files

- `utterance-dump.json` — recorded `speak()` calls + engine events across the session
- `speaking-zira.png` — speaking state with Zira@1.5 applied
- `paused.png` — paused state (`Resume reading`/`Stop reading`)
- `offline.png` — offline state during playback
- `reduced-motion.png` — speaking under `prefers-reduced-motion: reduce`
- `settings-section.png` — Settings → Chat read-aloud rows
