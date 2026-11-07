import {createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {HarnessError, type StartRun} from '../contracts/index.ts';
import {skillReferenceSchema} from '../contracts/skill-catalog.ts';
import {skillInvocationAuthoritySchema, skillInvocationRequestSchema, type SkillInvocationAuthority, type AdmittedSkillGuidance, type RuntimeStartInput} from '../contracts/skill-invocation.ts';
import {catalogHash, type SkillCatalogRepository} from '../skill-catalog/repository.ts';
import type {Store} from '../storage/store.ts';
import type {SkillSummary} from '../contracts/skills.ts';
import {materialize, packagePath, verifyCaptured, SKILL_INVOCATION_LIMITS, type CapturedSkill, type HarnessVersionReader} from './materialize.ts';

export {SKILL_INVOCATION_LIMITS} from './materialize.ts';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const capturedFileSchema = z.strictObject({path: z.string().min(1).max(240), bytes: z.number().int().min(0).max(SKILL_INVOCATION_LIMITS.fileBytes), digest: hash, data: z.string().max(4 * Math.ceil(SKILL_INVOCATION_LIMITS.fileBytes / 3))});
const recordSchema = z.strictObject({
  version: z.literal(1), commandId: z.string().min(1).max(240), requestDigest: hash,
  authority: skillInvocationAuthoritySchema,
  captures: z.array(z.strictObject({reference: skillReferenceSchema, files: z.array(capturedFileSchema).min(1).max(SKILL_INVOCATION_LIMITS.files)})).min(1).max(SKILL_INVOCATION_LIMITS.skills),
  seal: hash,
});
/** Host-private durable snapshot. Never include this record in messages, snapshots or HTTP responses. */
export type SkillInvocationRecord = z.infer<typeof recordSchema>;
export interface PreparedSkillInvocation {readonly record: SkillInvocationRecord; readonly guidance: readonly AdmittedSkillGuidance[]}
export interface PersonalSkillInvocationOptions {
  catalog: Pick<SkillCatalogRepository, 'checkReference'>;
  /** Synchronous current authority, derived from host records, never the submitted snapshot. */
  currentAuthority(): SkillInvocationAuthority;
  /** Persist the same 32+ byte secret across restarts, outside browser data. */
  replayKey: Uint8Array;
  /** Exact command-ID lookup in private durable host storage; absence must be null. */
  findReplay(commandId: string): unknown | null;
  readHarnessVersion?: HarnessVersionReader;
}
const deny = () => new HarnessError('SKILL_RESELECT', 'This skill is unavailable or changed. Select it again.');
const conflict = () => new HarnessError('SKILL_REPLAY_CONFLICT', 'This Send was already saved with a different payload.');
function active(signal: AbortSignal): void {if (signal.aborted) throw new HarnessError('CANCELLED', 'Skill Send cancelled.');}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new HarnessError('CANCELLED', 'Skill Send cancelled.'));
    signal.addEventListener('abort', cancelled, {once: true});
    if (signal.aborted) cancelled();
    // The catalog has no cancellation parameter; drain its read-only result without admitting it.
    pending.then(value => {signal.removeEventListener('abort', cancelled); resolve(value);}, error => {signal.removeEventListener('abort', cancelled); reject(error);});
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function bounded(captures: readonly CapturedSkill[]): void {
  if (captures.length > SKILL_INVOCATION_LIMITS.skills || captures.reduce((total, capture) => total + capture.files.reduce((size, file) => size + file.bytes, 0), 0) > SKILL_INVOCATION_LIMITS.packageBytes) throw deny();
}

