import { Fragment, memo, useContext, useMemo, type ReactNode } from 'react';
import { FileReferenceContext, FileReferenceNode } from './FileReference';
import { findTextReferences, parseCodeSpanReference } from './file-references';
import {SentenceReveal} from './SentenceReveal';
import {CopyButton} from './CopyButton';
import './markdown.css';

const REF_BUDGET = { count: 0 };
function inline(text: string, fileRefs: boolean): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/[^\s)]+|#[^\s)]+)\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      const content = part.slice(1, -1);
      const ref = fileRefs && REF_BUDGET.count < 64 ? parseCodeSpanReference(content) : null;
      if (ref) { REF_BUDGET.count++; return <FileReferenceNode key={index} reference={ref} raw={content} code />; }
      return <code key={index}>{content}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target={link[2].startsWith('#') ? undefined : '_blank'} rel="noreferrer">{link[1]}</a>;
    if (fileRefs && REF_BUDGET.count < 64) {
      const hits = findTextReferences(part, 64 - REF_BUDGET.count);
      if (hits.length) {
        REF_BUDGET.count += hits.length;
        const pieces: ReactNode[] = [];
        let cursor = 0;
        for (const hit of hits) {
          if (hit.start > cursor) pieces.push(part.slice(cursor, hit.start));
          pieces.push(<FileReferenceNode key={`${index}-${cursor}`} reference={hit.ref} raw={part.slice(hit.start, hit.end)} />);
          cursor = hit.end;
        }
        if (cursor < part.length) pieces.push(part.slice(cursor));
        return <Fragment key={index}>{pieces}</Fragment>;
      }
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type Alignment='left'|'center'|'right'|undefined;
const MAX_TABLE_COLUMNS=24,MAX_TABLE_ROWS=200,MAX_TABLE_CELLS=4096;
function tableRow(line:string){
  const source=line.trim(),cells:string[]=[];let value='',ticks=0,pipes=0;
  for(let index=0;index<source.length;index++){
    const character=source[index]!;
    if(character==='\\'&&source[index+1]==='|'&&!ticks){value+='|';index++;continue;}
    if(character==='\\'&&source[index+1]==='\\'&&!ticks){value+='\\';index++;continue;}
    if(character==='`'){
      let end=index+1;while(source[end]==='`')end++;const count=end-index;
      if(!ticks)ticks=count;else if(ticks===count)ticks=0;
      value+=source.slice(index,end);index=end-1;continue;
    }
    if(character==='|'&&!ticks){cells.push(value.trim());value='';pipes++;}else value+=character;
  }
  cells.push(value.trim());
  if(source.startsWith('|'))cells.shift();
  if(source.endsWith('|')&&cells.at(-1)==='')cells.pop();
  return {cells,pipes};
}
function tableStart(lines:string[],index:number){
  if(!lines[index]?.includes('|')||!lines[index+1]?.includes('-'))return null;
  const header=tableRow(lines[index]!),separator=tableRow(lines[index+1]!);
  if(!header.pipes||!header.cells.length||header.cells.length!==separator.cells.length||!separator.cells.every(cell=>/^:?-{3,}:?$/.test(cell)))return null;
  return {header:header.cells,oversized:header.cells.length>MAX_TABLE_COLUMNS,align:header.cells.length>MAX_TABLE_COLUMNS?[]:separator.cells.map<Alignment>(cell=>cell.startsWith(':')?cell.endsWith(':')?'center':'left':cell.endsWith(':')?'right':undefined)};
}
function marker(line:string){
  const match=/^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
  return match?{indent:match[1]!.replaceAll('\t','    ').length,ordered:/^\d/.test(match[2]!),start:Number.parseInt(match[2]!,10),text:match[3]!}:null;
}
const heading=(line:string)=>/^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
const fence=(line:string)=>/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const numeric=(value:string)=>/^[+\-−]?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|ms|s|bytes?|[kmg]i?b))?$/i.test(value);
const startsList=(line:string)=>{const item=marker(line);return item!==null&&item.indent<4;};

