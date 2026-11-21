import {Select} from '../../../packages/ui-shell/Select';
import {settingsOperation} from './settings-operations';
import {IntegrationSecretReferences} from './IntegrationSecretReferences';
import {useEffect,useState} from 'react';
import type {IntegrationStatus,PonytailMode} from '../../../packages/contracts/integrations.ts';
import {authenticated,csrfToken,read} from './api';

export function IntegrationSettings({query=''}:{query?:string}){
 const [items,setItems]=useState<IntegrationStatus[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const load=()=>authenticated(()=>fetch('/api/integrations',{credentials:'same-origin',cache:'no-store'})).then(read<{integrations:IntegrationStatus[]}>).then(value=>setItems(value.integrations));
 useEffect(()=>{let alive=true;void authenticated(()=>fetch('/api/integrations',{credentials:'same-origin',cache:'no-store'})).then(read<{integrations:IntegrationStatus[]}>).then(value=>{if(alive)setItems(value.integrations);}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'Integration inventory could not load.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[]);
 const update=(id:string,type:string,payload:Record<string,unknown>={})=>{setBusy(id);setError('');void settingsOperation(()=>authenticated(()=>fetch(`/api/integrations/${encodeURIComponent(id)}/commands`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({id:crypto.randomUUID(),type,payload})})).then(read).then(load)).catch(cause=>setError(cause instanceof Error?cause.message:'Integration could not be updated.')).finally(()=>setBusy(null));};
 const recheck=(id:string)=>{setBusy(id);setError('');void load().catch(cause=>setError(cause instanceof Error?cause.message:'Integration inventory could not load.')).finally(()=>setBusy(null));};
 const tokens=query.toLowerCase().trim().split(/\s+/).filter(Boolean),matching=items.filter(item=>tokens.every(token=>`${item.name} ${item.id} ${item.version} ${item.state} ${item.capabilities.skills.join(' ')} ${item.capabilities.commands.join(' ')}`.toLowerCase().includes(token)));
 return <div className="integration-settings">
  {loading&&<p role="status" className="muted">Reading bundled integrations…</p>}
  {error&&<div><p role="status" className="error-text">Integrations could not be checked or updated. Recheck the inventory and try again.</p><button type="button" className="secondary" disabled={busy!==null} onClick={()=>recheck('$inventory')}>Recheck integrations</button><details><summary>Technical details</summary><pre>{error}</pre></details></div>}
  {matching.map(item=><section className="settings-row" key={item.id}>
   <div className="settings-row-copy">
    <h2>{item.name}<span className="availability">{item.state.replaceAll('-',' ')}</span></h2>
    <p>Version {item.version} · {item.installed?'Bundled locally':'Payload unavailable'}{item.capabilities.mcp?' · Starts on use':''}{item.id==='context7'?' · Online documentation':''}</p>
    {(!item.installed||item.error)&&<div className="integration-recovery">
     <p>{!item.installed?`${item.name} isn't installed in this environment. Restore its bundled files by repairing or reinstalling the application, then recheck.`:`${item.name} is unavailable. Check its setup, then recheck the integration.`}</p>
     <button type="button" className="secondary" disabled={busy!==null} onClick={()=>recheck(item.id)}>{busy===item.id?'Rechecking…':`Recheck ${item.name}`}</button>
     {item.error&&<details><summary>Technical details</summary><pre>{item.error}</pre></details>}
    </div>}
    {item.capabilities.skills.length>0&&<p>{item.capabilities.skills.length} skills · {item.capabilities.commands.length} commands{item.capabilities.hooks.length?` · ${item.capabilities.hooks.length} hooks`:''}</p>}
    {item.id==='context7'&&<IntegrationSecretReferences/>}
   </div>
   <div className="settings-row-control">
    {item.id==='ponytail'&&<Select aria-label="Ponytail mode" disabled={busy!==null||!item.installed} value={item.mode??'full'} onValueChange={mode=>update(item.id,'configure',{mode:mode as PonytailMode})} options={[{value:'off',label:'Off'},{value:'lite',label:'Lite'},{value:'full',label:'Full'},{value:'ultra',label:'Ultra'}]}/>}
    <button className="settings-switch" role="switch" aria-label={`${item.name} integration`} aria-checked={item.enabled} disabled={busy!==null||!item.installed} onClick={()=>update(item.id,item.enabled?'disable':'enable')}><span/></button>
   </div>
  </section>)}
 </div>;
}
