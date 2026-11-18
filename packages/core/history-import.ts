import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import {
  ARCHIVE_V1_LIMITS,
  IMPORT_PREVIEW_HEURISTIC_NOTE,
  archiveV1DocumentSchema,
  importIndexV1Schema,
  importPreviewV1Schema,
  importReceiptV1Schema,
  importStagingV1Schema,
  importedConversationV1Schema,
  type ArchiveV1Conversation,
  type ArchiveV1Document,
  type ImportAccessLinkV1,
  type ImportFieldReportV1,
  type ImportIndexV1,
  type ImportPreviewV1,
  type ImportReceiptV1,
  type ImportStagingV1,
  type ImportedConversationV1,
} from '../contracts/session-branch.ts';
import { digest, type Store } from '../storage/store.ts';

/** ArchiveV1 inert import. Validation is pure and completes before any
 * Store write; publication is one atomic host command. Imported content is
 * historical data only — it never dispatches tools, approvals, memory or
 * file effects. */

const error = (code: string, message: string, details?: unknown) => new HarnessError(code, message, details);
const formatError = (reason: string, detail: string) =>
  error('IMPORT_FORMAT_ERROR', `ArchiveV1 import rejected: ${detail}`, { reason });

export interface ImportOwner { threadId: string; projectId: string | null }
export const importOwnerKey = (owner: ImportOwner): string => owner.projectId ?? `thread:${owner.threadId}`;
const receiptIdFor = (ownerKey: string, contentDigest: string) => `${ownerKey}:${contentDigest}`;

/* ------------------------------------------------------------------ */
/* Format admission                                                    */
/* ------------------------------------------------------------------ */

const ZIP_MAGICS = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]];
const GZIP_MAGIC = [0x1f, 0x8b];
const magic = (bytes: Uint8Array, signature: number[]) =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

/** Rejects non-ArchiveV1 input before JSON parsing. Size is measured on the
 * actual encoded bytes; ZIP/gzip/binary payloads are UNSUPPORTED_IMPORT_FORMAT
 * (a separate parser admission is required, never guessed). */
