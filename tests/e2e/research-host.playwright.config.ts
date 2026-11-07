import {defineConfig} from '@playwright/test';
import base from './workspace-host.playwright.config';
export default defineConfig({...base,testMatch:'research-host.spec.ts',outputDir:'.harness-ui-shell/research-host'});
