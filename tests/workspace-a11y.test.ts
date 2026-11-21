import {readFileSync} from 'node:fs';
import {expect,it,describe} from 'vitest';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const workbench=read('apps/web/src/SourceWorkbench.tsx');
const panelContent=read('apps/web/src/WorkbenchPanelContent.tsx');
const inputs=read('apps/web/src/WorkbenchInputsPanel.tsx');
const background=read('apps/web/src/BackgroundWork.tsx');
const panels=read('apps/web/src/WorkbenchPanels.tsx');
const css=read('apps/web/src/source-workbench.css');

describe('workbench dock tab semantics',()=>{
 it('declares a labelled tablist with five roving tabs wired to a tabpanel',()=>{
  expect(workbench).toContain('role="tablist" aria-label="Workbench views"');
  expect(workbench).toContain('role="tab"');
  expect(workbench).toContain("[['request','Last request'],['tools','Tools'],['run','Run'],['sources','Sources'],['evidence','Evidence']]");
  expect(workbench).toContain('aria-selected={tab===id}');
  expect(workbench).toContain('aria-controls={tab===id?`wb-panel-${id}`:undefined}');
  expect(workbench).toContain('id={`wb-tab-${id}`}');
  expect(workbench).toContain('tabIndex={tab===id?0:-1}');
  for(const key of ['ArrowLeft','ArrowRight','Home','End'])expect(workbench).toContain(`'${key}'`);
  expect(workbench).toContain('role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`} tabIndex={0}');
 });
 it('focuses the selected tab on mount and persists source/evidence views on activation',()=>{
  expect(workbench).toContain('autoFocus={tab===id}');
  expect(workbench).toContain("persistView('SOURCES')");
  expect(workbench).toContain("persistView('EVIDENCE')");
 });
 it('names every composer chip action with its source label',()=>{
  for(const label of ['Open source ${label}','Remove source ${label}','Refresh source ${label}','Keep captured source ${label}'])expect(workbench).toContain('aria-label={`'+label+'`}');
 });
});
describe('evidence filter tab semantics',()=>{
 it('declares a labelled tablist with roving category tabs wired to a tabpanel',()=>{
  expect(panelContent).toContain('role="tablist" aria-label="Evidence categories"');
  expect(panelContent).toContain('role="tab"');
  expect(panelContent).toContain("['ALL','REQUIREMENT','CHECK','ARTIFACT','SOURCE']");
  expect(panelContent).toContain('aria-selected={evidenceKind===kind}');
  expect(panelContent).toContain('tabIndex={evidenceKind===kind?0:-1}');
  for(const key of ['ArrowLeft','ArrowRight','Home','End'])expect(panelContent).toContain(`'${key}'`);
  expect(panelContent).toContain('role="tabpanel" id="wb-evidence-panel" aria-labelledby={`wb-evidence-tab-${evidenceKind}`} tabIndex={0}');
 });
});
describe('background drawer semantics',()=>{
 it('announces every error paragraph as an alert, never a status',()=>{
  expect(background).not.toContain('role="status" className="error-text"');
  expect((background.match(/role="alert" className="error-text"/g)??[]).length).toBe(6);
 });
 it('exposes a polite live region summarising refreshed counts',()=>{
  expect(background).toContain('className="sr-only" role="status" aria-live="polite"');
  expect(background).toContain('Background work updated: ${data.works.length} work item(s), ${data.schedules.length} schedule(s), ${data.intake.records.length} intake record(s).');
 });
 it('names the approval model select and response fieldset with the task title',()=>{
  expect(background).toContain('aria-label={`Model for approved task: ${record.proposedTask.title}`}');
  expect(background).toContain('aria-label={`Response for ${work.title}`}');
 });
 it('names card actions with the work title',()=>{
  for(const label of ['Output for ${work.title}','Cancel ${work.title}','Open child task for ${work.title}','Decline response for ${work.title}'])expect(background).toContain('aria-label={`'+label+'`}');
 });
});
describe('recorded-request table semantics',()=>{
 it('labels the table and marks every header cell as a column header',()=>{
  expect(panels).toContain("aria-label={tools?'Tool segments in the recorded request':'Recorded request segments'}");
  const headers=panels.match(/<th(?:\s[^>]*)?>/g)??[];
  expect(headers.length).toBeGreaterThan(0);
  expect(headers.every(header=>header.startsWith('<th scope="col"'))).toBe(true);
 });
});
describe('workbench input inspect buttons',()=>{
 it('names each inspect button with its index and owning input id',()=>{
  expect(inputs).toContain('aria-label={`Inspect retained source ${index+1} of input ${input.inputId}`}');
 });
});
describe('focus styling',()=>{
 it('offsets focus outlines on tabs and source chips and respects reduced motion',()=>{
  expect(css).toContain('.workbench-panel [role="tab"]:focus-visible { outline-offset: 2px; }');
  expect(css).toContain('.workbench-source-chip button:focus-visible { outline-offset: 2px; }');
  expect(css).toContain('prefers-reduced-motion:reduce');
 });
});
