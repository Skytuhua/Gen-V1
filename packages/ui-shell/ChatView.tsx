import type {ReactNode} from 'react';
import './chat-view.css';

/** The plain in-flow chat surface used for the home view and embedded panes.
 * Floating, docking and split moves are owned by the workspace split plane;
 * this shell keeps no layout switcher of its own. */
export function ChatView({header,actions,children}:{header:ReactNode;actions?:ReactNode;children:ReactNode}){
 return <div className="workspace chat-view-slot">
  <main className="workspace chat-view-surface" aria-label="Chat">
   <header className="workspace-header chat-view-header">{header}<div className="header-actions">{actions}</div></header>
   {children}
  </main>
 </div>;
}
