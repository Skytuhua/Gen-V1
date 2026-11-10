import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const SOURCE_PATH = 'docs/company/requirements.md';
const SOURCE_SHA256 = '7ee0b8ee083ce9e91963e3ec5272f266a44802c7b64626f911b1771b379640bf';
const BASELINE = {
  reviewedGen: '9f23537334f2a1dc6c3bbe00d0444f8e86b57e28',
  currentService: 'bcb9ee7c6196243b2647e917a1ccb7b1d0793770',
};
const AREA_COUNTS = {
  MGR: 8, ORG: 9, EMP: 8, INT: 9, DAG: 8, SCH: 8, RUN: 8, DIST: 8, COM: 8,
  MEM: 8, CTX: 8, LRN: 8, APR: 9, AUTH: 7, TLS: 7, SEC: 9, GIT: 8, QA: 8,
  GUI: 10, VIEW: 10, MKT: 8, PUB: 8, BUS: 6, COST: 8, OPS: 8, OBS: 8, EVAL: 9,
};
const EXPECTED_COUNTS = { total: 221, areas: 27, P0: 102, P1: 100, P2: 19 };

export type ImplementationStatus = 'unassessed' | 'not_implemented' | 'partial' | 'implemented';
export type ActivationStatus = 'disabled' | 'blocked' | 'enabled';
export interface CompanyEvidence {
  kind: 'source' | 'test' | 'live' | 'review';
  reference: string;
  scope: string;
}
interface Assessment {
  implementationStatus: ImplementationStatus;
  activationStatus: ActivationStatus;
  evidence: CompanyEvidence[];
  remainingGates: string[];
}
export interface CompanyRequirement extends Assessment {
  id: string;
  area: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  owners: ('G' | 'C' | 'W' | 'U')[];
  baseline: 'preserve' | 'extend' | 'not_established';
  requiredBehavior: string;
  acceptanceProof: string;
  sourceLine: number;
}
export interface CompanyRequirementsCatalog {
  version: 1;
  sourcePath: string;
  sourceSHA256: string;
  baseline: typeof BASELINE;
  counts: typeof EXPECTED_COUNTS;
  areas: { id: string; title: string; sourceLine: number }[];
  requirements: CompanyRequirement[];
}

