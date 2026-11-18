import {resolve} from 'node:path';
import original from '../../../../../tests/e2e/usage-context.playwright.config.ts';

// Explicit Linux equivalence run. The declared Edge launch failure is retained.
// Assertions, deadlines, viewport, web server and suite behavior stay original.
export default {...original,
  testDir: resolve(import.meta.dirname, '../../../../../tests/e2e'),
  use: {...original.use, channel: undefined},
};
