import {SentenceReveal} from './SentenceReveal';
import {WindowDocument} from './DocumentWindow';
import { Children, lazy, Suspense, useContext, useRef } from 'react';
import { useStateStore, type ComponentRegistry, type ComponentRenderProps } from '@json-render/react';
import { ExternalLink, FileText, Check, AlertTriangle, CornerDownLeft } from 'lucide-react';
import { Markdown } from './Markdown';
import { ArtifactTitle, ChoiceList, RelationshipGraph, Status, Steps } from './task-interface';
export { ArtifactTitle } from './task-interface';
import type { DocumentPreviewProps, SignaturePadProps } from '../../../packages/ui-catalog/documents';

// Load task families on first use, rather than paying for every possible
// interaction before the conversation and composer can become usable.
function lazyRegistry(load: () => Promise<ComponentRegistry>, names: string[]): ComponentRegistry {
  return Object.fromEntries(names.map(name => {
    const Component = lazy(async () => ({ default: (await load())[name] }));
    return [name, (props: ComponentRenderProps) => <Suspense fallback={<span role="status" className="muted">Loading {name}…</span>}><Component {...props} /></Suspense>];
  }));
}
const SOFTWARE_REGISTRY = lazyRegistry(() => import('./SoftwareDevelopment').then(module => module.SOFTWARE_REGISTRY), ['Diagnostics', 'ChangeSet', 'ApiExplorer', 'Pipeline']);
const IMAGE_COMPARE_REGISTRY = lazyRegistry(() => import('./ImageCompare').then(module => module.IMAGE_COMPARE_REGISTRY), ['ImageCompare']);
const EVERYDAY_REGISTRY = lazyRegistry(() => import('./EverydayData').then(module => module.EVERYDAY_REGISTRY), ['Stats', 'Comparison', 'CredentialEntry']);
const INTERACTION_REGISTRY = lazyRegistry(() => import('./InteractionTools').then(module => module.INTERACTION_REGISTRY), ['ReviewQueue', 'EditableTable', 'ParameterControls']);
const EXPLORATION_REGISTRY = lazyRegistry(() => import('./ExplorationTools').then(module => module.EXPLORATION_REGISTRY), ['ImageAnnotator', 'SchedulePicker', 'LogExplorer']);
const WORK_OBJECT_REGISTRY = lazyRegistry(() => import('./WorkObjects').then(module => module.WORK_OBJECT_REGISTRY), ['WorkflowBoard', 'ArchitectureCanvas', 'TraceWaterfall']);

const DocumentPreview = lazy(() => import('./DocumentPreview').then(module => ({ default: module.DocumentPreview })));
const SignaturePad = lazy(() => import('./SignaturePad').then(module => ({ default: module.SignaturePad })));