/** Preparation grants guidance custody only. The parent owns atomic commit and active-run admission. */
export class PersonalSkillInvocations {
  private readonly key: Buffer;
  private readonly prepared = new WeakMap<PreparedSkillInvocation, SkillInvocationRecord>();
  private readonly settings = new WeakMap<PreparedSkillInvocation, {modelId: string; thinkingLevel?: string | null}>();
  constructor(private readonly options: PersonalSkillInvocationOptions) {
    if (options.replayKey.byteLength < 32) throw deny();
    this.key = Buffer.from(options.replayKey);
  }
  private mac(value: unknown): string {return createHmac('sha256', this.key).update(JSON.stringify(value)).digest('hex');}
  private current(expected: SkillInvocationAuthority, signal: AbortSignal): void {
    active(signal);
    try {
      const actual = skillInvocationAuthoritySchema.safeParse(this.options.currentAuthority());
      if (!actual.success || catalogHash(actual.data) !== catalogHash(expected)) throw deny();
    } catch {active(signal); throw deny();}
  }
  async prepare(raw: unknown, signal: AbortSignal): Promise<PreparedSkillInvocation> {
    active(signal);
    try {
      const request = skillInvocationRequestSchema.parse(raw), {commandId, payload} = request;
      if (Buffer.byteLength(payload.content) > 64 * 1024) throw deny();
      const authority = payload.skills[0].authority;
      if (payload.skills.some(pin => catalogHash(pin.authority) !== catalogHash(authority)) || new Set(payload.skills.map(pin => catalogHash(pin.reference))).size !== payload.skills.length) throw deny();
      this.current(authority, signal);
      const requestDigest = catalogHash(request), saved = this.options.findReplay(commandId);
      let record: SkillInvocationRecord;
      if (saved !== null) {
        record = recordSchema.parse(saved);
        bounded(record.captures);
        if (record.captures.some(capture => capture.files.some(file => file.data.length !== 4 * Math.ceil(file.bytes / 3)))) throw deny();
        const {seal, ...body} = record;
        if (!timingSafeEqual(Buffer.from(seal, 'hex'), Buffer.from(this.mac(body), 'hex'))) throw deny();
        if (record.commandId !== commandId || record.requestDigest !== requestDigest) throw conflict();
        if (catalogHash(record.authority) !== catalogHash(authority) || record.captures.length !== payload.skills.length) throw deny();
        for (const [index, capture] of record.captures.entries()) {
          if (catalogHash(capture.reference) !== catalogHash(payload.skills[index].reference)) throw deny();
          verifyCaptured(capture);
        }
      } else {
        const captures: CapturedSkill[] = [];
        for (const pin of payload.skills) {
          const context = {threadId: authority.threadId, ...(authority.projectId ? {projectId: authority.projectId} : {})};
          const recheck = async () => {
            this.current(authority, signal);
            const custody = await abortable(this.options.catalog.checkReference(pin.reference, context), signal);
            this.current(authority, signal); return custody;
          };
          const custody = await recheck();
          const capture = await materialize(pin.reference, custody, signal, () => this.current(authority, signal), recheck, this.options.readHarnessVersion);
          captures.push(capture); bounded(captures);
        }
        const body = {version: 1 as const, commandId, requestDigest, authority, captures};
        record = {...body, seal: this.mac(body)};
      }
      bounded(record.captures); this.current(authority, signal);
      const guidance = record.captures.map(capture => {
        const entry = capture.files.find(file => file.path === 'SKILL.md')!;
        const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(Buffer.from(entry.data, 'base64'));
        return {inputId: commandId, trust: 'untrusted-guidance' as const, reference: capture.reference,
          entry: {path: 'SKILL.md' as const, bytes: entry.bytes, digest: entry.digest, text},
          supportingFiles: capture.files.filter(file => file.path !== 'SKILL.md').map(({path, bytes, digest}) => ({path, bytes, digest, handle: this.mac({commandId, requestDigest, reference: capture.reference, path})})),
        };
      });
      const admission = freeze({record, guidance}); this.prepared.set(admission, record); this.settings.set(admission, {modelId: payload.modelId, thinkingLevel: payload.thinkingLevel}); return admission;
    } catch (error) {
      active(signal);
      if (error instanceof HarnessError && error.code === 'SKILL_REPLAY_CONFLICT') throw error;
      throw deny();
    }
  }
  /** Call synchronously inside the Store.command transaction, immediately before writing anything. */
  assertCurrent(admission: PreparedSkillInvocation, signal: AbortSignal): void {
    const record = this.prepared.get(admission); if (!record) throw deny(); this.current(record.authority, signal);
  }
  runtimeInput(input: StartRun, admissions: readonly PreparedSkillInvocation[], signal: AbortSignal): RuntimeStartInput {
    active(signal);
    const ids = input.inputIds ?? [input.inputId];
    if (!input.runId || !Number.isSafeInteger(input.epoch) || input.epoch < 0 || ids[0] !== input.inputId || new Set(ids).size !== ids.length || new Set(admissions.map(item => item.record.commandId)).size !== admissions.length) throw deny();
    for (const admission of admissions) {
      this.assertCurrent(admission, signal);
      const {authority, commandId} = admission.record;
      const settings = this.settings.get(admission)!;
      if (authority.threadId !== input.threadId || authority.accountId !== (input.accountId ?? null) || !ids.includes(commandId) || settings.modelId !== input.modelId || settings.thinkingLevel !== input.thinkingLevel) throw deny();
    }
    bounded(admissions.flatMap(item => item.record.captures));
    return {...input, admittedSkillGuidance: Object.freeze(admissions.flatMap(item => item.guidance))};
  }
  /** Host-only data resolver. Handles address captured files, never current filesystem paths. */
  readSupportingFile(admission: PreparedSkillInvocation, handle: string, signal: AbortSignal): Buffer {
    this.assertCurrent(admission, signal);
    for (const [index, guidance] of admission.guidance.entries()) {
      const file = guidance.supportingFiles.find(file => file.handle === handle);
      if (file) return Buffer.from(admission.record.captures[index].files.find(saved => saved.path === file.path)!.data, 'base64');
    }
    throw deny();
  }
}

/** Exact Store version read; it never consults the filesystem/Hermes projection or a latest alias. */
export function harnessVersionReader(store: Pick<Store, 'get'>): HarnessVersionReader {
  return record => {
    const saved = store.get<{skill: SkillSummary & {content: string; files: Record<string, string>}; document?: string}>('skillVersion', `${record.name}@${record.revision}`);
    if (!saved || saved.skill.name !== record.name || saved.skill.revision !== record.revision || Object.hasOwn(saved.skill.files, 'SKILL.md') || Object.keys(saved.skill.files).some(path => !packagePath(path))) throw deny();
    const document = saved.document ?? `---\nname: ${JSON.stringify(saved.skill.name)}\ndescription: ${JSON.stringify(saved.skill.description)}\n---\n\n${saved.skill.content}`;
    return {'SKILL.md': document, ...saved.skill.files};
  };
}
