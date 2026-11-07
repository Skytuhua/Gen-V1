import type {SurfaceSpec} from '../contracts/index.ts';
export type CompositionExample={id:string;purpose:string;components:string[];spec:SurfaceSpec};
const node=(type:string,props:Record<string,unknown>,children?:string[])=>({type,props,...(children?{children}:{})});
/** Discovery examples only: these are not a task classifier or a production screen router. */
export const COMPOSITION_EXAMPLES:CompositionExample[]=[
 {id:'time-offered',purpose:'Choose among supplied review windows; the intervals themselves are the control.',components:['SchedulePicker'],spec:{root:'times',elements:{times:node('SchedulePicker',{dataBinding:'windows',stateKey:'chosenTime',actionId:'propose',actionLabel:'Propose time'})}}},
 {id:'time-visits',purpose:'Arrange a visit using supplied places and available times; keep place and interval selections independent.',components:['MapView','SchedulePicker','Split'],spec:{root:'visit',elements:{visit:node('Split',{ratio:.56,gap:'md'},['places','times']),places:node('MapView',{dataBinding:'places',stateKey:'selectedPlace'}),times:node('SchedulePicker',{dataBinding:'windows',stateKey:'chosenTime',actionId:'propose',actionLabel:'Propose visit'})}}},
 {id:'review-copy',purpose:'Review supplied wording directly and attach decisions to each passage.',components:['ReviewQueue'],spec:{root:'passages',elements:{passages:node('ReviewQueue',{dataBinding:'passages',stateKey:'copyReview',actionId:'sendReview'})}}},
 {id:'review-patch',purpose:'Evaluate a proposed code change alongside specific review questions; preserve the actual diff.',components:['Diff','ReviewQueue','Stack'],spec:{root:'patch',elements:{patch:node('Stack',{gap:'md'},['diff','questions']),diff:node('Diff',{dataBinding:'patch'}),questions:node('ReviewQueue',{dataBinding:'reviewQuestions',stateKey:'patchReview',actionId:'sendReview'})}}},
 {id:'investigation-failure',purpose:'Find why a supplied test failed: assertion, related source and evidence first.',components:['Diagnostics'],spec:{root:'failure',elements:{failure:node('Diagnostics',{dataBinding:'failures',stateKey:'failure'})}}},
 {id:'investigation-latency',purpose:'Understand a latency change by connecting the supplied measurement with actual span durations.',components:['Stats','TraceWaterfall','Stack'],spec:{root:'latency',elements:{latency:node('Stack',{gap:'md'},['trend','spans']),trend:node('Stats',{dataBinding:'measurements',stateKey:'metric'}),spans:node('TraceWaterfall',{dataBinding:'trace',stateKey:'selectedSpan'})}}},
 {id:'image-export',purpose:'Inspect the granted source image while adjusting an export proposal; the source preview does not claim a new export.',components:['Image','ParameterControls','Split'],spec:{root:'export',elements:{export:node('Split',{ratio:.6,gap:'md'},['source','parameters']),source:node('Image',{resourceId:'source-image-grant',alt:'Source image'}),parameters:node('ParameterControls',{dataBinding:'parameters',stateKey:'exportDraft',actionId:'prepareExport',actionLabel:'Review export'})}}},
 {id:'visit-facts',purpose:'Answer a visit question first, expose the decision facts and next step, and keep an optional follow-up independent. Bind actual hours, deadlines, guest/safety limits and booking status; no source essay.',components:['Markdown','Table','Disclosure','Stack'],spec:{root:'visitAnswer',elements:{
  visitAnswer:node('Stack',{gap:'sm'},['answer','facts','next','question']),
  answer:node('Markdown',{dataBinding:'visitAnswer'}),
  facts:node('Table',{rowsBinding:'visitFacts',rowKey:'id',columns:[{key:'topic',label:'Check'},{key:'fact',label:'Visit facts'}]}),
  next:node('Markdown',{dataBinding:'visitNext'}),
  question:node('Disclosure',{title:'What else should I check?',stateKey:'visitFollowupOpen',dataBinding:'visitFollowup',defaultOpen:false,onOpenActionId:'explainVisit',payload:{topic:'otherChecks'}}),
 }}},
 {id:'kit-comparison',purpose:'Lead with a justified recommendation and fit reasons; compare concrete totals with one chooser. Keep calculations and source passages accessible on request, without a default evidence essay.',components:['Markdown','Comparison','Stack'],spec:{root:'kitAnswer',elements:{
  kitAnswer:node('Stack',{gap:'sm'},['answer','options','next']),
  answer:node('Markdown',{dataBinding:'kitAnswer'}),
  options:node('Comparison',{dataBinding:'kits',stateKey:'chosenKit',actionId:'reviewKit',actionLabel:'Review selected kit'}),
  next:node('Markdown',{dataBinding:'kitNext'}),
 }}},
 {id:'document-signing',purpose:'Pair the granted PDF with bound editable details and one signature. Omit routine banners and the whole source/signature explanation section. Replace example resource/field names and signature coordinates only from the actual granted document; preparing review never saves or delivers it.',components:['DocumentPreview','SignaturePad','Form','Input','Stack','Split'],spec:{root:'signing',elements:{
  signing:node('Split',{ratio:.55,gap:'md'},['pdf','details']),
  pdf:node('DocumentPreview',{resourceId:'granted-agreement',fieldStateKeys:{Name:'name',Title:'title',Email:'email',SignedDate:'signedDate'},signatureStateKey:'signature',signatureBox:{page:1,x:72,y:120,width:180,height:40}}),
  details:node('Form',{actionId:'reviewAgreement',submitLabel:'Review agreement',payloadFromState:{name:'name',title:'title',email:'email',signedDate:'signedDate',signature:'signature'}},['name','title','email','date','signature']),
  name:node('Input',{label:'Signer',stateKey:'name'}),title:node('Input',{label:'Title',stateKey:'title'}),
  email:node('Input',{label:'Notices email',stateKey:'email'}),date:node('Input',{label:'Signed date',stateKey:'signedDate'}),
  signature:node('SignaturePad',{stateKey:'signature',nameStateKey:'name',label:'Signature'}),
 }}},
];
