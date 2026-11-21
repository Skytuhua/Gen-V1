import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import application from './vite.config';

export default defineConfig({ ...application, server: { ...application.server,
  fs: { allow: [resolve('.'), realpathSync('node_modules')] },
} });
