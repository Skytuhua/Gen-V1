import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import type {DesktopSurface, DesktopThreadExportResult} from '../packages/desktop-contract/index.ts';

const documentUrl = 'http://127.0.0.1:4317/?desktopWindow=main-1#launch=owned';
type Outcome = {result?: DesktopThreadExportResult; error?: Error};
const payload = (overrides: Record<string, unknown> = {}) => ({threadId: 'thread-a', filename: 'export-demo-2026-11-21.md', content: '<!-- gen-v1-thread-export v1 -->\n# Export demo\n', ...overrides});
const implementation = async () => {
  const module = await import('../apps/desktop/thread-export.ts').catch(() => null);
  expect(module?.createThreadExportDownloads, 'Native export must use a bounded explicit one-use download policy.').toBeTypeOf('function');
  return module!;
};

class NativeContents extends EventEmitter {
  id = 7;
  mainFrame = {url: documentUrl};
  session = new EventEmitter();
  url = documentUrl;
  destroyed = false;
  scripts: {worldId: number; code: string}[] = [];
  requests: {url: string; filename: string}[] = [];
  scriptFailure: Error | undefined;
  getURL() {return this.url;}
  isDestroyed() {return this.destroyed;}
  async executeJavaScriptInIsolatedWorld(worldId: number, scripts: {code: string}[]) {
    if (this.scriptFailure) throw this.scriptFailure;
    for (const {code} of scripts) {
      this.scripts.push({worldId, code});
      const anchor = {href: '', download: '', remove() {}, click: () => this.requests.push({url: anchor.href, filename: anchor.download})};
      runInNewContext(code, {document: {createElement: (tag: string) => {if (tag !== 'a') throw Error('Unexpected element'); return anchor;}, body: {append: () => {}}}});
    }
  }
}
class NativeDownload extends EventEmitter {
  dialog: Record<string, unknown> | undefined;
  origin = 'http://127.0.0.1:4317';
  chain: string[];
  received: number;
  cancelled = false;
  constructor(public url: string, public filename: string) {
    super(); this.chain = [url]; this.received = url.startsWith('data:') ? Buffer.from(url.split(',', 2)[1], 'base64').length : 0;
  }
  getURL() {return this.url;}
  getURLChain() {return this.chain;}
  getFilename() {return this.filename;}
  getInitiatorOrigin() {return this.origin;}
  getReceivedBytes() {return this.received;}
  setSaveDialogOptions(options: Record<string, unknown>) {this.dialog = options;}
  cancel() {this.cancelled = true;}
}
async function fixture(surface: DesktopSurface = {kind: 'main'}) {
  const module = await implementation(), policy = module.createThreadExportDownloads();
  const contents = new NativeContents(); let current = true;
  const owner = {contents, documentUrl, surface, isCurrent: () => current};
  policy.guard(contents.session as never);
  const request = (input: unknown = payload()): Promise<Outcome> => policy.export(owner as never, input).then(result => ({result}), error => ({error: error as Error}));
  const download = (changes: Partial<NativeDownload> = {}, from = contents, frame: unknown = contents.mainFrame) => {
    const requested = contents.requests.at(-1) ?? {url: 'https://example.com/unrelated.exe', filename: 'unrelated.exe'};
    const item = Object.assign(new NativeDownload(requested.url, requested.filename), changes), event = {preventDefault: vi.fn()};
    contents.session.emit('will-download', event, item, from, frame); return {item, event};
  };
  return {policy, owner, contents, request, download, revoke: () => {current = false;}};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

it('keeps an ordinary download denied without an explicit thread export request', async () => {
  const f = await fixture(), {event} = f.download(); expect(event.preventDefault).toHaveBeenCalledOnce();
});

it('admits the exact Markdown payload once and acknowledges only a completed native save', async () => {
  const f = await fixture(), pending = f.request(); let settled = false; void pending.then(() => {settled = true;});
  await Promise.resolve();
  const request = f.contents.requests[0], text = Buffer.from(request.url.split(',', 2)[1], 'base64').toString('utf8');
  expect(text).toBe(payload().content); expect(request.filename).toBe('export-demo-2026-11-21.md');
  expect(request.url).toMatch(/^data:text\/markdown;charset=utf-8;harness-thread-export=[a-f0-9]+;base64,/);
  expect(f.contents.scripts[0].worldId).not.toBe(0); expect(f.contents.scripts[0].worldId).not.toBe(999);
  const {item, event} = f.download(); expect(event.preventDefault).not.toHaveBeenCalled();
  expect(item.dialog).toMatchObject({title: 'Export thread', defaultPath: 'export-demo-2026-11-21.md', filters: [{name: 'Markdown', extensions: ['md']}]});
  await Promise.resolve(); expect(settled).toBe(false);
  const replay = f.download(); expect(replay.event.preventDefault).toHaveBeenCalledOnce();
  item.emit('done', {}, 'completed');
  expect(await pending).toEqual({result: {status: 'saved', admitted: true, filename: request.filename, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex')}});
  expect(f.contents.listenerCount('destroyed')).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

it.each<DesktopSurface>([{kind: 'thread', threadId: 'thread-a'}, {kind: 'plan', threadId: 'thread-a'}, {kind: 'workspace', threadId: 'thread-a', tab: 'context'}])('allows the owning detached %j surface', async surface => {
  const f = await fixture(surface), pending = f.request(); await Promise.resolve(); const {item, event} = f.download();
  expect(event.preventDefault).not.toHaveBeenCalled(); item.emit('done', {}, 'cancelled'); expect((await pending).result?.status).toBe('cancelled');
});

it.each<DesktopSurface>([{kind: 'plugin', pluginId: 'plugin-a', scopeId: 'scope-a', surfaceId: 'view-a'}, {kind: 'browser', browserId: 'browser-a'}, {kind: 'navigation'}, {kind: 'usage', threadId: 'thread-a'}, {kind: 'thread', threadId: 'foreign'}, {kind: 'plan', threadId: 'foreign'}, {kind: 'workspace', threadId: 'foreign', tab: 'context'}, {kind: 'workspace', tab: 'context'}])('refuses a surface without this export authority: %j', async surface => {
  const f = await fixture(surface); expect((await f.request()).error).toBeInstanceOf(Error); expect(f.contents.requests).toHaveLength(0);
});

it.each(['origin', 'url', 'filename', 'chain', 'frame', 'contents'] as const)('does not consume the permit for a foreign %s', async field => {
  const f = await fixture(), pending = f.request(); await Promise.resolve();
  const changes: Partial<NativeDownload> = field === 'origin' ? {origin: ''} : field === 'url' ? {url: 'https://example.com/file.md'} : field === 'filename' ? {filename: 'other.md'} : field === 'chain' ? {chain: ['https://example.com/redirect']} : {};
  const denied = f.download(changes, field === 'contents' ? new NativeContents() : f.contents, field === 'frame' ? {url: documentUrl} : f.contents.mainFrame);
  expect(denied.event.preventDefault).toHaveBeenCalledOnce();
  const admitted = f.download(); expect(admitted.event.preventDefault).not.toHaveBeenCalled(); admitted.item.emit('done', {}, 'cancelled');
  expect((await pending).result?.status).toBe('cancelled');
});

it('refuses a changed live owner before a pending native download is admitted', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); f.revoke();
  expect(f.download().event.preventDefault).toHaveBeenCalledOnce(); expect((await pending).error).toBeInstanceOf(Error);
});

it.each(['navigation', 'destroyed', 'replacement frame'] as const)('revokes a pending export on %s', async cause => {
  const f = await fixture(), pending = f.request(); await Promise.resolve();
  if (cause === 'navigation') f.contents.emit('did-start-navigation', {}, 'https://example.com', false, true);
  else if (cause === 'destroyed') {f.contents.destroyed = true; f.contents.emit('destroyed');}
  else {f.contents.mainFrame = {url: documentUrl}; f.download();}
  expect((await pending).error).toBeInstanceOf(Error); expect(f.download().event.preventDefault).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it.each(['origin', 'url', 'filename', 'chain', 'frame'] as const)('retains only a fixed %s refusal reason until admission expiry', async field => {
  const f = await fixture(), pending = f.request(); await Promise.resolve();
  const privateValue = 'private-value-that-must-not-appear';
  const changes: Partial<NativeDownload> = field === 'origin' ? {origin: privateValue} : field === 'url' ? {url: privateValue} : field === 'filename' ? {filename: privateValue} : field === 'chain' ? {chain: [privateValue]} : {};
  expect(f.download(changes, f.contents, field === 'frame' ? {url: privateValue} : f.contents.mainFrame).event.preventDefault).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await pending).error?.message).toBe('Thread export: the native download was not admitted before expiry (refusal=' + field.toUpperCase() + '_MISMATCH).');
  expect(vi.getTimerCount()).toBe(0);
});

it('expires an unused grant and never authorizes a late matching download', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(10_000);
  expect((await pending).error).toBeInstanceOf(Error); expect(f.download().event.preventDefault).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('cancels a hung admitted save within its separate completion bound', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); const {item} = f.download();
  await vi.advanceTimersByTimeAsync(300_000); expect((await pending).error).toBeInstanceOf(Error); expect(item.cancelled).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('reports native cancellation without claiming the file was saved', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); f.download().item.emit('done', {}, 'cancelled');
  expect((await pending).result).toMatchObject({admitted: true, status: 'cancelled'});
});

it.each(['interrupted', 'short bytes'] as const)('refuses to acknowledge a completed export after %s', async failure => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); const {item} = f.download();
  if (failure === 'short bytes') item.received--;
  item.emit('done', {}, failure === 'interrupted' ? 'interrupted' : 'completed'); expect((await pending).error).toBeInstanceOf(Error);
});

it('cleans the admitted export when the native received-byte getter throws', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); const {item} = f.download();
  item.getReceivedBytes = () => {throw Error('private-native-getter-detail');};
  expect(() => item.emit('done', {}, 'completed')).not.toThrow();
  expect((await pending).error?.message).toBe('Thread export: native save completion could not be verified.');
  expect(item.cancelled).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(item.listenerCount('done')).toBe(0);
  expect(f.download().event.preventDefault).toHaveBeenCalledOnce();
});

