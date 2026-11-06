import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Settings } from '../../apps/web/src/Settings';
import { Modal } from '../../packages/ui-shell/Modal';
import { getSnapshot } from '../../apps/web/src/api';
import type { Snapshot } from '../../packages/contracts';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const fixture = window as unknown as { settingsFixture: Snapshot; openedUrls: string[] };
function ManualBrowserFixture() {
  const [snapshot,setSnapshot]=useState(fixture.settingsFixture),[open,setOpen]=useState(true);
  const refresh=async()=>setSnapshot(await getSnapshot());
  return <><p>Synthetic settings adapter fixture</p><Modal open={open} title="Settings" className="settings-dialog" onClose={()=>setOpen(false)}><Settings snapshot={snapshot} modelError="" loadModels={async()=>{}} refresh={refresh} close={()=>setOpen(false)} addResource={()=>{}} initialSection="browser" openBrowser={async url=>{fixture.openedUrls.push(url);}}/></Modal></>;
}
createRoot(document.getElementById('root')!).render(<ManualBrowserFixture/>);
