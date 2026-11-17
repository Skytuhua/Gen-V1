import {createHash, randomUUID} from 'node:crypto';
import {closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeSync, type BigIntStats} from 'node:fs';
import {join, resolve} from 'node:path';
import {crc32, inflateSync} from 'node:zlib';
import {HarnessError, type Thread} from '../contracts/index.ts';
import {toolOwnerSchema, type ToolOwner} from '../contracts/tool-effects.ts';
import type {CheckObservationV1, VisualObservationV1} from '../contracts/verification.ts';
import {verificationArtifactRecordSchema, verificationArtifactRefSchema, verificationArtifactRootSchema, type VerificationArtifactAttestation, type VerificationArtifactRecord, type VerificationArtifactRoot} from '../contracts/verification-artifacts.ts';
import {digest, type Store} from '../storage/store.ts';
import {observationMatchesThreadOwner} from './verification-gate.ts';

export const VERIFICATION_ARTIFACT_LIMITS = Object.freeze({logBytes: 64 * 1024, screenshotBytes: 8 * 1024 * 1024, executionCount: 50, executionBytes: 64 * 1024 * 1024});
const rootKind = 'verificationArtifactRoot', artifactKind = 'verificationArtifact', rootId = 'v1';
const denied = (message: string) => new HarnessError('VERIFICATION_ARTIFACT_UNAVAILABLE', message);
const identity = (stat: BigIntStats) => ({device: String(stat.dev), inode: String(stat.ino)});
const sameIdentity = (a: {device: string; inode: string}, b: {device: string; inode: string}) => a.device === b.device && a.inode === b.inode;
const sameOwner = (a: ToolOwner, b: ToolOwner) => digest(a) === digest(b);
const noFollow = constants.O_NOFOLLOW ?? 0;
const validPath = (path: string) => realpathSync(path) === resolve(path);

function privatePermissions(stat: BigIntStats): void {
  if (process.platform !== 'win32' && ((stat.mode & 0o077n) !== 0n || (process.getuid && stat.uid !== BigInt(process.getuid()))))
    throw denied('Verification artifact storage is not private to the host.');
}

function directory(path: string, privateScope = false): ReturnType<typeof identity> {
  const stat = lstatSync(path, {bigint: true});
  if (!stat.isDirectory() || stat.isSymbolicLink() || !validPath(path)) throw denied('Verification artifact storage identity changed.');
  if (privateScope) privatePermissions(stat);
  return identity(stat);
}

function currentThread(store: Store, owner: ToolOwner, exact: boolean): Thread {
  const thread = store.get<Thread>('thread', owner.threadId);
  if (!observationMatchesThreadOwner({owner}, thread) || store.get('archivedThread', owner.threadId) ||
      (exact && (thread!.runId !== owner.runId || thread!.epoch !== owner.epoch)))
    throw denied('The producing verification owner was revoked or changed.');
  return thread!;
}

