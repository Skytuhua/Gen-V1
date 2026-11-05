/**
 * Adapted from Vespin, Copyright 2026 Stage Inc., Apache-2.0.
 * Pinned source/ranges and modifications are recorded in provenance.json.
 * This is only the list/row/reader presentation. No Vespin service or store is used.
 */
import {memo,type ReactNode,type Ref} from 'react';

interface InboxItemRowProps {
 title:string;description:ReactNode;lead:{icon:ReactNode;label:ReactNode};meta:ReactNode;
 unread:boolean;current:boolean;muted:boolean;onPress:()=>void;label:string;pressRef?:Ref<HTMLButtonElement>;
}

/** ListRow's ABOVE lead + TITLE metadata branch, as InboxItemRow composes it. */
export const InboxItemRow=memo(function InboxItemRow({title,description,lead,meta,unread,current,muted,onPress,label,pressRef}:InboxItemRowProps){
 const heading=(
  <span className="ui-list-row-title">
   {unread?<span className="sr-only">Unread. </span>:null}
   {title}
  </span>
 );
 const end=(
  <span className="ui-list-row-end">
   <span className="ui-list-row-meta">{meta}</span>
  </span>
 );
 const leadMark=(
  <span className="ui-list-row-lead" data-at="above">
   <span className="ui-list-row-lead-icon" aria-hidden="true">{lead.icon}</span>
   <span className="ui-list-row-lead-label">{lead.label}</span>
  </span>
 );
 const face=(
  <>
   <span className="ui-list-row-leading" aria-hidden="true">
    <span className="ui-unread-dot" data-unread={unread?'true':undefined}/>
   </span>
   <span className="ui-list-row-text">
    <span className="ui-list-row-head">{leadMark}{end}</span>
    {heading}
    <span className="ui-list-row-description"><span className="inbox-row-line">{description}</span></span>
   </span>
  </>
 );
 return(
  <li className="ui-list-row" data-meta="title" data-lead="above" data-current={current?'true':undefined} data-current-look="tint" data-unread={unread?'true':undefined} data-muted={muted?'true':undefined} data-ink="sidebar">
   <button ref={pressRef} type="button" className="ui-list-row-main" aria-current={current?'page':undefined} aria-label={label} onClick={onPress}>{face}</button>
  </li>
 );
});

/** InboxList's head, search, held row body and scroll area without application providers. */
export function InboxList({label,hidden,head,search,children,note,empty}:{label:string;hidden:boolean;head:ReactNode;search:ReactNode;children:ReactNode;note?:ReactNode;empty:boolean}){
 const body=(
  <div className="inbox-tasks-body" data-empty={String(empty)}>
   <ul className="sidebar-tasks ui-list">{children}</ul>
   {note}
  </div>
 );
 return(
  <nav className="inbox-tasks" aria-label={label} hidden={hidden}>
   {head}
   {search}
   <div className="inbox-tasks-scroll" tabIndex={0}>{body}</div>
  </nav>
 );
}

/** Subject and ConversationContent structure from InboxPane. Actions are supplied by Gen. */
export function InboxPane({title,hidden,toolbar,children,footer,paneRef,empty}:{title?:string;hidden:boolean;toolbar:ReactNode;children?:ReactNode;footer?:ReactNode;paneRef?:Ref<HTMLElement>;empty?:ReactNode}){
 return(
  <section ref={paneRef} className="inbox-view-items" aria-label={title??'Selected inbox item'} hidden={hidden} tabIndex={-1}>
   {toolbar}
   <div className="desktop-inbox">
    {title?<div className="inbox-board">
     <header className="inbox-subject"><h2 className="inbox-subject-title" data-inbox-title="">{title}</h2></header>
     <ol className="inbox-thread" aria-label="Messages"><li>{children}</li></ol>
     {footer}
    </div>:empty}
   </div>
  </section>
 );
}
