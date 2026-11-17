import {resolve} from 'node:path';
import original from '../../../../../tests/e2e/ui-shell-controls.playwright.config.ts';

// Explicit local substitute for the unavailable Edge executable. Assertions,
// deadlines, fixtures and server remain owned by the declared configuration.
export default {...original,
  testDir: resolve(import.meta.dirname, '../../../../../tests/e2e'),
  use: {...original.use, channel: undefined},
};
