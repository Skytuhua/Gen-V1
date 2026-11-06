import type {ReactNode} from 'react';
import {ActionProvider, Renderer, VisibilityProvider} from '@json-render/react';
import {registry, Unsupported} from './registry';

/** Catalog presentation only. State, actions, credentials and native ownership
 * are provided by its caller; this component never dispatches a host command. */
export function ArtifactPresentation({spec}: {spec:Parameters<typeof Renderer>[0]['spec']}) {
  return <VisibilityProvider><ActionProvider><Renderer spec={spec} registry={registry} fallback={Unsupported}/></ActionProvider></VisibilityProvider>;
}
export function ArtifactFrame({title,tools,children}: {title:string;tools?:ReactNode;children:ReactNode}) {
  return <section className="artifact artifact-width-standard artifact-frame-card" aria-label={title}><header className="artifact-header"><span className="artifact-title"><strong>{title}</strong></span>{Boolean(tools)&&<div className="artifact-tools">{tools}</div>}</header><div className="artifact-body"><div className="artifact-content">{children}</div></div></section>;
}
