import {defineConfig} from '@playwright/test';
import base from './workspace-host.playwright.config';
export default defineConfig({...base,testMatch:'code-review-host.spec.ts',outputDir:'.harness-ui-shell/code-review-host'});
