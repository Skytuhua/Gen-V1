import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import { defineConfig,normalizePath } from 'vite';
import { application } from '../../vite.config';

// Contract tests own their hosts or intercept APIs. A missed intercept must
// never fall through to the user's running host on 4317.
export default defineConfig({ ...application,
  plugins:[...application.plugins??[],{name:'root-plan-timeline-fixture',configureServer(server){
    server.middlewares.use((request,response,next)=>{
      if(new URL(request.url??'/','http://localhost').pathname!=='/plan-timeline.html')return next();
      const entry='/@fs/'+normalizePath(resolve('tests/e2e/plan-timeline-renderer.tsx'));
      const html=readFileSync(resolve('tests/e2e/plan-timeline.html'),'utf8').replace('src="./plan-timeline-renderer.tsx"',`src="${entry}"`);
      void server.transformIndexHtml(request.url!,html).then(value=>{response.setHeader('Content-Type','text/html');response.end(value);}).catch(next);
    });
  }}],
  cacheDir:resolve(process.env.GEN_BROWSER_OUTPUT_DIR??'/tmp/wo5-run-d-integration-results','node_modules/.vite'), server: { host: '127.0.0.1', port: 5499, strictPort: true,watch:{ignored:['**/.harness*/**']}, fs:{allow:[resolve('.'),realpathSync('node_modules')]} } });
