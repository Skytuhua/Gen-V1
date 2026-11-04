import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStateStore } from '@json-render/react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Focus, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { DOCUMENT_SCHEMAS, type DocumentPreviewProps } from '../../../packages/ui-catalog/documents';
import { bootstrap, getResourceContent } from './api';
import { documentStatePath, readVisualSignature } from './SignaturePad';
import { signatureStrokes } from '../../../packages/ui-catalog/signature-data';
import { fetchSignaturePng, pngDataUrl, useDocumentAssets } from './signature-assets';
import { createPdfDraft } from './pdf-draft';
import type { PdfDraft as Draft } from './pdf-draft-protocol';
import { documentExportEvidence, type VerifiedExportEvidence } from '../../../packages/ui-catalog/document-export-evidence';
import { useDocumentEvidence, type DocumentEvidence, type DocumentHandoffState } from './document-evidence';
import './document-preview.css';
import { ArtifactInline } from './task-context';

const MAX_BYTES = 20 * 1024 * 1024, MAX_PAGES = 200, MAX_PIXELS = 8_000_000;
const TASK_TIMEOUT = 15_000;
type Loaded = { document: PDFDocumentProxy; draft: Draft; loading: PDFDocumentLoadingTask; key: string; source: Uint8Array; sourceGrantKey: string };
type Frame = { width: number; height: number; page: number; pages: number; draft: Draft; signatureJson: string; status: string };
type Rectangle = { left: number; top: number; width: number; height: number };
let rendererPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;

/** Vite emits a local worker asset. No CDN, PDF iframe, scripting manager or annotation DOM. */
export function loadPdfRenderer() {
  return rendererPromise ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([renderer, worker]) => {
    renderer.GlobalWorkerOptions.workerSrc = worker.default; return renderer;
  }).catch(error => { rendererPromise = undefined; throw error; });
}

export function resourceContentUrl(resourceId: string, resourcePath?: string) {
  const parsed = DOCUMENT_SCHEMAS.DocumentPreview.parse({ resourceId, ...(resourcePath === undefined ? {} : { resourcePath }) });
  const query = parsed.resourcePath === undefined ? '' : `?${new URLSearchParams({ path: parsed.resourcePath })}`;
  return `/api/resources/${encodeURIComponent(parsed.resourceId)}/content${query}`;
}

