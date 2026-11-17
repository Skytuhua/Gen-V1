export function activityOutputRows(messages:readonly {id:string;content:string}[]):{id:string;text:string}[] {
 return messages.flatMap((message,messageIndex)=>{
  const lines=message.content.split('\n');
  if(messageIndex===messages.length-1&&(message.content.endsWith('\n')||messages.length>1&&message.content===''))lines.pop();
  return lines.map((text,index)=>({id:`${message.id}:${index}`,text}));
 });
}
