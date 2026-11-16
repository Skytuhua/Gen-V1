import base from './m05-restored/tests/e2e/frontend-refinement.playwright.config.ts';

if (!base.webServer || Array.isArray(base.webServer)) throw new Error('Expected the existing single frontend fixture server.');
export default {
  ...base,
  testDir: '/workspace/scratch/36f66011d961/m05-restored/tests/e2e',
  outputDir: '/workspace/scratch/36f66011d961/m05-local-checks/continuation-85d-cold-pdf-check-artifacts',
  use: {...base.use, baseURL: 'http://127.0.0.1:5388'},
  webServer: {
    ...base.webServer,
    command: 'pnpm exec vite --host 127.0.0.1 --port 5388 --strictPort --force',
    url: 'http://127.0.0.1:5388',
  },
};
