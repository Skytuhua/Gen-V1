# Trusted UI catalog

Catalog version `1.0.0` exposes 48 components through `CAPABILITIES: Capability[]`, `CATALOG_VERSION`, `SURFACE_LIMITS`, and `validateSurface(spec: unknown): void`. Each capability has `name`, `category`, `description`, `props` (strict JSON Schema) and `example` (valid props). Admission throws `HarnessError("INVALID_SURFACE", ...)`; the host may normalize that wire code to `INVALID_SPEC`. `ui_discover({details:true})` returns these schemas and examples.

The catalog supports documents, software development and everyday task interactions through the same persistent renderer. Catalog availability does not establish live-model reliability or visual acceptance. Compose contextual controls around the actual task object, following [the interface brief](../../docs/generated-interface-brief.md), rather than a category-to-screen router. The [current recorded review](../../docs/evidence/frontend-review/reserved-rail-20261030/index.html) covers every advertised component and labels fixture evidence explicitly.

The trusted frontend registry should follow these exact props. No arbitrary styles, HTML, executable expressions or unknown props are admitted. All content strings are literal. Markdown must disable raw HTML and filter unsafe link destinations in the trusted renderer. Image `src` only accepts HTTP(S) without credentials; granted images can instead use `resourceId` and the host's authenticated resource endpoint.

| Component | Props |
| --- | --- |
| Stack | `gap?: none/xs/sm/md/lg`, `align?: start/center/end/stretch` |
| Grid | `columns?: 1..6`, `gap?` |
| Split | `ratio?: 0.1..0.9`, `gap?` |
| Tabs | `labels: string[]` (unique by exact string equality), `stateKey: string`, `statusBinding?` |
| Panel | `title?`, `description?` |
| Disclosure | `title`, `text?`, `stateKey`, `defaultOpen?: boolean` |
| Text | `text`, `tone?: default/muted/success/warning/danger`, `size?: sm/md/lg` |
| Markdown | `text?`, `dataBinding?` |
| EvidenceList | `rowsBinding`, `title?` |
| Metric | `label`, `value?: string/number`, `dataBinding?`, `unit?` |
| Progress | `value?: nonnegative number`, `max?: positive number`, `label?`, `dataBinding?` |
| Timeline | `rowsBinding` |
| Table | `rowsBinding`, `columns: {key,label}[]`, `caption?`, `stateKey?`, `rowKey?` |
| Chart | `rowsBinding`, `kind: bar/line/scatter`, `xKey`, `yKey`, `title?` |
| Tree | `rowsBinding` |
| Form | `title?`, `actionId`, `submitLabel?`, `payload?: object`, `payloadFromState?: {payloadKey: stateKey}` |
| Input | `stateKey`, `label`, `inputType?: text/number/email/date/textarea`, `placeholder?`, `required?: boolean` |
| Select | `stateKey`, `label`, `options: {label,value}[]` (string values) |
| Toggle | `stateKey`, `label` |
| Button | `label`, `actionId`, `tone?: default/primary/danger`, `payload?: object`, `payloadFromState?: {payloadKey: stateKey}` |
| Code | `code?`, `language?`, `dataBinding?` |
| Diff | `before?`, `after?`, `language?`, `dataBinding?` |
| Document | `text?`, `dataBinding?`, `resourceId?`, `title?` |
| Image | `src?`, `resourceId?`, `alt` |
| ChoiceList | `stateKey`, `label`, `options: {value,label,description?,detail?,disabled?}[]`, `required?`, `disabled?` |
| Steps | `stateKey`, `steps: {key,label,description?}[]`, `defaultStep?` |
| RelationshipGraph | `dataBinding?` or `nodes` + `edges` + `source`; `stateKey?`, `label?` |
| Status | `dataBinding?` or `label` + `status`; `detail?` |
| DocumentPreview | `resourceId`, `resourcePath?`, `title?`, `page?`, `fieldStateKeys?: {pdfFieldName: stateKey}`, `activeFieldStateKey?`, paired `signatureStateKey?` + `signatureBox?` |
| SignaturePad | `stateKey`, `label?`, `initialMode?: draw/type` |
| MapView | Source-bound places, linked selection and details; strict props in `workflow.ts` |
| Diagnostics, ChangeSet, ApiExplorer, Pipeline | Source-bound development inspectors; strict props/data in `software-development.ts` |
| ImageCompare | Granted before/after images with persistent comparison state; `image-compare.ts` |
| Stats, Comparison, CredentialEntry | Source-backed everyday views and session-only secret entry; `everyday.ts` |
| ReviewQueue, EditableTable, ParameterControls | `dataBinding`, `stateKey`, optional `actionId` and `actionLabel`; `interactions.ts` |

