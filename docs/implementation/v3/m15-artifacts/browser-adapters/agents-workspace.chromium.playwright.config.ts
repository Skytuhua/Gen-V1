import {resolve} from 'node:path';
import original from '../../../../../tests/e2e/agents-workspace.playwright.config.ts';

// Run with the registered AGENTSUI_APP_CANDIDATE=1 environment.
// Only the unavailable Edge channel and relative testDir resolution differ.
export default {...original,
  testDir: resolve(import.meta.dirname, '../../../../../tests/e2e'),
  use: {...original.use, channel: undefined},
};