function list(lines:string[],start:number,key:string,depth=0,fileRefs=false):{node:ReactNode;next:number}{
  const first=marker(lines[start]!)!,items:ReactNode[]=[];let index=start;
  while(index<lines.length){
    const current=marker(lines[index]!);if(!current||current.indent!==first.indent||current.ordered!==first.ordered)break;
    let text=current.text;const children:ReactNode[]=[];index++;
    while(index<lines.length){
      const line=lines[index]!,next=marker(line);
      if(!line.trim()){
        let after=index+1;while(after<lines.length&&!lines[after]!.trim())after++;
        const following=marker(lines[after]??'');
        if(following&&following.indent===first.indent&&following.ordered===first.ordered)index=after;
        break;
      }
      if(next){
        if(next.indent<=first.indent)break;
        if(depth<12){const nested=list(lines,index,`${key}-${items.length}-${children.length}`,depth+1,fileRefs);children.push(nested.node);index=nested.next;continue;}
      }
      if(heading(line)||fence(line)||tableStart(lines,index))break;
      text+='\n'+line.trim();index++;
    }
    items.push(<li key={items.length}>{inline(text,fileRefs)}{children}</li>);
  }
  return {node:first.ordered?<ol key={key} className="markdown-list" start={first.start}>{items}</ol>:<ul key={key} className="markdown-list">{items}</ul>,next:index};
}

/** A small safe block renderer; malformed table rows remain visible as prose. */
function blocks(text:string,fileRefs:boolean):ReactNode[]{
  const lines=text.replaceAll('\r\n','\n').split('\n'),nodes:ReactNode[]=[];let index=0,tableCells=0;
  while(index<lines.length){
    if(!lines[index]!.trim()){index++;continue;}
    const key=String(index),opening=fence(lines[index]!);
    if(opening){
      const start=++index,character=opening[1]![0]!,minimum=opening[1]!.length;
      while(index<lines.length&&!new RegExp(`^ {0,3}${character}{${minimum},}[ \\t]*$`).test(lines[index]!))index++;
      const code=lines.slice(start,index).join('\n')+(index<lines.length&&index>start?'\n':'');
      nodes.push(<div key={key} className="markdown-code"><CopyButton text={code} label="Copy code"/><pre><code>{code}</code></pre></div>);if(index<lines.length)index++;continue;
    }
    const title=heading(lines[index]!);
    if(title){const Heading=`h${title[1]!.length}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6';nodes.push(<Heading key={key}>{inline(title[2]!,fileRefs)}</Heading>);index++;continue;}
    const table=tableStart(lines,index);
    if(table){
      const start=index,rows:string[][]=[];let rowCount=0,oversized=table.oversized||tableCells+table.header.length>MAX_TABLE_CELLS;index+=2;
      while(index<lines.length&&lines[index]!.trim()){
        const row=tableRow(lines[index]!);
        if(!row.pipes||row.cells.length>table.header.length)break;
        rowCount++;
        oversized ||= rowCount>MAX_TABLE_ROWS||tableCells+(rowCount+1)*table.header.length>MAX_TABLE_CELLS;
        if(!oversized)rows.push([...row.cells,...Array<string>(table.header.length-row.cells.length).fill('')]);index++;
      }
      if(oversized){nodes.push(<p key={key} className="markdown-table-fallback">{lines.slice(start,index).join('\n')}</p>);continue;}
      tableCells+=(rowCount+1)*table.header.length;
      const align=table.align.map((value,column)=>value??(rows.some(row=>row[column])&&rows.every(row=>!row[column]||numeric(row[column]!))?'right':undefined));
      nodes.push(<div key={key} className="markdown-table-scroll" role="region" aria-label="Table" tabIndex={0}><table className="markdown-table"><thead><tr>{table.header.map((cell,column)=><th key={column} scope="col" style={{textAlign:align[column]}}>{inline(cell,fileRefs)}</th>)}</tr></thead><tbody>{rows.map((row,item)=><tr key={item}>{row.map((cell,column)=><td key={column} style={{textAlign:align[column]}}>{inline(cell,fileRefs)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const first=marker(lines[index]!);
    if(first&&first.indent<4){const rendered=list(lines,index,key);nodes.push(rendered.node);index=rendered.next;continue;}
    const paragraph=[lines[index++]!];
    while(index<lines.length&&lines[index]!.trim()&&!fence(lines[index]!)&&!heading(lines[index]!)&&!tableStart(lines,index)&&!startsList(lines[index]!))paragraph.push(lines[index++]!);
    nodes.push(<p key={key}>{inline(paragraph.join('\n'),fileRefs)}</p>);
  }
  return nodes;
}
export const Markdown = memo(function Markdown({ text,animate=false,initialReveal=false }: { text: string;animate?:boolean;initialReveal?:boolean }) {
  const context = useContext(FileReferenceContext);
  const fileRefs = Boolean(context) && !animate;
  const rendered = useMemo(() => { REF_BUDGET.count = 0; return blocks(text, fileRefs); }, [text, fileRefs]);
  return <SentenceReveal className="markdown" text={text} animate={animate} initialReveal={initialReveal}>{rendered}</SentenceReveal>;
});
