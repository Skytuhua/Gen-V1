export const MAX_HIGHLIGHT_CHARS=20_000,MAX_HIGHLIGHT_LINES=1_000;
const PLAIN_TAGS=new Set(['text','txt','plain','plaintext','diff','patch']);
export function parseFenceLanguage(info:string):string|null {
  const word=(info.trim().split(/\s+/)[0]??'').replace(/^\{?\.?/,'').replace(/\}$/,'').toLowerCase();
  return /^[a-z0-9_+#.-]{1,32}$/.test(word)?word:null;
}
export function highlightable(tag:string,code:string):boolean {
  if(PLAIN_TAGS.has(tag)||code.length>MAX_HIGHLIGHT_CHARS)return false;
  let lines=1;for(let i=0;i<code.length;i++)if(code.charCodeAt(i)===10&&++lines>MAX_HIGHLIGHT_LINES)return false;
  return true;
}
