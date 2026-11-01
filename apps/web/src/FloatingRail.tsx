import{createContext,isValidElement,useCallback,useMemo,useRef,useState,type MutableRefObject,type ReactNode}from'react';

type WindowState={open:boolean;collapsed:boolean};
export const FloatingRailSlotContext=createContext<{element:MutableRefObject<HTMLDivElement|null>;report:(state:WindowState|null)=>void}|null>(null);
function Slot({name,state,onState,children}:{name:'plan'|'usage';state:WindowState;onState:(value:WindowState)=>void;children:ReactNode}){
 const element=useRef<HTMLDivElement|null>(null),report=useCallback((value:WindowState|null)=>onState(value??{open:false,collapsed:true}),[onState]);
 const context=useMemo(()=>({element,report}),[report]);
 return <div ref={element} className={`floating-rail-slot floating-rail-${name}`} data-open={state.open} data-collapsed={state.collapsed}><FloatingRailSlotContext.Provider value={context}>{children}</FloatingRailSlotContext.Provider></div>;
}
/** On-demand tools share an overlay anchor without reserving conversation width. */
export function FloatingRail({plan,usage}:{plan:ReactNode;usage:ReactNode}){
 const[planState,setPlan]=useState<WindowState>(()=>({open:isValidElement<{open?:boolean}>(plan)&&plan.props.open!==false,collapsed:false})),[usageState,setUsage]=useState<WindowState>({open:false,collapsed:true});
 const reportPlan=useCallback((value:WindowState)=>setPlan(old=>old.open===value.open&&old.collapsed===value.collapsed?old:value),[]);
 const reportUsage=useCallback((value:WindowState)=>setUsage(old=>old.open===value.open&&old.collapsed===value.collapsed?old:value),[]);
 return <aside className="floating-rail" aria-label="Task tools" data-active={planState.open||usageState.open} data-plan-open={planState.open} data-usage-open={usageState.open} data-plan-collapsed={planState.collapsed} data-usage-collapsed={usageState.collapsed}>
  <Slot name="plan" state={planState} onState={reportPlan}>{plan}</Slot><Slot name="usage" state={usageState} onState={reportUsage}>{usage}</Slot>
 </aside>;
}
