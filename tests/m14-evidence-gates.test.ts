import { describe, expect, it } from 'vitest';
import {
  bundleStatus,
  dependencyContractSchema,
  implementationEvidenceV3Schema,
  validateCommandEvidence,
  validateImplementationEvidence,
  type CommandEvidence,
  type ImplementationEvidenceV3,
  type PhaseEvidence,
} from '../packages/contracts/implementation-evidence.ts';

// Synthetic evidence only. These tests exercise the existing release gates;
// they do not prove native forking, snapshot inspection or archive import.
// Bundle labels below are not assertions about the missing bundles' API names.
const requiredContracts = ['M01', 'M02', 'M04', 'M05'].map((name, index) => ({
  name, version: String(index + 1).repeat(40),
}));

function command(overrides: Partial<CommandEvidence> = {}): CommandEvidence {
  return {
    argv: ['node', 'synthetic-fixture.js'], cwdIdentity: '/synthetic/m14', executableIdentity: '/synthetic/node',
    startedAt: '2026-11-15T00:00:00Z', endedAt: '2026-11-15T00:00:01Z', exitCode: 0,
    termination: 'NONE', status: 'PASS', boundedLogRef: 'synthetic/log.txt', logDigest: 'a'.repeat(64),
    ...overrides,
  };
}

function phase(overrides: Partial<PhaseEvidence> = {}): PhaseEvidence {
  return {
    id: 'core.evidence-gates', status: 'PASS', requiredCases: [{ id: 'synthetic-case', status: 'PASS' }],
    commands: [command()], artifactRefs: [], ...overrides,
  };
}

function evidence(overrides: Partial<ImplementationEvidenceV3> = {}): ImplementationEvidenceV3 {
  return {
    schemaVersion: 3, bundleId: 'M14', baseSha: 'b'.repeat(40), sourceLockDigest: 'c'.repeat(64),
    platform: 'synthetic', nodeVersion: 'v24.22.1', packageManagerVersion: '10.30.3',
    phases: [phase()], changedFiles: [],
    dependencyContracts: requiredContracts.map(contract => ({ ...contract, testIds: ['synthetic-contract-case'] })),
    flags: [{ key: 'sessions.branchV1', enabled: false }, { key: 'sessions.inertImportV1', enabled: false }],
    remainingGates: [], reviewerApproval: false, ...overrides,
  };
}

describe('M14 evidence gates, independent of blocked feature integration', () => {
  it('rejects missing M04 and M05 even when M01 and M02 have source versions and test IDs', () => {
    const complete = implementationEvidenceV3Schema.parse(evidence());
    expect(validateImplementationEvidence(complete, { requiredContracts })).toEqual([]);
    const incomplete = { ...complete, dependencyContracts: complete.dependencyContracts.slice(0, 2) };
    const issues = validateImplementationEvidence(incomplete, { requiredContracts });
    expect(issues).toEqual([
      { code: 'CONTRACT_MISSING', message: 'Dependency contract M04 is not covered.' },
      { code: 'CONTRACT_MISSING', message: 'Dependency contract M05 is not covered.' },
    ]);
  });

  it('rejects a local branch name as a substitute for a dependency source blob', () => {
    expect(dependencyContractSchema.safeParse({ name: 'M04', version: 'agent/m04-v3', testIds: ['synthetic-contract-case'] }).success).toBe(false);
    expect(dependencyContractSchema.safeParse({ name: 'M04', version: requiredContracts[2].version, testIds: ['synthetic-contract-case'] }).success).toBe(true);
  });

  it('rejects changed contract blobs despite matching dependency labels and test IDs', () => {
    const value = evidence();
    value.dependencyContracts[2].version = 'd'.repeat(40);
    const issues = validateImplementationEvidence(value, { requiredContracts });
    expect(issues).toEqual([{
      code: 'CONTRACT_MISMATCH',
      message: `Dependency contract M04 is ${'d'.repeat(40)}, expected ${requiredContracts[2].version}.`,
    }]);
  });

  it('keeps a bundle partial when feature acceptance is blocked after independent evidence tests pass', () => {
    const blocked = phase({
      id: 'integration.native-fork-and-import', status: 'BLOCKED',
      requiredCases: [{ id: 'actual-feature-acceptance', status: 'NOT_RUN' }], commands: [],
    });
    expect(bundleStatus([phase(), blocked])).toBe('PARTIAL');
    expect(bundleStatus([blocked])).toBe('BLOCKED');
  });

  it('rejects nonzero setup failure mislabeled as an intended-negative success', () => {
    const setupFailure = command({
      argv: ['node', 'missing-setup.js'], exitCode: 1, status: 'EXPECTED_NEGATIVE',
      expectedNegative: { assertedFailure: 'Synthetic missing setup is not feature rejection evidence.', observed: true },
    });
    expect(validateCommandEvidence(setupFailure).map(issue => issue.code)).toContain('EXPECTED_NEGATIVE_MISLABEL');
    expect(validateCommandEvidence(command({
      exitCode: 0, status: 'EXPECTED_NEGATIVE',
      expectedNegative: { assertedFailure: 'Synthetic fixture asserted the intended rejection.', observed: true },
    }))).toEqual([]);
  });

  it('rejects a passing phase that leaves required acceptance unrun', () => {
    const value = evidence({ phases: [phase({
      id: 'integration.native-fork', requiredCases: [{ id: 'actual-native-fork', status: 'NOT_RUN' }],
    })] });
    expect(validateImplementationEvidence(value)).toEqual([{
      code: 'REQUIRED_CASE_NOT_RUN', phase: 'integration.native-fork',
      message: 'Required case actual-native-fork is NOT_RUN inside a PASS phase.',
    }]);
  });
});
