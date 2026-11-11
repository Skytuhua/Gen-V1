import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import { defineConfig } from 'vite';
import application from '../../vite.config';

// Contract tests own their hosts or intercept APIs. A missed intercept must
// never fall through to the user's running host on 4317.
export default defineConfig({ ...application, cacheDir:'/tmp/wo5-run-d/node_modules/.vite/app', server: { host: '127.0.0.1', port: 5499, strictPort: true,watch:{ignored:['**/.harness*/**']}, fs:{allow:[resolve('.'),realpathSync('node_modules')]} } });
