import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

// Separate React roots share one normal-flow tool owner in their own document.
// Closing a tool hides its section; its renderer and drafts remain mounted.
const docks=new WeakMap<Document,{element:HTMLElement;widths:Map<symbol,number>}>();
export function ToolDock({width,children}:{width:number;children:ReactNode}){
 const [element,setElement]=useState<HTMLElement|null>(null),identity=useRef(Symbol());
 useLayoutEffect(()=>{
  const owner=document;let dock=docks.get(owner);
  if(!dock){const element=owner.createElement('aside');element.className='ui-tool-dock';element.setAttribute('aria-label','Tools');dock={element,widths:new Map()};docks.set(owner,dock);owner.body.append(element);}
  dock.widths.set(identity.current,width);dock.element.style.width=`${Math.max(...dock.widths.values())}px`;setElement(dock.element);
  return()=>{dock.widths.delete(identity.current);if(dock.widths.size)dock.element.style.width=`${Math.max(...dock.widths.values())}px`;else{dock.element.remove();docks.delete(owner);}};
 },[]);
 useLayoutEffect(()=>{const dock=docks.get(document);if(dock&&element){dock.widths.set(identity.current,width);element.style.width=`${Math.max(...dock.widths.values())}px`;}},[width,element]);
 return element?createPortal(children,element):null;
}
