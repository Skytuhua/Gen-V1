import {ChevronRight,FolderPlus} from 'lucide-react';
import './connect-folder-notice.css';

// Prerequisite (not an error): the owning project has no local folder yet.
// onConnect is absent in detached windows, where the dialog cannot open.
export function ConnectFolderNotice({onConnect}:{onConnect?:()=>void}){
 return <button type="button" className="connect-folder-notice" disabled={!onConnect} onClick={onConnect}>
  <FolderPlus size={14} aria-hidden="true"/>
  <span>Connect this project to a local folder</span>
  <ChevronRight size={12} aria-hidden="true"/>
 </button>;
}
