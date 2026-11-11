import type {Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

export async function serveChatFixture(page:Page,long=false){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic local conversation.'}}}});
 snapshot.artifacts=[];snapshot.settings.theme='dark';
 if(long)snapshot.resources=[{id:'attachment',threadId:'task-thread',kind:'attachment',path:'/synthetic/notes.txt',label:'notes.txt',writable:false,createdAt:snapshot.messages[0].createdAt}];
 snapshot.threads[0].title='Chat view modes';snapshot.threads[0].projectName='Gen-V1';
 snapshot.messages=[
  {...snapshot.messages[0],id:'question',role:'user',content:'Help me keep this conversation close while I work.'},
  {...snapshot.messages[0],id:'answer',content:'You can keep the same conversation in a full page, a side drawer, or a small pop-up.\n\nYour messages, files, and draft stay with you as you move between layouts.'},
  {...snapshot.messages[0],id:'follow-up',role:'user',content:'I’d like to make room for the workspace.'},
  {...snapshot.messages[0],id:'follow-up-answer',content:'Use the layout menu in the header. Resize a panel from any edge or corner, or move it by its header. You can dock it on the right again whenever you need.'},
 ];
 if(long)for(let index=0;index<24;index++)snapshot.messages.push({...snapshot.messages[1],id:'history-'+index,content:`Message ${index+1}. This synthetic history makes it possible to check that the reading position stays put when the chat changes shape.\n\nThe composer and attachments belong to the same conversation.`});
 return serveTaskFixture(page,snapshot);
}