function validatePng(bytes: Buffer, viewport: {width: number; height: number} | undefined): void {
  if (!viewport || !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width < 1 || viewport.height < 1 ||
      viewport.width > 8192 || viewport.height > 8192 || viewport.width * viewport.height > 16_777_216 ||
      bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw denied('Verification screenshots require a bounded PNG matching the viewport.');
  let offset = 8, dataSeen = false, dataEnded = false, ended = false, depth = 0, color = -1, interlace = 0, paletteEntries = 0;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw denied('Verification screenshot PNG is incomplete.');
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length) throw denied('Verification screenshot PNG is incomplete.');
    const letters = bytes.subarray(offset + 4, offset + 8), name = letters.toString('ascii');
    if (!letters.every(value => value >= 65 && value <= 90 || value >= 97 && value <= 122) || letters[2]! >= 97 ||
        crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw denied('Verification screenshot PNG is corrupt.');
    if (offset === 8) {
      if (name !== 'IHDR' || size !== 13 || bytes.readUInt32BE(offset + 8) !== viewport.width || bytes.readUInt32BE(offset + 12) !== viewport.height ||
          bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20]! > 1)
        throw denied('Verification screenshot PNG does not match the viewport.');
      depth = bytes[offset + 16]!; color = bytes[offset + 17]!; interlace = bytes[offset + 20]!;
      const depths: Record<number, number[]> = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
      if (!depths[color]?.includes(depth)) throw denied('Verification screenshot PNG uses an invalid pixel format.');
    } else if (name === 'IHDR') throw denied('Verification screenshot PNG has repeated dimensions.');
    if (letters[0]! < 97 && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(name)) throw denied('Verification screenshot PNG has an unknown critical chunk.');
    if (name === 'PLTE') {
      if (dataSeen || paletteEntries || color === 0 || color === 4 || !size || size % 3 || size > 768 || color === 3 && size / 3 > 2 ** depth)
        throw denied('Verification screenshot PNG has an invalid palette.');
      paletteEntries = size / 3;
    }
    if (name === 'IDAT') {
      if (dataEnded || color === 3 && !paletteEntries) throw denied('Verification screenshot PNG has invalid image data ordering.');
      dataSeen = true; compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (dataSeen) dataEnded = true;
    if (name === 'IEND') {if (size !== 0 || end !== bytes.length || !dataSeen) throw denied('Verification screenshot PNG is incomplete.'); ended = true;}
    offset = end;
  }
  if (!ended) throw denied('Verification screenshot PNG is incomplete.');
  const channels = ({0: 1, 2: 3, 3: 1, 4: 2, 6: 4} as Record<number, number>)[color]!;
  const bits = channels * depth;
  const layouts = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const passes = layouts.map(([x, y, dx, dy]) => {
    const width = Math.max(0, Math.ceil((viewport.width - x!) / dx!)), height = Math.max(0, Math.ceil((viewport.height - y!) / dy!));
    return {width, height, rowBytes: Math.ceil(width * bits / 8)};
  }).filter(pass => pass.width && pass.height);
  const expected = passes.reduce((sum, pass) => sum + (pass.rowBytes + 1) * pass.height, 0);
  // Reject before inflating. A tiny compressed PNG cannot allocate an
  // unbounded image, and an oversized stream stops at the exact scanline cap.
  if (expected > 64 * 1024 * 1024) throw denied('Verification screenshot decoded PNG exceeds the byte limit.');
  let decoded: Buffer;
  try {
    const input = Buffer.concat(compressed);
    const result = inflateSync(input, {info: true, maxOutputLength: expected}) as unknown as {buffer: Buffer; engine: {bytesWritten: number}};
    if (result.buffer.length !== expected || result.engine.bytesWritten !== input.length) throw Error('PNG scanline length mismatch');
    decoded = result.buffer;
  } catch {throw denied('Verification screenshot PNG image data is invalid or exceeds its decoded byte limit.');}
  let cursor = 0;
  for (const pass of passes) {
    let previous = Buffer.alloc(pass.rowBytes);
    for (let row = 0; row < pass.height; row++) {
      const filter = decoded[cursor++]!;
      if (filter > 4) throw denied('Verification screenshot PNG has an invalid scanline filter.');
      if (color === 3) {
        const current = Buffer.alloc(pass.rowBytes);
        for (let index = 0; index < pass.rowBytes; index++) {
          const left = index ? current[index - 1]! : 0, above = previous[index]!, upperLeft = index ? previous[index - 1]! : 0;
          const p = left + above - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - above), pc = Math.abs(p - upperLeft);
          const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft) : 0;
          current[index] = (decoded[cursor + index]! + predictor) & 255;
        }
        for (let pixel = 0; pixel < pass.width; pixel++) {
          const sample = (current[Math.floor(pixel * depth / 8)]! >> (8 - depth - pixel * depth % 8)) & (2 ** depth - 1);
          if (sample >= paletteEntries) throw denied('Verification screenshot PNG uses an absent palette entry.');
        }
        previous = current;
      }
      cursor += pass.rowBytes;
    }
  }
}

/** Host-only evidence custody under the already protected artifacts directory.
 * Constructor and reads never create storage, and no public input is a path. */
export class VerificationArtifactStore {
  private readonly parent: string;
  private readonly namespace: string;
  private readonly initialStorage: ReturnType<typeof identity>;
  constructor(private readonly store: Store) {
    this.parent = join(store.dataDir, 'artifacts');
    this.namespace = join(this.parent, 'verification-v1');
    this.initialStorage = directory(store.dataDir);
  }

  private root(create: boolean): VerificationArtifactRoot {
    const storage = directory(this.store.dataDir);
    if (!sameIdentity(storage, this.initialStorage)) throw denied('Verification storage root was replaced.');
    const retained = this.store.get(rootKind, rootId);
    if (retained) {
      const expected = verificationArtifactRootSchema.parse(retained);
      if (!sameIdentity(expected.storage, storage) || !sameIdentity(expected.artifacts, directory(this.parent)) || !sameIdentity(expected.namespace, directory(this.namespace, true)))
        throw denied('Verification artifact storage identity changed.');
      return expected;
    }
    if (!create) throw denied('Verification artifact storage has no host custody.');
    for (const path of [this.parent, this.namespace]) {
      try {mkdirSync(path, {mode: 0o700});}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
      // Validate each parent before creating its child. An existing junction
      // must not cause even a directory creation outside protected storage.
      directory(path, path === this.namespace);
    }
    return {version: 1, storage, artifacts: directory(this.parent), namespace: directory(this.namespace, true)};
  }

