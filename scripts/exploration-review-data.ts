import type {SurfaceSpec} from '../packages/contracts/index.ts';

export const ANNOTATION_REVIEW_IMAGE='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#eef0f5"/><rect x="32" y="32" width="1136" height="656" rx="18" fill="white"/><text x="64" y="93" font-family="Segoe UI,sans-serif" font-size="28" fill="#20242e">Export image</text><path d="M64 120H1136" stroke="#e3e6ed"/><rect x="64" y="154" width="640" height="458" rx="10" fill="#dfe7fa"/><rect x="112" y="198" width="544" height="210" rx="8" fill="#b8cdf5"/><text x="112" y="461" font-family="Segoe UI,sans-serif" font-size="24" fill="#273e6f">Workspace cover</text><rect x="112" y="484" width="420" height="11" rx="5" fill="#afbfdd"/><rect x="112" y="509" width="324" height="11" rx="5" fill="#afbfdd"/><text x="752" y="184" font-family="Segoe UI,sans-serif" font-size="19" fill="#252b37">Settings</text><text x="752" y="237" font-family="Segoe UI,sans-serif" font-size="15" fill="#606a7b">Format</text><rect x="752" y="252" width="352" height="46" rx="7" fill="#f4f5f8"/><text x="770" y="281" font-family="Segoe UI,sans-serif" font-size="16" fill="#252b37">PNG</text><text x="752" y="342" font-family="Segoe UI,sans-serif" font-size="15" fill="#606a7b">Quality</text><path d="M762 373H1090" stroke="#dce3ef" stroke-width="6" stroke-linecap="round"/><path d="M762 373H1025" stroke="#4566e8" stroke-width="6" stroke-linecap="round"/><circle cx="1025" cy="373" r="9" fill="#4566e8"/><text x="752" y="433" font-family="Segoe UI,sans-serif" font-size="16" fill="#252b37">1600 × 900 px</text><rect x="752" y="552" width="352" height="48" rx="8" fill="#4566e8"/><text x="866" y="583" font-family="Segoe UI,sans-serif" font-size="17" fill="white">Export image</text></svg>';

export const EXPLORATION_REVIEW_DATA={
 schedule:{title:'Review windows',timeZone:'America/Los_Angeles',slots:[
  {id:'morning',start:'2026-11-02T09:00:00-08:00',end:'2026-11-02T09:30:00-08:00',label:'Design review',availability:'available'},
  {id:'midday',start:'2026-11-02T12:00:00-08:00',end:'2026-11-02T12:30:00-08:00',label:'Team check-in',availability:'unavailable'},
  {id:'afternoon',start:'2026-11-03T14:00:00-08:00',end:'2026-11-03T15:00:00-08:00',label:'Implementation review',availability:'tentative',detail:'Confirm the reviewer before finalizing.'},
 ],source:'Supplied illustrative slots; no calendar is connected.'},
 logs:{title:'Checkout investigation',events:[
  {id:'request',timestamp:'2026-10-30T16:42:00Z',level:'info',message:'Checkout request accepted',stream:'api',correlationId:'checkout-17'},
  {id:'cache',timestamp:'2026-10-30T16:42:01Z',level:'warning',message:'Cached price was unavailable',stream:'pricing',correlationId:'checkout-17',detail:'The pricing lookup used the supplied fallback record.'},
  {id:'failure',timestamp:'2026-10-30T16:42:02Z',level:'error',message:'Quantity assertion failed',stream:'tests',correlationId:'checkout-17',detail:'Expected total 24; received 12. The supplied test contains two items at 12 each.'},
  {id:'unknown',level:'unknown',message:'Imported diagnostic note',detail:'The source did not include a timestamp or severity.'},
 ],source:'Supplied illustrative diagnostic records; no terminal or service is connected.'},
};
export function explorationElements(resourceId:string):SurfaceSpec['elements']{
 return {
  exploration:{type:'Tabs',props:{labels:['Image feedback','Schedule','Logs'],stateKey:'explorationTab'},children:['annotateImage','chooseSchedule','exploreLogs']},
  annotateImage:{type:'ImageAnnotator',props:{resourceId,alt:'Export panel under review',title:'Image feedback',stateKey:'imageFeedback',actionId:'inspect',actionLabel:'Send feedback'}},
  chooseSchedule:{type:'SchedulePicker',props:{dataBinding:'schedule',stateKey:'scheduleChoice',actionId:'inspect',actionLabel:'Propose this time'}},
  exploreLogs:{type:'LogExplorer',props:{dataBinding:'logs',stateKey:'logSelection',actionId:'inspect',actionLabel:'Investigate event'}},
 };
}
