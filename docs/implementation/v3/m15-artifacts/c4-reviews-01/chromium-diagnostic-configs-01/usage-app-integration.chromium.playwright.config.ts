import original from "/workspace/scratch/1b47eb428672/m15-v3/tests/e2e/usage-app-integration.playwright.config.ts";

// Private Linux Chromium diagnostic substitute for the declared msedge channel.
// This does not establish Edge or installed-desktop proof. Deadlines, assertions,
// fixtures, test membership, viewport and web server remain inherited unchanged.
export default {...original,
  testDir: "/workspace/scratch/1b47eb428672/m15-v3/tests/e2e",
  use: {...original.use, channel: undefined},
};
