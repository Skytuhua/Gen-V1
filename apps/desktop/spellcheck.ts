import type {DesktopSpellcheckLanguages,DesktopSpellcheckState} from '../../packages/desktop-contract/index.ts';
import type {MenuItemConstructorOptions} from 'electron';

export const spellcheckLanguageTag=/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const maxLanguageLength=35;

export function parseSpellcheckState(value:unknown):DesktopSpellcheckState{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2)throw Error('Invalid spellcheck action.');
 const state=value as Record<string,unknown>;
 if(typeof state.enabled!=='boolean')throw Error('Invalid spellcheck action.');
 if(state.language!==null&&(typeof state.language!=='string'||state.language.length>maxLanguageLength||!spellcheckLanguageTag.test(state.language)))throw Error('Invalid spellcheck language.');
 return {enabled:state.enabled,language:state.language as string|null};
}

// "Match system" = the platform's preferred languages that have a dictionary,
// falling back to en-US when nothing matches. Mirrors R06.
export function resolveSpellcheckLanguages(preferred:string[],available:string[],platform:string):string[]{
 if(platform==='darwin')return preferred.filter(tag=>available.includes(tag));
 const set=new Set(available);
 const chosen=preferred.filter(tag=>set.has(tag));
 return chosen.length>0?chosen:['en-US'];
}

export function spellcheckLanguagesInfo(platform:string,spellSession:{availableSpellCheckerLanguages:string[]}):DesktopSpellcheckLanguages{
 const platformManaged=platform==='darwin';
 return {platformManaged,available:platformManaged?[]:[...spellSession.availableSpellCheckerLanguages].sort()};
}

// Builds the native context menu for an editable misspelling. Returns null when
// the menu should not open (preference off or non-editable target).
export function buildSpellcheckMenuTemplate(params:{isEditable:boolean;misspelledWord:string;dictionarySuggestions?:string[]},enabled:boolean,contents:{replaceMisspelling(text:string):void},spellSession:{addWordToSpellCheckerDictionary(word:string):void}):MenuItemConstructorOptions[]|null{
 if(!params.isEditable||!enabled)return null;
 const items:MenuItemConstructorOptions[]=[];
 if(params.misspelledWord){
  const suggestions=(params.dictionarySuggestions??[]).slice(0,5);
  if(suggestions.length===0)items.push({label:'No suggestions',enabled:false});
  else for(const suggestion of suggestions)items.push({label:suggestion,click:()=>contents.replaceMisspelling(suggestion)});
  items.push({label:'Add to dictionary',click:()=>spellSession.addWordToSpellCheckerDictionary(params.misspelledWord)});
 }
 items.push({type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'});
 return items;
}
