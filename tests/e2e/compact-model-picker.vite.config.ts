import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import application from './vite.config';

// Prepared worktrees may share same-lock dependencies through a local junction.
export default defineConfig({ ...application, server: { ...application.server,
  fs: { allow: [resolve('.'), realpathSync('node_modules')] },
} });
