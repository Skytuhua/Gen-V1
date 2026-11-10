import { expect, it } from 'vitest';
import { mapFile, screens } from '../../scripts/capture-ui/screen-map';
import { parseArgs } from '../../scripts/capture-ui/helpers';

it('defaults to the union so baseline screens remain selected', () => expect(parseArgs([]).scope).toBe('all'));
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
