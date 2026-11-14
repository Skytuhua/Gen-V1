import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useStateStore } from '@json-render/react';
import { Eraser, PenLine, Type, Upload, Undo2 } from 'lucide-react';
import type { SignaturePadProps } from '../../../packages/ui-catalog/documents';
import { MAX_SIGNATURE_POINTS, readVisualSignature, signatureStrokes, validateSignaturePng, type SignaturePoint, type VisualSignature } from '../../../packages/ui-catalog/signature-data';
import { pngDataUrl, useDocumentAssets } from './signature-assets';
import {useSecureArtifact} from './secure-artifact-context';
import '@fontsource/caveat/400.css';
import '@fontsource/dancing-script/400.css';
import './document-preview.css';
export { readVisualSignature } from '../../../packages/ui-catalog/signature-data';
export type { SignaturePoint, VisualSignature } from '../../../packages/ui-catalog/signature-data';
export const documentStatePath = (key: string) => `/values/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100_000) / 100_000;
const fromDataUrl = (url: string) => Uint8Array.from(atob(url.split(',')[1]), character => character.charCodeAt(0));
const styles = [{ label: 'Handwritten', font: 'Caveat' }, { label: 'Flowing', font: 'Dancing Script' }];
function canonicalCanvas() { const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 320; return canvas; }

export function SignaturePad({ stateKey, label = 'Your signature', initialMode = 'generate', nameStateKey }: SignaturePadProps) {
  const editable = useSecureArtifact()?.editable !== false;
  const store = useStateStore(), assets = useDocumentAssets(), path = documentStatePath(stateKey), raw = store.get(path);
  let signature: VisualSignature | null = null, stateError = '';
  try { signature = readVisualSignature(raw); } catch (error) { stateError = (error as Error).message; }
  const [mode, setMode] = useState<'draw' | 'generate' | 'upload'>(initialMode === 'type' ? 'generate' : initialMode);
  const sourceName = nameStateKey ? String(store.get(documentStatePath(nameStateKey)) ?? '') : '';
  const [name, setName] = useState(signature?.kind === 'typed' ? signature.text : sourceName);
  const [style, setStyle] = useState(0), [ready, setReady] = useState(false), [error, setError] = useState(''), [imageUrl, setImageUrl] = useState('');
  const [editingName, setEditingName] = useState(!name);
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef<{ pointerId: number | null; strokes: SignaturePoint[][] } | null>(null);
  const cursor = useRef<SignaturePoint>({ x: .2, y: .5 }), keyboard = useRef(false), uploadGeneration = useRef(0), id = useId();
  const paint = useRef<(() => void) | null>(null), ink = useRef(signature); ink.current = signature;
  const lastSave = useRef(0), nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), namePreparation = useRef<(() => void) | undefined>(undefined);
  const generatedInitial = useRef(false);
  const reveal = useRef<HTMLDivElement>(null), revealAnimation = useRef<Animation | null>(null), revealRequest = useRef(0), revealed = useRef(0);
  const inkBounds = useRef({ left: 0, right: 1 });
  useEffect(() => () => { uploadGeneration.current++; cancelQueuedGenerate(); revealAnimation.current?.cancel(); }, []);
  const section = useRef<HTMLElement>(null), [visible, setVisible] = useState(false);
  const serialized = JSON.stringify(signature), pendingUrl = assets?.preview(stateKey);
  useEffect(() => { const target = section.current; if (!target) return; const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting)); observer.observe(target); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!generatedInitial.current && nameStateKey) setName(sourceName); }, [sourceName, nameStateKey]);
  useEffect(() => { let alive = true; void Promise.all(styles.map(item => document.fonts.load(`64px "${item.font}"`))).then(() => { if (alive) setReady(true); }).catch(() => { if (alive) setError('Signature fonts could not load. Draw or upload a PNG instead.'); }); return () => { alive = false; }; }, []);
  useEffect(() => { let alive = true; setImageUrl(''); if (signature?.kind === 'image' && assets) void assets.get(signature.resourceId).then(bytes => { if (alive) setImageUrl(pngDataUrl(bytes)); }).catch(cause => { if (alive) setError((cause as Error).message); }); return () => { alive = false; }; }, [serialized, assets]);
  const write = (next: VisualSignature | null) => { uploadGeneration.current++; assets?.clear(stateKey); ink.current = next; store.set(path, next); };
  const markStrokes = () => drawing.current?.strokes ?? (signature?.kind === 'drawn' ? signatureStrokes(signature) : []);
  const saveStrokes = () => { const strokes = markStrokes().map(stroke => [...stroke]); write(strokes.length === 1 ? { kind: 'drawn', points: strokes[0] } : strokes.length ? { kind: 'drawn', strokes } : null); };
  const clear = () => { generatedInitial.current = true; uploadGeneration.current++; cancelQueuedGenerate(); drawing.current = null; keyboard.current = false; setError(''); write(null); paint.current?.(); };
  // A queued name generation is real pending work: submissions and draft transfers
  // must see it until generate() hands the mark to the signature journal.
  const cancelQueuedGenerate = () => { clearTimeout(nameTimer.current); nameTimer.current = undefined; namePreparation.current?.(); namePreparation.current = undefined; };
  const queueGenerate = (text: string) => { generatedInitial.current = true; setName(text); clearTimeout(nameTimer.current); namePreparation.current ??= assets?.beginPreparation(); nameTimer.current = setTimeout(() => { nameTimer.current = undefined; try { generate(text); } finally { namePreparation.current?.(); namePreparation.current = undefined; } }, 250); };
  const generate = (text: string, choice = style) => {
    generatedInitial.current = true; setError(''); setName(text); setStyle(choice); uploadGeneration.current++; revealRequest.current++;
    if (!text.trim()) { write(null); return; }
    if (!assets) { setError('Signature resources are unavailable in this document.'); return; }
    try {
      const target = canonicalCanvas(), context = target.getContext('2d'); if (!context) throw new Error('The signature canvas is unavailable.');
      context.fillStyle = '#191b30'; context.font = `76px "${styles[choice].font}"`;
      const size = Math.min(76, 76 * 900 / Math.max(1, context.measureText(text).width)); context.font = `${size}px "${styles[choice].font}"`;
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 480, 160);
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      let left = target.width, right = 0;
      for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) if (pixels[(y * target.width + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x + 1); }
      inkBounds.current = { left: Math.max(0, left - 2) / target.width, right: Math.min(target.width, right + 2) / target.width };
      assets.save(stateKey, fromDataUrl(target.toDataURL('image/png')));
    } catch (cause) { setError((cause as Error).message); }
  };
  useEffect(() => {
    if (editable && visible && mode === 'generate' && ready && !signature && !pendingUrl && name.trim() && !generatedInitial.current) generate(nameStateKey && !editingName ? sourceName : name);
  }, [visible, mode, ready, serialized, pendingUrl, name, sourceName, nameStateKey, editingName, editable]);
  const upload = async (file: File | undefined) => {
    if (!file) return; const generation = ++uploadGeneration.current; setError('');
    const finishPreparation=assets?.beginPreparation();
    try {
      if (!assets) throw new Error('Signature resources are unavailable in this document.');
      if (file.type !== 'image/png' || file.size > 2 * 1024 * 1024) throw new Error('Choose a PNG signature up to 2 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer()); validateSignaturePng(bytes, true);
      const bitmap = await createImageBitmap(new Blob([bytes]));
      try {
        if (generation !== uploadGeneration.current) return;
        const target = canonicalCanvas(), context = target.getContext('2d'); if (!context) throw new Error('The signature canvas is unavailable.');
        const scale = Math.min(920 / bitmap.width, 280 / bitmap.height); context.drawImage(bitmap, (960 - bitmap.width * scale) / 2, (320 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
        assets.save(stateKey, fromDataUrl(target.toDataURL('image/png')));
      } finally { bitmap.close(); }
    } catch (cause) { if (generation === uploadGeneration.current) setError((cause as Error).message); } finally {finishPreparation?.();}
  };
  useEffect(() => {
    const target = canvas.current; if (!target || mode !== 'draw') return;
    const redraw = () => {
      const bounds = target.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2); target.width = Math.max(1, Math.round(bounds.width * ratio)); target.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = target.getContext('2d'); if (!context) return; context.scale(ratio, ratio); context.strokeStyle = getComputedStyle(target).color; context.fillStyle = context.strokeStyle; context.lineWidth = 1.8; context.lineCap = 'round'; context.lineJoin = 'round';
      const saved = ink.current, strokes = drawing.current?.strokes ?? (saved?.kind === 'drawn' ? signatureStrokes(saved) : []);
      for (const stroke of strokes) { context.beginPath(); stroke.forEach((point, index) => { const x = point.x * bounds.width, y = point.y * bounds.height; if (!index) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke(); }
      if (keyboard.current) { context.beginPath(); context.arc(cursor.current.x * bounds.width, cursor.current.y * bounds.height, 3, 0, Math.PI * 2); context.fill(); }
    };
    paint.current = redraw; redraw(); const resize = new ResizeObserver(redraw); resize.observe(target); const theme = new MutationObserver(redraw); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => { if (paint.current === redraw) paint.current = null; resize.disconnect(); theme.disconnect(); };
  }, [mode, serialized]);
  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)), y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)) }; };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); keyboard.current = false; paint.current?.();
    const strokes = markStrokes().map(stroke => [...stroke]); if (strokes.flat().length > MAX_SIGNATURE_POINTS - 2) { setError('The signature reached 2000 points. Undo a stroke or clear it.'); return; }
    const point = pointAt(event); drawing.current = { pointerId: event.pointerId, strokes: [...strokes, [point, point]] }; saveStrokes();
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current || drawing.current.pointerId !== event.pointerId) return; if (drawing.current.strokes.reduce((count, stroke) => count + stroke.length, 0) < MAX_SIGNATURE_POINTS) { drawing.current.strokes.at(-1)!.push(pointAt(event)); const now = performance.now(); if (now - lastSave.current >= 100) { lastSave.current = now; saveStrokes(); } } };
  const finish = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current || drawing.current.pointerId !== event.pointerId) return; saveStrokes(); drawing.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const undo = () => { const strokes = markStrokes().slice(0, -1); drawing.current = null; write(strokes.length === 1 ? { kind: 'drawn', points: strokes[0] } : strokes.length ? { kind: 'drawn', strokes } : null); paint.current?.(); };
  const keyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (['Delete', 'Backspace', 'Escape', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault(); else return;
    if (event.key === 'Delete') { clear(); return; } if (event.key === 'Backspace') { undo(); return; } if (event.key === 'Escape') { drawing.current = null; keyboard.current = false; paint.current?.(); return; }
    keyboard.current = true;
    if (event.key === 'Enter' || event.key === ' ') { if (drawing.current) drawing.current = null; else { const strokes = markStrokes(); if (strokes.flat().length > MAX_SIGNATURE_POINTS - 2) { paint.current?.(); return; } drawing.current = { pointerId: null, strokes: [...strokes, [cursor.current, cursor.current]] }; saveStrokes(); } paint.current?.(); return; }
    const step = event.shiftKey ? .05 : .01; cursor.current = { x: clamp(cursor.current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)), y: clamp(cursor.current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)) };
    if (drawing.current && drawing.current.strokes.flat().length < MAX_SIGNATURE_POINTS) { drawing.current.strokes.at(-1)!.push(cursor.current); saveStrokes(); }
    paint.current?.();
  };
  const preview = pendingUrl || imageUrl;
  const revealGenerated = (image: HTMLImageElement) => {
    if (mode !== 'generate' || revealRequest.current === revealed.current) return;
    revealed.current = revealRequest.current; revealAnimation.current?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && reveal.current) {
      const outer = reveal.current.getBoundingClientRect(), box = image.getBoundingClientRect();
      const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight), renderedWidth = image.naturalWidth * scale;
      const start = box.left - outer.left + (box.width - renderedWidth) / 2;
      const inset = (fraction: number) => `inset(0 ${Math.max(0, 100 * (1 - (start + renderedWidth * fraction) / outer.width))}% 0 0)`;
      revealAnimation.current = reveal.current.animate([{ clipPath: inset(inkBounds.current.left), opacity: .65 }, { clipPath: inset(inkBounds.current.right), opacity: 1, offset: .9 }, { clipPath: inset(inkBounds.current.right), opacity: 1 }], { duration: 550, easing: 'linear' });
    }
  };
  const imagePreview = preview ? <img src={preview} alt="Selected visual signature" onLoad={event => revealGenerated(event.currentTarget)} /> : signature?.kind === 'drawn' ? <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Selected drawn signature" role="img">{signatureStrokes(signature).map((stroke, index) => <polyline key={index} points={stroke.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}</svg> : <span className="signature-generated-name" style={{ fontFamily: `"${styles[style].font}"` }}>{signature?.kind === 'typed' ? signature.text : ''}</span>;
  return <section ref={section} className="signature-pad" aria-labelledby={`${id}-label`}>
    <div className="signature-heading"><span id={`${id}-label`}>{label}</span></div>
    <div className="signature-modes" role="group" aria-label="Signature input method">{(['generate', 'draw', 'upload'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => { uploadGeneration.current++; cancelQueuedGenerate(); drawing.current = null; setMode(item); }}>{item === 'generate' ? <Type size={13} /> : item === 'draw' ? <PenLine size={13} /> : <Upload size={13} />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <div className="signature-well" data-mode={mode}>
      {mode === 'draw' ? <canvas ref={canvas} className="signature-canvas" tabIndex={0} role="application" aria-label="Draw visual signature" aria-describedby={`${id}-help`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyDown} /> : mode === 'generate' ? <div ref={reveal} className="signature-image-preview">{imagePreview}</div> : <label className={`signature-upload ${preview ? 'has-signature' : ''}`}>{preview ? imagePreview : <><Upload size={20} /><strong>Upload your signature</strong><span>PNG up to 2 MiB</span></>}<input type="file" accept="image/png" aria-label="Upload PNG signature" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>}
      <div className="signature-well-tools">{mode === 'generate' ? <button type="button" disabled={!ready || !name.trim()} onClick={() => generate(name, (style + 1) % styles.length)}>Another style</button> : <>{mode === 'draw' && <button type="button" aria-label="Undo last signature stroke" disabled={signature?.kind !== 'drawn'} onClick={undo}><Undo2 size={12} />Undo</button>}<button type="button" onClick={clear}><Eraser size={12} />Clear</button></>}</div>
    </div>
    <div className="signature-controls">{pendingUrl && <span role="status">Saving signature…</span>}{mode === 'generate' && <button type="button" aria-expanded={editingName} aria-controls={`${id}-name-editor`} onClick={() => setEditingName(value => !value)}>Edit name</button>}</div>
    {mode === 'generate' && editingName && <div id={`${id}-name-editor`} className="signature-name-editor"><label htmlFor={`${id}-name`}>Type your name</label><input id={`${id}-name`} className="signature-name-input" maxLength={200} value={name} placeholder="Your full name" autoComplete="name" disabled={!ready} onChange={event => queueGenerate(event.target.value)} /></div>}
    {(stateError || error || assets?.error(stateKey)) && <p className="document-error" role="status">{stateError || error || assets?.error(stateKey)}{assets?.error(stateKey) && <button type="button" onClick={() => assets.retry()}>Retry signature upload</button>}</p>}
    <details className="signature-help"><summary>Signature help</summary><p id={`${id}-help`}>Draw with your pointer, or use arrow keys to move, Enter to start or end a stroke, Backspace to undo and Delete to clear. A visual mark only; no certificate or digital signature.</p></details>
  </section>;
}
