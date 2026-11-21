import {LanguageDescription,type Language} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {classHighlighter,highlightCode} from '@lezer/highlight';
export interface Segment {text:string;classes:string}
// `@lezer/common` is a transitive dependency that pnpm does not hoist to the
// root, so the parser type is derived from the Language contract instead.
export type HighlightParser=Language['parser'];
const parsers=new Map<string,HighlightParser|null>();   // resolved results only; failures are not cached
export function resolve(tag:string){return LanguageDescription.matchLanguageName(languages,tag,false)??LanguageDescription.matchFilename(languages,'file.'+tag);}
export function cachedParser(tag:string){return parsers.get(tag);}   // undefined = not loaded yet
export async function loadParser(tag:string):Promise<HighlightParser|null>{
  if(parsers.has(tag))return parsers.get(tag)!;
  const description=resolve(tag);
  if(!description){parsers.set(tag,null);return null;}
  const support=description.support??await description.load();   // throws on chunk failure -> caller treats as plain, not cached
  parsers.set(tag,support.language.parser);return support.language.parser;
}
export function segments(code:string,parser:HighlightParser):Segment[]{
  const out:Segment[]=[];
  highlightCode(code,parser.parse(code),classHighlighter,(text,classes)=>{out.push({text,classes});},()=>{out.push({text:'\n',classes:''});});
  return out;
}
