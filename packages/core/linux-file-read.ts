import { AsyncLocalStorage } from 'node:async_hooks';
import { constants, type BigIntStats } from 'node:fs';
import { open, lstat, type FileHandle } from 'node:fs/promises';
import { posix } from 'node:path';
import { HarnessError } from '../contracts/index.ts';

export interface LinuxReadIdentity { dev: string; ino: string }
export interface LinuxReadWitness extends LinuxReadIdentity { path: string }
interface HeldNode { path: string; handle: FileHandle; identity: BigIntStats; directory: boolean }
interface ReadScope {
  descriptorPath: string;
  file: HeldNode;
  signal: AbortSignal;
  closed: boolean;
  check(): Promise<void>;
}
const scopes = new AsyncLocalStorage<ReadScope>();
const denied = () => new HarnessError('CAPABILITY_DENIED', 'The granted file could not be read through a stable ordinary-file descriptor');
const active = (signal: AbortSignal) => { if (signal.aborted) throw new HarnessError('CANCELLED', 'Filesystem operation cancelled'); };
const sameIdentity = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;
const sameContents = (left: BigIntStats, right: BigIntStats) => sameIdentity(left, right)
  && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const matches = (info: BigIntStats, identity: LinuxReadIdentity) => String(info.dev) === identity.dev && String(info.ino) === identity.ino;
function validPath(path: string): void {
  if (typeof path !== 'string' || path.length > 4096 || path.includes('\0') || !posix.isAbsolute(path)
    || posix.normalize(path) !== path || path.split('/').length > 128) throw denied();
}
function validIdentity(identity: LinuxReadIdentity): void {
  if (!/^\d+$/.test(identity.dev) || !/^\d+$/.test(identity.ino)) throw denied();
}

/** Read custody is an explicit capability for one ordinary file. It is not a
 * pathname mutation guard, credential lease, or arbitrary-code sandbox. Linux
 * O_NOFOLLOW is applied to every component relative to the preceding held
 * directory FD. Only the resulting host-owned descriptor alias enters action.
 * Namespace guards retain their separate privileged mount-broker contract. */
export async function withLinuxBoundFileRead<T>(
  path: string, signal: AbortSignal, action: (descriptorPath: string) => Promise<T>,
  options: { identity?: LinuxReadIdentity; witnesses?: readonly LinuxReadWitness[] } = {},
): Promise<T> {
  if (process.platform !== 'linux') throw denied();
  active(signal); validPath(path);
  if (options.identity) validIdentity(options.identity);
  if ((options.witnesses?.length ?? 0) > 32) throw denied();
  const nodes = new Map<string, HeldNode>();
  let scope: ReadScope | undefined;
  const hold = async (target: string, directory: boolean): Promise<HeldNode> => {
    active(signal); validPath(target);
    const parts = target.split('/').filter(Boolean);
    let current = '/';
    let parent: HeldNode | undefined;
    for (let index = -1; index < parts.length; index++) {
      if (index >= 0) current = posix.join(current, parts[index]!);
      const isDirectory = index < parts.length - 1 || directory;
      let node = nodes.get(current);
      if (node) { if (node.directory !== isDirectory) throw denied(); }
      else {
        if (nodes.size >= 256) throw denied();
        const name = parent ? `/proc/self/fd/${parent.handle.fd}/${parts[index]}` : '/';
        // NONBLOCK prevents a substituted FIFO from wedging the host before its
        // descriptor type can be checked. No writable descriptor is opened.
        const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          | (isDirectory ? constants.O_DIRECTORY : 0));
        try {
          const identity = await handle.stat({ bigint: true });
          if (isDirectory ? !identity.isDirectory() : !identity.isFile() || identity.nlink !== 1n) throw denied();
          node = { path: current, handle, identity, directory: isDirectory };
          nodes.set(current, node);
        } catch (error) { await handle.close(); throw error; }
      }
      parent = node;
    }
    if (!parent || parent.directory !== directory) throw denied();
    return parent;
  };
  try {
    for (const witness of options.witnesses ?? []) {
      validIdentity(witness);
      if (!matches((await hold(witness.path, true)).identity, witness)) throw denied();
    }
    const file = await hold(path, false);
    if (options.identity && !matches(file.identity, options.identity)) throw denied();
    const descriptorPath = '/proc/self/fd/' + file.handle.fd;
    scope = {
      descriptorPath, file, signal, closed: false,
      async check() {
        active(signal); if (this.closed) throw denied();
        try {
          for (const node of nodes.values()) {
            const [visible, held] = await Promise.all([lstat(node.path, { bigint: true }), node.handle.stat({ bigint: true })]);
            if (!sameIdentity(visible, node.identity) || !sameIdentity(held, node.identity) || visible.isSymbolicLink()
              || (node.directory ? !visible.isDirectory() || !held.isDirectory()
                : !visible.isFile() || !held.isFile() || visible.nlink !== 1n || held.nlink !== 1n
                  || !sameContents(visible, node.identity) || !sameContents(held, node.identity))) throw denied();
          }
          active(signal); if (this.closed) throw denied();
        } catch (error) { if (error instanceof HarnessError) throw error; throw denied(); }
      },
    };
    await scope.check();
    const result = await scopes.run(scope, () => action(descriptorPath));
    await scope.check();
    return result;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw denied();
  } finally {
    if (scope) scope.closed = true;
    // Closing every owned descriptor is part of completion, including errors,
    // cancellation and callbacks that leave a late asynchronous read behind.
    await Promise.allSettled([...nodes.values()].reverse().map(node => node.handle.close()));
  }
}

/** Undefined means there is no descriptor scope. Inside a scope, another path
 * is denied rather than silently falling back to a pathname-based open. */
export function readLinuxBoundFile(
  path: string, maxBytes: number, identity?: LinuxReadIdentity & { size: number },
): Promise<Buffer> | undefined {
  const scope = scopes.getStore();
  if (!scope) return undefined;
  return (async () => {
    if (path !== scope.descriptorPath || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 512 * 1024 * 1024) throw denied();
    await scope.check();
    const before = await scope.file.handle.stat({ bigint: true });
    if (identity && (!matches(before, identity) || before.size !== BigInt(identity.size))) throw denied();
    if (before.size > BigInt(maxBytes)) throw new HarnessError('RESOURCE_LIMIT', 'Resource exceeds its byte limit');
    const bytes = Buffer.alloc(Math.min(Number(before.size) + 1, maxBytes + 1));
    let length = 0;
    while (length < bytes.length) {
      active(scope.signal); if (scope.closed) throw denied();
      const part = await scope.file.handle.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > maxBytes || length > Number(before.size)) throw new HarnessError('RESOURCE_LIMIT', 'Resource grew during read');
    const after = await scope.file.handle.stat({ bigint: true });
    if (after.nlink !== 1n || !sameContents(before, after) || length !== Number(before.size)) throw denied();
    await scope.check();
    return bytes.subarray(0, length);
  })();
}
