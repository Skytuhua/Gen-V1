import {Skeleton} from './LoadingState';
import './settings.css';
import './agents-workspace/agents-workspace.css';

// Use the destination's layout classes so its breakpoints and reserved areas agree.
export function ConversationSkeleton() {
  return <div className="loading-conversation" aria-hidden="true">
    <div className="loading-message loading-message-user"><span className="loading-skeleton loading-skeleton-line"/></div>
    <div className="loading-message"><Skeleton/></div>
  </div>;
}

export function ComposerSkeleton() {
  return <div className="loading-composer" aria-hidden="true">
    <span className="loading-skeleton loading-skeleton-line"/>
    <div className="loading-composer-controls"><span className="loading-skeleton loading-skeleton-control"/><span className="loading-skeleton loading-skeleton-icon"/></div>
  </div>;
}

export function WorkspaceSkeleton({sidebar = true}: {sidebar?: boolean}) {
  return <div className="loading-workspace" aria-hidden="true">
    {sidebar && <div className="sidebar"><div className="brand-row"><span className="loading-skeleton loading-skeleton-icon"/><span className="loading-skeleton loading-skeleton-line"/></div><Skeleton/><div className="sidebar-footer"><span className="loading-skeleton loading-skeleton-control"/></div></div>}
    <div className="workspace"><div className="workspace-header"><span className="loading-skeleton loading-skeleton-control"/></div><div className="conversation-scroll"><ConversationSkeleton/></div><div className="composer-dock"><ComposerSkeleton/></div></div>
  </div>;
}

export function AgentsSkeleton() {
  return <div className="loading-agents" aria-hidden="true">{[0, 1].map(project => <div className="agents-project" key={project}>
    <div className="agents-project-header"><span className="loading-skeleton agents-project-mark"/><span className="loading-skeleton loading-skeleton-control"/></div>
    <div className="agents-project-slot"><div className="agents-agent-grid">{[0, 1].map(agent => <div className="agents-grid-slot" key={agent}><div className="agents-agent">
      <div className="agents-agent-header"><span className="loading-skeleton loading-skeleton-line"/></div><div className="agents-activity"><span className="loading-skeleton loading-skeleton-control"/></div>
      <div className="agents-transcript-wrap"><div className="agents-transcript"><ConversationSkeleton/></div></div>
      <div className="loading-agent-composer"><ComposerSkeleton/></div>
      <div className="agents-children"><div className="agents-child"><Skeleton/></div></div>
    </div></div>)}</div></div>
  </div>)}</div>;
}

export function SettingsSkeleton() {
  return <div className="settings-layout" aria-hidden="true">
    <div className="settings-navigation"><span className="loading-skeleton loading-skeleton-field"/>{[0, 1, 2, 3].map(group => <Skeleton key={group}/>)}</div>
    <div className="settings-content"><div className="settings-page-heading"><span className="loading-skeleton loading-skeleton-control"/></div>{[0, 1, 2].map(section => <div className="settings-row" key={section}><div className="settings-row-copy"><span className="loading-skeleton loading-skeleton-line"/><span className="loading-skeleton loading-skeleton-line"/></div><span className="loading-skeleton loading-skeleton-control"/></div>)}</div>
  </div>;
}
