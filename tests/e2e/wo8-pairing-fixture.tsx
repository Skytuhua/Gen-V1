import {createRoot} from 'react-dom/client';
import {JSONUIProvider, Renderer} from '@json-render/react';
import {registry} from '../../apps/web/src/registry';
import {UsageSummary} from '../../apps/web/src/WorkspacePanelBodies';
import {NotificationSettings} from '../../apps/web/src/AppearanceSettings';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import {EMPTY_USAGE} from '../../packages/contracts';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/settings.css';

const spec = {root:'layout',elements:{
  layout:{type:'Stack',props:{gap:'lg'},children:['metric','progress','steps','table','comparison']},
  metric:{type:'Metric',props:{label:'Files reviewed',value:124800,unit:'files'}},
  progress:{type:'Progress',props:{label:'Review progress',value:2,max:4}},
  steps:{type:'Steps',props:{stateKey:'step',steps:[{key:'review',label:'Review a long supplied task label that can wrap'},{key:'verify',label:'Verify'}]},children:['stepOne','stepTwo']},
  stepOne:{type:'Text',props:{text:'Review source records.'}},stepTwo:{type:'Text',props:{text:'Verify the result.'}},
  table:{type:'Table',props:{rowsBinding:'records',caption:'Reported records',columns:[{key:'label',label:'Record'},{key:'count',label:'Count',type:'number'},{key:'code',label:'Code'}]}},
  comparison:{type:'Comparison',props:{dataBinding:'options',stateKey:'option'}},
}};
const usage={...EMPTY_USAGE,contextTokens:8000,contextWindow:10000,inputTokens:124800,outputTokens:18240,cost:.42,sessionPercent:23.456,weeklyPercent:0};
createRoot(document.getElementById('root')!).render(<main style={{padding:16,maxWidth:760,margin:'auto'}}>
  <p>Synthetic WO-8 production component fixture</p>
  <UsageSummary usage={usage}/>
  <JSONUIProvider registry={registry} initialState={{inputs:{records:[{label:'First record',count:123456789012345,code:'0012'},{label:'Second record',count:0,code:'1234'}],options:{title:'Supplied comparison',source:'Synthetic source',criteria:[{id:'count',label:'Count'},{id:'code',label:'Code'}],options:[{id:'a',label:'Option A',values:{count:123456789012345,code:'0012'}},{id:'b',label:'Option B',values:{count:0,code:'1234'}}]}}}}>
    <Renderer registry={registry} spec={spec}/>
  </JSONUIProvider>
  <NotificationSettings preferences={DEFAULT_PREFERENCES} busy={false} update={async()=>{}}/>
</main>);
