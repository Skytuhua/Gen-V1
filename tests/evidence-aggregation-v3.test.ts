import { describe, expect, it } from 'vitest';
import { bundleStatus, validatePhaseEvidence, type CommandEvidence, type PhaseEvidence } from '../packages/contracts/implementation-evidence.ts';

const command = (overrides: Partial<CommandEvidence> = {}): CommandEvidence => ({
  argv: ['node', 'fixture'], cwdIdentity: '/fixture', executableIdentity: '/node',
  startedAt: '2026-11-17T00:00:00Z', endedAt: '2026-11-17T00:00:01Z',
  exitCode: 0, termination: 'NONE', status: 'PASS', boundedLogRef: 'fixture.log',
  logDigest: 'a'.repeat(64), ...overrides,
});
const phase = (overrides: Partial<PhaseEvidence> = {}): PhaseEvidence => ({
  id: 'core', status: 'PASS', requiredCases: [{ id: 'required', status: 'PASS' }],
  commands: [command()], artifactRefs: [], ...overrides,
});

const unsupported: [string, PhaseEvidence][] = [
  ['unrun required case', phase({ requiredCases: [{ id: 'required', status: 'NOT_RUN' }] })],
  ['missing commands', phase({ commands: [] })],
  ['empty required coverage', phase({ requiredCases: [] })],
  ['timeout labelled PASS', phase({ commands: [command({ termination: 'TIMEOUT', exitCode: null })] })],
  ['expected negative without assertion', phase({ commands: [command({ status: 'EXPECTED_NEGATIVE' })] })],
];

describe('M01 aggregate cannot promote unsupported PASS claims', () => {
  it.each(unsupported)('blocks %s', (_name, value) => {
    expect(validatePhaseEvidence(value).length).toBeGreaterThan(0);
    expect(bundleStatus([value])).toBe('BLOCKED');
  });

  it('reports PARTIAL when a valid phase accompanies an unsupported PASS', () => {
    expect(bundleStatus([phase(), phase({ id: 'integration', commands: [] })])).toBe('PARTIAL');
  });

  it('preserves an observed required failure as FAIL', () => {
    expect(bundleStatus([phase({ requiredCases: [{ id: 'required', status: 'FAIL' }] })])).toBe('FAIL');
  });

  it('retains honest failed attempts without discarding later valid evidence', () => {
    const value = phase({ commands: [command({ status: 'FAIL', exitCode: 7 }), command()] });
    expect(validatePhaseEvidence(value)).toEqual([]);
    expect(bundleStatus([value])).toBe('PASS');
  });

  it('keeps a fully supported phase PASS', () => {
    expect(bundleStatus([phase()])).toBe('PASS');
    expect(bundleStatus([])).toBe('BLOCKED');
  });
});