/** Read incrementally: an absent or dishonest Content-Length cannot bypass the byte limit. */
export async function fetchPdfBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  if (!/^\/api\/resources\/[^/?#]+\/content(?:\?path=[^#]*)?$/.test(url)) throw new Error('Choose a PDF attachment or granted local PDF.');
  await bootstrap(); signal.throwIfAborted();
  const parsed = new URL(url, window.location.origin);
  const response = await getResourceContent(decodeURIComponent(parsed.pathname.split('/')[3]), parsed.searchParams.get('path') ?? '', signal);
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'This PDF is no longer available to this thread. Reattach it or renew its grant.' : `The PDF could not be loaded (${response.status}). Check the resource and try again.`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Preview supports PDFs up to 20 MiB.'); }
  if (!response.body) throw new Error('The PDF response was empty.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error('Preview supports PDFs up to 20 MiB.');
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('This resource is not a PDF. Choose a PDF attachment or granted file.');
  return bytes;
}

export { createPdfDraft } from './pdf-draft';

const message = (error: unknown) => error instanceof Error ? error.message : 'The PDF preview could not be displayed.';
const destroy = (task: PDFDocumentLoadingTask) => { void task.destroy().catch(() => {}); };
const grantIdentity = (grant: DocumentEvidence['resources'][number] | undefined) => grant ? JSON.stringify([grant.id, grant.threadId, grant.path, grant.identity]) : '';

/** A single viewport spring retains its velocity when focus changes mid-flight.
 * Manual input owns the viewport until the next explicit document navigation. */
function documentNavigation(view: HTMLDivElement) {
  let request = 0, lastTime = 0, x = view.scrollLeft, y = view.scrollTop, vx = 0, vy = 0;
  let left = x, top = y, intent = '', manual = false, frequency = 26;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const bounded = (value: number, maximum: number) => Math.max(0, Math.min(value, Math.max(0, maximum)));
  const position = (nextLeft: number, nextTop: number) => {
    if (Math.abs(view.scrollLeft - nextLeft) > .1 || Math.abs(view.scrollTop - nextTop) > .1) view.scrollTo({ left: nextLeft, top: nextTop });
  };
  const stop = () => { cancelAnimationFrame(request); request = 0; vx = 0; vy = 0; };
  const finish = () => { stop(); x = bounded(left, view.scrollWidth - view.clientWidth); y = bounded(top, view.scrollHeight - view.clientHeight); position(x, y); };
  const spring = (value: number, velocity: number, target: number, elapsed: number) => {
    const offset = value - target, carry = velocity + frequency * offset, decay = Math.exp(-frequency * elapsed);
    return [target + (offset + carry * elapsed) * decay, (velocity - frequency * carry * elapsed) * decay];
  };
  const step = (now: number) => {
    request = 0; if (manual || !view.isConnected || document.hidden) { stop(); return; }
    const elapsed = Math.min(.05, Math.max(.001, (now - lastTime) / 1000)); lastTime = now;
    const targetX = bounded(left, view.scrollWidth - view.clientWidth), targetY = bounded(top, view.scrollHeight - view.clientHeight);
    [x, vx] = spring(x, vx, targetX, elapsed); [y, vy] = spring(y, vy, targetY, elapsed);
    x = bounded(x, view.scrollWidth - view.clientWidth); y = bounded(y, view.scrollHeight - view.clientHeight);
    position(x, y);
    if (Math.abs(x - targetX) < .2 && Math.abs(y - targetY) < .2 && Math.abs(vx) < 3 && Math.abs(vy) < 3) { finish(); return; }
    request = requestAnimationFrame(step);
  };
  const setIntent = (nextIntent: string) => { if (intent !== nextIntent) { intent = nextIntent; manual = false; } };
  const navigate = (nextIntent: string, nextLeft: number, nextTop: number) => {
    setIntent(nextIntent);
    if (manual) return;
    left = nextLeft; top = nextTop;
    if (!request) { x = view.scrollLeft; y = view.scrollTop; }
    const distance = Math.hypot(bounded(left, view.scrollWidth - view.clientWidth) - x, bounded(top, view.scrollHeight - view.clientHeight) - y);
    if (preference.matches) { finish(); return; }
    if (distance < .5 && Math.abs(vx) < 3 && Math.abs(vy) < 3) { stop(); return; }
    frequency = 28 - Math.min(7, distance / 70);
    if (!request && !document.hidden) { lastTime = performance.now(); request = requestAnimationFrame(step); }
  };
  const override = () => { manual = true; stop(); };
  const key = (event: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) override(); };
  const motionPreference = () => { if (preference.matches && !manual) finish(); };
  const visibility = () => { if (document.hidden) { if (manual) stop(); else finish(); } };
  view.addEventListener('wheel', override, { passive: true }); view.addEventListener('pointerdown', override, { passive: true }); view.addEventListener('keydown', key);
  preference.addEventListener('change', motionPreference); document.addEventListener('visibilitychange', visibility);
  return { navigate, setIntent, stop, dispose() { stop(); view.removeEventListener('wheel', override); view.removeEventListener('pointerdown', override); view.removeEventListener('keydown', key); preference.removeEventListener('change', motionPreference); document.removeEventListener('visibilitychange', visibility); } };
}

export function DocumentPreview(props: DocumentPreviewProps) {
  const store = useStateStore(), assets = useDocumentAssets(), evidence = useDocumentEvidence(), validation = DOCUMENT_SCHEMAS.DocumentPreview.safeParse(props);
  const inline = useContext(ArtifactInline);
  const sourceUrl = validation.success ? resourceContentUrl(props.resourceId, props.resourcePath) : '';
  const [source, setSource] = useState<Uint8Array | null>(null), [frame, setFrame] = useState<Frame | null>(null);
  const [frameVisible, setFrameVisible] = useState(false);
  const [error, setError] = useState(''), [activity, setActivity] = useState('Loading PDF…'), [retry, setRetry] = useState(0);
  const [currentPage, setCurrentPage] = useState(props.page ?? 1), [zoom, setZoom] = useState(1), [focusField, setFocusField] = useState(props.fit !== 'page'), [width, setWidth] = useState(300), [height, setHeight] = useState(260), [signatureUrl, setSignatureUrl] = useState('');
  const displayedZoom = inline ? Math.min(zoom, 1) : zoom;
  const scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), generation = useRef(0), committedDocument = useRef<Loaded | null>(null), sourceOrigins = useRef(new WeakMap<Uint8Array, string>()), identity = useRef(sourceUrl);
  const navigation = useRef<ReturnType<typeof documentNavigation> | null>(null);
  const sourceHashes = useRef(new WeakMap<Uint8Array, string>()), evidenceRef = useRef(evidence); evidenceRef.current = evidence;
  const knownGrant = useRef({ id: props.resourceId, observed: false }), lastGrantKey = useRef('');
  const currentGrant = evidence?.resources.find(grant => grant.id === props.resourceId && grant.threadId === evidence.threadId);
  if (knownGrant.current.id !== props.resourceId) knownGrant.current = { id: props.resourceId, observed: false };
  if (currentGrant) knownGrant.current.observed = true;
  const grantKey = grantIdentity(currentGrant);
  const handoff = useRef<{ evidence: VerifiedExportEvidence; continuous: boolean } | null>(null);
  const committedView = useRef({ factor: 1, fit: props.fit ?? 'width' });
  const [handoffState, setHandoffState] = useState<DocumentHandoffState | null>(null);
  const notified = useRef('');
  const notifyHandoff = (operationId: string, state: DocumentHandoffState) => {
    setHandoffState(state); const key = `${operationId}:${state}`;
    if (notified.current !== key) { notified.current = key; evidenceRef.current?.onHandoffState?.(operationId, state); }
  };
  const clearCommitted = () => {
    navigation.current?.stop();
    setFrame(null); setFrameVisible(false); setGeometry({ highlight: null, signature: null });
    const previous = committedDocument.current; committedDocument.current = null;
    if (previous) destroy(previous.loading);
    if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; }
  };
  const failPreview = (cause: unknown) => {
    setError(message(cause)); setActivity('');
    if (props.exportOperationId) { clearCommitted(); notifyHandoff(props.exportOperationId, 'error'); }
  };
  const operation = evidence?.operations.find(item => item.id === props.exportOperationId);
  // Ignore cloned snapshot identity; only actual evidence/grant changes revalidate.
  const evidenceKey = props.exportOperationId ? JSON.stringify([evidence?.threadId, operation, evidence?.resources.filter(grant => operation?.resourceIds.includes(grant.id)).map(({ id, threadId, path, identity }) => ({ id, threadId, path, identity }))]) : '';
  const values = Object.fromEntries(Object.entries(props.fieldStateKeys ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, key]) => [name, store.get(documentStatePath(key))]));
  const valuesJson = JSON.stringify(values), signatureJson = JSON.stringify(props.signatureStateKey ? store.get(documentStatePath(props.signatureStateKey)) ?? null : null), boxJson = JSON.stringify(props.signatureBox ?? null);
  const active = props.activeFieldStateKey ? store.get(documentStatePath(props.activeFieldStateKey)) : null, activeName = typeof active === 'string' ? active : '';
  const signatureField = activeName === props.signatureStateKey && props.signatureBox ? { name: activeName, page: props.signatureBox.page, rect: [props.signatureBox.x, props.signatureBox.y, props.signatureBox.x + props.signatureBox.width, props.signatureBox.y + props.signatureBox.height] } : undefined;
  const field = focusField ? frame?.draft.fields.find(item => item.name === activeName || props.fieldStateKeys?.[item.name] === activeName) ?? signatureField : undefined;
  const fitPage = props.fit === 'page' || !focusField || inline && Boolean(props.activeFieldStateKey && (!activeName || frame && !field));
  const selectedPage = field?.page ?? currentPage;
  const draftKey = `${valuesJson}|${signatureJson}|${boxJson}`;
  const latestView = useRef({ activeName, focusField, currentPage }); latestView.current = { activeName, focusField, currentPage };
  let mark: ReturnType<typeof readVisualSignature> = null, signatureValid = true; try { mark = readVisualSignature(JSON.parse(signatureJson)); } catch { signatureValid = false; /* The worker reports invalid durable state. */ }
  const pendingSignature = props.signatureStateKey ? assets?.preview(props.signatureStateKey) : undefined;
  useEffect(() => { setCurrentPage(props.page ?? 1); }, [props.page, sourceUrl]);
  useEffect(() => { setFocusField(props.fit !== 'page'); }, [activeName, props.fit]);
  useEffect(() => {
    const target = scroll.current; if (!target) return;
    const heightSource = target;
    const resize = new ResizeObserver(() => {
      if (target.clientWidth > (inline ? 0 : 28)) setWidth(Math.max(inline ? 1 : 160, Math.floor(target.clientWidth - 28)));
      if (heightSource.clientHeight > 96) setHeight(Math.max(inline ? 260 : 0, Math.floor(heightSource.clientHeight - 96)));
    }); resize.observe(target); if (heightSource !== target) resize.observe(heightSource); return () => resize.disconnect();
  }, [inline]);
  useEffect(() => {
    let alive = true; const controller = new AbortController(); setSignatureUrl('');
    if (mark?.kind === 'image') void (assets?.get(mark.resourceId, controller.signal) ?? fetchSignaturePng(mark.resourceId, controller.signal)).then(bytes => { if (alive) setSignatureUrl(pngDataUrl(bytes)); }).catch(() => {});
    return () => { alive = false; controller.abort(); };
  }, [signatureJson, assets]);

  useLayoutEffect(() => {
    ++generation.current; let alive = true; const controller = new AbortController();
    setSource(null); setError(''); setActivity('Loading PDF…');
    const clearFrame = clearCommitted;
    let exportEvidence: VerifiedExportEvidence | undefined;
    handoff.current = null;
    const previousGrantKey = lastGrantKey.current; lastGrantKey.current = grantKey;
    if (evidenceRef.current && knownGrant.current.observed && !currentGrant) {
      identity.current = sourceUrl; clearFrame(); failPreview(new Error('This PDF is no longer available to this thread. Reattach it or renew its grant.')); return;
    }
    if (props.exportOperationId) {
      try {
        const owner = evidenceRef.current;
        if (!owner) throw new Error('Completed PDF export evidence is unavailable. Open the source or retry.');
        exportEvidence = documentExportEvidence(owner.threadId, props.exportOperationId, owner.operations, owner.resources, props);
        if (identity.current === sourceUrl && previousGrantKey !== grantKey) clearFrame();
        const previous = committedDocument.current;
        const previousUrl = previous ? sourceOrigins.current.get(previous.source) : undefined;
        const originalUrl = resourceContentUrl(exportEvidence.source.resourceId, exportEvidence.source.resourcePath);
        const originalGrantKey = grantIdentity(owner.resources.find(grant => grant.id === exportEvidence!.source.resourceId && grant.threadId === owner.threadId));
        const continuous = Boolean(previous && previousUrl === originalUrl && previous.sourceGrantKey === originalGrantKey && sourceHashes.current.get(previous.source) === exportEvidence.sourceSha256);
        const alreadyVerified = Boolean(previous && previousUrl === sourceUrl && sourceHashes.current.get(previous.source) === exportEvidence.outputSha256);
        if (previous && !continuous && !alreadyVerified) throw new Error('The export does not match the currently displayed PDF. Open the source or retry.');
        handoff.current = { evidence: exportEvidence, continuous };
        notifyHandoff(props.exportOperationId, 'pending');
        if (!continuous && !alreadyVerified) clearFrame();
      } catch (cause) {
        identity.current = sourceUrl; clearFrame(); setError(message(cause)); setActivity(''); notifyHandoff(props.exportOperationId, 'error'); return;
      }
    } else {
      setHandoffState(null);
      const committedUrl = committedDocument.current ? sourceOrigins.current.get(committedDocument.current.source) : identity.current;
      if (committedUrl !== sourceUrl || previousGrantKey !== grantKey) clearFrame();
    }
    identity.current = sourceUrl;
    if (!sourceUrl) { setError('Choose a PDF attachment or a file within a resource grant. Check the preview properties.'); setActivity(''); return; }
    const timer = setTimeout(() => controller.abort(new Error('The PDF download timed out. Try again.')), 20_000);
    void fetchPdfBytes(sourceUrl, controller.signal).then(async bytes => {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), value => value.toString(16).padStart(2, '0')).join('');
      if (exportEvidence && hash !== exportEvidence.outputSha256) throw new Error('The saved PDF differs from the approved export. Open the source or retry.');
      if (alive) { sourceOrigins.current.set(bytes, sourceUrl); sourceHashes.current.set(bytes, hash); setSource(bytes); }
    }).catch(cause => { if (alive) { clearFrame(); setError(message(cause)); setActivity(''); if (props.exportOperationId) notifyHandoff(props.exportOperationId, 'error'); } }).finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [sourceUrl, retry, props.exportOperationId, evidenceKey, grantKey]);
  useEffect(() => () => { generation.current++; if (committedDocument.current) destroy(committedDocument.current.loading); committedDocument.current = null; }, []);
  useEffect(() => { if (!frame || frameVisible) return; const request = requestAnimationFrame(() => setFrameVisible(true)); return () => cancelAnimationFrame(request); }, [Boolean(frame), frameVisible]);

  useEffect(() => {
    if (!source || sourceOrigins.current.get(source) !== sourceUrl) return;
    const token = ++generation.current, controller = new AbortController();
    let candidate: Loaded | undefined, loading: PDFDocumentLoadingTask | undefined, task: RenderTask | undefined;
    let phaseTimer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setInterval> | undefined, frameRequest = 0;
    const temporary = document.createElement('canvas');
    const valid = () => generation.current === token && !controller.signal.aborted;
    const deadline = (label: string) => { clearTimeout(phaseTimer); phaseTimer = setTimeout(() => { if (valid()) { controller.abort(new Error(label)); task?.cancel(); if (loading && committedDocument.current?.loading !== loading) destroy(loading); failPreview(new Error(label)); } }, TASK_TIMEOUT); };
    setError(''); setActivity(frame ? 'Updating PDF preview…' : 'Preparing PDF preview…');
    const debounce = setTimeout(() => { void (async () => {
      const existing = committedDocument.current;
      if (existing?.source === source && existing.key === draftKey) candidate = existing;
      else {
        const signature = readVisualSignature(JSON.parse(signatureJson));
        const png = signature?.kind === 'image' ? await (assets?.get(signature.resourceId, controller.signal) ?? fetchSignaturePng(signature.resourceId, controller.signal)) : undefined;
        const draft = await createPdfDraft(source, JSON.parse(valuesJson), signature, JSON.parse(boxJson) ?? undefined, controller.signal, png); if (!valid()) return;
        deadline('PDF loading exceeded the preview time limit. Try again or open the source.');
        const renderer = await loadPdfRenderer(); if (!valid()) return;
        const options = { data: draft.bytes.slice(), enableXfa: false, isEvalSupported: false, useWorkerFetch: false, useWasm: false, useSystemFonts: true, stopAtErrors: true, maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4, disableAutoFetch: true, disableStream: true, disableRange: true };
        loading = renderer.getDocument(options);
        const document = await loading.promise; if (!valid()) return;
        if (!document.numPages || document.numPages > MAX_PAGES) throw new Error('Preview supports PDFs with 1 to 200 pages.');
        candidate = { document, draft, loading, source, key: draftKey, sourceGrantKey: grantKey };
      }
      const next = candidate, requested = latestView.current;
      const focus = requested.focusField ? next.draft.fields.find(item => item.name === requested.activeName || props.fieldStateKeys?.[item.name] === requested.activeName) ?? (requested.activeName === props.signatureStateKey ? signatureField : undefined) : undefined;
      const pageNumber = Math.min(next.document.numPages, Math.max(1, focus?.page ?? selectedPage));
      deadline('PDF rendering exceeded the preview time limit. Open the source or try another page.');
      const page = await next.document.getPage(pageNumber); if (!valid()) return;
      const wholePage = props.fit === 'page' || !requested.focusField || inline && Boolean(props.activeFieldStateKey && !focus);
      const base = page.getViewport({ scale: 1 }), fitScale = Math.min(width / base.width, wholePage ? height / base.height : Infinity), scale = Math.min(4, fitScale * displayedZoom);
      const viewport = page.getViewport({ scale }), raster = page.getViewport({ scale: scale * 1.8 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (raster.width * raster.height)), 8192 / raster.width, 8192 / raster.height);
      if (!(ratio > 0) || !Number.isFinite(ratio)) throw new Error('The PDF page cannot be rendered within the canvas limit.');
      temporary.width = Math.max(1, Math.floor(raster.width * ratio)); temporary.height = Math.max(1, Math.floor(raster.height * ratio));
      clearTimeout(phaseTimer);
      // PDF.js display rendering is frame scheduled. Count only time with delivered frames;
      // background/frame-starved surfaces suspend rather than consuming their CPU deadline.
      let lastTick = performance.now(), lastFrame = lastTick, activeTime = 0;
      const heartbeat = () => { lastFrame = performance.now(); if (valid()) frameRequest = requestAnimationFrame(heartbeat); };
      frameRequest = requestAnimationFrame(heartbeat);
      watchdog = setInterval(() => {
        const now = performance.now(), elapsed = now - lastTick; lastTick = now;
        if (!valid()) return;
        if (now - lastFrame > 300) { setActivity('Preview paused — waiting for display frames'); return; }
        activeTime += elapsed; setActivity('Rendering PDF…');
        if (activeTime >= TASK_TIMEOUT) { controller.abort(); task?.cancel(); failPreview(new Error('PDF rendering exceeded the preview time limit. Open the source or try another page.')); }
      }, 100);
      task = page.render({ canvas: temporary, viewport: raster, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: 1, background: '#ffffff' });
      await task.promise; if (!valid() || !canvas.current) return;
      const transition = handoff.current;
      const visible = canvas.current, context = visible.getContext('2d'); if (!context) throw new Error('Your browser could not create a PDF canvas. Open the source instead.');
      visible.width = temporary.width; visible.height = temporary.height; context.drawImage(temporary, 0, 0);
      const chosen = focus?.page === pageNumber ? focus : undefined, viewFactor = chosen ? 1.8 : 1;
      const overlayViewport = page.getViewport({ scale: scale * viewFactor });
      const locate = (rect: number[]) => { const a = overlayViewport.convertToViewportPoint(rect[0], rect[1]), b = overlayViewport.convertToViewportPoint(rect[2], rect[3]); return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }; };
      const placement = props.signatureBox;
      setGeometry({ highlight: chosen ? locate(chosen.rect) : null, signature: placement?.page === pageNumber ? locate([placement.x, placement.y, placement.x + placement.width, placement.y + placement.height]) : null });
      const previous = committedDocument.current; committedDocument.current = next;
      setFrame({ width: viewport.width, height: viewport.height, page: pageNumber, pages: next.document.numPages, draft: next.draft, signatureJson, status: `${next.draft.edited ? 'Draft preview' : 'PDF preview'} · Page ${pageNumber} of ${next.document.numPages}` }); setError(''); setActivity('');
      if (transition && transition.evidence.operationId === props.exportOperationId) { transition.continuous = false; notifyHandoff(transition.evidence.operationId, 'ready'); }
      if (previous && previous !== next) destroy(previous.loading);
    })().catch(cause => { if (valid()) failPreview(cause); }).finally(() => { clearTimeout(phaseTimer); clearInterval(watchdog); cancelAnimationFrame(frameRequest); temporary.width = 0; temporary.height = 0; if (candidate && committedDocument.current !== candidate) destroy(candidate.loading); }); }, 140);
    return () => { controller.abort(); clearTimeout(debounce); clearTimeout(phaseTimer); clearInterval(watchdog); cancelAnimationFrame(frameRequest); task?.cancel(); if (loading && committedDocument.current?.loading !== loading) destroy(loading); };
    // Primitive edit keys and page number retain renderer identity through unrelated host updates.
  }, [source, sourceUrl, draftKey, selectedPage, width, fitPage ? height : null, fitPage, props.fit, displayedZoom, inline]);

  const awaitingPage = Boolean(frame && Math.min(frame.pages, Math.max(1, selectedPage)) !== frame.page);
  const displayedFactor = useRef(1);
  // Hold editing geometry as well as pixels until the exact exported candidate
  // commits. Its reframe and the verified receipt then start in the same update.
  const waitingForExport = Boolean(props.exportOperationId && frame && committedDocument.current && sourceOrigins.current.get(committedDocument.current.source) !== sourceUrl);
  const requestedFactor = waitingForExport ? committedView.current.factor : awaitingPage ? displayedFactor.current : field && frame?.page === field.page ? 1.8 : 1;
  const factor = requestedFactor;
  const displayedFit = waitingForExport ? committedView.current.fit : fitPage ? 'page' : props.fit ?? 'width';
  if (frame && !waitingForExport) committedView.current = { factor, fit: displayedFit };
  if (!awaitingPage) displayedFactor.current = factor;
  const [geometry, setGeometry] = useState<{ highlight: Rectangle | null; signature: Rectangle | null }>({ highlight: null, signature: null });
  const navigationIntent = JSON.stringify([sourceUrl, selectedPage, activeName, focusField, displayedZoom]);
  const appliedNavigation = useRef('');
  useLayoutEffect(() => {
    const view = scroll.current; if (!view) return; const controller = documentNavigation(view); navigation.current = controller;
    return () => { controller.dispose(); if (navigation.current === controller) navigation.current = null; };
  }, []);
  // Register intent before its async candidate finishes: a wheel/scrollbar action
  // after a zoom or page click must still outrank that candidate's later commit.
  useLayoutEffect(() => { navigation.current?.setIntent(navigationIntent); }, [navigationIntent]);
  useLayoutEffect(() => {
    if (!frame || !committedDocument.current || awaitingPage || waitingForExport) { navigation.current?.stop(); return; } let alive = true;
    const navigatingDocument = committedDocument.current;
    void navigatingDocument.document.getPage(frame.page).then(page => {
      if (!alive || committedDocument.current !== navigatingDocument) return; const viewport = page.getViewport({ scale: frame.width / page.getViewport({ scale: 1 }).width * factor });
      const locate = (rect: number[]) => { const a = viewport.convertToViewportPoint(rect[0], rect[1]), b = viewport.convertToViewportPoint(rect[2], rect[3]); return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }; };
      const highlight = field?.page === frame.page ? locate(field.rect) : null;
      const box = props.signatureBox, signature = box?.page === frame.page ? locate([box.x, box.y, box.x + box.width, box.y + box.height]) : null;
      setGeometry({ highlight, signature }); const target = scroll.current; if (!target) return;
      const left = highlight ? Math.max(0, highlight.width > target.clientWidth - 28 ? highlight.left : highlight.left + highlight.width / 2 - target.clientWidth / 2 + 14) : 0, top = highlight ? Math.max(0, highlight.top + highlight.height / 2 - target.clientHeight / 2 + 14) : 0;
      // Edits, regenerated drafts, and layout updates refresh geometry without
      // taking viewport ownership again. Only an explicit navigation may pan.
      if (appliedNavigation.current !== navigationIntent) {
        appliedNavigation.current = navigationIntent;
        navigation.current?.navigate(navigationIntent, left, top);
      }
    }).catch(cause => { if (alive && committedDocument.current === navigatingDocument) failPreview(cause); });
    return () => { alive = false; };
  }, [frame?.page, frame?.width, frame?.height, JSON.stringify(field ?? null), activeName, focusField, factor, boxJson, awaitingPage, sourceUrl, waitingForExport, navigationIntent]);
  const title = props.title || 'PDF document', busy = Boolean(activity), changedSignature = Boolean(frame && props.signatureBox?.page === frame.page && (pendingSignature || signatureValid && frame.signatureJson !== signatureJson));
  const changePage = (next: number) => { setFocusField(false); setCurrentPage(next); };
  const overlay = (rect: Rectangle) => ({ left: `${rect.left / Math.max(1, (frame?.width ?? 1) * factor) * 100}%`, top: `${rect.top / Math.max(1, (frame?.height ?? 1) * factor) * 100}%`, width: `${rect.width / Math.max(1, (frame?.width ?? 1) * factor) * 100}%`, height: `${rect.height / Math.max(1, (frame?.height ?? 1) * factor) * 100}%` });
  return <section className="document-preview" aria-label={title} aria-busy={busy} data-fit={displayedFit} data-export-handoff={handoffState ?? undefined} data-preview-state={activity.includes('paused') ? 'suspended' : busy ? 'updating' : error ? 'error' : 'ready'}>
    <div className="document-preview-toolbar"><span className="document-preview-title" title={title}>{title}</span><div className="document-preview-tools">
      {activeName && <button type="button" aria-label="Focus active PDF field" title="Focus active field" aria-pressed={focusField} onClick={() => setFocusField(value => !value)}><Focus size={14} /></button>}
      <button type="button" className="document-preview-fit-page" aria-label="Fit PDF page" aria-pressed={displayedFit === 'page'} disabled={!frame} onClick={() => { setFocusField(false); setZoom(1); }}>Fit page</button>
      <button type="button" aria-label="Zoom out PDF" title="Zoom out" disabled={displayedZoom <= .5 || !frame} onClick={() => setZoom(Math.max(.5, displayedZoom - .25))}><Minus size={14} /></button><button type="button" aria-label="Zoom in PDF" title={inline ? 'Expand the preview for closer zoom' : 'Zoom in'} disabled={displayedZoom >= (inline ? 1 : 3) || !frame} onClick={() => setZoom(Math.min(inline ? 1 : 3, displayedZoom + .25))}><Plus size={14} /></button>
      {sourceUrl && <><a href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open source PDF" title="Open source PDF"><ExternalLink size={14} /></a><a href={sourceUrl} download aria-label="Download source PDF" title="Download source PDF"><Download size={14} /></a></>}
    </div></div>
    <div className="document-preview-scroll" ref={scroll} tabIndex={0} role="region" aria-label="Document viewport" hidden={!frame && Boolean(error)}><div className="document-preview-page" style={{ width: frame ? frame.width * factor : 1, height: frame ? frame.height * factor : 1, transition: frameVisible ? undefined : 'none' }}><canvas ref={canvas} role="img" aria-label={`${title}, page ${frame?.page ?? currentPage}. Form values and visual marks are a draft preview.`} />{geometry.highlight && <span key={`${frame?.page}:${activeName}`} className="document-active-field" aria-hidden="true" style={overlay(geometry.highlight)} />}
      {changedSignature && geometry.signature && <svg className="document-signature-overlay" style={overlay(geometry.signature)} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><rect width="1000" height="1000" fill="white" />{pendingSignature || mark?.kind === 'image' ? <image href={pendingSignature || signatureUrl} width="1000" height="1000" preserveAspectRatio="none" /> : mark?.kind === 'drawn' ? signatureStrokes(mark).map((stroke, index) => <polyline key={index} points={stroke.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} fill="none" stroke="#191b33" strokeWidth={1.5 * geometry.signature!.width / props.signatureBox!.width} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />) : mark?.kind === 'typed' ? <text x="0" y="650" fontFamily="Helvetica,Arial,sans-serif" fontStyle="italic" fontSize="400" fill="#191b33" textLength="980" lengthAdjust="spacingAndGlyphs">{mark.text}</text> : null}</svg>}
    </div></div>
    {error && <div className={`document-preview-failure ${frame ? 'has-frame' : ''}`} role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry preview</button>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open source PDF</a>}</div>}
    <div className="document-preview-footer"><p role="status" aria-live="polite">{frame?.status ?? (error ? 'Preview unavailable' : activity)}</p>{frame && busy && <span className="document-preview-activity">{activity}</span>}<div className="document-preview-paging" role="group" aria-label="PDF pages"><button type="button" aria-label="Previous PDF page" disabled={!frame || frame.page <= 1} onClick={() => changePage((frame?.page ?? 1) - 1)}><ChevronLeft size={14} /></button><button type="button" aria-label="Next PDF page" disabled={!frame || frame.page >= frame.pages} onClick={() => changePage((frame?.page ?? 1) + 1)}><ChevronRight size={14} /></button></div></div>
  </section>;
}