The extended pack schemas are the authority for their complete props. `ui_discover({details:true})` also supplies source-data schemas for development, everyday and interaction packs. ReviewQueue submits content feedback, never operation approval. EditableTable submits typed changed-cell proposals; ParameterControls submits typed values. Both preserve incomplete local drafts, validate before submitting and leave source writes to the existing broker and native approval boundary.

`stateKey` is a bare persistent field name, such as `selectedRows` or `faqOpen`; the frontend maps it to `/values/<stateKey>`. Keys start with a letter/underscore and contain up to 128 letters, digits, underscores or hyphens; `__proto__`, `prototype` and `constructor` are denied. Do not put `/values/` in the prop. Choices, step navigation, disclosures and table selections are local state interactions and require no model call. Table `rowKey` identifies a field in each bound row, defaulting to `id`. Tabs store the selected label and retain panels mounted when switching. Steps stores the stable step key and also retains its panels; navigation is not proof of task completion.

Tabs require unique labels by exact string equality, with no trimming, case folding or Unicode normalization. The published labels schema declares `uniqueItems: true`, and admission rejects duplicates with `INVALID_SURFACE`. Saved surfaces with ambiguous duplicate labels show an alert without rendering tab controls or child panels or rewriting saved selection. Unique tabs retain their mounted drafts; an unknown saved label displays the first tab without rewriting state merely on render.

`dataBinding` and `rowsBinding` are bare aliases into `/inputs/<alias>` in the artifact's resolved data namespace. They are not JSON pointers, expressions or raw data IDs. Bindings belong to `ArtifactRecord.bindings`; use snapshot/live `DataBinding` records there. Opaque `resourceId` values are separate from alias/state names and accept UUIDs starting with digits. The host rejects composition when any component resourceId is missing or owned by another thread.

`actionId` refers to an entry in `artifact.actions`. Form/Button combine literal `payload` with `payloadFromState`, mapping payload names to saved fields at submission; mapped values take precedence. The map admits at most 40 fields. Form has its own submit control (`submitLabel`, default `Submit`). The host validates action/binding existence at composition and routes submitted values through its action envelope. A local selection never approves a mutation.

Only Stack/Grid/Split/Tabs/Panel/Disclosure/Form/Steps/RelationshipGraph take `children`. Graph children are contextual footer controls. When present, Tabs children must match labels, and Steps children must match steps. Graph admission permits 200 nodes, depth 12 (root counts as 1), and 128 KiB of UTF-8 JSON. Unknown types/props, dangling references, cycles including disconnected cycles, and unreachable nodes are rejected. Shared children count toward the deepest path correctly.

## Workflow and document schemas

ChoiceList requires 1–50 uniquely valued choices. Steps requires 1–12 unique stable keys; defaultStep must name one. Choice/step/node/status labels are nonempty and at most 500 characters; descriptions/details and graph edge labels are at most 2,000 characters. Status values are `neutral`, `pending`, `running`, `success`, `error`.

RelationshipGraph uses either a bound `{nodes,edges}` object or literal nodes/edges with a source explanation. Nodes are `{id,label,detail?,status?,lane?}` (1–80, unique IDs, lane 0–3); edges are `{from,to,label?,status?}` (at most 160), and both endpoints must exist. Bound data is validated again at render time. Optional stateKey saves the selected node ID.

Status binds either `{status,label,detail?}` or a host operation record containing operationId/status. Prepared/unknown render as pending, running as running, succeeded as success, and failed/cancelled as error. Receipt details remain in disclosure; clicks, labels and elapsed time do not manufacture success. The host requires numerical Progress values to bind executor-owned data.

DocumentPreview.resourceId must be an opaque grant ID, never a URL. Optional resourcePath is a relative file path within a directory grant: no absolute path, parent traversal, colon or control characters; at most 1,024 characters. It maps to `/api/resources/<encoded-id>/content?path=<encoded-relative-file>`. Direct file/attachment grants omit the query. Both host guards and thread-owned admission apply.

Pages are 1-based (1–200); fieldStateKeys maps at most 100 PDF field names to persistent fields. activeFieldStateKey contains the current PDF field name. signatureStateKey and signatureBox must occur together. The box is `{page,x,y,width,height}` in bottom-left PDF points, on an unrotated page; dimensions must be positive and at most 2,000 points, and the placement must fit the page.

SignaturePad saves `{kind:"typed",text}` (at most 200 characters), `{kind:"drawn",points:[{x,y},...]}` (2–2,000 points normalized to 0–1), or null. Drawing preserves multiple normalized strokes (at most 2,000 points in total). Generate and Upload save bounded PNG resources before submission; the legacy typed/points records remain compatible. These are visual marks, not certificate signatures. DocumentPreview derives a disposable draft with supported form values and the mark, renders via local legacy PDF.js/canvas, and leaves the source unchanged. Its fixed parse/edit/save worker is terminable; repeated/cyclic page-tree expansion is rejected. Processing deadlines remain separate from animation-frame suspension. Preview does not export; the native broker must prepare and approve the PDF export. OCR, certificate signing and email are outside this flow.

