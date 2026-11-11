import {useState} from 'react';
import '@fontsource-variable/inter';
import {createRoot} from 'react-dom/client';
import {createStateStore,StateProvider,type ComponentRenderProps} from '@json-render/react';
import {RelationshipGraph} from '../../../apps/web/src/RelationshipGraph';
import {Modal} from '../../../packages/ui-shell/Modal';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/appearance.css';
import '../../../apps/web/src/task-motion.css';

const graph={nodes:[{id:'structure',label:'Map modules',detail:'Source modules and imports',lane:0},{id:'worker',label:'Review dependencies',detail:'Read-only source review',lane:1,conflictCount:1,excerpts:[{label:'Source',text:'export function total(items) { return items.length; }'}]},{id:'result',label:'Review findings',detail:'Summarize verified relationships',lane:0}],edges:[{from:'structure',to:'worker'},{from:'worker',to:'result'}],checks:[{label:'Types',status:'success',detail:'The supplied type check passed.'}],summary:{label:'Review the dependency findings',status:'pending'},source:'Synthetic graph; no model or remote effects.'};
const store=createStateStore({values:{},inputs:{network:graph}});
Object.assign(window,{graphFixture:{store,graph,reorder:()=>store.set('/inputs/network',{...graph,nodes:[graph.nodes[2],graph.nodes[1],graph.nodes[0]]})}});
const element={type:'RelationshipGraph',props:{dataBinding:'network',stateKey:'selection',label:'Dependency review'}} as ComponentRenderProps['element'];
const graphProps:ComponentRenderProps={element,emit:()=>{},on:()=>({emit:()=>{},shouldPreventDefault:false,bound:false})};
function Fixture(){const[open,setOpen]=useState(false);return <main style={{padding:'56px 16px 16px'}}><p>Synthetic graph fixture</p><button onClick={()=>setOpen(true)}>Open diagram</button><button>Outside graph</button><StateProvider store={store}><RelationshipGraph {...graphProps}/><Modal open={open} title="Diagram details" onClose={()=>setOpen(false)}><RelationshipGraph {...graphProps}><button type="button">Continue review</button></RelationshipGraph></Modal></StateProvider></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
