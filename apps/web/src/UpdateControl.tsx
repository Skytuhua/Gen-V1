import {Download} from 'lucide-react';
import {useState} from 'react';
import {useDesktop} from './desktop-context';

/** Both Settings and sidebar actions use the one main-process updater. */
export function UpdateControl({compact=false}: {compact?:boolean}){
 const desktop=useDesktop(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const status=desktop?.state.update,message=error||status?.message||'Install Gen to receive automatic updates.';
 const ready=status?.state==='ready',unavailable=!desktop?.bridge.update||status?.state==='unavailable';
 const run=async()=>{if(!desktop?.bridge.update)return;setBusy(true);setError('');try{await desktop.bridge.update(ready?'restart':'check');}catch{setError('Updates are unavailable. Gen will keep the current version.');}finally{setBusy(false);}};
 if(compact)return <button type="button" title={message} disabled={busy||unavailable||status?.state==='checking'||status?.state==='downloading'} onClick={()=>void run()}><Download size={16}/><span>{ready?'Restart to update':'Update'}</span></button>;
 return <section className="settings-row" aria-label="Gen updates"><div className="settings-row-copy"><h2>Updates</h2><p role="status">{message}{status?.state==='downloading'&&status.percent!==undefined?` ${Math.round(status.percent)}%`:''}</p><p>Stable releases are checked on startup and every six hours. Installation waits for saved work and a normal close.</p></div><div className="settings-row-control"><button className="secondary" disabled={busy||unavailable||status?.state==='checking'||status?.state==='downloading'} onClick={()=>void run()}>{ready?'Restart to update':'Check for updates'}</button></div></section>;
}
