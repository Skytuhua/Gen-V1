import {defineConfig} from 'vite';
import application from './vite.config';
import {agentsAppCandidate} from './agents-workspace-App-candidate';
export default defineConfig({...application, plugins: [{
 name: 'agents-workspace-parent-candidate', enforce: 'pre',
 transform(source, id) {if (process.env.AGENTSUI_APP_CANDIDATE !== '0' && id.replaceAll('\\', '/').endsWith('/apps/web/src/App.tsx')) return agentsAppCandidate(source);},
}, ...(application.plugins ?? [])]});
