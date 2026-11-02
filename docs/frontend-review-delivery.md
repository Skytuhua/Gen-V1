# Frontend recording handoff

The approved delivery is one local review page with embedded MP4 controls, chapter links when supplied, provenance for every recording, component composition coverage, and reference/result frame comparisons. The page lets the reviewer inspect the app without operating it.

After the final recording folder contains `manifest.json` and its media, run:

```powershell
pnpm exec tsx scripts/build-review-index.ts --input 'C:\path\to\final-recording-folder'
```

Open `index.html` in that folder. Keep the folder intact when sharing it: video, image and evidence links are relative. Regenerate the index after adding genuine Pi evidence or chapters. The command writes `index.html`, `review-index.json`, `component-coverage.json`, and byte-for-byte copies of the six authorized reference PNGs under `references/`. It does not change the source manifest or recordings, start the app, call a model, or capture media.

## Recording manifest

The existing recorder's `source`, `generation`, `catalogCoverage`, and `captures` fields are supported. A successful deterministic capture has `fixture: true`. Additional fields are optional:

```json
{
  "source": "Describe the evidence and its limits.",
  "generation": "Deterministic fixtures; genuine Pi evidence is separate.",
  "catalogCoverage": ["Stack", "Input", "Button"],
  "captures": [{
    "scenario": "signing",
    "file": "01-signing.mp4",
    "fixture": true,
    "title": "Sign a local PDF",
    "summary": "Review details, exercise signature modes, approve the exact export and inspect the saved PDF.",
    "poster": "signing-settled.png",
    "chapters": [
      { "title": "Contractor and notices", "startSeconds": 0 },
      { "title": "Signature modes", "startSeconds": 12, "endSeconds": 30 },
      { "title": "Exact native approval", "startSeconds": 35 }
    ],
    "evidence": ["signing-receipt.json"],
    "probe": {}
  }],
  "genuinePi": {
    "status": "pending",
    "notes": "Attach the genuine runtime recording and supporting evidence before claiming model-generation acceptance.",
    "captures": []
  }
}
```

The example timestamps describe the schema only. Supply timestamps measured from the delivered recording. Chapter buttons seek within the same video. `probe`, when present, is shown intact in a disclosure; encoded frame rate is labelled as encoded frame rate, not measured source capture rate.

For genuine evidence, add a capture to `genuinePi.captures` or the ordinary `captures` array with both `fixture: false` and `provenance: "genuine-pi"`. It may include `model`, a concise `summary`, and relative `evidence` links to the actual session/run receipts. The index labels this claim as manifest-declared; it cannot authenticate inference from an MP4. Missing media remains visibly pending. Top-level MP4s omitted from the manifest are included as unclassified recordings. Their filenames never establish provenance.

All media/evidence paths must name existing regular files inside the recording folder. Absolute paths, remote URLs, directory traversal and links resolving outside the folder are excluded. MP4s and result PNGs may use nested relative paths when explicitly listed. No network requests are needed to build or view the handoff.

## Frame comparisons

The only copied reference images are the six extracts already documented in [the reference contract](reference-videos.md):

| Scenario | Authorized reference extract | Source recording / extract |
| --- | --- | --- |
| `signing` | `signing-18.png` | 15:47:28 / 18 s |
| `pr-dark` | `merge-16.png` | 15:46:41 / 16 s |
| `pr-light` | `graph-14.png` | 15:50:08 / 14 s |
| `migration` | `migration-16.png` | 15:49:30 / 16 s |
| `context` | `context-10.png` | 15:49:05 / 10 s |
| `faq` | `faq-24.png` | 15:48:20 / 24 s |

By default, each extract appears beside `<scenario>-settled.png`. These are scenario comparisons with an explicit notice that workflow moment and viewport differ. Missing results remain pending. The index does not fabricate a reference for the map, catalog or settings.

To select a more relevant delivered frame, add a top-level array:

```json
{
  "frameComparisons": [{
    "scenario": "signing",
    "reference": "signing-18.png",
    "result": "frames/signing-signature-step.png",
    "label": "Document and current signature question",
    "note": "Same workflow phase; reference is 1280×720, result is 1920×1080. Timing and pixels are not identical."
  }]
}
```

Use an honest note stating which workflow phase, viewport and interaction are comparable. Only the six allowed reference filenames are accepted; the builder copies them from this repository's `docs/reference/`, without searching other screenshots or attachments. Additional top-level PNGs remain available as unpaired captured frames.

## Coverage and acceptance

`component-coverage.json` compares `catalogCoverage` with the current advertised `CAPABILITIES` list. It records declared, missing and unrecognized names. This is composition coverage; visibility and exercised interaction still require review of the catalog recording and its supporting checks.

Deterministic fixture recordings exercise the actual local host and renderer without model inference. The signing PDF export and SQLite migration can be real local operations after exact native approval. GitHub, CI, Supabase, email, phone and fixture context telemetry remain illustrative. Genuine Pi evidence must separately show agent-selected composition, in-place revision, durable interaction, continued work and recovery.

The index preserves the remaining acceptance boundaries in [the rebuild plan](frontend-rebuild-plan.md): user visual assessment, fresh-run model reliability, external provider execution, generated-app enablement and the deferred 36-run pilot are not inferred from these recordings.
