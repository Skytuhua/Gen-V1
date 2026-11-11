import { build } from 'esbuild';
import { resolve } from 'node:path';
let bundle: Promise<{ js: string; css: string }> | undefined;
export function pluginAssets() {
  return bundle ??= build({ stdin: { contents: `import * as runtime from './apps/web/src/plugin-runtime';globalThis.GenPluginUI=runtime;void import('./plugins/personal-visuals/src/frontend').then(()=>{function PluginToolBody(){runtime.React.useEffect(()=>runtime.pluginReady(),[]);return runtime.React.createElement('p',null,'Synthetic isolated plugin window.');}const floating=document.createElement('div');document.body.append(floating);runtime.ReactDOMClient.createRoot(floating).render(runtime.React.createElement(runtime.FloatingWindow,{id:'capture-plugin-window',title:'Plugin tools',defaultSize:{width:300,height:180},focusOnOpen:false},runtime.React.createElement(PluginToolBody)));});`, resolveDir: resolve('.'), loader: 'tsx' }, bundle: true, write: false, outfile: 'capture-plugin.js', format: 'iife', platform: 'browser', logOverride: { 'empty-import-meta': 'silent' }, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } }).then(result => ({ js: result.outputFiles.find(f=>f.path.endsWith('.js'))!.text, css: result.outputFiles.find(f=>f.path.endsWith('.css'))?.text ?? '' }));
}
export function pluginDocument(): string {
  // Match the installed plugin's classic-runtime-before-private-UI ordering.
  // The final script waits until an RPC proves the parent accepted the port;
  // this prevents a single synthetic inline script from racing iframe.onload.
  return '<!doctype html><html data-theme="dark"><head><meta name="gen-plugin-id" content="personal-visuals"><link rel="stylesheet" href="/capture-plugin/runtime.css"></head><body><div id="root"></div><script src="/capture-plugin/runtime.js"></script><script src="/capture-plugin/barrier.js"></script></body></html>';
}
