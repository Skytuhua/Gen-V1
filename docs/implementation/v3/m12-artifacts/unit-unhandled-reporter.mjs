// Read-only observation of Vitest 4.1.12's verified Reporter API:
// onInit(ctx); onTestRunEnd(testModules, unhandledErrors, reason).
// The built-in JSON reporter omits the second argument, so this sidecar records
// bounded, redacted metadata without changing any test result or exit status.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_ERRORS = 128;
const FIELD_LIMITS = Object.freeze({ name: 256, type: 256, code: 256, message: 8192, stack: 16384, VITEST_TEST_PATH: 4096, VITEST_TEST_NAME: 4096 });

function ownText(value, key) {
  if (!value || typeof value !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : null;
}

function redact(value, maximum) {
  const originalLength = value.length;
  // Truncate before regular-expression work; report the truncation explicitly.
  let text = value.slice(0, maximum);
  text = text.replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|authorization|cookie)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n}]+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
  return { text: text.slice(0, maximum), truncated: originalLength > maximum || text.length > maximum, originalCharacters: originalLength };
}

export default class UnitUnhandledReporter {
  root;
  onInit(ctx) { this.root = ctx.config.root; }

  async onTestRunEnd(testModules, unhandledErrors, reason) {
    if (!this.root) throw new Error('Unhandled-error evidence reporter did not receive the Vitest root');
    if (!Array.isArray(unhandledErrors)) throw new Error('Unhandled-error evidence reporter received an incompatible Vitest API');
    const errors = unhandledErrors.slice(0, MAX_ERRORS).map((error, index) => {
      const fields = {};
      for (const [key, maximum] of Object.entries(FIELD_LIMITS)) {
        const value = ownText(error, key);
        if (value !== null) fields[key] = redact(value, maximum);
      }
      if (typeof error === 'string') fields.message = redact(error, FIELD_LIMITS.message);
      return { index, fields };
    });
    const directory = join(this.root, 'docs/implementation/v3/m12-artifacts');
    const destination = join(directory, 'candidate-vitest-unhandled.json');
    const temporary = `${destination}.tmp-${process.pid}`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, JSON.stringify({
      version: 1, reporter: 'unit-unhandled-reporter.mjs', vitestVersionVerified: '4.1.12',
      reason, observedAt: new Date().toISOString(), reportedTestFileCount: testModules.length,
      unhandledErrorCount: unhandledErrors.length, recordedErrorCount: errors.length,
      errorsTruncated: unhandledErrors.length > MAX_ERRORS, maximumErrors: MAX_ERRORS,
      fieldCharacterLimits: FIELD_LIMITS, redactionApplied: true, errors,
    }, null, 2) + '\n');
    await rename(temporary, destination);
  }
}
