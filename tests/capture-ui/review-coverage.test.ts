import { expect, it } from 'vitest';
import { mapFile, screens, keyStates, requiredOutputScreenIds } from '../../scripts/capture-ui/screen-map';
import { parseArgs } from '../../scripts/capture-ui/helpers';

it('defaults to the union so baseline screens remain selected', () => expect(parseArgs([]).scope).toBe('all'));
it('keeps all 28 added renderer screens in the output-verification policy', () => {
  expect(requiredOutputScreenIds).toHaveLength(28);
  expect(new Set(requiredOutputScreenIds).size).toBe(28);
  expect(screens.slice(screens.findIndex(screen => screen.id === 'side-chat')).map(screen => screen.id)).toEqual(requiredOutputScreenIds);
});
it('declares every key state, with specific reasons for unsupported states', () => {
  for (const screen of screens) for (const state of keyStates) {
    const recipe = screen.states[state];
    expect(recipe, `${screen.id}/${state}`).toBeDefined();
    if (recipe?.skip !== undefined) expect(recipe.skip.trim().length, `${screen.id}/${state}`).toBeGreaterThan(15);
  }
});
it.each([
  'SideChat', 'ScopedConversationComposer', 'conversation-workspace/ConversationPane',
  'InteractionTools', 'WorkObjects', 'Artifact', 'ArtifactPresentation', 'DocumentPreview', 'DocumentWindow', 'SignaturePad',
  'TaskTable', 'TaskDisclosure', 'EverydayData', 'ExplorationTools', 'SoftwareDevelopment', 'ImageCompare', 'MapView',
  'UpdateControl', 'PluginFrame', 'PluginFloatingWindow', 'plugin-runtime', 'Connections', 'CredentialEntry', 'GitHubSignIn',
  'UsageDialog', 'UsageFooter', 'ContextInspector', 'ContextMeter', 'SkillLibrary', 'TaskMemory', 'DraftTransfer',
  'DelegatedAgentTranscript', 'WorkspaceSplitLayout', 'ProjectContextCard', 'ProjectContextSurface', 'TerminalBody', 'FloatingWindow',
])('covers browser renderer %s rather than excluding it', name => {
  const entry = mapFile(`apps/web/src/${name}.tsx`);
  expect(entry.category).toBe('screen');
  expect(entry.screens.length).toBeGreaterThan(0);
  for (const id of entry.screens) expect(screens.find(s => s.id === id)?.states.default).toBeDefined();
});
it('justifies a genuinely native surface with its attempted browser route', () => {
  const file = mapFile('apps/web/src/DesktopBrowser.tsx');
  expect(file).toMatchObject({ category: 'excludedWebUi', reason: expect.stringContaining('WebContents'), attemptedRoute: expect.any(String) });
});

it.each([
  'CodeReviewHost.tsx', 'ResearchHost.tsx', 'code-review-host.css', 'research-host.css',
  'code-review-workspace/CodeReviewWorkspace.tsx', 'code-review-workspace/code-review-workspace.css',
  'research-workspace/PassageInspector.tsx', 'research-workspace/ResearchWorkspace.tsx',
  'research-workspace/SourceImport.tsx', 'research-workspace/SourceReader.tsx',
  'research-workspace/research-workspace.css',
])('captures the surviving workspace shell for retired renderer %s in recent PR history', path => {
  expect(mapFile(`apps/web/src/${path}`)).toMatchObject({category: 'screen', screens: ['app-shell']});
});

it('still flags an unrelated unmapped renderer', () => {
  expect(mapFile('apps/web/src/UnknownWidget.tsx').category).toBe('unmappedWebUi');
});
