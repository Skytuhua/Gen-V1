export interface BrowserSuite { name:string; config:string; specs:string[]; project?:string; env?:Record<string,string> }

export const rootBrowserSpecs = [
  'artifact-acknowledgment.spec.ts', 'clarity-data-work.spec.ts', 'dark-default.spec.ts',
  'document-window.spec.ts', 'host-loop.spec.ts', 'journal-reload.spec.ts', 'latency.spec.ts',
  'migration-redesign.spec.ts', 'operational-motion.spec.ts', 'overnight-shell.spec.ts',
  'plan-timeline.spec.ts', 'review-capture-theme.spec.ts', 'shell-micro-motion.spec.ts',
  'signing-motion.spec.ts', 'skills.spec.ts',
];

const suite = (name:string, specs=[`${name}.spec.ts`], options:Partial<BrowserSuite>={}):BrowserSuite =>
  ({name, config:`tests/e2e/${name}.playwright.config.ts`, specs, ...options});

// Assign each spec once. Named configurations retain their fixture roots, browser
// channels and timeouts; their overlapping caller projects run in their full suites.
export const browserSuites:BrowserSuite[] = [
  {name:'root', config:'playwright.config.ts', specs:rootBrowserSpecs},
  suite('agents-workspace', undefined, {env:{AGENTSUI_APP_CANDIDATE:'1'}}),
  suite('browser-action'),
  suite('code-review-host'),
  suite('compact-model-picker', ['compact-model-picker.spec.ts', 'model-composer-refinement.spec.ts', 'subscription-accounts.spec.ts']),
  suite('ui-shell-overlays'),
  suite('file-checkpoints'),
  suite('files-reading', undefined, {project:'files-reading'}),
  suite('generated-selects', ['generated-selects.spec.ts', 'inline-diagrams.spec.ts', 'work-objects.spec.ts'], {project:'generated-controls'}),
  suite('graph-popovers'),
  suite('inbox-controls'),
  suite('memory-recovery', undefined, {env:{GEN_MEMORY_MODE:''}}),
  suite('research-host'),
  suite('saved-layout-chooser'),
  suite('scoped-conversation'),
  suite('settings-leaf-selects', ['settings-controls.spec.ts', 'settings-leaf-selects.spec.ts', 'settings-loading.spec.ts']),
  suite('sidebar-collapse', ['sidebar-collapse.spec.ts']),
  suite('sidebar-shared-menu', ['sidebar-compact.spec.ts', 'sidebar-shared-menu.spec.ts'], {project:'sidebar-menu'}),
  suite('terminal-excerpts'),
  suite('terminal-read'),
  suite('thread-hover'),
  suite('thread-move', ['thread-move.spec.ts']),
  suite('usage-app-integration', ['mobile-navigation.spec.ts', 'shell-error-ownership.spec.ts', 'usage-app-integration.spec.ts']),
  suite('workspace-host'),
  suite('memory-recovery-app', undefined, {config:'tests/e2e/memory-recovery.playwright.config.ts', env:{GEN_MEMORY_MODE:'app'}}),
  suite('memory-recovery-journal', undefined, {config:'tests/e2e/memory-recovery.playwright.config.ts', env:{GEN_MEMORY_MODE:'journal'}}),
  suite('frontend-refinement', ['artifact-style.spec.ts', 'canvas-clarity.spec.ts', 'composer-app-refinement.spec.ts', 'context-compact.spec.ts', 'document-smoothness.spec.ts', 'drag-detach.spec.ts', 'floating-windows.spec.ts', 'free-floating.spec.ts', 'frontend-refinement.spec.ts', 'no-detach-canvas.spec.ts', 'reserved-rail.spec.ts', 'right-tools.spec.ts']),
  suite('conversation-scroll'),
  suite('micro-motion', ['composer-integration.spec.ts', 'composer-motion.spec.ts', 'markdown.spec.ts', 'micro-motion.spec.ts', 'proactive-copy.spec.ts', 'progressive-fidelity.spec.ts', 'shared-motion.spec.ts', 'shared-smoothness.spec.ts']),
  suite('motion-tokens', ['document-pair-layout.spec.ts', 'motion-tokens.spec.ts']),
  suite('clarity-software', ['clarity-software.spec.ts', 'software-clarity.spec.ts', 'software-development.spec.ts', 'task-software.spec.ts']),
  suite('clarity-review-parameters', ['clarity-review-parameters.spec.ts', 'interaction-tools.spec.ts', 'task-reviewing.spec.ts']),
  suite('clarity-schedule-logs', ['clarity-schedule-logs.spec.ts', 'exploration-ui.spec.ts', 'task-scheduling.spec.ts']),
  suite('fidelity', ['graph-fidelity.spec.ts', 'signing-fidelity.spec.ts']),
  suite('model-picker', ['composer-reference.spec.ts', 'model-picker.spec.ts']),
  suite('research-workspace', ['research-workspace-app.spec.ts', 'research-workspace.spec.ts']),
  suite('workspace', ['workspace-components.spec.ts', 'workspace-ui.spec.ts']),
  suite('chart-coordinates'),
  suite('code-review-workspace'),
  suite('compact-settings'),
  suite('compact-tools-cleanup'),
  suite('composer-commands'),
  suite('composer-prediction'),
  suite('context-connections'),
  suite('desktop-surfaces'),
  suite('everyday', ['everyday-ui.spec.ts']),
  suite('floating', ['planning-ui.spec.ts']),
  suite('inline-surfaces'),
  suite('native-browser-bounds'),
  suite('pdf', ['document-preview.spec.ts']),
  suite('plan-presentation'),
  suite('plan-window-reset'),
  suite('project-app-integration', ['project-app-integration.spec.mjs']),
  suite('project-picker'),
  suite('project-search'),
  suite('runtime-presentation'),
  suite('shared-panels'),
  suite('shell', ['frontend.spec.ts']),
  suite('short-tool-overflow'),
  suite('side-chat'),
  suite('chat-view-modes'),
  suite('smooth-operational', ['operational-smoothness.spec.ts']),
  suite('smooth-pdf', ['image-compare.spec.ts']),
  suite('snapshot-performance'),
  suite('summary-dock'),
  suite('t3-centered'),
  suite('tabs-identity'),
  suite('task-design'),
  suite('task-interface'),
  suite('ui-shell-controls'),
  suite('usage-context'),
];

export function validateBrowserSuites(specs:string[], suites=browserSuites):void {
  const assigned=suites.flatMap(value=>value.specs), counts=new Map<string,number>();
  for(const spec of assigned)counts.set(spec,(counts.get(spec)??0)+1);
  const duplicates=[...counts].filter(([,count])=>count!==1).map(([spec])=>spec);
  const missing=specs.filter(spec=>!counts.has(spec)), unknown=assigned.filter(spec=>!specs.includes(spec));
  if(new Set(suites.map(value=>value.name)).size!==suites.length)throw Error('Duplicate browser suite name.');
  if(duplicates.length||missing.length||unknown.length)throw Error(`Browser spec coverage: missing [${missing.join(', ')}]; duplicate [${duplicates.join(', ')}]; unknown [${unknown.join(', ')}].`);
}
