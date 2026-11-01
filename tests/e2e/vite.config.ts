import { defineConfig } from 'vite';
import application from '../../vite.config';

// Contract tests own their hosts or intercept APIs. A missed intercept must
// never fall through to the user's running host on 4317.
export default defineConfig({ ...application, server: { host: '127.0.0.1', port: 5499, strictPort: true } });