  private path(ref: string): string {
    const parsed = verificationArtifactRefSchema.parse(ref);
    return join(this.namespace, parsed.slice('verification-artifact:'.length) + '.bin');
  }

  private metadata(ref: string): VerificationArtifactRecord {
    verificationArtifactRefSchema.parse(ref);
    const record = verificationArtifactRecordSchema.parse(this.store.get(artifactKind, ref));
    if (record.ref !== ref) throw denied('Verification artifact reference changed.');
    return record;
  }

  private checkBudget(owner: ToolOwner, executionId: string, byteLength: number): void {
    const row = this.store.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(json_extract(body,'$.byteLength')),0) AS bytes
      FROM entities WHERE kind=? AND thread_id=? AND json_extract(body,'$.executionId')=?
      AND json_extract(body,'$.owner.projectId') IS ? AND json_extract(body,'$.owner.workspaceId') IS ?
      AND json_extract(body,'$.owner.accountBinding') IS ? AND json_extract(body,'$.owner.runId') IS ? AND json_extract(body,'$.owner.epoch')=?`)
      .get(artifactKind, owner.threadId, executionId, owner.projectId, owner.workspaceId, owner.accountBinding, owner.runId, owner.epoch) as {count: number; bytes: number};
    if (row.count >= VERIFICATION_ARTIFACT_LIMITS.executionCount || row.bytes + byteLength > VERIFICATION_ARTIFACT_LIMITS.executionBytes)
      throw denied('Verification artifact execution budget exceeded.');
  }

  write(input: {owner: ToolOwner; executionId: string; kind: 'LOG' | 'SCREENSHOT'; bytes: Buffer; viewport?: {width: number; height: number}; truncated?: boolean}): VerificationArtifactRecord {
    const owner = toolOwnerSchema.parse(input.owner);
    if (!Number.isSafeInteger(owner.epoch) || owner.epoch < 0 || Object.values(owner).some(value => typeof value === 'string' && (!value || value.length > 200)) ||
        typeof input.executionId !== 'string' || !input.executionId || input.executionId.length > 200)
      throw denied('Verification artifact owner or execution is invalid.');
    currentThread(this.store, owner, true);
    const limit = input.kind === 'LOG' ? VERIFICATION_ARTIFACT_LIMITS.logBytes : VERIFICATION_ARTIFACT_LIMITS.screenshotBytes;
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length > limit) throw denied('Verification artifact byte limit exceeded.');
    const bytes = Buffer.from(input.bytes);
    if (input.kind === 'LOG') {
      try {new TextDecoder('utf-8', {fatal: true}).decode(bytes);}
      catch {throw denied('Verification logs must be valid UTF-8.');}
      if (input.viewport) throw denied('Verification logs cannot carry screenshot metadata.');
    } else if (input.kind === 'SCREENSHOT') validatePng(bytes, input.viewport);
    else throw denied('Verification artifact kind is invalid.');
    this.checkBudget(owner, input.executionId, bytes.length);
    const root = this.root(true), ref = `verification-artifact:${randomUUID()}`, path = this.path(ref);
    let file: number | undefined, written: ReturnType<typeof identity> | undefined;
    try {
      file = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600);
      const opened = fstatSync(file, {bigint: true}); written = identity(opened);
      if (!opened.isFile() || opened.nlink !== 1n) throw denied('Verification artifact creation lost custody.');
      privatePermissions(opened);
      let offset = 0;
      while (offset < bytes.length) {const count = writeSync(file, bytes, offset, bytes.length - offset); if (!count) throw denied('Verification artifact write stopped.'); offset += count;}
      fsyncSync(file);
      const closed = fstatSync(file, {bigint: true});
      if (!sameIdentity(written, identity(closed)) || closed.size !== BigInt(bytes.length) || closed.nlink !== 1n) throw denied('Verification artifact changed during publication.');
      closeSync(file); file = undefined;
      // Retain the first namespace witness atomically with the first artifact.
      // A replacement directory cannot silently become the new trusted root.
      if (!sameIdentity(root.storage, directory(this.store.dataDir)) || !sameIdentity(root.artifacts, directory(this.parent)) || !sameIdentity(root.namespace, directory(this.namespace, true)))
        throw denied('Verification artifact storage changed during publication.');
      const retainedFile = lstatSync(path, {bigint: true});
      if (!retainedFile.isFile() || retainedFile.nlink !== 1n || !sameIdentity(written, identity(retainedFile)))
        throw denied('Verification artifact was replaced during publication.');
      const record = verificationArtifactRecordSchema.parse({version: 1, ref, owner, executionId: input.executionId, kind: input.kind,
        mediaType: input.kind === 'LOG' ? 'text/plain; charset=utf-8' : 'image/png', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
        viewport: input.viewport ?? null, truncated: input.truncated ?? false, identity: written, createdAt: new Date().toISOString()});
      this.store.internal('verification.artifact', owner.threadId, () => {
        currentThread(this.store, owner, true); this.checkBudget(owner, input.executionId, bytes.length);
        const currentRoot = this.store.get(rootKind, rootId);
        if (currentRoot && digest(currentRoot) !== digest(root)) throw denied('Verification artifact storage custody changed.');
        this.store.put(rootKind, rootId, null, root); this.store.put(artifactKind, ref, owner.threadId, record);
        return {ref, kind: record.kind, byteLength: record.byteLength};
      });
      return record;
    } catch (error) {
      if (file !== undefined) closeSync(file);
      // Failed publication may remove only the file this call created.
      try {
        if (written && sameIdentity(root.storage, directory(this.store.dataDir)) && sameIdentity(root.artifacts, directory(this.parent)) &&
            sameIdentity(root.namespace, directory(this.namespace, true)) && sameIdentity(written, identity(lstatSync(path, {bigint: true})))) unlinkSync(path);
      } catch { /* Retain an orphan rather than deleting a replacement. */ }
      throw error;
    }
  }

  read(ref: string, expectedOwner: ToolOwner, executionId: string): {metadata: VerificationArtifactRecord; bytes: Buffer} {
    const metadata = this.metadata(ref);
    if (!sameOwner(metadata.owner, expectedOwner) || metadata.executionId !== executionId) throw denied('Verification artifact belongs to another producing owner or execution.');
    currentThread(this.store, metadata.owner, false);
    const root = this.root(false), path = this.path(ref), linked = lstatSync(path, {bigint: true});
    if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== 1n || !sameIdentity(metadata.identity, identity(linked)) || !validPath(path))
      throw denied('Verification artifact physical identity changed.');
    const file = openSync(path, constants.O_RDONLY | noFollow);
    try {
      const before = fstatSync(file, {bigint: true});
      if (!before.isFile() || before.nlink !== 1n || !sameIdentity(metadata.identity, identity(before)) || before.size !== BigInt(metadata.byteLength))
        throw denied('Verification artifact byte custody changed.');
      privatePermissions(before);
      const bytes = Buffer.alloc(metadata.byteLength);
      let offset = 0;
      while (offset < bytes.length) {const count = readSync(file, bytes, offset, bytes.length - offset, offset); if (!count) throw denied('Verification artifact was truncated.'); offset += count;}
      const after = fstatSync(file, {bigint: true});
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.nlink !== 1n ||
          !sameIdentity(metadata.identity, identity(lstatSync(path, {bigint: true}))) || digest(this.root(false)) !== digest(root) ||
          createHash('sha256').update(bytes).digest('hex') !== metadata.sha256)
        throw denied('Verification artifact changed while being read.');
      return {metadata, bytes};
    } finally {closeSync(file);}
  }

  readForThread(threadId: string, ref: string): {metadata: VerificationArtifactRecord; bytes: Buffer} {
    const metadata = this.metadata(ref);
    if (metadata.owner.threadId !== threadId) throw denied('Verification artifact belongs to another thread.');
    return this.read(ref, metadata.owner, metadata.executionId);
  }

  attest(observation: CheckObservationV1 | VisualObservationV1): VerificationArtifactAttestation[] {
    const attestations: VerificationArtifactAttestation[] = [];
    for (const ref of new Set(observation.artifactRefs)) {
      try {
        const {metadata} = this.read(ref, observation.owner, observation.executionId);
        if ('screenshotDigest' in observation && metadata.kind === 'SCREENSHOT' &&
            (metadata.sha256 !== observation.screenshotDigest || digest(metadata.viewport) !== digest(observation.viewport))) continue;
        const {owner, executionId, kind, sha256, byteLength, viewport} = metadata;
        attestations.push({ref, owner, executionId, kind, sha256, byteLength, viewport});
      } catch { /* Historical metadata survives; missing custody supplies no proof. */ }
    }
    return attestations;
  }
}
