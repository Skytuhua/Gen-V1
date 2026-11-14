import {createRoot} from 'react-dom/client';
import {ShellNotice} from '../../apps/web/src/ShellNotice';

export function mountNotice(container:HTMLElement) {
 const root=createRoot(container);
 root.render(<ShellNotice message="Keep this visible." onDismiss={()=>root.unmount()}/>);
}