it('revokes the grant when fixed-script execution fails', async () => {
  const f = await fixture(); f.contents.scriptFailure = Error('Frame execution refused');
  expect((await f.request()).error?.message).toContain('Frame execution refused'); expect(f.download().event.preventDefault).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('cleans native authority immediately when script dispatch throws synchronously', async () => {
  const f = await fixture();
  f.contents.executeJavaScriptInIsolatedWorld = () => {throw Error('Native dispatch threw');};
  expect((await f.request()).error?.message).toContain('Native dispatch threw');
  expect(vi.getTimerCount()).toBe(0); expect(f.contents.listenerCount('destroyed')).toBe(0); expect(f.contents.listenerCount('did-start-navigation')).toBe(0);
  expect(f.download().event.preventDefault).toHaveBeenCalledOnce();
});

it('does not replace a live export with a second same-window request', async () => {
  const f = await fixture(), first = f.request(); await Promise.resolve(); expect((await f.request()).error).toBeInstanceOf(Error);
  expect(f.contents.requests).toHaveLength(1); f.download().item.emit('done', {}, 'cancelled'); expect((await first).result?.status).toBe('cancelled');
});

it('bounds active exports across windows and releases capacity after terminal cancellation', async () => {
  const policy = (await implementation()).createThreadExportDownloads();
  const entries = Array.from({length: 5}, (_, index) => {
    const contents = new NativeContents(); contents.id += index; policy.guard(contents.session as never);
    const owner = {contents, surface: {kind: 'main'}, documentUrl, isCurrent: () => true};
    const request = (): Promise<Outcome> => policy.export(owner as never, payload()).then(result => ({result}), error => ({error}));
    return {contents, request};
  });
  const pending = entries.slice(0, 4).map(entry => entry.request()); await Promise.resolve();
  expect((await entries[4].request()).error).toBeInstanceOf(Error); expect(entries[4].contents.requests).toHaveLength(0);
  entries[0].contents.emit('destroyed'); expect((await pending[0]).error).toBeInstanceOf(Error);
  const next = entries[4].request(); await Promise.resolve(); expect(entries[4].contents.requests).toHaveLength(1);
  for (const entry of entries.slice(1)) entry.contents.emit('destroyed');
  await Promise.all([...pending, next]); expect(vi.getTimerCount()).toBe(0);
});

it('cancels an admitted native download when its owning document is destroyed', async () => {
  const f = await fixture(), pending = f.request(); await Promise.resolve(); const {item} = f.download();
  f.contents.emit('destroyed'); expect((await pending).error).toBeInstanceOf(Error); expect(item.cancelled).toBe(true);
  item.emit('done', {}, 'completed'); expect(vi.getTimerCount()).toBe(0);
});

it.each<Record<string, unknown>>([
  {threadId: 42}, {threadId: 'thread a'}, {threadId: '__proto__'},
  {filename: 'Export-Demo-2026-11-21.md'}, {filename: 'export-demo.md'}, {filename: '../escape-2026-11-21.md'}, {filename: 'no-date.md'},
  {content: 42}, {content: 'has a\0NUL'},
  {extra: 'field'},
])('rejects an invalid payload field before creating a grant: %j', async overrides => {
  const f = await fixture(); expect((await f.request(payload(overrides))).error).toBeInstanceOf(Error); expect(f.contents.requests).toHaveLength(0);
});

it.each([null, 'string', 42, ['array'], {threadId: 'thread-a', filename: 'export-demo-2026-11-21.md', content: 'x', extra: 'key'}])('rejects a malformed payload before creating a grant: %j', async input => {
  const f = await fixture(); expect((await f.request(input)).error?.message).toBe('Thread export: a valid export payload is required.');
  expect(f.contents.requests).toHaveLength(0);
});

it('bounds UTF-8 input before script execution', async () => {
  const f = await fixture();
  expect((await f.request(payload({content: 'x'.repeat(32 * 1024 * 1024 + 1)}))).error).toBeInstanceOf(Error);
  expect(f.contents.requests).toHaveLength(0);
});
