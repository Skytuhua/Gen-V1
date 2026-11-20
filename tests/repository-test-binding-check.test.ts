import {describe, expect, it} from 'vitest';
import {requireRepositoryTestBinding, type RepositoryTestBinding} from '../packages/capabilities/repository-test-binding.ts';

// Regression coverage: a malformed executionBinding must fail closed as
// PRECONDITION_FAILED instead of leaking a schema parse error to callers.
const sha = 'a'.repeat(64);
const binding: RepositoryTestBinding = {
  version: 1,
  executable: {path: '/usr/bin/node', dev: '1', ino: '2', bytes: 100, sha256: sha},
  cwd: {path: '/repo', dev: '1', ino: '3'},
  test: {path: '/repo/src/foo.test.ts', dev: '1', ino: '4', bytes: 10, sha256: 'b'.repeat(64)},
  argv: ['--test', '--', 'src/foo.test.ts'],
  definition: {id: 'repository_test_prepare', version: 1, schemaDigest: sha, executorBinding: 'domain-prepare'},
};

describe('requireRepositoryTestBinding on malformed bindings', () => {
  it('rejects structurally invalid bindings as PRECONDITION_FAILED', () => {
    const changed = expect.objectContaining({code: 'PRECONDITION_FAILED'});
    for (const actual of [
      {...binding, version: 2},
      {...binding, executable: {...binding.executable, path: 'relative/node'}},
      {...binding, executable: {...binding.executable, dev: 'x'}},
      {...binding, definition: {...binding.definition, executorBinding: 'other'}},
      {...binding, definition: {...binding.definition, id: 'other_tool'}},
      {...binding, argv: ['--test', '--', 'no-pattern.txt']},
      {...binding, extra: 1},
      'not-a-binding',
      null,
    ]) expect(() => requireRepositoryTestBinding(binding, actual as RepositoryTestBinding, binding.test.sha256)).toThrow(changed);
  });
});
