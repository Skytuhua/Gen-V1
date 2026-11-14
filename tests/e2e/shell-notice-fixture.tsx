import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {ShellNotice} from '../../apps/web/src/ShellNotice';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const host=document.querySelector('[aria-label="Shell notice fixture"]');
if(host){
 const node=createRoot(host as HTMLElement);
 const render=(message:string)=>node.render(createElement(ShellNotice,{message,onDismiss:()=>render('')}));
 Object.assign(window,{noticeFixture:{render}});
}