export { ArtifactActions } from './task-context';
import { mapActionPayload, statePath, useTaskAction } from './task-context';
import { Disclosure } from './TaskDisclosure';
import { Table } from './TaskTable';
import { MapView } from './MapView';
import { TaskHistory } from './TaskHistory';
import { tabStateData } from '../../../packages/ui-catalog/workflow';
import { StatusIcon } from './task-status';
const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const display = (value: unknown): string => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const fieldPath = (key: unknown) => `/values/${string(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

function useField(props: Record<string, unknown>, bindings?: Record<string, string>) {
  const store = useStateStore();
  const path = bindings?.value ?? fieldPath(props.stateKey);
  const value = store.get(path) ?? props.value ?? props.defaultValue;
  return [value, (next: unknown) => store.set(path, next)] as const;
}
function useData(props: Record<string, unknown>) {
  const store = useStateStore();
  const name = props.rowsBinding ?? props.dataBinding;
  return typeof name === 'string' ? store.get(`/inputs/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`) : undefined;
}
function Layout({ element: { props }, children }: ComponentRenderProps) {
  const gaps: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 16, lg: 24 };
  const layout = <div className={`surface-layout layout-${string(props.direction, 'column')}`} style={{ gap: gaps[string(props.gap)] ?? 14, gridTemplateColumns: props.columns ? `repeat(${Math.min(6, Math.max(1, Number(props.columns) || 1))}, minmax(0, 1fr))` : undefined, alignItems: string(props.align) === 'start' ? 'flex-start' : string(props.align) === 'end' ? 'flex-end' : string(props.align) === 'center' ? 'center' : undefined }}>{children}</div>;
  return props.scroll === 'bounded' ? <TaskHistory label={string(props.label, 'Question history')}>{layout}</TaskHistory> : layout;
}
function Split({ element: { props }, children }: ComponentRenderProps) { const ratio = Math.max(.1, Math.min(.9, Number(props.ratio) || .5)); return <div className="surface-split" style={{ gridTemplateColumns: `${ratio}fr ${1 - ratio}fr` }}>{children}</div>; }
function Text({ element: { props } }: ComponentRenderProps) { return <SentenceReveal text={string(props.text,string(props.content))} animate as="p" className={`surface-text tone-${string(props.tone)} size-${string(props.size)}`}>{string(props.text,string(props.content))}</SentenceReveal>; }
function Heading({ element: { props } }: ComponentRenderProps) { return <h3>{string(props.text, string(props.title))}</h3>; }
function Panel({ element: { props }, children }: ComponentRenderProps) { const artifactTitle = useContext(ArtifactTitle); return <section className={`surface-section${props.align === 'center' ? ' surface-section-centered' : ''}`}>{props.title && props.title !== artifactTitle ? <h3>{string(props.title)}</h3> : null}{props.description ? <p className="muted">{string(props.description)}</p> : null}{children}</section>; }
function Input({ element: { props }, bindings }: ComponentRenderProps) {
  const [value, setValue] = useField(props, bindings);
  const inputType = props.inputType ?? props.type;
  const multiline = props.multiline === true || inputType === 'textarea';
  const control = multiline ? <textarea required={props.required === true} value={value == null ? '' : String(value)} placeholder={string(props.placeholder)} disabled={props.disabled === true} onChange={event => setValue(event.target.value)} /> : <input required={props.required === true} type={['number', 'email', 'date', 'password', 'url'].includes(string(inputType)) ? string(inputType) : 'text'} value={value == null ? '' : String(value)} placeholder={string(props.placeholder)} disabled={props.disabled === true} onChange={event => setValue(inputType === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
  return <label className="field">{string(props.label)}{control}{props.help ? <small>{string(props.help)}</small> : null}</label>;
}
function Checkbox({ element: { props }, bindings }: ComponentRenderProps) { const [value, setValue] = useField(props, bindings); return <label className="check-field"><input type="checkbox" checked={value === true} disabled={props.disabled === true} onChange={event => setValue(event.target.checked)} />{string(props.label)}</label>; }
function Select({ element: { props }, bindings }: ComponentRenderProps) {
  const [value, setValue] = useField(props, bindings);
  return <label className="field">{string(props.label)}<select value={value == null ? '' : String(value)} onChange={event => setValue(event.target.value)}><option value="">{string(props.placeholder, 'Choose an option')}</option>{list(props.options).map((option, i) => { const item = obj(option); return <option key={i} value={typeof option === 'string' ? option : display(item.value)}>{typeof option === 'string' ? option : string(item.label, display(item.value))}</option>; })}</select></label>;
}
function Button({ element: { props } }: ComponentRenderProps) {
  const action = useTaskAction(), store = useStateStore();
  return <span className="surface-action"><button type="button" className={props.tone === 'primary' || props.variant === 'primary' ? 'primary' : props.tone === 'danger' ? 'secondary tone-danger' : 'secondary'} disabled={action.busy || props.disabled === true || !props.actionId} title={!props.actionId ? 'This control has no registered action.' : undefined} onClick={() => { if (props.actionId) void action.run(string(props.actionId), mapActionPayload(props, store.getSnapshot().values)); }}>{action.busy && props.disabled !== true ? 'Submitting…' : string(props.label, 'Continue')}</button>{action.error && <span role="alert" className="error-text">{action.error}</span>}</span>;
}
function Chart({ element: { props } }: ComponentRenderProps) {
  const data = list(useData(props) ?? props.data);
  const xKey = string(props.xKey, 'label'), yKey = string(props.yKey, 'value');
  const values = data.map(row => {
    try {
      const value = Number(obj(row)[yKey]);
      return Number.isFinite(value) ? value : 0;
    } catch { return 0; }
  });
  const max = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 1);
  const line = props.kind === 'line' || props.kind === 'scatter';
  // Normalize an overflowing signed range before subtraction. Ordinary ranges
  // keep their precision, including very small or closely spaced endpoints.
  const fraction = (value: number, minimum: number, maximum: number) => {
    if (minimum === maximum) return .5;
    const range = maximum - minimum;
    if (Number.isFinite(range)) return (value - minimum) / range;
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum));
    return (value / scale - minimum / scale) / (maximum / scale - minimum / scale);
  };
  const yMin = values.reduce((minimum, value) => Math.min(minimum, value), 0);
  const yMax = values.reduce((maximum, value) => Math.max(maximum, value), 0);
  const numericXs = data.map(row => obj(row)[xKey]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const numericX = props.kind === 'scatter' && numericXs.length === data.length;
  const xMin = numericXs.reduce((minimum, value) => Math.min(minimum, value), Infinity);
  const xMax = numericXs.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
  const points = values.map((value, i) => ({
    x: 30 + (numericX ? fraction(numericXs[i]!, xMin, xMax) : i / Math.max(1, values.length - 1)) * 540,
    y: yMin === yMax ? 210 : 210 - fraction(value, yMin, yMax) * 180,
  }));
  return <figure className="chart"><figcaption>{string(props.title)}</figcaption>{!data.length ? <p className="muted">No chart data available.</p> : <><svg role="img" aria-label={string(props.title, 'Data chart')} viewBox={`0 0 600 ${line ? 250 : Math.max(80, data.length * 36)}`}><title>{string(props.title, 'Data chart')}</title>{line ? <><line x1="25" y1="215" x2="580" y2="215" stroke="var(--border)" />{props.kind === 'line' && <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={points.map(point => `${point.x},${point.y}`).join(' ')} />}{values.map((value, i) => <g key={i}><circle cx={points[i]!.x} cy={points[i]!.y} r="4" fill="var(--accent)"><title>{display(obj(data[i])[xKey])}: {value}</title></circle><text x={points[i]!.x} y="237" textAnchor="middle" fill="currentColor" fontSize="10">{display(obj(data[i])[xKey]).slice(0, 12)}</text></g>)}</> : data.map((row, i) => <g key={i} transform={`translate(0,${i * 36})`}><text x="0" y="23" fill="currentColor" fontSize="12">{display(obj(row)[xKey]).slice(0, 18)}</text><rect x="135" y="7" width={Math.abs(values[i]!) / max * 390} height="21" rx="3" fill="var(--accent)" /><text x="535" y="23" fill="currentColor" fontSize="12">{values[i]}</text></g>)}</svg><details><summary>View chart data</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></>}</figure>;
}
function TreeNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 12) return <span className="muted">Nested content exceeds display depth.</span>;
  const item = obj(value);
  return <li><details open={depth === 0}><summary>{string(item.label, string(item.name, string(item.title, 'Item')))}</summary>{item.content ? <p>{display(item.content)}</p> : null}{list(item.children).length > 0 && <ul>{list(item.children).map((child, i) => <TreeNode key={i} value={child} depth={depth + 1} />)}</ul>}</details></li>;
}
function Tree({ element: { props } }: ComponentRenderProps) { const data = useData(props) ?? props.items; return <ul className="tree">{list(data).map((node, i) => <TreeNode key={i} value={node} />)}</ul>; }
function Code({ element: { props } }: ComponentRenderProps) { const data = useData(props); return <figure className="code-block">{props.title ? <figcaption>{string(props.title)}</figcaption> : null}<pre><code>{typeof data === 'string' ? data : string(props.code, string(props.content, data ? display(data) : ''))}</code></pre></figure>; }
function Diff({ element: { props } }: ComponentRenderProps) { const data = useData(props); const pair = data && typeof data === 'object' ? obj(data) : props; const code = typeof data === 'string' ? data : typeof pair.before === 'string' || typeof pair.after === 'string' ? [...string(pair.before).split('\n').map(line => `- ${line}`), ...string(pair.after).split('\n').map(line => `+ ${line}`)].join('\n') : string(props.diff, string(props.content)); return <pre className="diff">{code.split('\n').map((line, i) => <div key={i} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line || ' '}</div>)}</pre>; }
function Document({ element: { props }, children }: ComponentRenderProps) { const data = useData(props); const text=typeof props.text==='string'?props.text:typeof data==='string'?data:undefined;const path = typeof props.resourcePath === 'string' ? '?' + new URLSearchParams({ path: props.resourcePath }) : '';if(props.presentation==='window')return <WindowDocument props={props} text={text}/>; return <section className={`document${props.download ? ' document-download' : ''}`}><div className="document-heading"><FileText size={16} />{string(props.title, 'Document')}</div>{props.text || props.content || typeof data === 'string' ? <Markdown text={string(props.text, string(props.content, string(data)))} /> : null}{children}{typeof props.resourceId === 'string' && <a href={`/api/resources/${encodeURIComponent(props.resourceId)}/content${path}`} download={props.download === true || undefined} target={props.download ? undefined : '_blank'} rel="noreferrer">{string(props.linkLabel, props.download ? 'Download PDF' : 'Open granted document')}<ExternalLink size={12} /></a>}</section>; }
function Progress({ element: { props } }: ComponentRenderProps) { const source = useData(props); const value = Number(source ?? props.value); const max = Number(props.max) || 100; return <div className="surface-progress"><div>{string(props.label)}{Number.isFinite(value) && <span>{value} / {max}</span>}</div><progress aria-label={string(props.label, 'Progress')} value={Number.isFinite(value) ? value : undefined} max={max} /></div>; }
function Timeline({ element: { props } }: ComponentRenderProps) { const items = list(useData(props) ?? props.items); return <ol className="timeline">{items.map((entry, i) => { const item = obj(entry); return <li key={i}><span className={`timeline-dot tone-${string(item.status)}`} /><div><strong>{string(item.title, string(item.label))}</strong>{item.description ? <p>{string(item.description)}</p> : null}</div><small>{string(item.time, string(item.status))}</small></li>; })}</ol>; }
function Evidence({ element: { props } }: ComponentRenderProps) { const data = useData(props); const href = string(props.href); return <div className="evidence"><Check size={14} /><div>{string(props.label, string(props.title, 'Evidence'))}{props.source ? <small>{string(props.source)}</small> : null}{data !== undefined && <pre>{display(data)}</pre>}</div>{/^https?:\/\//.test(href) && <a aria-label="Open evidence source" href={href} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</div>; }
function Notice({ element: { props }, children }: ComponentRenderProps) { return <div className={`notice tone-${string(props.tone)}`}><AlertTriangle size={15} /><div>{props.title ? <strong>{string(props.title)}</strong> : null}{props.text ? <p>{string(props.text)}</p> : null}{children}</div></div>; }
function Tabs({ element: { props }, children, bindings }: ComponentRenderProps) {
  const [value, setValue] = useField(props, bindings), store = useStateStore(), artifactTitle = useContext(ArtifactTitle);
  const labels = list(props.labels), active = labels.includes(value) ? value : labels[0];
  const parsed = tabStateData.safeParse(typeof props.statusBinding === 'string' ? store.get(`/inputs/${props.statusBinding}`) : undefined);
  const source = parsed.success ? parsed.data : undefined;
  const selected = source?.items.find(item => item.label === active);
  if (new Set(labels).size !== labels.length) return <p role="alert">This saved tab view is invalid because its labels are not unique.</p>;
  return <div className={source ? 'task-tabs-operation' : undefined}>
    {source && (source.title || source.detail || source.status) && <header className="task-tabs-operation-header"><div>{source.title && source.title !== artifactTitle && <strong>{source.title}</strong>}{source.detail && <span>{source.detail}</span>}</div>{source.status && <StatusIcon status={source.status} />}</header>}
    <div className="surface-tabs" role="tablist" aria-label={string(props.label, 'Views')}>{labels.map((label, i) => {
      const status = source?.items.find(item => item.label === label)?.status;
      return <button type="button" key={i} role="tab" tabIndex={active === label ? 0 : -1} aria-selected={active === label} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? labels.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + labels.length) % labels.length; setValue(labels[index]); (event.currentTarget.parentElement?.children[index] as HTMLElement | undefined)?.focus(); } }} onClick={() => setValue(label)}>{source && <span className={`task-tab-status-slot status-${status??'neutral'}`} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:14,height:14,flex:'0 0 14px'}} aria-hidden="true">{status && status !== 'neutral' && <StatusIcon status={status} />}</span>}<span className="task-tab-label">{display(label)}</span></button>;
    })}</div>
    {Children.toArray(children).map((child, i) => <div role="tabpanel" className="task-tab-panel" key={i} hidden={active !== labels[i]}>{child}</div>)}
    {source?.footer && <footer className="task-tabs-operation-footer"><span>{source.footer.label}</span><div>{(selected?.code ?? source.footer.code) && <code>{selected?.code ?? source.footer.code}</code>}{(selected?.detail ?? source.footer.detail) && <small>{selected?.detail ?? source.footer.detail}</small>}</div></footer>}
    {typeof props.statusBinding === 'string' && !parsed.success && <small className="muted">Operation details unavailable.</small>}
  </div>;
}
function Badge({ element: { props } }: ComponentRenderProps) { return <span className={`badge tone-${string(props.tone)}`}>{string(props.text, string(props.label))}</span>; }
function Form({ element: { props }, children }: ComponentRenderProps) {
  const action = useTaskAction(), store = useStateStore(), artifactTitle = useContext(ArtifactTitle), composing = useRef(false);
  return <form className="surface-form" aria-busy={action.busy} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} onSubmit={event => {
    event.preventDefault(); if (!props.actionId || composing.current || action.busy) return;
    const submitted = { ...obj(store.getSnapshot().values) };
    void action.run(string(props.actionId), mapActionPayload(props, submitted)).then(accepted => {
      if (accepted) for (const key of list(props.clearOnSuccess)) if (typeof key === 'string' && store.get(statePath(key)) === submitted[key]) store.set(statePath(key), '');
    });
  }}>{props.title && props.title !== artifactTitle ? <h3>{string(props.title)}</h3> : null}{children}{action.error && <p className="error-text" role="alert">{action.error}</p>}<button type="submit" className="primary" title={string(props.submitLabel, 'Submit')} disabled={action.busy || !props.actionId}><span className="form-submit-label">{action.busy ? 'Submitting…' : string(props.submitLabel, 'Submit')}</span><CornerDownLeft className="form-submit-icon" size={15} aria-hidden="true" /></button></form>;
}
function BoundMarkdown({ element: { props } }: ComponentRenderProps) { const data = useData(props); return <Markdown text={string(props.text, string(data))} animate />; }
function Metric({ element: { props } }: ComponentRenderProps) { const data = useData(props); return <div className="surface-metric"><span className="muted">{string(props.label)}</span><strong>{display(data ?? props.value)} {string(props.unit)}</strong></div>; }
function EvidenceList({ element: { props } }: ComponentRenderProps) { const rows = list(useData(props)); return <section>{props.title ? <h3>{string(props.title)}</h3> : null}<ul className="evidence-list">{rows.map((row, i) => { const item = obj(row); return <li key={i}><Check size={13} /><div>{typeof row === 'string' ? row : string(item.label, string(item.title, string(item.text, display(row))))}{item.source ? <small>{display(item.source)}</small> : null}</div></li>; })}</ul></section>; }
function Image({ element: { props } }: ComponentRenderProps) { const src = typeof props.resourceId === 'string' ? `/api/resources/${encodeURIComponent(props.resourceId)}/content` : /^https?:\/\//.test(string(props.src)) ? string(props.src) : undefined; return src ? <img className="surface-image" src={src} alt={string(props.alt)} loading="lazy" referrerPolicy="no-referrer" /> : <p className="muted">No granted image is available.</p>; }
function Link({ element: { props } }: ComponentRenderProps) { return /^https?:\/\//.test(string(props.href)) ? <a href={string(props.href)} target="_blank" rel="noreferrer">{string(props.label, string(props.href))}<ExternalLink size={12} /></a> : <span>{string(props.label)}</span>; }

export const registry: ComponentRegistry = {
  ...SOFTWARE_REGISTRY,
  ...IMAGE_COMPARE_REGISTRY,
  ...EVERYDAY_REGISTRY,
  ...INTERACTION_REGISTRY,
  ...EXPLORATION_REGISTRY,
  ...WORK_OBJECT_REGISTRY,
  ChoiceList, Steps, RelationshipGraph, Status, MapView,
  DocumentPreview: ({ element: { props } }) => <Suspense fallback={<p className="muted">Loading document preview…</p>}><DocumentPreview {...props as DocumentPreviewProps} /></Suspense>,
  SignaturePad: ({ element: { props } }) => <Suspense fallback={<p className="muted">Loading signature control…</p>}><SignaturePad {...props as SignaturePadProps} /></Suspense>,
  Stack: Layout, Row: props => <Layout {...props} element={{ ...props.element, props: { ...props.element.props, direction: 'row' } }} />, Grid: Layout, Split, Columns: Layout, Section: Panel, Card: Panel, Panel,
  Text, Heading, Markdown: BoundMarkdown, Metric, EvidenceList, Image,
  Input, Textarea: props => <Input {...props} element={{ ...props.element, props: { ...props.element.props, multiline: true } }} />, TextArea: props => <Input {...props} element={{ ...props.element, props: { ...props.element.props, multiline: true } }} />,
  Checkbox, Toggle: Checkbox, Select, Button, Form, Disclosure, Accordion: Disclosure, Tabs, Table, DataTable: Table, Chart, BarChart: Chart, Tree, FileTree: Tree, Document, Code, CodeBlock: Code, Diff, Progress, Timeline, Evidence, Notice, Alert: Notice, Badge, Link,
  Divider: () => <hr />, Spacer: () => <div className="surface-spacer" />,
};

export function Unsupported({ element }: ComponentRenderProps) { return <p className="notice">The component “{element.type}” is unavailable in this catalog.</p>; }
export function schemaDefaults(schema: Record<string, unknown>): unknown {
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries(obj(schema.properties)).map(([name, field]) => {
    const definition = obj(field);
    const optionalContainer = !list(schema.required).includes(name) && (definition.type === 'object' || definition.properties || definition.type === 'array');
    return [name, optionalContainer && !Object.hasOwn(definition, 'default') ? undefined : schemaDefaults(definition)];
  }).filter(([, value]) => value !== undefined));
  return undefined;
}
export function SchemaFields({ schema, value, onChange }: { schema: Record<string, unknown>; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const properties = obj(schema.properties);
  const required = list(schema.required);
  return <div className="schema-fields">{Object.entries(properties).map(([name, definition]) => <SchemaValue key={name} schema={obj(definition)} label={string(obj(definition).title, name)} value={value[name]} required={required.includes(name)} onChange={item => { const next = { ...value, [name]: item }; if (item === undefined) delete next[name]; onChange(next); }} />)}</div>;
}

function SchemaValue({ schema, label, value, required, onChange }: { schema: Record<string, unknown>; label: string; value: unknown; required: boolean; onChange: (value: unknown) => void }) {
  const omittedDraft = useRef<unknown>(undefined);
  if (value !== undefined) omittedDraft.current = value;
  if (schema.type === 'object' || schema.properties || schema.type === 'array') {
    const present = required || value !== undefined;
    const values = list(value ?? omittedDraft.current), itemSchema = obj(schema.items);
    return <fieldset className="schema-fields"><legend>{label}</legend>{!required && <label className="check-field"><input type="checkbox" checked={present} onChange={event => onChange(event.target.checked ? omittedDraft.current ?? schemaDefaults(schema) : undefined)} />Include {label}</label>}<fieldset className={present ? "schema-fields" : undefined} hidden={!present} disabled={!present}>{schema.type === 'array' ? <>{values.map((item, index) => <div key={index}><SchemaValue schema={itemSchema} label={`${label} ${index + 1}`} value={item} required onChange={next => onChange(values.map((value, position) => position === index ? next : value))} /><button type="button" className="quiet" onClick={() => onChange(values.filter((_, position) => position !== index))}>Remove {label} {index + 1}</button></div>)}<button type="button" className="secondary" disabled={typeof schema.maxItems === 'number' && values.length >= schema.maxItems} onClick={() => onChange([...values, schemaDefaults(itemSchema) ?? ''])}>Add {label}</button></> : <SchemaFields schema={schema} value={obj(value ?? omittedDraft.current)} onChange={onChange} />}</fieldset></fieldset>;
  }
  if (schema.type === 'boolean') return <label className="check-field"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />{label}</label>;
  if (Array.isArray(schema.enum)) {
    const options = schema.enum;
    return <label className="field">{label}<select required={required} value={value === undefined ? '' : String(options.findIndex(item => JSON.stringify(item) === JSON.stringify(value)))} onChange={event => onChange(event.target.value === '' ? undefined : options[Number(event.target.value)])}><option value="">Choose…</option>{options.map((option, index) => <option key={index} value={index}>{display(option)}</option>)}</select></label>;
  }
  const numeric = schema.type === 'number' || schema.type === 'integer';
  return <label className="field">{label}<input type={numeric ? 'number' : schema.format === 'email' ? 'email' : 'text'} step={schema.type === 'integer' ? 1 : 'any'} min={typeof schema.minimum === 'number' ? schema.minimum : undefined} max={typeof schema.maximum === 'number' ? schema.maximum : undefined} required={required} value={value == null ? '' : String(value)} onChange={event => onChange(numeric && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />{schema.description ? <small>{string(schema.description)}</small> : null}</label>;
}
