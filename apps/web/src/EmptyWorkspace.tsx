import {BookOpen, Bug, GitPullRequest, ListChecks, MessageSquare} from 'lucide-react';

const starters = [
  {label:'Explain this codebase',icon:BookOpen,prompt:'Help me understand this codebase. Start with its architecture, main entry points, and how the important pieces fit together.'},
  {label:'Fix a failing test',icon:Bug,prompt:'Help me investigate a failing test. Identify the root cause, propose the smallest correct fix, and explain how to verify it.'},
  {label:'Plan a new feature',icon:ListChecks,prompt:'Help me plan a new feature. Clarify the requirements, explore the existing implementation, and outline a small, testable delivery plan.'},
  {label:'Review my changes',icon:GitPullRequest,prompt:'Review my current changes for correctness, edge cases, and missing tests. Prioritize actionable findings and explain their impact.'},
];

export function EmptyWorkspace({working,needsSetup,onConnect,onProject,onPrompt}:{working:boolean;needsSetup:boolean;onConnect:()=>void;onProject:()=>void;onPrompt:(prompt:string)=>void}) {
  return <section className="empty-state empty-workspace" aria-label={working?'Run in progress':'Start a conversation'}>
    <div className="empty-workspace-rings" aria-hidden="true"><i/><i/><i/></div>
    <div className="empty-symbol empty-workspace-tile"><MessageSquare size={23} strokeWidth={1.4} aria-hidden="true"/></div>
    <h1>{working?'Run in progress':'What are we working on?'}</h1>
    <p>{working?'The transcript will appear here as the agent works.':'Start with a question, file, or project.'}</p>
    {!working&&<>
      <div className="empty-workspace-starters" aria-label="Suggested prompts">{starters.map(({label,icon:Icon,prompt})=><button type="button" key={label} onClick={()=>onPrompt(prompt)}><Icon size={15} strokeWidth={1.5} aria-hidden="true"/>{label}</button>)}</div>
      {needsSetup&&<ol className="empty-workspace-setup" aria-label="Get started">
        <li aria-current="step"><span className="empty-step-number" aria-hidden="true">1</span><span>Connect a model</span><button type="button" className="primary" onClick={onConnect}>Connect</button></li>
        <li><span className="empty-step-number" aria-hidden="true">2</span><button type="button" className="empty-project-step" onClick={onProject}>Choose a project</button></li>
        <li><span className="empty-step-number" aria-hidden="true">3</span><span>Ask anything</span></li>
      </ol>}
    </>}
  </section>;
}