/** Import source requirements only. An acceptance description is never passing evidence. */
export function parseCompanyRequirements(markdown: string): CompanyRequirementsCatalog {
  const requirements: CompanyRequirement[] = [];
  const areas: CompanyRequirementsCatalog['areas'] = [];
  const seen = new Set<string>();
  const areaOrder = Object.keys(AREA_COUNTS);
  let area: CompanyRequirementsCatalog['areas'][number] | undefined;
  let headerSeen = false;
  const counts = { total: 0, areas: 0, P0: 0, P1: 0, P2: 0 };
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const heading = /^### 5\.(\d+)\. (.+) \(([A-Z]+)\)$/.exec(line);
    if (heading) {
      if (Number(heading[1]) !== areas.length + 1 || heading[3] !== areaOrder[areas.length]) {
        throw new Error(`Invalid company catalog area at source line ${index + 1}`);
      }
      area = { id: heading[3], title: heading[2], sourceLine: index + 1 };
      areas.push(area);
      headerSeen = false;
      continue;
    }
    if (line.startsWith('### 5.')) throw new Error(`Malformed catalog area at source line ${index + 1}`);
    if (/^#{1,2} /.test(line)) area = undefined;
    if (!area || !line.trimStart().startsWith('|')) continue;
    if (!line.endsWith('|')) throw new Error(`Truncated requirement table at source line ${index + 1}`);
    const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim());
    if (isDeepStrictEqual(cells, ['ID and feature', 'Priority / owner / baseline', 'Required behavior', 'Acceptance proof'])) {
      if (headerSeen) throw new Error(`Duplicate requirement table header at source line ${index + 1}`);
      headerSeen = true;
      continue;
    }
    if (cells.length === 4 && cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    if (!headerSeen || cells.length !== 4) throw new Error(`Malformed requirement table at source line ${index + 1}`);
    const identity = /^\*\*([A-Z]+-\d{2}) (.+)\*\*$/.exec(cells[0]);
    const metadata = /^(P[012]) \/ ([GCWU](?:\+[GCWU])*) \/ (preserve|extend|not established)$/.exec(cells[1]);
    if (!identity || !metadata || !cells[2] || !cells[3]) {
      throw new Error(`Malformed requirement identity, metadata, behavior or acceptance at source line ${index + 1}`);
    }
    const id = identity[1];
    const areaId = area.id;
    const owners = metadata[2].split('+') as CompanyRequirement['owners'];
    if (new Set(owners).size !== owners.length) throw new Error(`Duplicate requirement owner for ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate requirement ID ${id}`);
    const position = requirements.filter(requirement => requirement.area === areaId).length + 1;
    if (id !== `${areaId}-${String(position).padStart(2, '0')}`) throw new Error(`Missing or misplaced requirement ID ${id}`);
    seen.add(id);
    const priority = metadata[1] as CompanyRequirement['priority'];
    requirements.push({
      id, area: areaId, title: identity[2], priority, owners,
      baseline: metadata[3].replace(' ', '_') as CompanyRequirement['baseline'],
      requiredBehavior: cells[2], acceptanceProof: cells[3], sourceLine: index + 1,
      implementationStatus: 'unassessed', activationStatus: 'disabled', evidence: [], remainingGates: [],
    });
    counts[priority]++;
  }
  counts.total = requirements.length;
  counts.areas = areas.length;
  if (!isDeepStrictEqual(counts, EXPECTED_COUNTS)) throw new Error('Company requirement catalog counts do not match the 221-row source baseline');
  for (const [id, expected] of Object.entries(AREA_COUNTS)) {
    if (requirements.filter(requirement => requirement.area === id).length !== expected) {
      throw new Error(`Missing or extra requirements in catalog area ${id}`);
    }
  }
  return {
    version: 1, sourcePath: SOURCE_PATH,
    sourceSHA256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
    baseline: { ...BASELINE }, counts, areas, requirements,
  };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const assessmentKeys = ['implementationStatus', 'activationStatus', 'evidence', 'remainingGates'];

function assessment(value: Record<string, unknown>): Assessment {
  if (typeof value.implementationStatus !== 'string' || !['unassessed', 'not_implemented', 'partial', 'implemented'].includes(value.implementationStatus) ||
      typeof value.activationStatus !== 'string' || !['disabled', 'blocked', 'enabled'].includes(value.activationStatus)) {
    throw new Error(`Invalid assessment status for ${value.id}`);
  }
  if (!Array.isArray(value.evidence) || !value.evidence.every(item => record(item) &&
      isDeepStrictEqual(Object.keys(item).sort(), ['kind', 'reference', 'scope']) &&
      typeof item.kind === 'string' && ['source', 'test', 'live', 'review'].includes(item.kind) && nonempty(item.reference) && nonempty(item.scope))) {
    throw new Error(`Invalid assessment evidence for ${value.id}`);
  }
  if (!Array.isArray(value.remainingGates) || !value.remainingGates.every(nonempty)) {
    throw new Error(`Invalid assessment remaining gate for ${value.id}`);
  }
  return structuredClone({
    implementationStatus: value.implementationStatus as ImplementationStatus,
    activationStatus: value.activationStatus as ActivationStatus,
    evidence: value.evidence as CompanyEvidence[], remainingGates: value.remainingGates as string[],
  });
}

/** Validate immutable source fidelity independently from operator-maintained assessments. */
export function checkCompanyRequirements(markdown: string, value: unknown): CompanyRequirementsCatalog {
  const expected = parseCompanyRequirements(markdown);
  if (!record(value) || !Array.isArray(value.requirements)) throw new Error('Invalid company requirement catalog');
  const { requirements: ignoredExpected, ...expectedMetadata } = expected;
  const { requirements: rows, ...metadata } = value;
  void ignoredExpected;
  if (!isDeepStrictEqual(metadata, expectedMetadata) || rows.length !== expected.requirements.length) {
    throw new Error('Company requirement source metadata or count fidelity mismatch');
  }
  for (const [index, row] of rows.entries()) {
    if (!record(row)) throw new Error('Invalid company requirement row');
    const sourceFields = Object.fromEntries(Object.entries(row).filter(([key]) => !assessmentKeys.includes(key)));
    const expectedFields = Object.fromEntries(Object.entries(expected.requirements[index]).filter(([key]) => !assessmentKeys.includes(key)));
    if (!isDeepStrictEqual(sourceFields, expectedFields)) throw new Error(`Company requirement source fidelity mismatch at ${expected.requirements[index].id}`);
    assessment(row);
  }
  return value as unknown as CompanyRequirementsCatalog;
}

/** Explicit regeneration preserves claims only under the same source digest and IDs. */
export function preserveCompanyAssessments(next: CompanyRequirementsCatalog, previous: unknown): CompanyRequirementsCatalog {
  if (!record(previous) || previous.sourceSHA256 !== next.sourceSHA256 || !Array.isArray(previous.requirements)) {
    throw new Error('Cannot preserve assessments across a changed or missing source digest');
  }
  const rows = new Map<string, Assessment>();
  for (const row of previous.requirements) {
    if (!record(row) || typeof row.id !== 'string' || rows.has(row.id)) throw new Error('Invalid or duplicate requirement assessment ID');
    rows.set(row.id, assessment(row));
  }
  if (rows.size !== next.requirements.length || next.requirements.some(row => !rows.has(row.id))) {
    throw new Error('Cannot preserve assessments with missing or unknown requirement IDs');
  }
  return { ...next, requirements: next.requirements.map(row => ({ ...row, ...rows.get(row.id)! })) };
}

function main(args: string[]): void {
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    throw new Error('Usage: tsx scripts/company-requirements.ts --check | --write');
  }
  const sourceURL = new URL('../docs/company/requirements.md', import.meta.url);
  const catalogURL = new URL('../docs/company/feature-backlog.json', import.meta.url);
  const bytes = readFileSync(sourceURL);
  if (createHash('sha256').update(bytes).digest('hex') !== SOURCE_SHA256) {
    throw new Error('Company requirement source digest differs from the pinned attachment');
  }
  const markdown = bytes.toString('utf8');
  if (args[0] === '--check') {
    checkCompanyRequirements(markdown, JSON.parse(readFileSync(catalogURL, 'utf8')));
  } else {
    let catalog = parseCompanyRequirements(markdown);
    if (existsSync(catalogURL)) catalog = preserveCompanyAssessments(catalog, JSON.parse(readFileSync(catalogURL, 'utf8')));
    writeFileSync(catalogURL, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  }
  console.log(`Company catalog ${args[0] === '--check' ? 'checked' : 'written'}: 221 requirements across 27 areas (102 P0, 100 P1, 19 P2). Assessments remain separate from source acceptance descriptions.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Company requirement catalog failed'); process.exitCode = 1; }
}
