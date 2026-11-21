import {createHash, randomBytes} from 'node:crypto';
import type {DownloadItem, Session, WebContents, WebFrameMain} from 'electron';
import type {DesktopSurface, DesktopThreadExportResult} from '../../packages/desktop-contract/index.ts';
import {desktopId} from '../../packages/desktop-contract/index.ts';

const MAX_BYTES = 32 * 1024 * 1024, MAX_PENDING = 4, ADMISSION_MS = 10_000, SAVE_MS = 300_000;
const WORLD = 1702;
const FILENAME = /^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$/;
type Refusal = 'NO_OWNED_EVENT' | 'CONTENTS_MISMATCH' | 'FRAME_MISMATCH' | 'ORIGIN_MISMATCH' | 'URL_MISMATCH' | 'CHAIN_MISMATCH' | 'FILENAME_MISMATCH';
export interface ThreadExportOwner {
  contents: WebContents;
  surface: DesktopSurface;
  documentUrl: string;
  isCurrent(): boolean;
}
interface Pending {
  owner: ThreadExportOwner;
  frame: WebFrameMain;
  origin: string;
  url: string;
  receipt: Omit<DesktopThreadExportResult, 'status'>;
  admitted: boolean;
  refusal: Refusal;
  item?: DownloadItem;
  timer: ReturnType<typeof setTimeout>;
  finish(error?: Error, status?: DesktopThreadExportResult['status']): void;
  done(event: unknown, state: string): void;
}
const error = (reason: string) => Error('Thread export: ' + reason);
function prepare(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) throw error('a valid export payload is required.');
  const request = payload as Record<string, unknown>;
  if (Object.keys(request).some(key => !['threadId', 'filename', 'content'].includes(key)) || !desktopId(request.threadId)) throw error('a valid export payload is required.');
  if (typeof request.filename !== 'string' || !FILENAME.test(request.filename)) throw error('a valid export filename is required.');
  if (typeof request.content !== 'string' || request.content.includes('\0')) throw error('the Markdown export content is required.');
  const bytes = Buffer.byteLength(request.content);
  if (bytes > MAX_BYTES) throw error('the export exceeds its byte bound.');
  return {filename: request.filename, content: request.content, threadId: request.threadId, bytes, sha256: createHash('sha256').update(request.content).digest('hex')};
}
function surfaceOwns(surface: DesktopSurface, threadId: string) {
  return surface.kind === 'main' || (surface.kind === 'thread' || surface.kind === 'plan' || surface.kind === 'workspace') && surface.threadId === threadId;
}
function current(entry: Pick<Pending, 'owner' | 'frame'>) {
  try {
    const {owner, frame} = entry, contents = owner.contents;
    return owner.isCurrent() && !contents.isDestroyed() && contents.getURL() === owner.documentUrl && contents.mainFrame === frame && frame.url === owner.documentUrl;
  } catch {return false;}
}

