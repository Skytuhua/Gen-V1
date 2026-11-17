import {resolve} from 'node:path';
import original from '../../../../../tests/e2e/scoped-conversation.playwright.config.ts';

// Explicit Linux equivalence run. This is not an Edge platform result.
export default {...original,
  testDir: resolve(import.meta.dirname, '../../../../../tests/e2e'),
  use: {...original.use, channel: undefined},
};