export function decodeArchiveBytes(bytes: Uint8Array): ArchiveV1Document {
  if (bytes.length > ARCHIVE_V1_LIMITS.maxBytes)
    throw error('IMPORT_TOO_LARGE', `ArchiveV1 imports are limited to ${ARCHIVE_V1_LIMITS.maxBytes} bytes`, { limit: ARCHIVE_V1_LIMITS.maxBytes, actual: bytes.length });
  for (const signature of ZIP_MAGICS)
    if (magic(bytes, signature)) throw error('UNSUPPORTED_IMPORT_FORMAT', 'ZIP archives are not an admitted import format. Only ArchiveV1 JSON is supported.');
  if (magic(bytes, GZIP_MAGIC)) throw error('UNSUPPORTED_IMPORT_FORMAT', 'Compressed archives are not an admitted import format. Only ArchiveV1 JSON is supported.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw error('UNSUPPORTED_IMPORT_FORMAT', 'The import is not UTF-8 ArchiveV1 JSON. Binary and other product export formats are not supported.'); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw formatError('JSON_SYNTAX', 'The document is not valid JSON.'); }
  const parsed = archiveV1DocumentSchema.safeParse(value);
  if (!parsed.success)
    throw formatError('SCHEMA', parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
  validateArchiveSemantics(parsed.data);
  return parsed.data;
}

const TRAVERSAL = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const attachmentShape = (ref: string): boolean =>
  !TRAVERSAL.test(ref) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) && !ref.startsWith('/') && !ref.startsWith('\\') && !ref.startsWith('~') && !/[\x00-\x1f]/.test(ref);

/** Iterative checks over the whole document. Nothing is published until the
 * entire import validates. */
export function validateArchiveSemantics(doc: ArchiveV1Document): void {
  if (doc.conversations.length > ARCHIVE_V1_LIMITS.maxConversations)
    throw formatError('LIMIT_CONVERSATIONS', `At most ${ARCHIVE_V1_LIMITS.maxConversations} conversations are admitted.`);
  let total = 0;
  const externalIds = new Set<string>();
  for (const conversation of doc.conversations) {
    if (externalIds.has(conversation.externalId))
      throw formatError('DUPLICATE_ID', `Duplicate conversation externalId "${conversation.externalId}".`);
    externalIds.add(conversation.externalId);
    total += conversation.messages.length;
    if (total > ARCHIVE_V1_LIMITS.maxMessages)
      throw formatError('LIMIT_MESSAGES', `At most ${ARCHIVE_V1_LIMITS.maxMessages} messages are admitted across the document.`);
    validateConversationGraph(doc, conversation);
    for (const message of conversation.messages) {
      if (Buffer.byteLength(message.text, 'utf8') > ARCHIVE_V1_LIMITS.maxMessageTextBytes)
        throw formatError('MESSAGE_TOO_LARGE', `Message "${message.id}" exceeds ${ARCHIVE_V1_LIMITS.maxMessageTextBytes} bytes of text.`);
      for (const ref of message.attachmentRefs)
        if (!attachmentShape(ref))
          throw formatError('MALFORMED_ATTACHMENT', `attachmentRef "${ref.slice(0, 80)}" on message "${message.id}" is not an inert opaque identifier.`);
    }
  }
  if (doc.provenance !== undefined && Buffer.byteLength(JSON.stringify(doc.provenance), 'utf8') > ARCHIVE_V1_LIMITS.maxProvenanceBytes)
    throw formatError('PROVENANCE_TOO_LARGE', `provenance exceeds ${ARCHIVE_V1_LIMITS.maxProvenanceBytes} bytes.`);
}

function validateConversationGraph(doc: ArchiveV1Document, conversation: ArchiveV1Conversation): void {
  const ids = new Set<string>();
  for (const message of conversation.messages) {
    if (ids.has(message.id))
      throw formatError('DUPLICATE_ID', `Duplicate message id "${message.id}" in conversation "${conversation.externalId}".`);
    ids.add(message.id);
  }
  const foreign = new Map<string, string>();
  for (const other of doc.conversations)
    if (other !== conversation) for (const message of other.messages) foreign.set(message.id, other.externalId);
  const parent = new Map<string, string | null>();
  for (const message of conversation.messages) {
    if (message.parentId !== null) {
      if (!ids.has(message.parentId)) {
        const owner = foreign.get(message.parentId);
        throw owner !== undefined
          ? formatError('PARENT_CROSS_CONVERSATION', `Message "${message.id}" parents a message in conversation "${owner}".`)
          : formatError('PARENT_UNKNOWN', `Message "${message.id}" references missing parent "${message.parentId}".`);
      }
    }
    parent.set(message.id, message.parentId);
  }
  // Iterative three-color walk over parent edges; a 10,000-deep chain must not
  // recurse. Each node has at most one parent, so gray re-entry is a cycle.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const state = new Map<string, number>();
  for (const start of parent.keys()) {
    if (state.get(start) === BLACK) continue;
    const chain: string[] = [];
    let cursor: string | null | undefined = start;
    while (cursor != null && (state.get(cursor) ?? WHITE) !== BLACK) {
      if (state.get(cursor) === GRAY)
        throw formatError('CYCLE', `Message parent graph in "${conversation.externalId}" contains a cycle through "${cursor}".`);
      state.set(cursor, GRAY);
      chain.push(cursor);
      cursor = parent.get(cursor);
    }
    while (chain.length) state.set(chain.pop()!, BLACK);
  }
}

/** Deterministic dedup digest: normalized JSON of the whole document. */
export function archiveContentDigest(doc: ArchiveV1Document): string { return digest(doc); }

/* ------------------------------------------------------------------ */
/* Safety inspection — report only, never dereference.                 */
/* ------------------------------------------------------------------ */

const SECRET_FIELD_SUFFIXES = [
  'secret', 'password', 'passwd', 'token', 'apikey', 'accesskey', 'privatekey', 'credential', 'credentials',
  'authorization', 'clientsecret', 'refreshtoken', 'accesstoken', 'sessionid', 'cookie', 'signingkey',
  'encryptionkey', 'bearertoken', 'webhooksecret', 'privatekeymaterial',
];
const normalizedField = (field: string) => field.replace(/[^a-z0-9]/gi, '').toLowerCase();
const secretField = (field: string): boolean => {
  const normalized = normalizedField(field);
  return SECRET_FIELD_SUFFIXES.some(suffix => normalized === suffix || (normalized.endsWith(suffix) && normalized.length > suffix.length));
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`\])}]+/gi;
const CREDENTIAL_QUERY = /^(?:access_?)?(?:token|key|secret|password|passwd|signature|sig|auth|apikey|api_?key|credential|session|client_?secret)s?$/i;
const linkKind = (raw: string): { kind: ImportAccessLinkV1['kind']; host: string | null } | null => {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return { kind: 'USERINFO', host: url.host.slice(0, 200) };
    for (const key of url.searchParams.keys()) if (CREDENTIAL_QUERY.test(key)) return { kind: 'CREDENTIAL_PARAM', host: url.host.slice(0, 200) };
  } catch { /* malformed URL text is not an access-bearing link */ }
  return null;
};

export interface ImportSafetyReport {
  secretFields: ImportFieldReportV1[];
  accessLinks: ImportAccessLinkV1[];
}

/** Bounded heuristic scan of declared fields and text. It never opens an
 * attachment path, fetches a URL or resolves a reference. */
export function inspectArchiveSafety(doc: ArchiveV1Document): ImportSafetyReport {
  const secretFields: ImportFieldReportV1[] = [];
  const accessLinks: ImportAccessLinkV1[] = [];
  const push = <T>(list: T[], item: T) => { if (list.length < 256) list.push(item); };
  const scanText = (path: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    URL_PATTERN.lastIndex = 0;
    for (const match of value.matchAll(URL_PATTERN)) {
      const found = linkKind(match[0]);
      if (found) push(accessLinks, { path, kind: found.kind, host: found.host });
    }
  };
  scanText('sourceProduct', doc.sourceProduct);
  if (doc.provenance)
    for (const [field, value] of Object.entries(doc.provenance)) {
      if (secretField(field)) push(secretFields, { path: `provenance.${field}`, field });
      scanText(`provenance.${field}`, value);
    }
  doc.importWarnings?.forEach((warning, index) => scanText(`importWarnings[${index}]`, warning));
  for (const conversation of doc.conversations)
    for (const message of conversation.messages)
      scanText(`conversations.${conversation.externalId}.${message.id}`, message.text);
  return { secretFields, accessLinks };
}

/* ------------------------------------------------------------------ */
/* Staging, commit and cancellation — called inside host transactions. */
/* ------------------------------------------------------------------ */

export interface PreparedImport {
  document: ArchiveV1Document;
  digest: string;
  safety: ImportSafetyReport;
}

/** Pure admission: validate and measure before the staging transaction. */
export function prepareImport(bytes: Uint8Array): PreparedImport {
  const document = decodeArchiveBytes(bytes);
  return { document, digest: archiveContentDigest(document), safety: inspectArchiveSafety(document) };
}

function previewFor(importId: string, owner: ImportOwner, prepared: PreparedImport): ImportPreviewV1 {
  const conversations = prepared.document.conversations.length;
  const messages = prepared.document.conversations.reduce((sum, item) => sum + item.messages.length, 0);
  const attachmentRefs = prepared.document.conversations.reduce((sum, item) => sum + item.messages.reduce((inner, message) => inner + message.attachmentRefs.length, 0), 0);
  const warnings: string[] = [...(prepared.document.importWarnings ?? [])];
  if (attachmentRefs) warnings.push(`${attachmentRefs} attachment reference(s) are inert identifiers; no attachment content is imported or fetched.`);
  if (prepared.safety.accessLinks.length) warnings.push(`${prepared.safety.accessLinks.length} access-bearing link(s) were reported without being opened.`);
  return importPreviewV1Schema.parse({
    version: 1, format: 'ArchiveV1', importId, digest: prepared.digest,
    source: { sourceProduct: prepared.document.sourceProduct, exportedAt: prepared.document.exportedAt },
    counts: { conversations, messages, attachmentRefs },
    warnings: warnings.slice(0, 300),
    secretFields: prepared.safety.secretFields,
    accessLinks: prepared.safety.accessLinks,
    blocked: prepared.safety.secretFields.length > 0,
    heuristicNote: IMPORT_PREVIEW_HEURISTIC_NOTE,
    destination: { threadId: owner.threadId, projectId: owner.projectId },
  });
}

export interface StageOutcome { staged: ImportStagingV1 | null; preview: ImportPreviewV1; deduplicated: ImportReceiptV1 | null }

/** Runs inside Store.command. An identical committed digest returns the
 * existing receipt for this owner; other owners cannot observe it. */
export function stageImport(store: Store, owner: ImportOwner, prepared: PreparedImport): StageOutcome {
  const ownerKey = importOwnerKey(owner);
  const existing = store.get<ImportReceiptV1>('importReceipt', receiptIdFor(ownerKey, prepared.digest));
  if (existing) {
    const preview = previewFor(existing.importId, owner, prepared);
    return { staged: null, preview, deduplicated: existing };
  }
  const importId = randomUUID();
  const preview = previewFor(importId, owner, prepared);
  const staging = importStagingV1Schema.parse({
    version: 1, importId, owner, ownerKey, digest: prepared.digest, document: prepared.document,
    secretFields: prepared.safety.secretFields.length, blocked: prepared.safety.secretFields.length > 0,
    createdAt: new Date().toISOString(),
  });
  store.put('importStaging', staging.importId, owner.threadId, staging);
  return { staged: staging, preview, deduplicated: null };
}

/** The caller must match the recorded owner exactly — a receipt under
 * another owner's identity is never revealed. */
const fencedReceipt = (owner: ImportOwner, receipt: ImportReceiptV1 | null): ImportReceiptV1 | null =>
  receipt && receipt.ownerKey === importOwnerKey(owner) && receipt.threadId === owner.threadId && receipt.projectId === owner.projectId ? receipt : null;

export interface CommitOutcome { receipt: ImportReceiptV1; conversations: string[]; deduplicated: boolean }

/** Runs inside Store.command — the validated entity set and its receipt are
 * published atomically. A secret-classified document cannot publish. */
export function commitImport(store: Store, owner: ImportOwner, importId: string): CommitOutcome {
  const staging = store.get<ImportStagingV1>('importStaging', importId);
  if (!staging) {
    const index = store.get<ImportIndexV1>('importIndex', importId);
    const receipt = index ? fencedReceipt(owner, store.get<ImportReceiptV1>('importReceipt', index.receiptId)) : null;
    if (receipt) return { receipt, conversations: [], deduplicated: true };
    throw error('IMPORT_NOT_FOUND', 'No staged import exists under this identity.');
  }
  if (staging.owner.threadId !== owner.threadId || staging.owner.projectId !== owner.projectId)
    throw error('CAPABILITY_DENIED', 'The staged import belongs to another owner.');
  const ownerKey = staging.ownerKey;
  const existing = store.get<ImportReceiptV1>('importReceipt', receiptIdFor(ownerKey, staging.digest));
  if (existing) {
    store.remove('importStaging', importId);
    return { receipt: existing, conversations: [], deduplicated: true };
  }
  if (staging.blocked || staging.secretFields > 0)
    throw error('IMPORT_SECRET_CONTENT', 'Publication is blocked: the archive declares fields classified as secret-bearing. Remove them and import again.');
  const receipt = importReceiptV1Schema.parse({
    version: 1,
    receiptId: receiptIdFor(ownerKey, staging.digest),
    importId, ownerKey, threadId: owner.threadId, projectId: owner.projectId,
    digest: staging.digest,
    conversations: staging.document.conversations.length,
    messageCount: staging.document.conversations.reduce((sum, item) => sum + item.messages.length, 0),
    committedAt: new Date().toISOString(),
  });
  const conversationIds: string[] = [];
  for (const conversation of staging.document.conversations) {
    const record = importedConversationV1Schema.parse({
      version: 1,
      conversationId: `${importId}:${conversation.externalId}`.slice(0, 240),
      importId,
      externalId: conversation.externalId,
      owner: { threadId: owner.threadId, projectId: owner.projectId },
      sourceProduct: staging.document.sourceProduct,
      exportedAt: staging.document.exportedAt,
      messages: conversation.messages,
      attachmentOmissions: conversation.messages.reduce((sum, message) => sum + message.attachmentRefs.length, 0),
      ...(staging.document.provenance !== undefined ? { provenance: staging.document.provenance } : {}),
      ...(staging.document.importWarnings !== undefined ? { importWarnings: staging.document.importWarnings } : {}),
    });
    store.put('importedConversation', record.conversationId, owner.threadId, record);
    conversationIds.push(record.conversationId);
  }
  store.put('importReceipt', receipt.receiptId, owner.threadId, receipt);
  store.put('importIndex', importId, owner.threadId, importIndexV1Schema.parse({ version: 1, importId, receiptId: receipt.receiptId }));
  store.remove('importStaging', importId);
  return { receipt, conversations: conversationIds, deduplicated: false };
}

export interface CancelOutcome { outcome: 'STAGED_REMOVED' | 'ALREADY_COMMITTED'; importId: string; receipt: ImportReceiptV1 | null }

/** Cancellation removes only the exact staging identity before commit and
 * returns the committed receipt after commit — never half-public data. */
export function cancelImport(store: Store, owner: ImportOwner, importId: string): CancelOutcome {
  const staging = store.get<ImportStagingV1>('importStaging', importId);
  if (staging) {
    if (staging.owner.threadId !== owner.threadId || staging.owner.projectId !== owner.projectId)
      throw error('CAPABILITY_DENIED', 'The staged import belongs to another owner.');
    store.remove('importStaging', importId);
    return { outcome: 'STAGED_REMOVED', importId, receipt: null };
  }
  const index = store.get<ImportIndexV1>('importIndex', importId);
  const receipt = index ? fencedReceipt(owner, store.get<ImportReceiptV1>('importReceipt', index.receiptId)) : null;
  if (receipt) return { outcome: 'ALREADY_COMMITTED', importId, receipt };
  throw error('IMPORT_NOT_FOUND', 'No staged or committed import exists under this identity.');
}

/** Owner-fenced reads for the archive viewer. */
export function listImportedConversations(store: Store, owner: ImportOwner): ImportedConversationV1[] {
  return store.all<ImportedConversationV1>('importedConversation', owner.threadId)
    .filter(record => record.owner.threadId === owner.threadId && record.owner.projectId === owner.projectId);
}
