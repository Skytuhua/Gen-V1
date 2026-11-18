import { stat } from 'node:fs/promises';
import { HarnessError, type ResourceGrant } from '../contracts/index.ts';
import type { DomainContext } from '../capabilities/index.ts';
import { digest, type Store } from '../storage/store.ts';
import { withResourceGrant } from './file-access.ts';

const SOURCE_LIMIT = 32;
type Identity = { root: string; target: string; dev: string; ino: string; directory: boolean };
type Source = { grant: ResourceGrant; grantDigest: string; relativePath: string | undefined; path: string; identity: Identity };
const stale = () => new HarnessError('STALE_REQUEST_CONTEXT', 'The original tool result authority changed.');

/** Captures only actual reads through the host DomainContext guard. Caller
 * arguments, a handle, a published DataRecord or a plugin claim are not grants.
 * Content changes in place do not rewrite the historical captured result. */
export function createContextResultLineage(options: { store: Store; threadId: string; signal: AbortSignal; assertCurrent: () => void }) {
  const sources = new Map<string, Source>();
  let observed = false, overflow = false;
  const current = (source?: Pick<Source, 'grant' | 'grantDigest'>) => {
    if (options.signal.aborted) throw stale();
    options.assertCurrent();
    const grant = source && options.store.get<ResourceGrant>('resource', source.grant.id);
    if (source && (!grant || grant.threadId !== options.threadId || digest(grant) !== source.grantDigest)) throw stale();
  };
  const identity = async (grant: ResourceGrant, path: string): Promise<Identity> => {
    const [root, target] = await Promise.all([stat(grant.path, { bigint: true }), stat(path, { bigint: true })]);
    if ((!target.isFile() && !target.isDirectory()) || target.isFile() && target.nlink !== 1n) throw stale();
    return { root: digest([String(root.dev), String(root.ino), root.isDirectory()]), target: path,
      dev: String(target.dev), ino: String(target.ino), directory: target.isDirectory() };
  };
  return {
    get observed() { return observed; },
    assertCurrent() { current(); for (const source of sources.values()) current(source); },
    wrap(context: DomainContext): DomainContext {
      return { ...context, withResource: async <T>(id: string, relativePath: string | undefined, write: boolean, action: (path: string) => Promise<T>) => {
        observed = true; current();
        const grant = options.store.get<ResourceGrant>('resource', id);
        if (!grant || grant.threadId !== options.threadId || !context.withResource) throw stale();
        const captured = { grant: structuredClone(grant), grantDigest: digest(grant) };
        // Write-capable or excessive reads cannot mint retained read authority.
        if (write || sources.size >= SOURCE_LIMIT) overflow = true;
        return context.withResource(id, relativePath, write, async path => {
          current(captured);
          const before = overflow ? undefined : await identity(grant, path); current(captured);
          const result = await action(path); current(captured);
          if (before) {
            const after = await identity(grant, path); current(captured);
            if (digest(before) !== digest(after)) throw stale();
            const key = digest([id, relativePath ?? null, path]);
            if (sources.size >= SOURCE_LIMIT && !sources.has(key)) overflow = true;
            else sources.set(key, { ...captured, relativePath, path, identity: before });
          }
          return result;
        });
      } };
    },
    async authorized(): Promise<boolean> {
      if (!observed || overflow || !sources.size) return false;
      const captured = [...sources.values()];
      async function verify(index: number): Promise<boolean> {
        current();
        const source = captured[index]; if (!source) return true;
        current(source);
        return withResourceGrant(source.grant, options.store.dataDir, source.relativePath, false, options.signal, async path => {
          current(source);
          if (path !== source.path || digest(await identity(source.grant, path)) !== digest(source.identity)) return false;
          current(source); return verify(index + 1);
        });
      }
      try { const allowed = await verify(0); for (const source of captured) current(source); return allowed; }
      catch { return false; }
    },
  };
}
