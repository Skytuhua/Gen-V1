import type {ElementSpec,SurfaceSpec} from '../packages/contracts/index.ts';
import {EVERYDAY_REVIEW_DATA} from './review-fixtures.ts';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec} from './software-development-fixtures.ts';
export const W2_PROVENANCE='Actual local renderer with intercepted, synthetic protocol sources. No external API, telemetry, purchase or credential service. Recorded transitions are fixture publications, not execution evidence.';
const n=(type:string,props:Record<string,unknown>,children?:string[]):ElementSpec=>({type,props,...(children?{children}:{})});
const leaf=(type:string,binding:string,state:string,actionId?:string,actionLabel?:string):SurfaceSpec=>({root:'object',elements:{object:n(type,{dataBinding:binding,stateKey:state,...(actionId?{actionId}:{}) ,...(actionLabel?{actionLabel}:{})})}});
export type W2Scene={id:string;title:string;request:string;spec:SurfaceSpec;inputs:Record<string,unknown>;values?:Record<string,unknown>;caption?:string};
export function localW2Scenes():W2Scene[]{return [
 {id:'diagnostics',title:'Review the check results',request:'Review these check results.',spec:softwareDevelopmentSpec('Diagnostics','inspect'),inputs:{software:SOFTWARE_FIXTURE_DATA.Diagnostics}},
 {id:'change-set',title:'Review the proposed patch',request:'Review the proposed patch.',spec:softwareDevelopmentSpec('ChangeSet','review'),inputs:{software:SOFTWARE_FIXTURE_DATA.ChangeSet}},
 {id:'api-explorer',title:'Inspect the order API',request:'Inspect this API contract.',spec:softwareDevelopmentSpec('ApiExplorer'),inputs:{software:SOFTWARE_FIXTURE_DATA.ApiExplorer}},
 {id:'pipeline',title:'Review the release checks',request:'Review the release checks.',spec:softwareDevelopmentSpec('Pipeline'),inputs:{software:SOFTWARE_FIXTURE_DATA.Pipeline}},
 {id:'stats',title:'Review site measurements',request:'Review these measurements.',spec:leaf('Stats','metrics','metric'),inputs:{metrics:EVERYDAY_REVIEW_DATA.Stats}},
 {id:'comparison',title:'Choose a project plan',request:'Compare the supplied plans.',spec:leaf('Comparison','options','option','choose','Save preference'),inputs:{options:EVERYDAY_REVIEW_DATA.Comparison}},
 {id:'credential-entry',title:'Project API credential',request:'Keep this project token private.',spec:{root:'credential',elements:{credential:n('CredentialEntry',{slotKey:'projectApiToken',label:'Project API token',service:'Project API'})}},inputs:{},caption:'An explicitly synthetic token is saved only in the recorder’s in-memory fixture endpoint, then removed. No external connection or real secret is used.'},
];}