/** Same deny-by-default download guard as the project memory export lane. */
export function createThreadExportDownloads() {
  const guarded = new WeakSet<Session>(), pending = new Map<WebContents, Pending>();
  function guard(session: Session) {
    if (guarded.has(session)) return;
    guarded.add(session);
    session.on('will-download', (event, item, contents, frame) => {
      const entry = pending.get(contents);
      if (!entry || entry.admitted) {event.preventDefault(); return;}
      if (!current(entry)) {event.preventDefault(); entry.finish(error('the owning document changed.')); return;}
      try {
        const chain = item.getURLChain();
        const refusal: Refusal | undefined = contents !== entry.owner.contents ? 'CONTENTS_MISMATCH'
          : frame !== entry.frame ? 'FRAME_MISMATCH'
          : item.getInitiatorOrigin() !== entry.origin ? 'ORIGIN_MISMATCH'
          : item.getURL() !== entry.url ? 'URL_MISMATCH'
          : chain.length !== 1 || chain[0] !== entry.url ? 'CHAIN_MISMATCH'
          : item.getFilename() !== entry.receipt.filename ? 'FILENAME_MISMATCH' : undefined;
        if (refusal) {entry.refusal = refusal; event.preventDefault(); return;}
        entry.admitted = true; entry.item = item; clearTimeout(entry.timer); entry.url = '';
        item.once('done', entry.done);
        entry.timer = setTimeout(() => entry.finish(error('the native save did not complete within five minutes.')), SAVE_MS);
        item.setSaveDialogOptions({title: 'Export thread', defaultPath: entry.receipt.filename, filters: [{name: 'Markdown', extensions: ['md']}], properties: ['showOverwriteConfirmation']});
      } catch {event.preventDefault(); entry.finish(error('native download admission failed.'));}
    });
  }
  async function exportThread(owner: ThreadExportOwner, payload: unknown): Promise<DesktopThreadExportResult> {
    const prepared = prepare(payload), frame = owner.contents.mainFrame;
    if (!surfaceOwns(owner.surface, prepared.threadId) || !current({owner, frame})) throw error('the native surface does not own this thread export.');
    if (pending.has(owner.contents) || pending.size >= MAX_PENDING) throw error('another export must finish before opening this save dialog.');
    guard(owner.contents.session);
    const origin = new URL(owner.documentUrl).origin;
    if (origin === 'null') throw error('the trusted application origin is unavailable.');
    const url = 'data:text/markdown;charset=utf-8;harness-thread-export=' + randomBytes(24).toString('hex') + ';base64,' + Buffer.from(prepared.content).toString('base64');
    const script = '(()=>{const link=document.createElement("a");link.href=' + JSON.stringify(url) + ';link.download=' + JSON.stringify(prepared.filename) + ';document.body.append(link);link.click();link.remove();})()';
    return new Promise<DesktopThreadExportResult>((resolve, reject) => {
      let settled = false;
      const navigation = (details: {isMainFrame?: boolean}, _url?: string, _inPlace?: boolean, mainFrame?: boolean) => {if (details?.isMainFrame ?? mainFrame) entry.finish(error('the owning document navigated.'));};
      const destroyed = () => entry.finish(error('the owning window closed.'));
      const entry: Pending = {
        owner, frame, origin, url, admitted: false, refusal: 'NO_OWNED_EVENT',
        receipt: {admitted: true, filename: prepared.filename, bytes: prepared.bytes, sha256: prepared.sha256},
        timer: setTimeout(() => entry.finish(error('the native download was not admitted before expiry (refusal=' + entry.refusal + ').')), ADMISSION_MS),
        finish(cause, status) {
          if (settled) return; settled = true;
          clearTimeout(entry.timer); pending.delete(owner.contents); entry.url = '';
          owner.contents.removeListener('did-start-navigation', navigation); owner.contents.removeListener('destroyed', destroyed);
          if (entry.item) {entry.item.removeListener('done', entry.done); if (cause) {try {entry.item.cancel();} catch { /* The failed request stays failed if the native item already closed. */ }}}
          if (cause) reject(cause); else resolve({...entry.receipt, status: status!});
        },
        done(_event, state) {
          if (!current(entry)) {entry.finish(error('the owning document changed before save completion.')); return;}
          if (state === 'cancelled') {entry.finish(undefined, 'cancelled'); return;}
          try {
            if (state !== 'completed' || entry.item!.getReceivedBytes() !== prepared.bytes) {entry.finish(error('the native save was interrupted or its byte count changed.')); return;}
          } catch {entry.finish(error('native save completion could not be verified.')); return;}
          entry.finish(undefined, 'saved');
        },
      };
      pending.set(owner.contents, entry);
      owner.contents.on('did-start-navigation', navigation); owner.contents.once('destroyed', destroyed);
      try {
        void owner.contents.executeJavaScriptInIsolatedWorld(WORLD, [{code: script}], true).then(() => {
          if (!settled && !current(entry)) entry.finish(error('the owning document changed during export.'));
        }, cause => entry.finish(cause instanceof Error ? cause : error('the download could not start.')));
      } catch (cause) {entry.finish(cause instanceof Error ? cause : error('the download could not start.'));}
    });
  }
  return {guard, export: exportThread};
}
