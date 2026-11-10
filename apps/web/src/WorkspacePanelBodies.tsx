import {useEffect,useState} from 'react';
import {ArrowLeft,ChevronRight,File,Folder,RefreshCw,Terminal,GitCompare,GitPullRequest,Link,Smartphone,ScrollText,ChartNoAxesCombined} from 'lucide-react';
import type {DataRecord,RuntimeUsage,Snapshot} from '../../../packages/contracts';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import type {WorkspacePanelKind} from '../../../packages/contracts/workspace';
import {getResourceContent,getResourceTree,type ResourceTree} from './api';
import {useWorkspace,type WorkspaceTab} from './workspace-context';
import {ContextMeter} from './ContextMeter';

const count = (value: number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export function UsageSummary({ usage }: { usage?: RuntimeUsage }) {
  const ratio = usage?.contextTokens != null && usage.contextWindow != null && usage.contextWindow > 0 ? Math.min(100, Math.max(0, usage.contextTokens / usage.contextWindow * 100)) : null;
  return <div className="usage-summary"><div className="usage-context"><span>Context window</span><strong>{ratio == null ? 'Unavailable' : `${Math.round(ratio)}%`}</strong></div><ContextMeter usage={usage} /><p>{count(usage?.contextTokens)} of {count(usage?.contextWindow)} tokens</p><dl><dt>Input tokens</dt><dd>{count(usage?.inputTokens)}</dd><dt>Output tokens</dt><dd>{count(usage?.outputTokens)}</dd><dt>Reported cost</dt><dd>{usage?.cost == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(usage.cost)}</dd><dt>Session limit</dt><dd>{usage?.sessionPercent == null ? 'Unavailable' : `${usage.sessionPercent}%`}</dd><dt>Weekly limit</dt><dd>{usage?.weeklyPercent == null ? 'Unavailable' : `${usage.weeklyPercent}%`}</dd></dl><p className="muted">Only runtime-reported values are shown. API billing, account quotas, and historical charts are unavailable unless reported by the runtime.</p></div>;
}

export function WorkspaceLauncher({onOpenTool}:{onOpenTool?:(kind:WorkspacePanelKind)=>void|Promise<void>}={}) {
  const workspace = useWorkspace();
  const [error,setError]=useState('');
  const openTool=(kind:WorkspacePanelKind)=>{setError('');try{const result=onOpenTool?onOpenTool(kind):workspace.setActiveTab(kind as WorkspaceTab);if(result)void result.catch(cause=>setError(cause instanceof Error?cause.message:'The surface could not open.'));}catch(cause){setError(cause instanceof Error?cause.message:'The surface could not open.');}};
  const unavailable = 'Unavailable in this local harness';
  return <section className="workspace-launcher" aria-label="Workspace launcher"><h3>Open a surface</h3>{error&&<p role="alert" className="error-text">{error}</p>}
    <button type="button" aria-label="Terminal" onClick={()=>openTool('terminal')} title="Open an interactive host terminal"><Terminal size={18} /><span>Terminal</span><small>Interactive host session</small></button>
    <button type="button" aria-label="Files" onClick={() => openTool('files')}><Folder size={18} /><span>Files</span><small>Granted resources</small></button>
    <button type="button" aria-label="Diff" onClick={() => openTool('diff')}><GitCompare size={18} /><span>Diff</span><small>Prepared changes</small></button>
    <button type="button" aria-label="Pull request" onClick={()=>openTool('pull-request')} title="Open project pull requests"><GitPullRequest size={18} /><span>Pull request</span><small>Project pull requests</small></button>
    <button type="button" aria-label="Linked pull requests" onClick={()=>openTool('linked-pull-requests')} title="Open linked pull requests"><Link size={18} /><span>Linked pull requests</span><small>Connected reviews</small></button>
    <button type="button" aria-label="Device" disabled title="Phone and device automation is not connected."><Smartphone size={18} /><span>Device</span><small>{unavailable}</small></button>
    <button type="button" aria-label="Executor output" onClick={() => openTool('output')}><ScrollText size={18} /><span>Executor output</span><small>Recorded operations</small></button>
    <button type="button" aria-label="Usage" onClick={() => openTool('usage')}><ChartNoAxesCombined size={18} /><span>Usage</span><small>Runtime reports</small></button>
  </section>;
}

export function GrantedFiles({ snapshot, threadId, preferredResourceId }: { snapshot: Snapshot; threadId?: string; preferredResourceId?:string }) {
  const grants = snapshot.resources.filter(item => item.threadId === threadId);
  const [resourceId, setResourceId] = useState('');
  useEffect(()=>{if(preferredResourceId)setResourceId(preferredResourceId);},[preferredResourceId,threadId]);
  const [path, setPath] = useState('');
  const [tree, setTree] = useState<ResourceTree | null>(null);
  const [selected, setSelected] = useState<ResourceTree['entries'][number] | null>(null);
  const [content, setContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = grants.some(item => item.id === resourceId) ? resourceId : grants[0]?.id ?? '';
  useEffect(() => { setPath(''); setSelected(null); setContent(''); setPreviewUrl(''); }, [threadId, active]);
  useEffect(() => {
    let current = true; setError(''); setTree(null); if (!active) return;
    setLoading(true); void getResourceTree(active, path).then(value => { if (current) setTree(value); }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'The granted directory could not be read.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, path, retry]);
  useEffect(() => {
    setContent(''); setPreviewUrl(''); setLoading(false); if (!selected) return;
    const controller = new AbortController(); let objectUrl = ''; setError('');
    if (/\.(pdf|zip|db|sqlite|sqlite3|exe|dll|bin|woff2?|ttf)$/i.test(selected.name)) return;
    setLoading(true);
    void (async () => {
      const response = await getResourceContent(active, selected.path, controller.signal);
      if (!response.ok) throw new Error(`File preview could not be read (${response.status}).`);
      const image = /^image\/(png|jpeg|gif|webp)$/.test(response.headers.get('content-type') ?? '');
      const limit = image ? 10 * 1024 * 1024 : 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(image ? 'Image preview is limited to 10 MiB.' : 'Text preview is limited to 1 MiB. Download the granted file to inspect it.'); }
      if (!response.body) throw new Error('The file response was empty.');
      const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('This file exceeds the preview size limit.'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
      controller.signal.throwIfAborted(); const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (image) { objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('content-type')! })); setPreviewUrl(objectUrl); }
      else { if (bytes.subarray(0, 4096).includes(0)) throw new Error('This binary file has no text preview.'); setContent(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'File preview is unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [active, selected]);
  return <div className="granted-files"><div className="panel-toolbar"><label><span className="sr-only">Granted resource</span><select aria-label="Granted resource" value={active} onChange={event => { setResourceId(event.target.value); setPath(''); setSelected(null); }} disabled={!grants.length}>{!grants.length && <option value="">No granted resources</option>}{grants.map(grant => <option key={grant.id} value={grant.id}>{grant.label}</option>)}</select></label><button className="icon-button" aria-label="Refresh granted files" disabled={!active} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} /></button></div>{active ? <><div className="file-breadcrumb"><button className="icon-button" aria-label="Parent directory" disabled={!path} onClick={() => { setPath(path.split('/').slice(0, -1).join('/')); setSelected(null); }}><ArrowLeft size={13} /></button><span>{path || 'Granted root'}</span></div><ul className="file-tree">{tree?.entries.map(entry => <li key={entry.path}><button className={selected?.path === entry.path ? 'selected' : ''} onClick={() => { if (entry.kind === 'directory') { setPath(entry.path); setSelected(null); } else setSelected(entry); }}>{entry.kind === 'directory' ? <Folder size={14} /> : <File size={14} />}<span>{entry.name}</span>{entry.kind === 'directory' ? <ChevronRight size={12} /> : <small>{new Intl.NumberFormat().format(entry.bytes)} B</small>}</button></li>)}</ul>{tree?.truncated && <p className="panel-note">This directory is limited to 300 entries. Open a subdirectory to continue.</p>}{loading && <p className="panel-note" role="status">Reading granted resource…</p>}{error && <p role="alert" className="panel-note error-text">{error}</p>}{selected && <section className="file-preview"><header><strong>{selected.name}</strong><a href={`/api/resources/${encodeURIComponent(active)}/content${selected.path ? '?path=' + encodeURIComponent(selected.path) : ''}`} download={selected.name}>Download</a></header>{previewUrl ? <img src={previewUrl} alt={selected.name} /> : content ? <pre>{content}</pre> : !loading && !error ? <p className="panel-note">This file has no inline preview. Download the granted file to inspect it.</p> : null}</section>}</> : <div className="panel-empty"><Folder size={22} /><strong>No granted resources</strong><p>Use Add resource or attach a file in the composer. Only files explicitly granted to this thread appear here.</p></div>}</div>;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function snapshotDiffs(snapshot: Snapshot, threadId?: string) {
  const diffs: { id: string; title: string; before?: string; after?: string; unified?: string; provenance: string }[] = [];
  for (const data of snapshot.data.filter(item => item.threadId === threadId)) {
    const value = record(data.value);
    if (typeof value.before === 'string' && typeof value.after === 'string') diffs.push({ id: data.id, title: typeof value.title === 'string' ? value.title : data.id, before: value.before, after: value.after, provenance: data.provenance });
    else if (/; git diff;/.test(data.provenance) && typeof value.stdout === 'string') diffs.push({ id: data.id, title: 'Repository diff', unified: value.stdout, provenance: data.provenance });
  }
  for (const artifact of snapshot.artifacts.filter(item => item.threadId === threadId && item.lifecycle === 'active')) for (const [id, element] of Object.entries(artifact.spec?.elements ?? {})) {
    if (element.type === 'Diff' && typeof element.props.before === 'string' && typeof element.props.after === 'string') diffs.push({ id: `${artifact.id}:${id}`, title: artifact.title, before: element.props.before, after: element.props.after, provenance: `Generated interface ${artifact.id}, revision ${artifact.revision}. This comparison is presentation data; it does not prove an executed change.` });
  }
  return diffs;
}
export function RecordedDiffPanel({ snapshot, threadId, preferences }: { snapshot: Snapshot; threadId?: string; preferences: UiPreferences }) {
  const diffs = snapshotDiffs(snapshot, threadId);
  const pair = (before: string, after: string) => {
    if (!preferences.hideWhitespace) return { before, after };
    const left = before.split('\n'), right = after.split('\n'); const changed = Math.max(left.length, right.length);
    return { before: Array.from({ length: changed }, (_, index) => (left[index] ?? '').replace(/\s/g, '') === (right[index] ?? '').replace(/\s/g, '') ? null : left[index] ?? '').filter(line => line !== null).join('\n'), after: Array.from({ length: changed }, (_, index) => (left[index] ?? '').replace(/\s/g, '') === (right[index] ?? '').replace(/\s/g, '') ? null : right[index] ?? '').filter(line => line !== null).join('\n') };
  };
  return <div className={`workspace-diffs diff-colors-${preferences.diffColors}`}>{diffs.length ? diffs.map(diff => { const value = pair(diff.before ?? '', diff.after ?? ''); return <details className="workspace-diff" key={diff.id} open={preferences.diffDefaultExpanded}><summary>{diff.title}</summary><p className="panel-note">{diff.provenance}</p>{diff.unified !== undefined ? <pre className="unified-diff">{diff.unified || 'No changes reported.'}</pre> : <div className={`workspace-diff-pair diff-${preferences.diffLayout}`}><section><h3>Before</h3><pre>{value.before || '(empty)'}</pre></section><section><h3>After</h3><pre>{value.after || '(empty)'}</pre></section></div>}</details>; }) : <div className="panel-empty"><strong>No recorded diffs</strong><p>Executor diff records and generated before/after comparisons appear here. This viewer does not run Git or manage pull requests.</p></div>}</div>;
}
export function OutputPanel({ snapshot, threadId, preferences }: { snapshot: Snapshot; threadId?: string; preferences: UiPreferences }) {
  const operations = snapshot.operations.filter(item => item.threadId === threadId), data = snapshot.data.filter(item => item.threadId === threadId && !operations.some(operation => operation.id === item.id) && (typeof record(item.value).stdout === 'string' || typeof record(item.value).stderr === 'string'));
  const output = (item: DataRecord) => { const value = record(item.value); return <section key={item.id} className="executor-record"><header><strong>Executor output</strong><small>{new Date(item.createdAt).toLocaleTimeString([], preferences.timeFormat === 'system' ? {} : { hour12: preferences.timeFormat === '12h' })}</small></header><p className="panel-note">{item.provenance}</p>{typeof value.stdout === 'string' && <pre>{value.stdout || 'No stdout.'}</pre>}{typeof value.stderr === 'string' && value.stderr && <pre className="error-text">{value.stderr}</pre>}<p className="panel-note">Exit code: {value.exitCode == null ? 'Unavailable' : String(value.exitCode)}</p></section>; };
  return <div className="executor-output"><p className="panel-note">Recorded executor receipts and output. Open Terminal for an interactive host session.</p>{operations.map(operation => <section key={operation.id} className="executor-record"><header><strong>{operation.kind}</strong><span className="badge">{operation.status}</span></header><p>{operation.description}</p>{operation.error && <p className="error-text">{operation.error}</p>}{operation.result !== undefined ? <pre>{JSON.stringify(operation.result, null, 2)}</pre> : <p className="panel-note">No executor result reported.</p>}<small>Operation {operation.id}</small></section>)}{data.map(output)}{!operations.length && !data.length && <div className="panel-empty"><strong>No executor output yet</strong><p>Actual operation receipts will appear after a prepared operation runs.</p></div>}</div>;
}