## Valid prop examples

These are strict component prop examples, not complete artifacts or execution evidence. Replace grant/binding/action names with ones owned by the current thread. Steps may supply one child panel per step in a complete graph.

```json
[
  {"type":"ChoiceList","props":{"stateKey":"deliveryMethod","label":"Choose a handoff","options":[{"value":"download","label":"Prepare a local export"},{"value":"review","label":"Review first"}]}},
  {"type":"Steps","props":{"stateKey":"currentStep","steps":[{"key":"Name","label":"Your name"},{"key":"confirm","label":"Review"}],"defaultStep":"Name"}},
  {"type":"RelationshipGraph","props":{"dataBinding":"relationships","stateKey":"selectedNode","label":"Dependencies"}},
  {"type":"Status","props":{"dataBinding":"operationStatus"}},
  {"type":"DocumentPreview","props":{"resourceId":"granted-project","resourcePath":"forms/agreement.pdf","title":"Agreement.pdf","page":1,"fieldStateKeys":{"Name":"name"},"activeFieldStateKey":"currentStep","signatureStateKey":"signature","signatureBox":{"page":1,"x":72,"y":72,"width":180,"height":40}}},
  {"type":"SignaturePad","props":{"stateKey":"signature","label":"Visual signature","initialMode":"draw"}},
  {"type":"Form","props":{"actionId":"review","submitLabel":"Review values","payload":{"intent":"review"},"payloadFromState":{"name":"name","choice":"deliveryMethod"}}},
  {"type":"Button","props":{"label":"Inspect selection","actionId":"inspect","payloadFromState":{"nodeId":"selectedNode"}}}
]
```

Artifact-level presentation is separate from props: `{width:"compact"|"standard"|"wide",frame:"card"|"canvas"}`. Both fields are required when supplied; new artifacts default to standard/card and updates retain omitted presentation. All inline presentations share one visible container and match the composer width selected by the user. Inline content grows/reflows within chat instead of owning nested scrolling. Frame/width metadata remains available for explicit expansion and workspace composition; it cannot remove the inline boundary or make an inline artifact wider than the composer. Expansion preserves the same object and state; see [integration-contract.md](../../docs/integration-contract.md).

Data produced by domain reads is a `DataRecord` whose `value` may be an object: text imports use `{text,sha256,resourceId,path}`, database inspection uses `{rows,totalRows,schema,integrity,resourceVersion}`, and PDF inspection uses `{pages,fields,limitations,sha256}`. Bind the relevant JSON pointer (for example `/rows`, `/text`, `/pages`) in `artifact.bindings` so components receive the expected primitive or array.

## Reference fidelity refinements

`ChoiceList.custom?: {label,placeholder?}` replaces its custom row with an input using the same state key. `DocumentPreview.fit?: "width"|"page"` preserves the document pipeline while fitting a completed page. `Status.presentation?: "inline"|"receipt"` and `Panel.align?: "start"|"center"` support a concise completion composition. `Document` can expose a granted `resourcePath`, `linkLabel` and `download` link; it does not execute an export.

`RelationshipGraph` source nodes may declare stable `column`, `kind` and branch `tone`; edges may be `prospective`; `branchLabels` supplies lane captions. Its children share the summary footer. `Tabs.statusBinding` supplies validated header, item status/detail/code and footer metadata; selection remains local and durable. `Disclosure` source `followupsPending` separates the related-question skeleton from real arriving answer content.


## Exploration interfaces

The trusted catalog has 48 components. `ImageAnnotator` provides normalized feedback pins on a granted image, `SchedulePicker` proposes a supplied time window in its declared timezone, and `LogExplorer` filters and inspects supplied events. Their selected items, drafts and filters use existing artifact state; optional actions return to the owning agent through the usual broker.

Image annotations include a fingerprint of the grant identity, not a content hash. Renewing the same resource ID for another path/inode cannot carry pins over. One previous source checkpoint is retained and inspectable. Schedule availability is never inferred from the current clock, and log inspection never starts a terminal or external stream. See `exploration.ts` for strict source schemas, limits and examples.

## Task-specific examples

Detail discovery includes at most two relevant `compositionExamples` alongside the requested component schemas. The index remains small and omits them. Each example is a bounded trusted `SurfaceSpec` demonstrating an arrangement, not a full-screen template or a production scenario router. Examples cover standalone availability versus place/time planning, passage versus patch review, and single-failure versus measurement/span investigation. Replace illustrative binding/action/grant names with actual same-thread references.

Selections use neutral surfaces. Blue belongs to small primary actions and keyboard focus; graph/diff/status colors retain their meaning. Current inline content always matches the composer and grows with chat. Historical descriptions of wider inline frames or local table/history scrolling are superseded.
